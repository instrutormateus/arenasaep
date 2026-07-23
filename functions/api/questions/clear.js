import { json, requireAdmin } from "../../_lib/common.js";
import { clearQuestionBank, getQuestionBankStats } from "../../_lib/questions.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    return json({ stats: await getQuestionBankStats(env) });
  } catch (error) {
    console.error("[Arena SAEP] Falha ao consultar estatísticas de limpeza", error);
    return json({
      error: "Não foi possível verificar o conteúdo do banco.",
      details: String(error?.message || error),
    }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    if (String(body?.confirmation || "").trim().toUpperCase() !== "LIMPAR TUDO") {
      return json({
        error: "Confirmação inválida.",
        details: "Digite exatamente LIMPAR TUDO para apagar todas as questões, revisões e imagens.",
      }, 400);
    }
    const result = await clearQuestionBank(env);
    return json(result);
  } catch (error) {
    console.error("[Arena SAEP] Falha na limpeza completa", error);
    return json({
      error: "Não foi possível limpar o banco de questões e imagens.",
      details: String(error?.message || error),
    }, 500);
  }
}
