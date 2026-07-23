import { normalizeText, sanitizeQuestion, sha256 } from "./common.js";
import { buildFallbackClassification, classifyQuestion } from "./ai.js";

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

  try {
    const schema = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('questions', 'question_revisions')
    `).first();
    if (Number(schema?.total || 0) !== 2) {
      throw new Error("As tabelas questions e question_revisions não existem. Execute o arquivo schema.sql no banco D1 vinculado.");
    }
  } catch (error) {
    throw new Error(`Banco D1 não inicializado corretamente: ${String(error?.message || error)}`);
  }

  let question;
  try {
    question = sanitizeQuestion(input);
  } catch (error) {
    throw new Error(`Validação da questão: ${String(error?.message || error)}`);
  }

  let classification;
  let classificationWarning = "";
  let archivedWithoutFreshAI = false;

  // Reutiliza a classificação produzida durante a análise visual do PDF.
  // Isso evita gastar a cota uma segunda vez ao aprovar a mesma questão.
  const reusableAiMetadata = Boolean(question.aiModel) &&
    !String(question.aiModel).startsWith("fallback-local:") &&
    !Boolean(question.aiClassification?.pendingAI) &&
    Boolean(
      question.tema || question.unidadeCurricular || question.competencia ||
      question.capacidade || question.habilidade || question.codigoMatriz
    );

  if (reusableAiMetadata) {
    classification = {
      dificuldade: question.dificuldade || "Médio",
      tema: question.tema || "",
      competencia: question.competencia || "",
      capacidade: question.capacidade || "",
      habilidade: question.habilidade || "",
      unidadeCurricular: question.unidadeCurricular || "",
      codigoMatriz: question.codigoMatriz || "",
      tags: Array.isArray(question.aiClassification?.tags) ? question.aiClassification.tags.slice(0, 12) : [],
      confidence: question.aiConfidence || 0.65,
      reviewNotes: ["Classificação gerada durante a análise do PDF e reutilizada no arquivamento."],
      model: question.aiModel,
      reused: true,
      pendingAI: false,
    };
  } else {
    try {
      classification = await classifyQuestion(env, question);
    } catch (error) {
      if (String(env.ARCHIVE_WITHOUT_AI || "true").toLowerCase() === "false") {
        throw new Error(`Classificação por IA: ${String(error?.message || error)}`);
      }
      classification = buildFallbackClassification(question, error);
      archivedWithoutFreshAI = true;
      classificationWarning = classification.reviewNotes?.[0] ||
        "A questão foi arquivada sem uma nova classificação por IA.";
      console.warn("[Arena SAEP] Arquivamento com classificação provisória.", {
        id: question.id,
        reasonCode: classification.reasonCode,
        error: String(error?.message || error),
      });
    }
  }
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
  let stored;
  try {
    stored = await persistImages(env, finalQuestion, idKey);
  } catch (error) {
    throw new Error(`Armazenamento de imagens no R2: ${String(error?.message || error)}`);
  }
  const now = new Date().toISOString();
  const id = duplicate?.id || finalQuestion.id;
  const searchText = normalizeText([id, finalQuestion.enunciado, finalQuestion.tema, finalQuestion.competencia, finalQuestion.capacidade, finalQuestion.habilidade, finalQuestion.unidadeCurricular].join(" "));
  try {
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
  } catch (error) {
    throw new Error(`Gravação da questão no D1: ${String(error?.message || error)}`);
  }
  const row = await env.DB.prepare("SELECT * FROM questions WHERE id_key = ?1 LIMIT 1").bind(idKey).first();
  const archivedQuestion = rowToQuestion(row);
  const revisionId = crypto.randomUUID();
  try {
    await env.DB.prepare(`
    INSERT INTO question_revisions (
      revision_id,question_id_key,question_id,snapshot_json,content_hash,approved_by,ai_model,ai_confidence,created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
  `).bind(
    revisionId,idKey,archivedQuestion.id,JSON.stringify(archivedQuestion),contentHash,instructor,
    classification.model,classification.confidence,now
  ).run();
  } catch (error) {
    throw new Error(`Gravação do histórico no D1: ${String(error?.message || error)}`);
  }
  const responseQuestion = {
    ...archivedQuestion,
    classificationPending: Boolean(classification.pendingAI),
    classificationMode: classification.fallback ? "provisoria-local" : classification.reused ? "ia-reutilizada" : "ia-nova",
    archiveWarning: classificationWarning,
  };
  return {
    question: responseQuestion,
    duplicate: Boolean(duplicate),
    classification,
    revisionId,
    archivedWithoutFreshAI,
    warning: classificationWarning,
  };
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
