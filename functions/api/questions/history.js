import { json, requireAdmin } from "../../_lib/common.js";
import { listQuestionHistory } from "../../_lib/questions.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Informe o ID da questão." }, 400);
    return json(await listQuestionHistory(env, id, url.searchParams.get("limit")));
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível consultar o histórico.", details: String(error?.message || error) }, 500);
  }
}
