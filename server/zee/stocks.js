import axios from "axios";

const FINNHUB_QUOTE = "https://finnhub.io/api/v1/quote";
const FINNHUB_CANDLE = "https://finnhub.io/api/v1/stock/candle";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const CANDLE_CACHE_TTL_MS = 10 * 60 * 1000;
const FINNHUB_COOLDOWN_MS = 15 * 60 * 1000;

/** @type {Map<string, { at: number, closes: number[] }>} */
const candleCache = new Map();
let finnhubBlockedUntil = 0;

function getToken() {
  const t = String(process.env.STOCKS_API_KEY || process.env.FINNHUB_API_KEY || "").trim();
  return t;
}

/**
 * @param {string} symbol
 * @param {{ from: number, to: number }} range unix seconds
 */
async function fetchCandles(symbol, { from, to }) {
  const token = getToken();
  if (!token) return { closes: [] };
  const key = String(symbol || "").toUpperCase();
  const cached = candleCache.get(key);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < CANDLE_CACHE_TTL_MS && Array.isArray(cached.closes) && cached.closes.length) {
    return { closes: cached.closes };
  }
  const res = await axios.get(FINNHUB_CANDLE, {
    timeout: 15000,
    params: {
      symbol: symbol.toUpperCase(),
      resolution: "D",
      from,
      to,
      token,
    },
  });
  const d = res.data || {};
  if (d.s === "no_data" || !Array.isArray(d.c)) return { closes: [] };
  const closes = d.c.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  candleCache.set(key, { at: nowMs, closes });
  return { closes };
}

async function fetchFromYahoo(symbol) {
  const res = await axios.get(`${YAHOO_CHART}/${encodeURIComponent(symbol)}`, {
    timeout: 15000,
    params: {
      interval: "1d",
      range: "3mo",
    },
  });
  const result = res.data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close)
    ? quote.close.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  const current = Number(result?.meta?.regularMarketPrice);
  const prev = Number(result?.meta?.chartPreviousClose || result?.meta?.previousClose);
  return {
    symbol,
    current: Number.isFinite(current) ? current : closes.at(-1) ?? null,
    previousClose: Number.isFinite(prev) ? prev : closes.at(-2) ?? null,
    changePct:
      Number.isFinite(current) && Number.isFinite(prev) && prev
        ? ((current - prev) / prev) * 100
        : null,
    high: Number.isFinite(Number(result?.meta?.regularMarketDayHigh)) ? Number(result.meta.regularMarketDayHigh) : null,
    low: Number.isFinite(Number(result?.meta?.regularMarketDayLow)) ? Number(result.meta.regularMarketDayLow) : null,
    sparkline: closes.slice(-30),
    provider: "yahoo",
  };
}

function isFinnhubRateLimited(errorDetail) {
  const s = String(errorDetail || "").toLowerCase();
  return (
    s.includes("api limit reached") ||
    s.includes("rate limit") ||
    s.includes("too many requests") ||
    s.includes("remaining limit: 0")
  );
}

function computeRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = Number(closes[i]) - Number(closes[i - 1]);
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (!avgLoss) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export async function getStockDetail(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!s) throw new Error("symbol is required");
  const res = await axios.get(`${YAHOO_CHART}/${encodeURIComponent(s)}`, {
    timeout: 15000,
    params: {
      interval: "1d",
      range: "1y",
    },
  });
  const result = res.data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const meta = result?.meta || {};
  const closes = Array.isArray(quote.close) ? quote.close.map((x) => Number(x)).filter(Number.isFinite) : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume.map((x) => Number(x)).filter(Number.isFinite) : [];
  const highs = Array.isArray(quote.high) ? quote.high.map((x) => Number(x)).filter(Number.isFinite) : [];
  const lows = Array.isArray(quote.low) ? quote.low.map((x) => Number(x)).filter(Number.isFinite) : [];

  const current = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose || meta.previousClose);
  const week52High = Number(meta.fiftyTwoWeekHigh);
  const week52Low = Number(meta.fiftyTwoWeekLow);

  return {
    symbol: s,
    current: Number.isFinite(current) ? current : closes.at(-1) ?? null,
    previousClose: Number.isFinite(previousClose) ? previousClose : closes.at(-2) ?? null,
    dayHigh: highs.at(-1) ?? null,
    dayLow: lows.at(-1) ?? null,
    week52High: Number.isFinite(week52High) ? week52High : Math.max(...closes),
    week52Low: Number.isFinite(week52Low) ? week52Low : Math.min(...closes),
    rsi14: computeRsi(closes, 14),
    closeSeries: closes.slice(-90),
    volumeSeries: volumes.slice(-45),
    provider: "yahoo",
  };
}

/**
 * @param {string[]} symbols
 */
export async function getStocksData(symbols) {
  const token = getToken();
  const now = Math.floor(Date.now() / 1000);
  const from = now - 60 * 60 * 24 * 90;
  const nowMs = Date.now();
  const allowFinnhub = Boolean(token) && nowMs >= finnhubBlockedUntil;

  const out = {};
  for (const sym of symbols) {
    const s = String(sym || "")
      .trim()
      .toUpperCase();
    if (!s) continue;
    try {
      if (allowFinnhub) {
        const [quoteRes, candles] = await Promise.all([
          axios.get(FINNHUB_QUOTE, {
            timeout: 12000,
            params: { symbol: s, token },
          }),
          fetchCandles(s, { from, to: now }),
        ]);
        const q = quoteRes.data || {};
        out[s] = {
          symbol: s,
          current: Number(q.c) || null,
          previousClose: Number(q.pc) || null,
          changePct:
            Number(q.c) && Number(q.pc) ? ((Number(q.c) - Number(q.pc)) / Number(q.pc)) * 100 : null,
          high: Number(q.h) || null,
          low: Number(q.l) || null,
          sparkline: candles.closes.slice(-30),
          provider: "finnhub",
        };
      } else {
        out[s] = await fetchFromYahoo(s);
      }
    } catch (e) {
      const detail = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : String(e.message || e);
      if (isFinnhubRateLimited(detail)) {
        finnhubBlockedUntil = Date.now() + FINNHUB_COOLDOWN_MS;
        try {
          out[s] = await fetchFromYahoo(s);
          continue;
        } catch (fallbackError) {
          const fallbackDetail = fallbackError?.response?.data
            ? JSON.stringify(fallbackError.response.data).slice(0, 200)
            : String(fallbackError.message || fallbackError);
          out[s] = { symbol: s, error: fallbackDetail };
          continue;
        }
      }
      const canFallback = detail.toLowerCase().includes("access") || detail.toLowerCase().includes("forbidden");
      if (canFallback) {
        try {
          out[s] = await fetchFromYahoo(s);
          continue;
        } catch (fallbackError) {
          const fallbackDetail = fallbackError?.response?.data
            ? JSON.stringify(fallbackError.response.data).slice(0, 200)
            : String(fallbackError.message || fallbackError);
          out[s] = { symbol: s, error: fallbackDetail };
          continue;
        }
      }
      out[s] = { symbol: s, error: detail };
    }
  }
  return out;
}
