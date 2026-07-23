import { aiPayload, safeJsonParse } from "./common.js";

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    dificuldade: { type: "string", enum: ["Fácil", "Médio", "Difícil"] },
    tema: { type: "string" },
    competencia: { type: "string" },
    capacidade: { type: "string" },
    habilidade: { type: "string" },
    unidadeCurricular: { type: "string" },
    codigoMatriz: { type: "string" },
    tags: { type: "array", items: { type: "string" }, maxItems: 12 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reviewNotes: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: ["dificuldade", "tema", "competencia", "capacidade", "habilidade", "unidadeCurricular", "codigoMatriz", "tags", "confidence", "reviewNotes"],
};

const PAGE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    enunciado: { type: "string" },
    alternativas: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 5 },
    warnings: { type: "array", items: { type: "string" }, maxItems: 10 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    visuals: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1 },
          target: { type: "string", enum: ["question", "A", "B", "C", "D", "E"] },
          x: { type: "number", minimum: 0, maximum: 1000 },
          y: { type: "number", minimum: 0, maximum: 1000 },
          width: { type: "number", minimum: 1, maximum: 1000 },
          height: { type: "number", minimum: 1, maximum: 1000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          description: { type: "string" },
        },
        required: ["page", "target", "x", "y", "width", "height", "confidence", "description"],
      },
    },
  },
  required: ["id", "enunciado", "alternativas", "warnings", "confidence", "visuals"],
};

async function runJson(env, model, messages, schema, extra = {}) {
  const request = {
    messages,
    temperature: 0,
    max_completion_tokens: extra.max_completion_tokens || 3500,
    response_format: { type: "json_schema", json_schema: schema },
    ...extra,
  };
  let response;
  try {
    response = await env.AI.run(model, request);
  } catch (firstError) {
    // Alguns modelos aceitam o esquema apenas como instrução textual.
    const fallbackMessages = [...messages, { role: "system", content: `Retorne exclusivamente JSON válido segundo este esquema: ${JSON.stringify(schema)}` }];
    response = await env.AI.run(model, { ...request, messages: fallbackMessages, response_format: undefined });
  }
  const payload = aiPayload(response);
  if (typeof payload === "string") {
    const parsed = safeJsonParse(payload);
    if (parsed) return parsed;
  }
  return payload;
}

export async function classifyQuestion(env, question) {
  if (!env.AI) throw new Error("Binding AI ausente.");
  const model = env.AI_CLASSIFY_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
  const messages = [
    {
      role: "system",
      content: "Você classifica questões profissionais do SAEP. Não altere enunciado, alternativas nem gabarito. Retorne apenas metadados pedagógicos objetivos em português do Brasil.",
    },
    {
      role: "user",
      content: `Classifique esta questão revisada pelo instrutor. Considere o contexto profissional, a capacidade técnica exigida e a complexidade cognitiva.\n\n${JSON.stringify({ id: question.id, enunciado: question.enunciado, alternativas: question.alternativas, correta: question.correta, metadadosInformados: { dificuldade: question.dificuldade, tema: question.tema, competencia: question.competencia, capacidade: question.capacidade, habilidade: question.habilidade, unidadeCurricular: question.unidadeCurricular, codigoMatriz: question.codigoMatriz } }, null, 2)}`,
    },
  ];
  const result = await runJson(env, model, messages, CLASSIFICATION_SCHEMA, { max_completion_tokens: 1600 });
  return {
    dificuldade: ["Fácil", "Médio", "Difícil"].includes(result?.dificuldade) ? result.dificuldade : question.dificuldade || "Médio",
    tema: String(result?.tema || question.tema || "").trim(),
    competencia: String(result?.competencia || question.competencia || "").trim(),
    capacidade: String(result?.capacidade || question.capacidade || "").trim(),
    habilidade: String(result?.habilidade || question.habilidade || "").trim(),
    unidadeCurricular: String(result?.unidadeCurricular || question.unidadeCurricular || "").trim(),
    codigoMatriz: String(result?.codigoMatriz || question.codigoMatriz || "").trim(),
    tags: Array.isArray(result?.tags) ? result.tags.map(String).slice(0, 12) : [],
    confidence: Number(result?.confidence) || 0.65,
    reviewNotes: Array.isArray(result?.reviewNotes) ? result.reviewNotes.map(String).slice(0, 8) : [],
    model,
  };
}

export async function analyzeQuestionPages(env, draft, pages) {
  if (!env.AI) throw new Error("Binding AI ausente.");
  const model = env.AI_VISION_MODEL || "@cf/google/gemma-4-26b-a4b-it";
  const results = [];
  for (const page of pages.slice(0, 5)) {
    const messages = [
      {
        role: "system",
        content: "Você é um transcritor técnico de avaliações SAEP. Preserve literalmente o conteúdo visível e identifique somente figuras necessárias à resolução. Não determine o gabarito.",
      },
      {
        role: "user",
        content: `Analise a página ${page.page} relacionada à questão ${draft.id}. O rascunho extraído pelo PDF.js está abaixo. Não resuma, não corrija erros do original e não invente conteúdo. Para figuras, retorne caixas normalizadas de 0 a 1000. Ignore logotipo, cabeçalho, rodapé e número da página.\n\n${JSON.stringify(draft, null, 2)}`,
      },
    ];
    const result = await runJson(env, model, messages, PAGE_SCHEMA, { image: page.image, max_completion_tokens: 3000 });
    if (result) results.push({ page: page.page, ...result });
  }

  const merged = {
    id: String(draft.id || results.find((r) => r.id)?.id || ""),
    enunciado: String(draft.enunciado || ""),
    alternativas: Array.isArray(draft.alternativas) ? draft.alternativas.slice(0, 5).map(String) : [],
    warnings: [],
    visuals: [],
    confidence: 0,
  };
  while (merged.alternativas.length < 5) merged.alternativas.push("");
  for (const result of results) {
    if (!merged.enunciado && result.enunciado) merged.enunciado = String(result.enunciado);
    (result.alternativas || []).forEach((value, i) => {
      if (!merged.alternativas[i] && value) merged.alternativas[i] = String(value);
    });
    merged.warnings.push(...(result.warnings || []).map(String));
    merged.visuals.push(...(result.visuals || []).map((v) => ({ ...v, page: Number(v.page || result.page) })));
    merged.confidence = Math.max(merged.confidence, Number(result.confidence) || 0);
  }
  const classification = await classifyQuestion(env, { ...merged, correta: "", dificuldade: "Médio" });
  return {
    question: { ...merged, ...classification, correta: "" },
    visuals: merged.visuals,
    warnings: [...new Set([...merged.warnings, ...classification.reviewNotes])],
    confidence: Math.max(merged.confidence, classification.confidence || 0),
    model,
    classificationModel: classification.model,
  };
}
