export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    const raw = String(value).trim();
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch {}
    }
    return fallback;
  }
}

export function aiPayload(response) {
  if (response == null) return null;
  if (response.response != null) return safeJsonParse(response.response, response.response);
  if (response.result != null) return safeJsonParse(response.result, response.result);
  if (response.choices?.[0]?.message?.content != null) {
    return safeJsonParse(response.choices[0].message.content, response.choices[0].message.content);
  }
  return safeJsonParse(response, response);
}

export function requireAdmin(request, env) {
  const expected = String(env.ARENA_ADMIN_KEY || "").trim();
  if (!expected) {
    return { ok: false, response: json({ error: "O segredo ARENA_ADMIN_KEY não foi configurado no Cloudflare Pages." }, 503) };
  }
  const provided = String(request.headers.get("x-arena-key") || "").trim();
  if (!provided || provided !== expected) {
    return { ok: false, response: json({ error: "Chave de instrutor inválida." }, 401) };
  }
  return {
    ok: true,
    instructor: String(request.headers.get("x-instructor-name") || "Instrutor não identificado").trim().slice(0, 160),
  };
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sanitizeQuestion(input = {}) {
  const letters = ["A", "B", "C", "D", "E"];
  const allowedCounts = [2, 4, 5];
  const sourceAlternatives = input.alternativas || input.alternatives || [];
  const alternatives = Array.isArray(sourceAlternatives)
    ? sourceAlternatives.slice(0, 5).map((v) => String(v ?? ""))
    : letters.map((l) => String(sourceAlternatives[l] ?? sourceAlternatives[l.toLowerCase()] ?? ""));
  const correct = String(input.correta || input.correct || "").trim().toUpperCase().slice(0, 1);
  const altImages = input.alternativaImagens || input.alternativeImages || {};
  const normalizedAltImages = Object.fromEntries(
    letters.map((l) => [l, [...new Set((Array.isArray(altImages[l]) ? altImages[l] : altImages[l] ? [altImages[l]] : []).map(String))]])
  );
  const inferredLastIndex = letters.reduce((last, letter, index) => {
    const text = String(alternatives[index] || "").trim();
    const visual = normalizedAltImages[letter].length > 0;
    return text || visual ? index : last;
  }, -1);
  const requestedCount = Number(input.quantidadeAlternativas || input.alternativeCount || 0);
  const inferredCount = inferredLastIndex + 1;
  const count = allowedCounts.includes(requestedCount) ? requestedCount : inferredCount;

  if (allowedCounts.includes(count)) {
    letters.slice(count).forEach((letter) => { normalizedAltImages[letter] = []; });
  }

  const question = {
    id: String(input.id || input.codigo || `Q_${Date.now()}`).trim().slice(0, 160),
    enunciado: String(input.enunciado || input.question || "").trim(),
    alternativas: alternatives.slice(0, Math.max(0, count)),
    correta: letters.includes(correct) ? correct : "",
    quantidadeAlternativas: count,
    dificuldade: ["Fácil", "Médio", "Difícil"].includes(input.dificuldade) ? input.dificuldade : "Médio",
    tema: String(input.tema || "").trim().slice(0, 240),
    competencia: String(input.competencia || "").trim().slice(0, 500),
    capacidade: String(input.capacidade || "").trim().slice(0, 500),
    habilidade: String(input.habilidade || "").trim().slice(0, 500),
    unidadeCurricular: String(input.unidadeCurricular || input.unidade || "").trim().slice(0, 240),
    codigoMatriz: String(input.codigoMatriz || "").trim().slice(0, 160),
    justificativa: String(input.justificativa || "").trim(),
    fonte: String(input.fonte || "").trim().slice(0, 1000),
    tempo: Number(input.tempo) > 0 ? Math.round(Number(input.tempo)) : null,
    imagens: [...new Set([...(Array.isArray(input.imagens) ? input.imagens : []), input.imagemUrl].filter(Boolean).map(String))],
    thumbnailUrl: String(input.thumbnailUrl || input.imagemUrl || ""),
    alternativaImagens: normalizedAltImages,
    arquivoOrigem: String(input.arquivoOrigem || "").trim().slice(0, 500),
    paginaOrigem: String(input.paginaOrigem || "").trim().slice(0, 160),
    statusGabarito: String(input.statusGabarito || "Validado pelo instrutor").trim().slice(0, 160),
    observacao: String(input.observacao || "").trim().slice(0, 1000),
    aiModel: String(input.aiModel || input.classificationModel || "").trim().slice(0, 300),
    aiConfidence: Math.max(0, Math.min(1, Number(input.aiConfidence ?? input.confidence) || 0)),
    aiClassification: input.aiClassification && typeof input.aiClassification === "object" ? input.aiClassification : null,
  };

  if (!question.id || !question.enunciado) throw new Error("A questão precisa de ID e enunciado.");
  if (!allowedCounts.includes(question.quantidadeAlternativas)) {
    throw new Error(`A questão deve possuir exatamente 2, 4 ou 5 alternativas. Foram identificadas ${question.quantidadeAlternativas || 0}.`);
  }
  if (!letters.slice(0, question.quantidadeAlternativas).includes(question.correta)) {
    throw new Error("O gabarito precisa corresponder a uma das alternativas existentes.");
  }
  for (let index = 0; index < question.quantidadeAlternativas; index++) {
    const letter = letters[index];
    const text = String(question.alternativas[index] || "").trim();
    const visual = question.alternativaImagens[letter].length > 0;
    if (!text && !visual) {
      throw new Error(`A alternativa ${letter} precisa conter texto ou imagem.`);
    }
  }
  return question;
}
