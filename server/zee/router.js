import { Router } from "express";
import express from "express";
import { relayRealtimeSdp, createClientSecret } from "./realtime.js";
import { getStocksData, getStockDetail } from "./stocks.js";
import { getAllNewsFeeds, fetchNewsFeed, ZEE_NEWS_TOPICS } from "./news.js";
import { getMusicLibrary, createMusicStreamHandler } from "./music.js";
import { createAudiImageHandler, getAudiImagePath } from "./audi.js";
import {
  getZeeGmailAuthStartUrl,
  handleZeeGmailAuthCallback,
  getZeeGmailStatus,
  disconnectZeeGmail,
  listZeeInboxSummaries,
} from "./gmail.js";

export function createZeeRouter() {
  const router = Router();

  const textSdp = express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" });

  router.post("/voice/sdp", textSdp, async (req, res) => {
    try {
      const answer = await relayRealtimeSdp(String(req.body || ""));
      res.type("application/sdp").send(answer);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/voice/token", async (_req, res) => {
    try {
      const data = await createClientSecret();
      res.json({ ok: true, ephemeralKey: data.value, expiresAt: data.expires_at ?? null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/stocks", async (req, res) => {
    try {
      const raw = String(req.query.symbols || "NVDA,SPY");
      const symbols = raw
        .split(/[,+\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const data = await getStocksData(symbols.length ? symbols : ["NVDA", "SPY"]);
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/stocks/detail", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "").trim().toUpperCase();
      const data = await getStockDetail(symbol || "NVDA");
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/news", async (req, res) => {
    try {
      const topic = String(req.query.topic || "").trim();
      if (topic) {
        if (!ZEE_NEWS_TOPICS.includes(topic)) {
          res.status(400).json({ ok: false, error: `Unknown topic. Use one of: ${ZEE_NEWS_TOPICS.join(", ")}` });
          return;
        }
        const articles = await fetchNewsFeed(/** @type {any} */ (topic), { pageSize: 8 });
        res.json({ ok: true, topic, articles });
        return;
      }
      const feeds = await getAllNewsFeeds();
      res.json({ ok: true, feeds });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/music/library", (req, res) => {
    try {
      const force = String(req.query.refresh || "") === "1";
      const lib = getMusicLibrary({ force });
      res.json({ ok: true, ...lib });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/music/stream", createMusicStreamHandler());

  router.get("/audi/status", (_req, res) => {
    const filePath = getAudiImagePath();
    res.json({ ok: true, configured: Boolean(filePath), filePath: filePath || null });
  });
  router.get("/audi/image", createAudiImageHandler());

  router.get("/gmail/status", (_req, res) => {
    try {
      res.json({ ok: true, status: getZeeGmailStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/gmail/auth/start", (_req, res) => {
    try {
      const authUrl = getZeeGmailAuthStartUrl();
      res.json({ ok: true, authUrl });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/gmail/auth/callback", async (req, res) => {
    try {
      await handleZeeGmailAuthCallback({ code: req.query?.code, state: req.query?.state });
      res.send(
        `<!doctype html><html><body><script>window.location.href="/zee.html?gmail=connected";</script>Zee Gmail connected.</body></html>`
      );
    } catch (e) {
      res.status(400).send(`Zee Gmail connect failed: ${String(e.message || e)}`);
    }
  });

  router.post("/gmail/disconnect", (_req, res) => {
    try {
      const result = disconnectZeeGmail();
      res.json({ ok: true, result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/gmail/messages", async (req, res) => {
    try {
      const max = Math.min(25, Math.max(1, Number(req.query.max || 12)));
      const data = await listZeeInboxSummaries({ max });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  return router;
}
