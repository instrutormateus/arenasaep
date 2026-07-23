import { normalizeText, sanitizeQuestion, sha256 } from "./common.js";
import { classifyQuestion } from "./ai.js";

const LETTERS = ["A", "B", "C", "D", "E"];

function extFromMime(mime = "image/jpeg") {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime: match[1].replace("image/jpg", "image/jpeg") };
}

function publicImageUrl(key) {
  return `/api/images/${String(key).split("/").map(encodeURIComponent).join("/")}`;
}

async function storeImage(env, idKey, dataUrl, label, index) {
  if (!String(dataUrl || "").startsWith("data:image/")) return String(dataUrl || "");
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return "";
  const digest = (await sha256(dataUrl)).slice(0, 20);
  const key = `questions/${idKey}/${label}-${index}-${digest}.${extFromMime(decoded.mime)}`;
  await env.QUESTION_IMAGES.put(key, decoded.bytes, {
    httpMetadata: { contentType: decoded.mime, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { question: idKey, label },
  });
  return publicImageUrl(key);
}

async function persistImages(env, question, idKey) {
  const images = [];
  for (let i = 0; i < question.imagens.length; i++) images.push(await storeImage(env, idKey, question.imagens[i], "question", i));
  const alt = {};
  for (const letter of LETTERS) {
    alt[letter] = [];
    const list = question.alternativaImagens[letter] || [];
    for (let i = 0; i < list.length; i++) alt[letter].push(await storeImage(env, idKey, list[i], `alternative-${letter}`, i));
  }
  let thumbnail = question.thumbnailUrl;
  if (String(thumbnail || "").startsWith("data:image/")) thumbnail = await storeImage(env, idKey, thumbnail, "thumbnail", 0);
  if (!thumbnail) thumbnail = images[0] || "";
  return { images: images.filter(Boolean), alternativeImages: alt, thumbnail };
}

function rowToQuestion(row) {
  const alternatives = JSON.parse(row.alternatives_json || "[]");
  const images = JSON.parse(row.images_json || "[]");
  const alternativeImages = JSON.parse(row.alternative_images_json || "{}");
  const classification = JSON.parse(row.ai_classification_json || "{}");
  return {
    id: row.id,
    enunciado: row.enunciado,
    alternativas,
    correta: row.correta,
    quantidadeAlternativas: row.quantidade_alternativas,
    dificuldade: row.dificuldade,
    tema: row.tema || "",
    competencia: row.competencia || "",
    capacidade: row.capacidade || "",
    habilidade: row.habilidade || "",
    unidadeCurricular: row.unidade_curricular || "",
    codigoMatriz: row.codigo_matriz || "",
    justificativa: row.justificativa || "",
    fonte: row.fonte || "",
    tempo: row.tempo || null,
    imagens: images,
    imagemUrl: images[0] || "",
    thumbnailUrl: row.thumbnail_url || images[0] || "",
    alternativaImagens: alternativeImages,
    arquivoOrigem: row.arquivo_origem || "",
    paginaOrigem: row.pagina_origem || "",
    statusGabarito: row.status_gabarito || "Validado pelo instrutor",
    observacao: row.observacao || "",
    approvedBy: row.approved_by || "",
    aiModel: row.ai_model || "",
    aiConfidence: Number(row.ai_confidence) || 0,
    aiClassification: classification,
    cloudArchivedAt: row.updated_at,
  };
}

export async function saveQuestion(env, input, instructor) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  const question = sanitizeQuestion(input);
  const classification = await classifyQuestion(env, question);
  const finalQuestion = {
    ...question,
    dificuldade: classification.dificuldade || question.dificuldade,
    tema: classification.tema || question.tema,
    competencia: classification.competencia || question.competencia,
    capacidade: classification.capacidade || question.capacidade,
    habilidade: classification.habilidade || question.habilidade,
    unidadeCurricular: classification.unidadeCurricular || question.unidadeCurricular,
    codigoMatriz: classification.codigoMatriz || question.codigoMatriz,
  };
  const requestedIdKey = normalizeText(finalQuestion.id).replace(/\s+/g, "-") || `q-${Date.now()}`;
  const contentHash = await sha256(JSON.stringify({ enunciado: normalizeText(finalQuestion.enunciado), alternativas: finalQuestion.alternativas.map(normalizeText), correta: finalQuestion.correta }));
  const duplicateByHash = await env.DB.prepare("SELECT * FROM questions WHERE content_hash = ?1 LIMIT 1").bind(contentHash).first();
  const duplicateById = duplicateByHash
    ? null
    : await env.DB.prepare("SELECT * FROM questions WHERE id_key = ?1 LIMIT 1").bind(requestedIdKey).first();
  const duplicate = duplicateByHash || duplicateById;
  // Quando o mesmo conteúdo chega com outro ID, atualizamos o registro original em vez de colidir com o índice UNIQUE de content_hash.
  const idKey = duplicate?.id_key || requestedIdKey;
  const stored = await persistImages(env, finalQuestion, idKey);
  const now = new Date().toISOString();
  const id = duplicate?.id || finalQuestion.id;
  const searchText = normalizeText([id, finalQuestion.enunciado, finalQuestion.tema, finalQuestion.competencia, finalQuestion.capacidade, finalQuestion.habilidade, finalQuestion.unidadeCurricular].join(" "));
  await env.DB.prepare(`
    INSERT INTO questions (
      id,id_key,enunciado,alternatives_json,correta,quantidade_alternativas,dificuldade,tema,competencia,capacidade,habilidade,unidade_curricular,codigo_matriz,justificativa,fonte,tempo,images_json,alternative_images_json,thumbnail_url,arquivo_origem,pagina_origem,status_gabarito,observacao,approved_by,ai_model,ai_confidence,ai_classification_json,content_hash,search_text,status,created_at,updated_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,'active',COALESCE((SELECT created_at FROM questions WHERE id_key=?2),?30),?30)
    ON CONFLICT(id_key) DO UPDATE SET
      id=excluded.id,enunciado=excluded.enunciado,alternatives_json=excluded.alternatives_json,correta=excluded.correta,quantidade_alternativas=excluded.quantidade_alternativas,dificuldade=excluded.dificuldade,tema=excluded.tema,competencia=excluded.competencia,capacidade=excluded.capacidade,habilidade=excluded.habilidade,unidade_curricular=excluded.unidade_curricular,codigo_matriz=excluded.codigo_matriz,justificativa=excluded.justificativa,fonte=excluded.fonte,tempo=excluded.tempo,images_json=excluded.images_json,alternative_images_json=excluded.alternative_images_json,thumbnail_url=excluded.thumbnail_url,arquivo_origem=excluded.arquivo_origem,pagina_origem=excluded.pagina_origem,status_gabarito=excluded.status_gabarito,observacao=excluded.observacao,approved_by=excluded.approved_by,ai_model=excluded.ai_model,ai_confidence=excluded.ai_confidence,ai_classification_json=excluded.ai_classification_json,content_hash=excluded.content_hash,search_text=excluded.search_text,status='active',updated_at=excluded.updated_at
  `).bind(
    id, idKey, finalQuestion.enunciado, JSON.stringify(finalQuestion.alternativas), finalQuestion.correta, finalQuestion.quantidadeAlternativas,
    finalQuestion.dificuldade, finalQuestion.tema, finalQuestion.competencia, finalQuestion.capacidade, finalQuestion.habilidade,
    finalQuestion.unidadeCurricular, finalQuestion.codigoMatriz, finalQuestion.justificativa, finalQuestion.fonte, finalQuestion.tempo,
    JSON.stringify(stored.images), JSON.stringify(stored.alternativeImages), stored.thumbnail, finalQuestion.arquivoOrigem, finalQuestion.paginaOrigem,
    finalQuestion.statusGabarito, finalQuestion.observacao, instructor, classification.model, classification.confidence,
    JSON.stringify(classification), contentHash, searchText, now
  ).run();
  const row = await env.DB.prepare("SELECT * FROM questions WHERE id_key = ?1 LIMIT 1").bind(idKey).first();
  const archivedQuestion = rowToQuestion(row);
  const revisionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO question_revisions (
      revision_id,question_id_key,question_id,snapshot_json,content_hash,approved_by,ai_model,ai_confidence,created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
  `).bind(
    revisionId,idKey,archivedQuestion.id,JSON.stringify(archivedQuestion),contentHash,instructor,
    classification.model,classification.confidence,now
  ).run();
  return { question: archivedQuestion, duplicate: Boolean(duplicate), classification, revisionId };
}

export async function listQuestions(env, url) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  const search = normalizeText(url.searchParams.get("search") || "");
  const difficulty = String(url.searchParams.get("difficulty") || "").trim();
  const theme = String(url.searchParams.get("theme") || "").trim();
  const unit = String(url.searchParams.get("unit") || "").trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const clauses = ["status = 'active'"];
  const params = [];
  if (search) { clauses.push("search_text LIKE ?"); params.push(`%${search}%`); }
  if (difficulty) { clauses.push("dificuldade = ?"); params.push(difficulty); }
  if (theme) { clauses.push("tema LIKE ?"); params.push(`%${theme}%`); }
  if (unit) { clauses.push("unidade_curricular LIKE ?"); params.push(`%${unit}%`); }
  const where = clauses.join(" AND ");
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM questions WHERE ${where}`).bind(...params).first();
  const result = await env.DB.prepare(`SELECT * FROM questions WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
  return { total: Number(totalRow?.total) || 0, questions: (result.results || []).map(rowToQuestion), limit, offset };
}

export async function deleteQuestion(env, id) {
  const idKey = normalizeText(id).replace(/\s+/g, "-");
  const result = await env.DB.prepare("UPDATE questions SET status='deleted', updated_at=?1 WHERE id_key=?2").bind(new Date().toISOString(), idKey).run();
  return { deleted: Number(result.meta?.changes || 0) > 0 };
}


export async function listQuestionHistory(env, id, limit = 50) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  const idKey = normalizeText(id).replace(/\s+/g, "-");
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const result = await env.DB.prepare(`
    SELECT revision_id,question_id,snapshot_json,content_hash,approved_by,ai_model,ai_confidence,created_at
    FROM question_revisions
    WHERE question_id_key = ?1
    ORDER BY created_at DESC
    LIMIT ?2
  `).bind(idKey, safeLimit).all();
  return {
    id,
    revisions: (result.results || []).map((row) => ({
      revisionId: row.revision_id,
      questionId: row.question_id,
      question: JSON.parse(row.snapshot_json || "{}"),
      contentHash: row.content_hash,
      approvedBy: row.approved_by || "",
      aiModel: row.ai_model || "",
      aiConfidence: Number(row.ai_confidence) || 0,
      createdAt: row.created_at,
    })),
  };
}
