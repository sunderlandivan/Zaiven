import axios from "axios";

const YT_SEARCH = "https://www.youtube.com/results";
const YT_OEMBED = "https://www.youtube.com/oembed";

function getTopics() {
  const raw = String(process.env.ZEE_YOUTUBE_TOPICS || "star citizen").trim();
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function fetchSearchVideoIds(topic) {
  const res = await axios.get(YT_SEARCH, {
    timeout: 15000,
    params: {
      search_query: topic,
      sp: "CAI%3D", // upload date
    },
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });
  const html = String(res.data || "");
  const ids = [];
  const re = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = re.exec(html))) {
    const id = String(m[1] || "");
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 16) break;
  }
  return ids;
}

async function hydrateVideoMeta(videoId) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const res = await axios.get(YT_OEMBED, {
      timeout: 12000,
      params: { url, format: "json" },
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    return {
      id: videoId,
      title: String(res.data?.title || "Star Citizen video").trim(),
      channel: String(res.data?.author_name || "").trim(),
      publishedAt: "",
      url,
      thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    };
  } catch {
    return {
      id: videoId,
      title: "Star Citizen video",
      channel: "",
      publishedAt: "",
      url,
      thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    };
  }
}

async function fetchTopicVideos(topic) {
  const ids = await fetchSearchVideoIds(topic);
  const out = [];
  for (const id of ids.slice(0, 8)) {
    out.push(await hydrateVideoMeta(id));
  }
  return out;
}

export async function getYoutubeVideoFeed() {
  const topics = getTopics();
  const all = [];
  for (const t of topics) {
    try {
      const rows = await fetchTopicVideos(t);
      for (const r of rows) all.push({ ...r, topic: t });
    } catch {
      // Best-effort per topic.
    }
  }
  const uniq = new Map();
  for (const row of all) {
    if (!row.id || uniq.has(row.id)) continue;
    uniq.set(row.id, row);
  }
  const videos = [...uniq.values()]
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
    .slice(0, 16);
  return { topics, videos };
}
