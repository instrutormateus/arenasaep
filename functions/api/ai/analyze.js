import { json, requireAdmin } from "../../_lib/common.js";
import { analyzeQuestionPages } from "../../_lib/ai.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const pages = Array.isArray(body.pages) ? body.pages.filter((p) => p?.image && p?.page).slice(0, 5) : [];
    if (!body.draft || !pages.length) return json({ error: "Envie o rascunho e ao menos uma página renderizada." }, 400);
    const result = await analyzeQuestionPages(env, body.draft, pages);
    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: "A análise da questão não foi concluída.", details: String(error?.message || error) }, 500);
  }
}
