import { json, requireAdmin } from "../../_lib/common.js";
import { analyzeQuestionPages, detectQuestionVisuals, isWorkersAiQuotaError } from "../../_lib/ai.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const pages = Array.isArray(body.pages)
      ? body.pages.filter((page) => page?.image && page?.page).slice(0, 5)
      : [];
    if (!body.draft || !pages.length) {
      return json({ error: "Envie o rascunho e ao menos uma página renderizada." }, 400);
    }
    const mode = String(body.mode || "full").toLowerCase();
    const result = mode === "visuals"
      ? await detectQuestionVisuals(env, body.draft, pages)
      : await analyzeQuestionPages(env, body.draft, pages);
    return json(result);
  } catch (error) {
    console.error(error);
    const quotaExceeded = isWorkersAiQuotaError(error);
    return json({
      error: quotaExceeded
        ? "A cota diária gratuita do Workers AI está esgotada."
        : "A análise da questão não foi concluída.",
      details: String(error?.message || error),
      code: quotaExceeded ? "AI_DAILY_QUOTA_EXCEEDED" : "AI_ANALYSIS_FAILED",
      recoverable: true,
    }, quotaExceeded ? 429 : 500);
  }
}
