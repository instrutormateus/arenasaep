import { json, requireAdmin } from "../../_lib/common.js";
import { deleteQuestion, listQuestions, saveQuestion } from "../../_lib/questions.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    return json(await listQuestions(env, new URL(request.url)));
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível consultar o banco.", details: String(error?.message || error) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    if (!body.question) return json({ error: "Questão não recebida." }, 400);
    return json(await saveQuestion(env, body.question, auth.instructor), 201);
  } catch (error) {
    console.error("[Arena SAEP] Falha ao classificar/arquivar", error);
    return json({
      error: "Não foi possível classificar e arquivar a questão.",
      details: String(error?.message || error),
      hint: "Confirme o modelo AI_CLASSIFY_MODEL, execute o schema.sql no D1 e verifique os logs da Pages Function. Na versão 1.3.2, a cota esgotada não deve impedir o arquivamento, salvo se ARCHIVE_WITHOUT_AI=false.",
    }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return json({ error: "Informe o ID da questão." }, 400);
    return json(await deleteQuestion(env, id));
  } catch (error) {
    return json({ error: "Não foi possível remover a questão.", details: String(error?.message || error) }, 500);
  }
}
