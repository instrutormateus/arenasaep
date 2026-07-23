export async function onRequestGet({ params, env }) {
  if (!env.QUESTION_IMAGES) return new Response("R2 binding missing", { status: 503 });
  const raw = Array.isArray(params.key) ? params.key : [params.key];
  const key = raw.filter(Boolean).map(decodeURIComponent).join("/");
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.QUESTION_IMAGES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
