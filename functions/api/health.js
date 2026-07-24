import { json, requireAdmin } from "../_lib/common.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let schemaReady = false;
  let schemaError = "";
  let tableCount = 0;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('questions', 'question_revisions')
      `).first();
      tableCount = Number(row?.total || 0);
      schemaReady = tableCount === 2;
    } catch (error) {
      schemaError = String(error?.message || error);
    }
  }

  return json({
    service: "Arena SAEP Cloud",
    version: "1.4.2",
    authorized: true,
    bindings: {
      ai: Boolean(env.AI),
      db: Boolean(env.DB),
      images: Boolean(env.QUESTION_IMAGES),
    },
    database: {
      schemaReady,
      tableCount,
      error: schemaError,
    },
    capabilities: {
      archiveWithoutAI: String(env.ARCHIVE_WITHOUT_AI || "true").toLowerCase() !== "false",
      reusePdfClassification: true,
      permanentQuestionDeletion: true,
      fullBankCleanup: true,
      hybridPdfPreanalysis: true,
      localPdfImageCropping: true,
      batchAiClassification: true,
    },
    models: {
      vision: env.AI_VISION_MODEL || "@cf/google/gemma-4-26b-a4b-it",
      classify: env.AI_CLASSIFY_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast",
    },
    instructor: auth.instructor,
    now: new Date().toISOString(),
  });
}
