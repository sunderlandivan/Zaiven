import { Router } from "express";
import express from "express";
import { relayRealtimeSdp, createClientSecret } from "./realtime.js";
import { getStocksData, getStockDetail } from "./stocks.js";
import { getAllNewsFeeds, fetchNewsFeed, ZEE_NEWS_TOPICS } from "./news.js";
import { getMusicLibrary, createMusicStreamHandler } from "./music.js";
import { createAudiImageHandler, getAudiImagePath } from "./audi.js";
import {
  clearAudiConnectState,
  getAudiConnectStatus,
  getAudiVehicleSnapshot,
  loginAudiConnect,
} from "./audiConnect.js";
import { getYoutubeVideoFeed } from "./youtube.js";
import { getSystemStats } from "./system.js";
import { addWakeListener, ensureWakeService } from "./wake.js";
import {
  getZeeGmailAuthStartUrl,
  handleZeeGmailAuthCallback,
  getZeeGmailStatus,
  disconnectZeeGmail,
  listZeeInboxSummaries,
} from "./gmail.js";
import {
  getHomeNetworkStatus,
  getHomeNetworkDevices,
  getHomeNetworkSpeedCache,
  runHomeNetworkSpeedTest,
  setHomeNetworkDeviceAllow,
  listKidsDevices,
  setKidsDevicesAllow,
} from "./homeNetwork.js";
import {
  getSmartHomeStatus,
  listSmartHomeDevices,
  setSmartHomeSwitch,
  resolveSmartHomeDevice,
} from "./smartthings.js";
import {
  disconnectOauth as disconnectSmartHomeOauth,
  getOauthAuthorizeUrl as getSmartHomeOauthAuthorizeUrl,
  getOauthStatus as getSmartHomeOauthStatus,
  handleOauthCallback as handleSmartHomeOauthCallback,
} from "./smartthingsOauth.js";
import { getSocialPending, getSocialStatus } from "./social.js";
import {
  addContact,
  deleteContact,
  findContactByName,
  getContact,
  listContacts,
  updateContact,
} from "./contacts.js";
import {
  generateMeetingLink,
  getCommStatus,
  getMailtoLink,
  importMeetSuggestionsFromGmail,
  sendInviteEmail,
} from "./communications.js";
import {
  addFollowup,
  completeFollowup,
  deleteFollowup,
  listFollowups,
} from "./followups.js";
import {
  getDevicePrefs,
  setDevicePrefs,
} from "./devices.js";
import {
  createTwilioOutboundCall,
  getTwilioStatus,
  getTwilioVoiceTwiml,
  recordTwilioStatusCallback,
} from "./twilio.js";
import { getVehicleLocationSnapshot } from "./vehicleLocation.js";
import { getRingStatus, markRingEvent } from "./ring.js";
import { listAlexaAppDevices } from "./alexa.js";

export function createZeeRouter() {
  const router = Router();
  ensureWakeService();

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

  router.get("/youtube/videos", async (_req, res) => {
    try {
      const data = await getYoutubeVideoFeed();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/system/stats", (_req, res) => {
    try {
      const data = getSystemStats();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/home-network/status", async (_req, res) => {
    try {
      const data = await getHomeNetworkStatus();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/home-network/devices", async (_req, res) => {
    try {
      const data = await getHomeNetworkDevices();
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/home-network/speed", (_req, res) => {
    try {
      res.json({ ok: true, speed: getHomeNetworkSpeedCache() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/home-network/speed-test", express.json(), async (req, res) => {
    try {
      const force = Boolean(req.body?.force) || String(req.query.force || "") === "1";
      const data = await runHomeNetworkSpeedTest({ force });
      if (!data.ok) {
        res.status(400).json(data);
        return;
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/home-network/device", express.json(), async (req, res) => {
    try {
      const mac = String(req.body?.mac || "").trim();
      const allow = Boolean(req.body?.allow);
      if (!mac) {
        res.status(400).json({ ok: false, error: "mac required" });
        return;
      }
      const data = await setHomeNetworkDeviceAllow(mac, allow);
      if (!data.ok) {
        res.status(400).json(data);
        return;
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/home-network/kids", (_req, res) => {
    try {
      res.json({ ok: true, devices: listKidsDevices() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/home-network/kids", express.json(), async (req, res) => {
    try {
      const action = String(req.body?.action || "").toLowerCase();
      const allow =
        typeof req.body?.allow === "boolean"
          ? req.body.allow
          : action === "unban" || action === "allow"
            ? true
            : false;
      const data = await setKidsDevicesAllow(allow);
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/smart-home/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getSmartHomeStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/smart-home/devices", async (req, res) => {
    try {
      const force = String(req.query.refresh || "") === "1";
      const st = await listSmartHomeDevices({ force });
      const hn = await getHomeNetworkDevices().catch(() => ({ ok: false, router: false, devices: [], merged: [] }));

      /** Best-effort Echo/Alexa discovery from router attachment names. */
      const inferAlexa = (name) => {
        const n = String(name || "").toLowerCase();
        if (!n) return false;
        return (
          n.includes("echo") ||
          n.includes("alexa") ||
          n.includes("fire tv") ||
          n.includes("firetv") ||
          n.includes("amazon")
        );
      };

      const alexaRows = [];
      const seenIds = new Set((st.devices || []).map((d) => String(d.id || "").toLowerCase()));
      if (hn?.ok && Array.isArray(hn.devices)) {
        for (const d of hn.devices) {
          const label = String(d?.name || d?.ip || d?.mac || "Unknown");
          if (!inferAlexa(label)) continue;
          const id = `alexa:${String(d.mac || d.ip || label).trim().toLowerCase()}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          alexaRows.push({
            id,
            label,
            name: label,
            room: null,
            locationId: null,
            manufacturer: "Amazon (router-detected)",
            ocfDeviceType: null,
            on: null,
            switchable: false,
            capabilities: [],
            source: "alexa-router",
            readOnlyReason: "Discovered on router; not directly controllable without Alexa API integration.",
            routerIp: d?.ip || null,
            routerMac: d?.mac || null,
          });
        }
      }
      const alexaAppRows = listAlexaAppDevices().filter((d) => {
        const key = String(d.id || "").toLowerCase();
        if (!key || seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      });

      const smartRows = (st.devices || []).map((d) => ({
        ...d,
        source: "smartthings",
      }));
      const merged = [...smartRows, ...alexaRows, ...alexaAppRows];
      merged.sort((a, b) => {
        if (a.switchable !== b.switchable) return a.switchable ? -1 : 1;
        if (a.source !== b.source) return a.source === "smartthings" ? -1 : 1;
        return String(a.label || "").localeCompare(String(b.label || ""));
      });

      res.json({
        ok: st.ok || alexaRows.length > 0,
        configured: Boolean(st.configured || (hn && hn.router)),
        smartThings: st,
        alexaFromRouter: {
          ok: hn?.ok && hn?.router,
          configured: Boolean(hn?.router),
          count: alexaRows.length,
        },
        alexaApp: {
          ok: true,
          configured: alexaAppRows.length > 0,
          count: alexaAppRows.length,
        },
        devices: merged,
        error: st.ok ? null : st.error || null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/smart-home/switch", express.json(), async (req, res) => {
    try {
      const id = String(req.body?.deviceId || "").trim();
      const on = Boolean(req.body?.on);
      const data = await setSmartHomeSwitch(id, on);
      if (!data.ok) {
        res.status(400).json(data);
        return;
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/smart-home/oauth/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getSmartHomeOauthStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/smart-home/oauth/start", (_req, res) => {
    try {
      const authUrl = getSmartHomeOauthAuthorizeUrl();
      res.json({ ok: true, authUrl });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/smart-home/oauth/callback", async (req, res) => {
    try {
      await handleSmartHomeOauthCallback({ code: req.query?.code, state: req.query?.state });
      res.send(
        `<!doctype html><html><body style="font-family:system-ui;background:#0b0d12;color:#e6e8ee;padding:24px"><h2>SmartThings connected.</h2><p>You can close this tab and return to Zee.</p><script>window.location.href="/zee.html?smartthings=connected";</script></body></html>`
      );
    } catch (e) {
      res
        .status(400)
        .send(
          `<!doctype html><html><body style="font-family:system-ui;background:#0b0d12;color:#e6e8ee;padding:24px"><h2>SmartThings connect failed</h2><pre>${String(e.message || e)}</pre></body></html>`
        );
    }
  });

  router.post("/smart-home/oauth/paste", express.json(), async (req, res) => {
    try {
      const raw = String(req.body?.url || req.body?.code || "").trim();
      if (!raw) {
        res.status(400).json({ ok: false, error: "Paste the full callback URL (or just code+state)." });
        return;
      }
      let code = "";
      let state = "";
      try {
        const u = new URL(raw);
        code = u.searchParams.get("code") || "";
        state = u.searchParams.get("state") || "";
      } catch {
        const params = new URLSearchParams(raw.replace(/^[?#]/, ""));
        code = params.get("code") || "";
        state = params.get("state") || "";
      }
      if (!code) {
        res.status(400).json({ ok: false, error: "No 'code' parameter found in the pasted URL." });
        return;
      }
      if (!state && typeof req.body?.state === "string") state = req.body.state;
      await handleSmartHomeOauthCallback({ code, state });
      res.json({ ok: true, connected: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/smart-home/oauth/disconnect", (_req, res) => {
    try {
      const r = disconnectSmartHomeOauth();
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/smart-home/by-name", express.json(), async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const on = Boolean(req.body?.on);
      const r = await resolveSmartHomeDevice(name);
      if (!r.ok) {
        res.status(404).json(r);
        return;
      }
      const cmd = await setSmartHomeSwitch(r.device.id, on);
      if (!cmd.ok) {
        res.status(400).json({ ok: false, error: cmd.error, matched: r.device });
        return;
      }
      res.json({ ok: true, on, device: r.device });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/social/pending", async (req, res) => {
    try {
      const force = String(req.query.refresh || "") === "1";
      const data = await getSocialPending({ force });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/social/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getSocialStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/comm/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getCommStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/comm/contacts", (_req, res) => {
    try {
      res.json({ ok: true, contacts: listContacts() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/comm/contacts", express.json(), (req, res) => {
    try {
      const c = addContact(req.body || {});
      res.json({ ok: true, contact: c });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.patch("/comm/contacts/:id", express.json(), (req, res) => {
    try {
      const c = updateContact(req.params.id, req.body || {});
      res.json({ ok: true, contact: c });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.delete("/comm/contacts/:id", (req, res) => {
    try {
      const r = deleteContact(req.params.id);
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/comm/quick-call", express.json(), (req, res) => {
    try {
      const platform = String(req.body?.platform || "meet").toLowerCase();
      const subject = String(req.body?.subject || "").trim() || null;
      const link = generateMeetingLink({ platform, contactName: subject });
      res.json({ ok: true, link });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/comm/call", express.json(), async (req, res) => {
    try {
      const id = String(req.body?.contactId || "").trim();
      const name = String(req.body?.name || "").trim();
      const platformOverride = req.body?.platform ? String(req.body.platform).toLowerCase() : null;
      const sendEmail = Boolean(req.body?.sendEmail);

      let contact = id ? getContact(id) : null;
      if (!contact && name) contact = findContactByName(name);
      if (!contact) {
        return res.status(404).json({
          ok: false,
          error: name ? `No contact matched "${name}".` : "Contact not found.",
        });
      }

      const platform = platformOverride || contact.preferredPlatform || "meet";
      const link = generateMeetingLink({ platform, contact, contactName: contact.name });

      let invite = null;
      if (sendEmail) {
        const subject = `Quick video call: ${contact.name}`;
        const body = `Hi ${contact.name},\n\nI'd like to chat. Join me on ${link.platform}:\n${link.url}\n\n— Zee`;
        invite = await sendInviteEmail({
          to: contact.email,
          subject,
          body,
        });
      }
      res.json({ ok: true, contact, link, invite });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/comm/import-meet-suggestions", async (req, res) => {
    try {
      const query = String(req.query?.q || "").trim() || undefined;
      const maxScan = Number(req.query?.maxScan) || undefined;
      const max = Number(req.query?.max) || undefined;
      const r = await importMeetSuggestionsFromGmail({ query, maxScan, max });
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/comm/import-meet-suggestions/accept", express.json(), (req, res) => {
    try {
      const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
      const created = [];
      for (const p of picks) {
        if (!p?.name) continue;
        try {
          created.push(addContact({
            name: String(p.name),
            preferredPlatform: "meet",
            email: p.email || null,
            notes: p.notes || "Imported from Meet history",
          }));
        } catch {
          /* skip dupes / invalid */
        }
      }
      res.json({ ok: true, created, total: created.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/followups", (req, res) => {
    try {
      const includeDone = String(req.query?.all || "") === "1";
      res.json({ ok: true, items: listFollowups({ includeDone }) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/followups", express.json(), (req, res) => {
    try {
      const item = addFollowup(req.body || {});
      res.json({ ok: true, item });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/followups/:id/complete", (req, res) => {
    try {
      const item = completeFollowup(req.params.id);
      res.json({ ok: true, item });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.delete("/followups/:id", (req, res) => {
    try {
      res.json({ ok: true, ...deleteFollowup(req.params.id) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/devices", (_req, res) => {
    try {
      res.json({ ok: true, prefs: getDevicePrefs() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/devices", express.json(), (req, res) => {
    try {
      const prefs = setDevicePrefs(req.body || {});
      res.json({ ok: true, prefs });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/comm/invite-email", express.json(), async (req, res) => {
    try {
      const to = String(req.body?.to || "").trim();
      const subject = String(req.body?.subject || "Zee meeting invite");
      const body = String(req.body?.body || "");
      if (!to) {
        return res.status(400).json({
          ok: false,
          error: "to is required",
          mailto: getMailtoLink({ subject, body }),
        });
      }
      const r = await sendInviteEmail({ to, subject, body });
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/wake/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send({ type: "connected" });
    const off = addWakeListener(send);
    const keepAlive = setInterval(() => send({ type: "ping", at: Date.now() }), 25000);
    res.on("close", () => {
      clearInterval(keepAlive);
      off();
      res.end();
    });
  });

  router.get("/audi/status", (_req, res) => {
    const filePath = getAudiImagePath();
    res.json({ ok: true, configured: Boolean(filePath), filePath: filePath || null });
  });
  router.get("/audi/image", createAudiImageHandler());

  router.get("/audi/connect/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getAudiConnectStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/audi/connect/login", express.json(), async (req, res) => {
    try {
      const email = String(req.body?.email || process.env.ZEE_AUDI_EMAIL || "").trim();
      const password = String(req.body?.password || process.env.ZEE_AUDI_PASSWORD || "");
      const state = await loginAudiConnect({ email, password });
      res.json({
        ok: true,
        connected: Boolean(state?.vwToken?.access_token),
        country: state.country,
        updatedAt: state.updatedAt,
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/audi/connect/logout", (_req, res) => {
    try {
      clearAudiConnectState();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/audi/connect/vehicle", async (_req, res) => {
    try {
      const data = await getAudiVehicleSnapshot();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/audi/location", async (_req, res) => {
    try {
      const data = await getVehicleLocationSnapshot();
      if (!data.ok) {
        res.status(400).json(data);
        return;
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/ring/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getRingStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/ring/event", express.json(), (req, res) => {
    try {
      const type = String(req.body?.type || "event");
      const out = markRingEvent(type, req.body || {});
      res.json(out);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.get("/twilio/status", (_req, res) => {
    try {
      res.json({ ok: true, ...getTwilioStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/twilio/call", express.json(), async (req, res) => {
    try {
      const to = String(req.body?.to || "").trim();
      const out = await createTwilioOutboundCall({ to });
      if (!out.ok) {
        res.status(400).json(out);
        return;
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post("/twilio/voice", express.urlencoded({ extended: false }), (req, res) => {
    try {
      const twiml = getTwilioVoiceTwiml({
        from: req.body?.From,
        to: req.body?.To,
        callSid: req.body?.CallSid,
      });
      res.type("text/xml").send(twiml);
    } catch (e) {
      res
        .type("text/xml")
        .status(500)
        .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${String(e.message || e)}</Say></Response>`);
    }
  });

  router.post("/twilio/status-callback", express.urlencoded({ extended: false }), (req, res) => {
    try {
      recordTwilioStatusCallback(req.body || {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

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
