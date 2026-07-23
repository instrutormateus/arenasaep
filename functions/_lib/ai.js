import { aiPayload, normalizeText, safeJsonParse } from "./common.js";


export function isWorkersAiQuotaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("4006") ||
    message.includes("daily free allocation") ||
    message.includes("10,000 neurons") ||
    message.includes("10000 neurons") ||
    message.includes("used up your daily free allocation");
}

function inferFallbackTheme(question) {
  const text = normalizeText([
    question.tema, question.unidadeCurricular, question.competencia, question.capacidade,
    question.habilidade, question.enunciado, ...(question.alternativas || [])
  ].filter(Boolean).join(" "));
  const rules = [
    [/clp|ladder|automacao|automacao industrial|sensor|atuador|inversor de frequencia/, "Automação Industrial"],
    [/pneumatic|hidraulic|cilindro|valvula solenoide/, "Sistemas Pneumáticos e Hidráulicos"],
    [/transistor|diodo|tiristor|triac|scr|amplificador|eletronica/, "Eletrônica"],
    [/manutencao|ordem de servico|preditiva|preventiva|corretiva|fmea|fmeca|tpm/, "Manutenção Industrial"],
    [/nr 10|nr10|nr 12|nr12|seguranca|apr|risco/, "Segurança em Instalações e Serviços"],
    [/instalacao eletrica|disjuntor|contator|rele termico|spda|nbr 5410|nbr 5419|corrente|tensao|resistor|potencia eletrica/, "Eletrotécnica"],
    [/5w2h|gestao|planejamento|processo|qualidade|histograma/, "Gestão e Melhoria de Processos"],
  ];
  for (const [pattern, theme] of rules) if (pattern.test(text)) return theme;
  return question.tema || "Competências Profissionais";
}

function inferFallbackUnit(theme, current = "") {
  if (current) return current;
  const map = {
    "Automação Industrial": "Automação Industrial",
    "Sistemas Pneumáticos e Hidráulicos": "Sistemas de Automação",
    "Eletrônica": "Eletrônica Aplicada",
    "Manutenção Industrial": "Manutenção Industrial",
    "Segurança em Instalações e Serviços": "Segurança do Trabalho",
    "Eletrotécnica": "Fundamentos e Instalações Elétricas",
    "Gestão e Melhoria de Processos": "Gestão da Manutenção e Processos",
  };
  return map[theme] || "";
}

export function buildFallbackClassification(question, error = null) {
  const theme = String(question.tema || inferFallbackTheme(question)).trim();
  const unit = inferFallbackUnit(theme, String(question.unidadeCurricular || "").trim());
  const tags = [...new Set([
    theme, unit, question.competencia, question.capacidade, question.habilidade,
    "Classificação pendente de IA"
  ].filter(Boolean).map(String))].slice(0, 12);
  const quota = isWorkersAiQuotaError(error);
  const reason = String(error?.message || error || "Serviço de IA indisponível").slice(0, 1200);
  return {
    dificuldade: ["Fácil", "Médio", "Difícil"].includes(question.dificuldade) ? question.dificuldade : "Médio",
    tema: theme,
    competencia: String(question.competencia || "").trim(),
    capacidade: String(question.capacidade || "").trim(),
    habilidade: String(question.habilidade || "").trim(),
    unidadeCurricular: unit,
    codigoMatriz: String(question.codigoMatriz || "").trim(),
    tags,
    confidence: 0,
    reviewNotes: [
      quota
        ? "Cota gratuita diária do Workers AI esgotada. A questão foi arquivada com os metadados revisados pelo instrutor e classificação heurística local."
        : "Workers AI indisponível. A questão foi arquivada com os metadados revisados pelo instrutor e classificação heurística local.",
      "Reaprove ou atualize esta questão quando a IA estiver disponível para substituir a classificação provisória.",
      reason,
    ],
    model: quota ? "fallback-local:quota-exceeded" : "fallback-local:ai-unavailable",
    fallback: true,
    pendingAI: true,
    reasonCode: quota ? "AI_DAILY_QUOTA_EXCEEDED" : "AI_UNAVAILABLE",
  };
}

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
    alternativas: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
    quantidadeAlternativas: { type: "integer", enum: [2, 4, 5] },
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
  required: ["id", "enunciado", "alternativas", "quantidadeAlternativas", "warnings", "confidence", "visuals"],
};

async function runJson(env, model, messages, schema, extra = {}) {
  const maxTokens = Number(extra.max_tokens || extra.max_completion_tokens || 3500);
  const modelExtras = { ...extra };
  delete modelExtras.max_tokens;
  delete modelExtras.max_completion_tokens;

  const request = {
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_schema", json_schema: schema },
    ...modelExtras,
  };

  let response;
  let jsonModeError = null;
  try {
    response = await env.AI.run(model, request);
  } catch (firstError) {
    jsonModeError = firstError;
    console.warn("[Arena SAEP] JSON Mode falhou; tentando resposta JSON por instrução.", {
      model,
      error: String(firstError?.message || firstError),
    });
    const fallbackMessages = [
      ...messages,
      {
        role: "system",
        content: `Retorne exclusivamente um objeto JSON válido, sem Markdown, conforme este esquema: ${JSON.stringify(schema)}`,
      },
    ];
    try {
      response = await env.AI.run(model, {
        messages: fallbackMessages,
        temperature: 0,
        max_tokens: maxTokens,
        ...modelExtras,
      });
    } catch (fallbackError) {
      throw new Error(
        `Workers AI recusou a classificação com o modelo ${model}. ` +
        `JSON Mode: ${String(jsonModeError?.message || jsonModeError)}. ` +
        `Tentativa alternativa: ${String(fallbackError?.message || fallbackError)}`
      );
    }
  }

  const payload = aiPayload(response);
  if (payload && typeof payload === "object") return payload;
  if (typeof payload === "string") {
    const parsed = safeJsonParse(payload);
    if (parsed) return parsed;
  }
  throw new Error(`O modelo ${model} respondeu, mas não devolveu JSON válido.`);
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
  let result;
  try {
    result = await runJson(env, model, messages, CLASSIFICATION_SCHEMA, { max_tokens: 1600 });
  } catch (error) {
    throw new Error(`Falha na classificação pedagógica por IA: ${String(error?.message || error)}`);
  }
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
        content: "Você é um transcritor técnico de avaliações SAEP. Preserve literalmente o conteúdo visível. As questões podem ter exatamente 2, 4 ou 5 alternativas. Uma alternativa pode ser composta somente por imagem, circuito, tabela, símbolo ou diagrama; nesse caso mantenha o texto vazio e associe uma caixa visual ao alvo correto. O título FOLHA DE RESPOSTA encerra a seção de questões e nunca deve ser interpretado como questão. A seção GABARITO é uma tabela separada; não invente respostas e preserve o gabarito já associado ao rascunho pelo sistema.",
      },
      {
        role: "user",
        content: `Analise a página ${page.page} relacionada à questão ${draft.id}. O rascunho extraído pelo PDF.js está abaixo. Não resuma, não corrija erros do original e não invente conteúdo. Reconheça exatamente ${draft.quantidadeAlternativas || "2, 4 ou 5"} alternativas, incluindo alternativas exclusivamente visuais. Para figuras, retorne caixas normalizadas de 0 a 1000 e use target=question para imagem do enunciado ou target=A/B/C/D/E para imagem de alternativa. Ignore logotipo, cabeçalho, rodapé, número da página, FOLHA DE RESPOSTA e GABARITO. O campo correta, quando presente no rascunho, veio da tabela oficial de gabarito e não deve ser modificado.\n\n${JSON.stringify(draft, null, 2)}`,
      },
    ];
    const result = await runJson(env, model, messages, PAGE_SCHEMA, { image: page.image, max_tokens: 3000 });
    if (result) results.push({ page: page.page, ...result });
  }

  const resultCount = results.map((r) => Number(r.quantidadeAlternativas)).find((n) => [2, 4, 5].includes(n));
  const draftCount = Number(draft.quantidadeAlternativas);
  const count = [2, 4, 5].includes(draftCount) ? draftCount : resultCount || 5;
  const merged = {
    id: String(draft.id || results.find((r) => r.id)?.id || ""),
    enunciado: String(draft.enunciado || ""),
    alternativas: Array.isArray(draft.alternativas) ? draft.alternativas.slice(0, count).map(String) : [],
    quantidadeAlternativas: count,
    correta: String(draft.correta || ""),
    statusGabarito: String(draft.statusGabarito || ""),
    warnings: [],
    visuals: [],
    confidence: 0,
  };
  while (merged.alternativas.length < count) merged.alternativas.push("");
  for (const result of results) {
    if (!merged.enunciado && result.enunciado) merged.enunciado = String(result.enunciado);
    (result.alternativas || []).slice(0, merged.quantidadeAlternativas).forEach((value, i) => {
      if (!merged.alternativas[i] && value) merged.alternativas[i] = String(value);
    });
    merged.warnings.push(...(result.warnings || []).map(String));
    merged.visuals.push(...(result.visuals || []).map((v) => ({ ...v, page: Number(v.page || result.page) })));
    merged.confidence = Math.max(merged.confidence, Number(result.confidence) || 0);
  }
  const classification = await classifyQuestion(env, { ...merged, dificuldade: draft.dificuldade || "Médio" });
  return {
    question: { ...merged, ...classification, correta: merged.correta },
    visuals: merged.visuals,
    warnings: [...new Set([...merged.warnings, ...classification.reviewNotes])],
    confidence: Math.max(merged.confidence, classification.confidence || 0),
    model,
    classificationModel: classification.model,
  };
}
