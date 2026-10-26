import { json } from "../../lib/store.js";

const CHANNEL_ID = "UC-cknqXPoxXdnGK85OAVARQ";

const pick = (s, re) => (s.match(re) || [])[1] || "";
const unxml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Latest uploads from the channel's public feed (no API key needed). */
export async function onRequestGet() {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, { cf: { cacheTtl: 1800, cacheEverything: true } });
  if (!res.ok) return json({ videos: [] });
  const xml = await res.text();
  const videos = xml
    .split("<entry>")
    .slice(1)
    .map((e) => ({
      id: pick(e, /<yt:videoId>([^<]+)/),
      title: unxml(pick(e, /<title>([^<]+)/)),
      published: pick(e, /<published>([^<]+)/),
      views: Number(pick(e, /views="(\d+)"/)) || 0,
      short: /#shorts?\b/i.test(e),
    }))
    .filter((v) => v.id);
  return new Response(JSON.stringify({ channel: "https://www.youtube.com/@thezaiven", videos }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" },
  });
}
