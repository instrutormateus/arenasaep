import { json, requireAdmin } from "../../_lib/common.js";
import { repairMissingHistory } from "../../_lib/questions.js";

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    let limit = 500;
    try {
      const body = await request.json();
      if (body?.limit) limit = Number(body.limit);
    } catch {}
    const result = await repairMissingHistory(env, auth.instructor, limit);
    return json(result);
  } catch (error) {
    console.error("[Arena SAEP] Falha ao reparar histórico", error);
    return json({
      error: "Não foi possível reparar o histórico das questões.",
      details: String(error?.message || error),
    }, 500);
  }
}
