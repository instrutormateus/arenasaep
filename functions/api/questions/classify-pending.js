import { json, requireAdmin } from "../../_lib/common.js";
import { reclassifyPendingQuestions } from "../../_lib/questions.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    return json(await reclassifyPendingQuestions(env, auth.instructor, body.limit || 100));
  } catch (error) {
    return json({ error: "Não foi possível classificar as questões pendentes.", details: String(error?.message || error) }, 500);
  }
}
