import axios from "axios";

const NEWS_EVERYTHING = "https://newsapi.org/v2/everything";

function getKey() {
  const k = String(process.env.NEWS_API_KEY || "").trim();
  if (!k) throw new Error("Missing NEWS_API_KEY (NewsAPI.org).");
  return k;
}

const FEEDS = {
  nvidia: { q: "NVIDIA OR GeForce", sortBy: "publishedAt" },
  star_citizen: {
    q: '"Star Citizen" OR "Cloud Imperium Games" OR "Roberts Space Industries" OR "CIG"',
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
  const key = getKey();
  const cfg = FEEDS[topic];
  if (!cfg) throw new Error(`Unknown news topic: ${topic}`);

  const res = await axios.get(NEWS_EVERYTHING, {
    timeout: 15000,
    params: {
      apiKey: key,
      q: cfg.q,
      language: "en",
      sortBy: cfg.sortBy,
      pageSize: Math.min(20, Math.max(1, pageSize)),
    },
  });
  const articles = Array.isArray(res.data?.articles) ? res.data.articles : [];
  let filtered =
    topic === "star_citizen"
      ? articles.filter((a) => {
          const hay = `${a?.title || ""} ${a?.description || ""} ${a?.source?.name || ""}`.toLowerCase();
          return (
            hay.includes("star citizen") ||
            hay.includes("cloud imperium") ||
            hay.includes("roberts space industries") ||
            hay.includes("squadron 42")
          );
        })
      : articles;
  if (topic === "star_citizen" && !filtered.length) {
    const fallbackRes = await axios.get(NEWS_EVERYTHING, {
      timeout: 15000,
      params: {
        apiKey: key,
        q: '"Star Citizen" OR "Squadron 42" OR "Cloud Imperium Games"',
        language: "en",
        sortBy: "publishedAt",
        pageSize: Math.min(20, Math.max(1, pageSize)),
      },
    });
    const fallbackArticles = Array.isArray(fallbackRes.data?.articles) ? fallbackRes.data.articles : [];
    filtered = fallbackArticles.filter((a) => {
      const hay = `${a?.title || ""} ${a?.description || ""} ${a?.source?.name || ""}`.toLowerCase();
      return hay.includes("star citizen") || hay.includes("squadron 42") || hay.includes("cloud imperium");
    });
  }
  return filtered.map((a) => ({
    title: String(a.title || "").trim(),
    source: String(a.source?.name || "").trim(),
    url: String(a.url || "").trim(),
    publishedAt: String(a.publishedAt || "").trim(),
  }));
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
