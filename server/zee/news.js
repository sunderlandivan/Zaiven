import axios from "axios";

const NEWS_EVERYTHING = "https://newsapi.org/v2/everything";
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_COOLDOWN_MS = 30 * 60 * 1000;

/** @type {Map<string, { at: number, items: any[] }>} */
const feedCache = new Map();
let newsBlockedUntil = 0;

function getKey() {
  const k = String(process.env.NEWS_API_KEY || "").trim();
  if (!k) throw new Error("Missing NEWS_API_KEY (NewsAPI.org).");
  return k;
}

const FEEDS = {
  nvidia: { q: "NVIDIA OR GeForce", sortBy: "publishedAt" },
  star_citizen: {
    q: '"Perris, CA" OR "Perris California" OR "Perris" OR "Riverside County"',
    sortBy: "publishedAt",
  },
  steam: { q: '"Steam" (release OR launched OR debut) game', sortBy: "publishedAt" },
  world: { q: "(war OR conflict OR Ukraine OR Gaza OR interest rates OR Federal Reserve OR inflation)", sortBy: "publishedAt" },
};

export const ZEE_NEWS_TOPICS = Object.keys(FEEDS);

/**
 * @param {keyof typeof FEEDS} topic
 */
export async function fetchNewsFeed(topic, { pageSize = 6 } = {}) {
  const nowMs = Date.now();
  const cached = feedCache.get(topic);
  if (cached && nowMs - cached.at < NEWS_CACHE_TTL_MS && Array.isArray(cached.items) && cached.items.length) {
    return cached.items;
  }
  if (nowMs < newsBlockedUntil && cached?.items?.length) {
    return cached.items;
  }
  const key = getKey();
  const cfg = FEEDS[topic];
  if (!cfg) throw new Error(`Unknown news topic: ${topic}`);

  let res;
  try {
    res = await axios.get(NEWS_EVERYTHING, {
      timeout: 15000,
      params: {
        apiKey: key,
        q: cfg.q,
        language: "en",
        sortBy: cfg.sortBy,
        pageSize: Math.min(20, Math.max(1, pageSize)),
      },
    });
  } catch (e) {
    const detail = e?.response?.data ? JSON.stringify(e.response.data).toLowerCase() : String(e.message || e).toLowerCase();
    const isRateLimit =
      detail.includes("ratelimit") || detail.includes("rate limit") || detail.includes("too many requests");
    if (isRateLimit) {
      newsBlockedUntil = Date.now() + NEWS_COOLDOWN_MS;
      if (cached?.items?.length) return cached.items;
      return [];
    }
    throw e;
  }
  const articles = Array.isArray(res.data?.articles) ? res.data.articles : [];
  let filtered =
    topic === "star_citizen"
      ? articles.filter((a) => {
          const hay = `${a?.title || ""} ${a?.description || ""} ${a?.source?.name || ""}`.toLowerCase();
          return (
            hay.includes("perris") ||
            hay.includes("riverside county") ||
            hay.includes("inland empire")
          );
        })
      : articles;
  if (topic === "star_citizen" && !filtered.length) {
    const fallbackRes = await axios.get(NEWS_EVERYTHING, {
      timeout: 15000,
      params: {
        apiKey: key,
        q: '"Perris" AND ("California" OR "CA") OR "Riverside County" OR "Inland Empire"',
        language: "en",
        sortBy: "publishedAt",
        pageSize: Math.min(20, Math.max(1, pageSize)),
      },
    });
    const fallbackArticles = Array.isArray(fallbackRes.data?.articles) ? fallbackRes.data.articles : [];
    filtered = fallbackArticles.filter((a) => {
      const hay = `${a?.title || ""} ${a?.description || ""} ${a?.source?.name || ""}`.toLowerCase();
      return hay.includes("perris") || hay.includes("riverside county") || hay.includes("inland empire");
    });
  }
  const out = filtered.map((a) => ({
    title: String(a.title || "").trim(),
    source: String(a.source?.name || "").trim(),
    url: String(a.url || "").trim(),
    publishedAt: String(a.publishedAt || "").trim(),
  }));
  if (out.length) feedCache.set(topic, { at: Date.now(), items: out });
  return out;
}

export async function getAllNewsFeeds() {
  const topics = /** @type {(keyof typeof FEEDS)[]} */ (["nvidia", "star_citizen", "steam", "world"]);
  const feeds = {};
  await Promise.all(
    topics.map(async (t) => {
      try {
        feeds[t] = await fetchNewsFeed(t, { pageSize: 6 });
      } catch (e) {
        feeds[t] = { error: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message };
      }
    })
  );
  return feeds;
}
