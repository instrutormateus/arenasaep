import { json, requireAdmin } from "../_lib/common.js";

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  return json({
    service: "Arena SAEP Cloud",
    version: "1.3.0",
    authorized: true,
    bindings: { ai: Boolean(env.AI), db: Boolean(env.DB), images: Boolean(env.QUESTION_IMAGES) },
    models: {
      vision: env.AI_VISION_MODEL || "@cf/google/gemma-4-26b-a4b-it",
      classify: env.AI_CLASSIFY_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast",
    },
    instructor: auth.instructor,
    now: new Date().toISOString(),
  });
}
