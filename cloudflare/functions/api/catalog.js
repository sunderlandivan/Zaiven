export async function onRequestGet({ env, request }) {
  const body = await env.STORE.get("catalog");
  if (body) return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return env.ASSETS.fetch(new URL("/catalog.json", request.url));
}
