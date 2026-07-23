import { normalizeText, safeJsonParse, sanitizeQuestion, sha256 } from "./common.js";
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
  const parsedAlternatives = safeJsonParse(row.alternatives_json, []);
  const storedAlternatives = Array.isArray(parsedAlternatives) ? parsedAlternatives.map(String) : [];
  const alternativeCount = [2, 4, 5].includes(Number(row.quantidade_alternativas))
    ? Number(row.quantidade_alternativas)
    : storedAlternatives.length;
  const alternatives = storedAlternatives.slice(0, alternativeCount);
  const parsedImages = safeJsonParse(row.images_json, []);
  const images = Array.isArray(parsedImages) ? parsedImages.map(String) : [];
  const parsedAlternativeImages = safeJsonParse(row.alternative_images_json, {});
  const alternativeImages = Object.fromEntries(
    LETTERS.map((letter) => [
      letter,
      Array.isArray(parsedAlternativeImages?.[letter])
        ? parsedAlternativeImages[letter].map(String)
        : [],
    ])
  );
  const parsedClassification = safeJsonParse(row.ai_classification_json, {});
  const classification = parsedClassification && typeof parsedClassification === "object"
    ? parsedClassification
    : {};
  return {
    id: row.id,
    idKey: row.id_key,
    enunciado: row.enunciado,
    alternativas: alternatives,
    correta: row.correta,
    quantidadeAlternativas: alternativeCount,
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
    classificationPending: Boolean(classification.pendingAI),
    classificationMode: classification.fallback
      ? "provisoria-local"
      : classification.reused
        ? "ia-reutilizada"
        : "ia-nova",
    archiveWarning: Array.isArray(classification.reviewNotes) ? String(classification.reviewNotes[0] || "") : "",
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

  const quotaAlreadyKnown =
    question.aiClassification?.reasonCode === "AI_DAILY_QUOTA_EXCEEDED" ||
    String(question.aiModel || "").includes("quota-exceeded");

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
  } else if (quotaAlreadyKnown) {
    classification = buildFallbackClassification(
      question,
      new Error("4006: daily free allocation of 10,000 neurons already exhausted during PDF analysis.")
    );
    archivedWithoutFreshAI = true;
    classificationWarning = classification.reviewNotes?.[0] ||
      "A questão foi arquivada com classificação provisória porque a cota diária da IA está esgotada.";
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
  const contentHash = await sha256(JSON.stringify({ enunciado: normalizeText(finalQuestion.enunciado), alternativas: finalQuestion.alternativas.slice(0, finalQuestion.quantidadeAlternativas).map(normalizeText), correta: finalQuestion.correta }));
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
  const createdAt = duplicate?.created_at || now;
  const searchText = normalizeText([
    id,
    finalQuestion.enunciado,
    finalQuestion.tema,
    finalQuestion.competencia,
    finalQuestion.capacidade,
    finalQuestion.habilidade,
    finalQuestion.unidadeCurricular,
  ].join(" "));
  const alternativesForStorage = finalQuestion.alternativas.slice(0, finalQuestion.quantidadeAlternativas);
  const revisionId = crypto.randomUUID();
  const archivedQuestion = {
    id,
    enunciado: finalQuestion.enunciado,
    alternativas: alternativesForStorage,
    correta: finalQuestion.correta,
    quantidadeAlternativas: finalQuestion.quantidadeAlternativas,
    dificuldade: finalQuestion.dificuldade,
    tema: finalQuestion.tema || "",
    competencia: finalQuestion.competencia || "",
    capacidade: finalQuestion.capacidade || "",
    habilidade: finalQuestion.habilidade || "",
    unidadeCurricular: finalQuestion.unidadeCurricular || "",
    codigoMatriz: finalQuestion.codigoMatriz || "",
    justificativa: finalQuestion.justificativa || "",
    fonte: finalQuestion.fonte || "",
    tempo: finalQuestion.tempo || null,
    imagens: stored.images,
    imagemUrl: stored.images[0] || "",
    thumbnailUrl: stored.thumbnail || stored.images[0] || "",
    alternativaImagens: stored.alternativeImages,
    arquivoOrigem: finalQuestion.arquivoOrigem || "",
    paginaOrigem: finalQuestion.paginaOrigem || "",
    statusGabarito: finalQuestion.statusGabarito || "Validado pelo instrutor",
    observacao: finalQuestion.observacao || "",
    approvedBy: instructor,
    aiModel: classification.model || "",
    aiConfidence: Number(classification.confidence) || 0,
    aiClassification: classification,
    cloudArchivedAt: now,
    classificationPending: Boolean(classification.pendingAI),
    classificationMode: classification.fallback
      ? "provisoria-local"
      : classification.reused
        ? "ia-reutilizada"
        : "ia-nova",
    archiveWarning: classificationWarning,
  };

  const upsertStatement = env.DB.prepare(`
    INSERT INTO questions (
      id,id_key,enunciado,alternatives_json,correta,quantidade_alternativas,dificuldade,tema,competencia,capacidade,habilidade,unidade_curricular,codigo_matriz,justificativa,fonte,tempo,images_json,alternative_images_json,thumbnail_url,arquivo_origem,pagina_origem,status_gabarito,observacao,approved_by,ai_model,ai_confidence,ai_classification_json,content_hash,search_text,status,created_at,updated_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,'active',?30,?31)
    ON CONFLICT(id_key) DO UPDATE SET
      id=excluded.id,
      enunciado=excluded.enunciado,
      alternatives_json=excluded.alternatives_json,
      correta=excluded.correta,
      quantidade_alternativas=excluded.quantidade_alternativas,
      dificuldade=excluded.dificuldade,
      tema=excluded.tema,
      competencia=excluded.competencia,
      capacidade=excluded.capacidade,
      habilidade=excluded.habilidade,
      unidade_curricular=excluded.unidade_curricular,
      codigo_matriz=excluded.codigo_matriz,
      justificativa=excluded.justificativa,
      fonte=excluded.fonte,
      tempo=excluded.tempo,
      images_json=excluded.images_json,
      alternative_images_json=excluded.alternative_images_json,
      thumbnail_url=excluded.thumbnail_url,
      arquivo_origem=excluded.arquivo_origem,
      pagina_origem=excluded.pagina_origem,
      status_gabarito=excluded.status_gabarito,
      observacao=excluded.observacao,
      approved_by=excluded.approved_by,
      ai_model=excluded.ai_model,
      ai_confidence=excluded.ai_confidence,
      ai_classification_json=excluded.ai_classification_json,
      content_hash=excluded.content_hash,
      search_text=excluded.search_text,
      status='active',
      updated_at=excluded.updated_at
  `).bind(
    id,
    idKey,
    archivedQuestion.enunciado,
    JSON.stringify(archivedQuestion.alternativas),
    archivedQuestion.correta,
    archivedQuestion.quantidadeAlternativas,
    archivedQuestion.dificuldade,
    archivedQuestion.tema,
    archivedQuestion.competencia,
    archivedQuestion.capacidade,
    archivedQuestion.habilidade,
    archivedQuestion.unidadeCurricular,
    archivedQuestion.codigoMatriz,
    archivedQuestion.justificativa,
    archivedQuestion.fonte,
    archivedQuestion.tempo,
    JSON.stringify(archivedQuestion.imagens),
    JSON.stringify(archivedQuestion.alternativaImagens),
    archivedQuestion.thumbnailUrl,
    archivedQuestion.arquivoOrigem,
    archivedQuestion.paginaOrigem,
    archivedQuestion.statusGabarito,
    archivedQuestion.observacao,
    instructor,
    archivedQuestion.aiModel,
    archivedQuestion.aiConfidence,
    JSON.stringify(classification),
    contentHash,
    searchText,
    createdAt,
    now
  );

  const revisionStatement = env.DB.prepare(`
    INSERT INTO question_revisions (
      revision_id,question_id_key,question_id,snapshot_json,content_hash,approved_by,ai_model,ai_confidence,created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
  `).bind(
    revisionId,
    idKey,
    archivedQuestion.id,
    JSON.stringify(archivedQuestion),
    contentHash,
    instructor,
    archivedQuestion.aiModel,
    archivedQuestion.aiConfidence,
    now
  );

  try {
    // O batch evita que a questão seja atualizada sem a respectiva revisão histórica.
    await env.DB.batch([upsertStatement, revisionStatement]);
  } catch (error) {
    throw new Error(`Gravação atômica da questão e do histórico no D1: ${String(error?.message || error)}`);
  }

  return {
    question: archivedQuestion,
    duplicate: Boolean(duplicate),
    classification,
    revisionId,
    archivedWithoutFreshAI,
    warning: classificationWarning,
  };

}


export async function repairMissingHistory(env, instructor, limit = 500) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const result = await env.DB.prepare(`
    SELECT q.*
    FROM questions q
    WHERE q.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM question_revisions r
        WHERE r.question_id_key = q.id_key
          AND r.content_hash = q.content_hash
      )
    ORDER BY q.updated_at ASC
    LIMIT ?1
  `).bind(safeLimit).all();
  const rows = result.results || [];
  let repaired = 0;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const chunk = rows.slice(offset, offset + 50);
    const statements = chunk.map((row) => {
      const snapshot = rowToQuestion(row);
      snapshot.historyRepair = true;
      snapshot.historyRepairAt = new Date().toISOString();
      return env.DB.prepare(`
        INSERT INTO question_revisions (
          revision_id,question_id_key,question_id,snapshot_json,content_hash,approved_by,ai_model,ai_confidence,created_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
      `).bind(
        crypto.randomUUID(),
        row.id_key,
        row.id,
        JSON.stringify(snapshot),
        row.content_hash,
        instructor || row.approved_by || "Reparo automático",
        row.ai_model || "",
        Number(row.ai_confidence) || 0,
        row.updated_at || new Date().toISOString()
      );
    });
    if (statements.length) {
      await env.DB.batch(statements);
      repaired += statements.length;
    }
  }
  return { repaired, scanned: rows.length, limit: safeLimit };
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

function normalizeIdKey(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

async function listR2Keys(env, prefix) {
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");
  const keys = [];
  let cursor;
  do {
    const page = await env.QUESTION_IMAGES.list({ prefix, cursor, limit: 1000 });
    keys.push(...(page.objects || []).map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteR2Keys(env, keys) {
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");
  let deleted = 0;
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const chunk = keys.slice(offset, offset + 1000);
    if (!chunk.length) continue;
    await env.QUESTION_IMAGES.delete(chunk);
    deleted += chunk.length;
  }
  return deleted;
}

async function deleteR2Prefix(env, prefix) {
  const keys = await listR2Keys(env, prefix);
  const deleted = await deleteR2Keys(env, keys);
  return { prefix, found: keys.length, deleted };
}

export async function deleteQuestion(env, id) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");

  const requested = String(id || "").trim();
  if (!requested) throw new Error("Informe o ID ou a chave interna da questão.");

  const normalized = normalizeIdKey(requested);
  const row = await env.DB.prepare(`
    SELECT id, id_key
    FROM questions
    WHERE id_key = ?1 OR id = ?2
    LIMIT 1
  `).bind(normalized, requested).first();

  // O id_key recebido pela interface é preferido. Mesmo que o registro já tenha
  // sido removido, uma nova tentativa consegue limpar imagens órfãs pelo prefixo.
  const idKey = row?.id_key || normalized;
  const questionId = row?.id || requested;
  const prefix = `questions/${idKey}/`;

  let databaseDeleted = false;
  let revisionsDeleted = 0;
  let questionsDeleted = 0;

  try {
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM question_revisions WHERE question_id_key = ?1").bind(idKey),
      env.DB.prepare("DELETE FROM questions WHERE id_key = ?1 OR id = ?2").bind(idKey, questionId),
    ]);
    revisionsDeleted = Number(results?.[0]?.meta?.changes || 0);
    questionsDeleted = Number(results?.[1]?.meta?.changes || 0);
    databaseDeleted = true;
  } catch (error) {
    throw new Error(`Exclusão da questão e do histórico no D1: ${String(error?.message || error)}`);
  }

  let imageCleanup = { prefix, found: 0, deleted: 0 };
  let warning = "";
  try {
    imageCleanup = await deleteR2Prefix(env, prefix);
  } catch (error) {
    warning = `A questão foi removida do D1, mas a limpeza das imagens no R2 não foi concluída: ${String(error?.message || error)}. Tente excluir novamente usando a mesma chave ${idKey}.`;
  }

  return {
    deleted: databaseDeleted,
    id: questionId,
    idKey,
    database: { questionsDeleted, revisionsDeleted },
    images: imageCleanup,
    warning,
  };
}

export async function getQuestionBankStats(env) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");
  const [questions, revisions] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM questions").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM question_revisions").first(),
  ]);
  const imageKeys = await listR2Keys(env, "questions/");
  return {
    questions: Number(questions?.total || 0),
    revisions: Number(revisions?.total || 0),
    images: imageKeys.length,
  };
}

export async function clearQuestionBank(env) {
  if (!env.DB) throw new Error("Binding DB ausente.");
  if (!env.QUESTION_IMAGES) throw new Error("Binding QUESTION_IMAGES ausente.");

  const before = await getQuestionBankStats(env);

  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM question_revisions"),
      env.DB.prepare("DELETE FROM questions"),
    ]);
  } catch (error) {
    throw new Error(`Limpeza das tabelas no D1: ${String(error?.message || error)}`);
  }

  let imageCleanup = { prefix: "questions/", found: 0, deleted: 0 };
  let warning = "";
  try {
    imageCleanup = await deleteR2Prefix(env, "questions/");
  } catch (error) {
    warning = `As tabelas foram limpas, mas algumas imagens podem ter permanecido no R2: ${String(error?.message || error)}. Execute a limpeza novamente para remover objetos órfãos.`;
  }

  return {
    cleared: true,
    before,
    database: { questionsDeleted: before.questions, revisionsDeleted: before.revisions },
    images: imageCleanup,
    warning,
  };
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
