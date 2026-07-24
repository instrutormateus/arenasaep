import { json, requireAdmin } from "../../_lib/common.js";
import { classifyQuestionsBatch, isWorkersAiQuotaError } from "../../_lib/ai.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const questions = Array.isArray(body.questions) ? body.questions.slice(0, 20) : [];
    if (!questions.length) return json({ error: "Envie ao menos uma questão para classificação." }, 400);
    return json(await classifyQuestionsBatch(env, questions));
  } catch (error) {
    console.error("[Arena SAEP] Falha na classificação em lote", error);
    const quotaExceeded = isWorkersAiQuotaError(error);
    return json({
      error: quotaExceeded
        ? "A cota diária gratuita do Workers AI está esgotada."
        : "A classificação em lote não foi concluída.",
      details: String(error?.message || error),
      code: quotaExceeded ? "AI_DAILY_QUOTA_EXCEEDED" : "AI_BATCH_CLASSIFICATION_FAILED",
      recoverable: true,
    }, quotaExceeded ? 429 : 500);
  }
}
