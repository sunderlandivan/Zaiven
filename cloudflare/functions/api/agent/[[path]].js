import { json } from "../../../lib/store.js";

const TYPES = new Set([
  "instagram_post",
  "instagram_story",
  "instagram_reel_script",
  "youtube_pinned_comment",
  "youtube_description",
  "youtube_short_script",
  "video_idea",
  "promo_idea",
  "weekly_report",
]);

const clip = (v, n) => String(v ?? "").slice(0, n);

/**
 * Private endpoints for the marketing agent (Bearer AGENT_TOKEN):
 *   GET  /api/agent/insights  sales, stock and price floors pushed by the PC
 *   POST /api/agent/drafts    { drafts: [...] } queued for approval in the portal
 */
export async function onRequest({ request, env, params }) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.AGENT_TOKEN || auth !== `Bearer ${env.AGENT_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const route = (params.path || []).join("/");

  if (route === "insights" && request.method === "GET") {
    const insights = await env.STORE.get("insights");
    return new Response(insights || "{}", { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  if (route === "drafts" && request.method === "POST") {
    const { drafts } = await request.json().catch(() => ({}));
    if (!Array.isArray(drafts) || !drafts.length) return json({ error: "Send { drafts: [...] }." }, 400);
    const now = new Date().toISOString();
    const saved = [];
    for (const d of drafts.slice(0, 30)) {
      if (!TYPES.has(d?.type)) return json({ error: `Unknown type "${d?.type}". Use one of: ${[...TYPES].join(", ")}.` }, 400);
      if (!String(d.body || "").trim()) return json({ error: "Each draft needs a body." }, 400);
      const id = `${now.replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
      await env.STORE.put(
        `draft:${id}`,
        JSON.stringify({
          id,
          createdAt: now,
          type: d.type,
          title: clip(d.title, 200),
          body: clip(d.body, 8000),
          notes: clip(d.notes, 2000),
          link: clip(d.link, 500),
          productIds: (Array.isArray(d.productIds) ? d.productIds : []).slice(0, 12).map((x) => clip(x, 40)),
          imageUrls: (Array.isArray(d.imageUrls) ? d.imageUrls : []).slice(0, 10).map((x) => clip(x, 500)),
          videoId: clip(d.videoId, 20),
          postAt: clip(d.postAt, 40),
        }),
      );
      saved.push(id);
    }
    return json({ ok: true, saved });
  }

  return json({ error: "not found" }, 404);
}
