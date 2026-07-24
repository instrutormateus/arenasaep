import { json, requireAdmin } from "../../_lib/common.js";
import { checkQuestionCodes } from "../../_lib/questions.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    return json(await checkQuestionCodes(env, body.ids || []));
  } catch (error) {
    return json({ error: "Não foi possível verificar os códigos no banco.", details: String(error?.message || error) }, 500);
  }
}
