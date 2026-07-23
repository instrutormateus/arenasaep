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
  const sourceAlternatives = input.alternativas || input.alternatives || [];
  const alternatives = Array.isArray(sourceAlternatives)
    ? sourceAlternatives.slice(0, 5).map((v) => String(v ?? ""))
    : letters.map((l) => String(sourceAlternatives[l] ?? sourceAlternatives[l.toLowerCase()] ?? ""));
  while (alternatives.length < 5) alternatives.push("");
  const correct = String(input.correta || input.correct || "").trim().toUpperCase().slice(0, 1);
  const altImages = input.alternativaImagens || input.alternativeImages || {};
  const question = {
    id: String(input.id || input.codigo || `Q_${Date.now()}`).trim().slice(0, 160),
    enunciado: String(input.enunciado || input.question || "").trim(),
    alternativas: alternatives,
    correta: letters.includes(correct) ? correct : "",
    quantidadeAlternativas: Number(input.quantidadeAlternativas || alternatives.filter(Boolean).length || 5),
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
    alternativaImagens: Object.fromEntries(
      letters.map((l) => [l, [...new Set((Array.isArray(altImages[l]) ? altImages[l] : altImages[l] ? [altImages[l]] : []).map(String))]])
    ),
    arquivoOrigem: String(input.arquivoOrigem || "").trim().slice(0, 500),
    paginaOrigem: String(input.paginaOrigem || "").trim().slice(0, 160),
    statusGabarito: String(input.statusGabarito || "Validado pelo instrutor").trim().slice(0, 160),
    observacao: String(input.observacao || "").trim().slice(0, 1000),
  };
  const availableAlternatives = letters.filter((letter, index) => {
    const text = String(question.alternativas[index] || "").trim();
    const visual = Array.isArray(question.alternativaImagens[letter]) && question.alternativaImagens[letter].length > 0;
    return Boolean(text || visual);
  }).length;
  question.quantidadeAlternativas = Math.max(
    availableAlternatives,
    Math.min(5, Number(input.quantidadeAlternativas) || 0)
  );
  if (!question.id || !question.enunciado) throw new Error("A questão precisa de ID e enunciado.");
  if (!question.correta) throw new Error("O gabarito precisa ser informado pelo instrutor.");
  if (availableAlternatives < 4) throw new Error("A questão precisa de pelo menos quatro alternativas preenchidas ou visuais.");
  return question;
}
