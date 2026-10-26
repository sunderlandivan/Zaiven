// Weekly promo Short for YouTube Shorts + Instagram Reels, in the approved "flashy" promo style (server/promoRender.js).
// Once a week (default Thursday 5 PM Pacific) the PC renders a Short for a rotating in-stock product, then either posts it
// (mode "auto") or waits for the owner's OK on the Marketing page (mode "ask"). The very first run always asks.
// Runs only while this PC holds the portal lease. Every entry is saved before rendering/uploading, so a restart can't
// double-post: an interrupted upload is marked "unknown" and never retried automatically.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";
import { buildInsights } from "./storeMarketing.js";
import { CATALOG_PATH } from "./storeCatalog.js";
import { HOOKS, SINGLE_HOOKS, STICKERS, CHEAP_STICKERS, listPromoShorts } from "./promoShorts.js";
import { pcLease, appendAudit } from "./portalLease.js";
import { notifyDesktop } from "./desktopNotify.js";
import { kvDelete, kvPutFile } from "./cloudflareKv.js";

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT = path.join(ROOT, "storefront");
export const SHORTS_DIR = path.join(ROOT, "data", "shorts");
const STATE_PATH = path.join(ROOT, "data", "weekly-shorts.json");
const YT_PATH = path.join(ROOT, "data", "youtube-oauth.json");
const IG_PATH = path.join(ROOT, "data", "instagram-publish.json");
const LISTINGS_PATH = path.join(ROOT, "data", "tcgplayer-listings.json");
const MARKETING_URL = "http://localhost:5173/inventory-marketing.html";
const SITE = "https://preeminentstore.com";
const PORTAL_MEDIA = "https://portal.preeminentstore.com/media/short";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YT_SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const YT_REDIRECT_DEFAULT = "http://localhost:5173/api/marketing/youtube/auth/callback";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_SETTINGS = {
  enabled: true,
  day: 4,
  time: "17:00",
  timezone: "America/Los_Angeles",
  mode: "auto",
  // The first scheduled Short waits for approval even in auto mode; cleared when the owner approves one.
  firstRunReview: true,
  platforms: { youtube: true, instagram: true },
  // "resumable" sends the file straight to Meta; "portal-url" hosts it for 2 hours on portal.preeminentstore.com.
  instagramUpload: "resumable",
  graphVersion: "v23.0",
  // Extra words that must never appear in a caption (e.g. your city). Kept on this PC only.
  privacyBlocklist: [],
  skipKeys: [],
  catchUpHours: 48,
  recentProductsToAvoid: 8,
  // Weekly Shorts feature sealed product only (never singles / custom decks / accessories).
  sealedOnly: true,
  minQty: 6,
  minPrice: 15,
  // Only feature items at or below TCGplayer market when a market price is known.
  requireCompetitive: true,
};

// ---------- state ----------
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

function readState() {
  const s = readJson(STATE_PATH, null);
  if (!s) {
    const fresh = { settings: { ...DEFAULT_SETTINGS }, armedAt: new Date().toISOString(), history: [] };
    writeJson(STATE_PATH, fresh);
    return fresh;
  }
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings, platforms: { ...DEFAULT_SETTINGS.platforms, ...s.settings?.platforms } };
  s.history ||= [];
  s.armedAt ||= new Date().toISOString();
  return s;
}
const saveState = (s) => writeJson(STATE_PATH, { ...s, history: s.history.slice(0, 104) });

function updateEntry(id, fn) {
  const s = readState();
  const e = s.history.find((h) => h.id === id);
  if (!e) throw new Error("Weekly Short not found.");
  fn(e, s);
  saveState(s);
  return e;
}

// ---------- schedule math (wall-clock time in the configured zone) ----------
function zoned(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
function zonedToUtc(y, m, d, h, mi, tz) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = zoned(guess, tz);
    guess += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return guess;
}
/** dir -1: most recent slot at or before now; dir 1: next slot after now. key = local date of the slot. */
export function findSlot(now, settings, dir) {
  const [h, mi] = String(settings.time || "17:00").split(":").map(Number);
  const today = zoned(now, settings.timezone);
  for (let k = 0; k <= 8; k++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + dir * k));
    if (day.getUTCDay() !== Number(settings.day)) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, settings.timezone);
    if (dir < 0 ? at <= now : at > now) return { at, key: day.toISOString().slice(0, 10) };
  }
  return null;
}

// Sealed product types featured on Weekly Shorts. Singles, custom decks, and accessories are never picked.
const SEALED_TYPES = new Set(["Box", "Booster Bundle", "ETB", "Pack", "Collection"]);

// ---------- product pick ----------
function pickProduct(settings, history) {
  const insights = buildInsights();
  const catalog = readJson(CATALOG_PATH, { items: [] });
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const recent = new Set([
    ...history.filter((h) => h.productId && h.status !== "skipped" && h.status !== "rejected").slice(0, settings.recentProductsToAvoid).map((h) => h.productId),
    ...listPromoShorts().slice(0, 3).map((s) => s.productId),
  ]);
  const hot = new Map(insights.salesLast30Days.topSellers.map((s) => [String(s.item).toLowerCase(), s.qty]));
  const maxHot = Math.max(1, ...hot.values());
  const maxRow = Math.max(1, ...insights.items.map((i) => i.addedRow || 0));

  const minQty = Math.max(1, Number(settings.minQty) || 3);
  const minPrice = Number(settings.minPrice) || 15;
  const sealedOnly = settings.sealedOnly !== false;
  const requireCompetitive = settings.requireCompetitive !== false;

  const market = marketPrices();
  const eligible = insights.items
    .map((i) => ({ ...i, cat: byId.get(i.id), market: market.get(marketKey(i.name, i.set)) || null }))
    .filter((i) => i.cat?.image && fs.existsSync(path.join(STOREFRONT, i.cat.image)))
    .filter((i) => !sealedOnly || SEALED_TYPES.has(i.cat.type))
    .filter((i) => (i.qty == null ? false : i.qty >= minQty) && i.price >= minPrice && !recent.has(i.id));
  if (!eligible.length) {
    throw new Error(
      sealedOnly
        ? `No sealed product with a photo, qty ≥ ${minQty}, and price ≥ $${minPrice} is available (or all were featured recently).`
        : "No in-stock product with a photo is available to feature (all were featured recently)."
    );
  }
  // Prefer site price at or below TCGplayer market. With requireCompetitive, never fall back to overpriced sealed.
  const goodValue = eligible.filter((i) => i.market && i.price <= i.market);
  const pool = goodValue.length ? goodValue : requireCompetitive ? [] : eligible;
  if (!pool.length) {
    throw new Error(
      `No sealed product with qty ≥ ${minQty} is at or below TCGplayer market right now. Refresh the TCGplayer export or raise stock of competitive sealed before making a Short.`
    );
  }

  const scored = pool.map((i) => {
    const sold = hot.get(String(i.cat.title || "").toLowerCase()) || 0;
    const margin = i.minPrice ? Math.max(0, (i.price - i.minPrice) / i.price) : 0.1;
    const qtyBoost = Math.min(1, (i.qty || 0) / 20);
    const score =
      0.3 * ((i.addedRow || 0) / maxRow) +
      0.25 * (sold / maxHot) +
      0.2 * Math.min(1, margin / 0.4) +
      0.15 * qtyBoost +
      0.1 * Math.random();
    const why = [
      `qty ${i.qty}`,
      (i.addedRow || 0) / maxRow > 0.8 ? "new arrival" : "",
      sold ? `${sold} sold in 30 days` : "",
      margin >= 0.2 ? "good margin" : "",
    ].filter(Boolean);
    if (goodValue.length) why.unshift(`at/below TCGplayer market ($${i.market.toFixed(2)})`);
    return { item: i.cat, qty: i.qty, market: i.market, goodValue: Boolean(goodValue.length), score, why: why.join(", ") || "rotation" };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

const marketKey = (name, set) => `${name}|${set}`.toLowerCase();
/** TCGplayer market price by product name + set, from the latest TCGplayer export (read only). */
function marketPrices() {
  const map = new Map();
  for (const l of readJson(LISTINGS_PATH, { listings: [] }).listings || []) {
    if (Number(l.market) > 0) map.set(marketKey(l.name, l.set), Number(l.market));
  }
  return map;
}

/** Prices are never changed here: a Short may only go out while its rendered price is still the site's price. */
function assertStillCurrent(entry) {
  const item = readJson(CATALOG_PATH, { items: [] }).items.find((i) => i.id === entry.productId);
  if (!item) throw new Error(`${entry.name} is no longer on the website. Reject this Short and make a new one.`);
  if (Math.abs(Number(item.price) - Number(entry.price)) > 0.001) {
    throw new Error(`The site price changed from $${Number(entry.price).toFixed(2)} to $${Number(item.price).toFixed(2)} since this Short was made. Reject it and make a new one so the video shows the current price.`);
  }
}

const pick = (list, avoid = []) => {
  const fresh = list.filter((x) => !avoid.includes(x));
  const from = fresh.length ? fresh : list;
  return from[Math.floor(Math.random() * from.length)];
};

// ---------- captions ----------
const GAME_TAGS = {
  pokemon: ["#pokemon", "#pokemontcg", "#pokemoncards"],
  magic: ["#mtg", "#magicthegathering", "#mtgcommunity"],
  fab: ["#fleshandblood", "#fabtcg"],
  weiss: ["#weissschwarz"],
  riftbound: ["#riftbound", "#leagueoflegends"],
  onepiece: ["#onepiececardgame", "#onepiecetcg"],
  gundam: ["#gundamcardgame", "#gundam"],
};
const oneLine = (s) => String(s).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
const noAngles = (s) => String(s).replace(/[<>]/g, "");
const productUrl = (item, ref) => `${SITE}/p/${encodeURIComponent(item.id)}?ref=${ref}`;

function buildCaptions(item, hook, { goodValue = false } = {}) {
  const price = `$${Number(item.price).toFixed(2)}`;
  const tags = [...(GAME_TAGS[item.game] || []), "#tcg", "#tradingcards", item.type === "Single" ? "#tcgsingles" : "#sealedproduct", "#unboxing", "#funny"];
  const asOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
  const line2 = `${item.name}, ${price} at The PreEminent Store.${item.low ? " Low stock!" : ""}${goodValue ? ` At or under TCGplayer market as of ${asOf}.` : ""}`;

  let name = item.name;
  const titleFor = (n) => noAngles(`${oneLine(hook)} | ${n} ${price} #Shorts`);
  while (titleFor(name).length > 100 && name.length > 12) name = `${name.slice(0, name.length - 4).trim()}…`;
  let youtubeTitle = titleFor(name);
  if (youtubeTitle.length > 100) youtubeTitle = noAngles(`${item.name.slice(0, 80)} ${price} #Shorts`);

  const youtubeDescription = noAngles(
    [oneLine(hook), "", line2, `Shop it: ${productUrl(item, "yt")}`, "Factory sealed, ships fast within the US.", "", [...tags, "#shorts"].join(" ")].join("\n")
  );
  const instagramCaption = [
    oneLine(hook),
    "",
    line2,
    "Tap the link in our bio 🔗 or go to preeminentstore.com",
    `Direct: ${productUrl(item, "ig")}`,
    "Factory sealed, ships fast within the US.",
    "",
    [...tags, "#reels", "#tcgcommunity"].slice(0, 25).join(" "),
  ].join("\n");
  const youtubeTags = ["shorts", "tcg", "trading cards", item.game, item.set, item.name, "PreEminent Store"].filter(Boolean).map((t) => String(t).slice(0, 60));
  return { youtubeTitle, youtubeDescription, youtubeTags, instagramCaption };
}

/** Refuses anything that looks like a street address, ZIP code or a blocklisted word (city). URLs are ignored. */
export function privacyCheck(texts, blocklist = []) {
  for (const raw of texts) {
    const t = String(raw || "").replace(/https?:\/\/\S+/g, " ");
    if (/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|cir|circle|pkwy|hwy)\b\.?/i.test(t)) throw new Error("Privacy check: a caption looks like it contains a street address.");
    if (/\b\d{5}(?:-\d{4})?\b/.test(t)) throw new Error("Privacy check: a caption contains a ZIP-code-like number.");
    for (const word of blocklist) {
      const w = String(word || "").trim();
      if (w && t.toLowerCase().includes(w.toLowerCase())) throw new Error("Privacy check: a caption contains a blocked word (see Privacy blocklist).");
    }
  }
}

// ---------- render ----------
async function renderShort(item, { hook, sticker, baseName }) {
  fs.mkdirSync(SHORTS_DIR, { recursive: true });
  const file = `${baseName}.mp4`;
  const thumb = `${baseName}.jpg`;
  const out = path.join(SHORTS_DIR, file);
  const specPath = path.join(SHORTS_DIR, `.spec-${Date.now()}.json`);
  writeJson(specPath, {
    out,
    image: path.join(STOREFRONT, item.image),
    name: item.name,
    set: item.set,
    game: item.game,
    price: item.price,
    low: item.low,
    hook,
    sticker,
    seed: Date.now() % 100000,
  });
  try {
    await run(process.execPath, [path.join(ROOT, "server", "promoRender.js"), specPath], { cwd: ROOT, timeout: 300_000, windowsHide: true });
  } catch (e) {
    throw new Error(`Render failed: ${String(e.stderr || e.message).trim().slice(-300)}`);
  } finally {
    fs.rmSync(specPath, { force: true });
  }
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "7.5", "-i", out, "-frames:v", "1", "-q:v", "3", path.join(SHORTS_DIR, thumb)], { timeout: 60_000, windowsHide: true });
  return { file, thumb, bytes: fs.statSync(out).size };
}

/** Renders a Short in the approved flashy style and fills in the entry. Used by the scheduler, "Make now", and the sample. */
export async function buildShortEntry({ baseName, productId } = {}) {
  const s = readState();
  let chosen;
  if (productId) {
    const item = readJson(CATALOG_PATH, { items: [] }).items.find((i) => i.id === String(productId));
    if (!item) throw new Error("That product isn't in the store right now.");
    const market = marketPrices().get(marketKey(item.name, item.set)) || null;
    chosen = { item, market, goodValue: Boolean(market && item.price <= market), why: "picked by owner" };
  } else chosen = pickProduct(s.settings, s.history);
  const { item } = chosen;
  const recentHooks = s.history.slice(0, 6).map((h) => h.hook);
  const hook = pick(item.type === "Single" ? [...SINGLE_HOOKS, ...HOOKS.slice(0, 3)] : HOOKS, recentHooks);
  // No value or investment claims on screen: the price is shown as-is and nothing says it's cheap.
  const neutral = [...STICKERS, ...CHEAP_STICKERS].filter((x) => !/investment|cheaper|free|pocket change|less than/i.test(x));
  const sticker = pick(neutral, s.history.slice(0, 4).map((h) => h.sticker));
  const captions = buildCaptions(item, hook, { goodValue: Boolean(chosen.goodValue) });
  privacyCheck([captions.youtubeTitle, captions.youtubeDescription, captions.instagramCaption, hook, sticker], s.settings.privacyBlocklist);
  const media = await renderShort(item, { hook, sticker, baseName: baseName || `weekly-${new Date().toISOString().slice(0, 10)}-${item.id}` });
  return { productId: item.id, name: item.name, price: item.price, market: chosen.market || null, goodValue: Boolean(chosen.goodValue), why: chosen.why, hook, sticker, ...media, ...captions };
}

// ---------- YouTube ----------
function googleConfig() {
  const clientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET aren't set (same Google OAuth client as Gmail sync).");
  return { clientId, clientSecret, redirectUri: String(process.env.YOUTUBE_REDIRECT_URI || "").trim() || YT_REDIRECT_DEFAULT };
}

export function youtubeAuthUrl() {
  const cfg = googleConfig();
  const state = crypto.randomBytes(24).toString("hex");
  writeJson(YT_PATH, { ...readJson(YT_PATH, {}), state, stateCreatedAt: new Date().toISOString() });
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YT_SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  return u.toString();
}

async function googleToken(params) {
  const cfg = googleConfig();
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const r = await axios.post(GOOGLE_TOKEN, body.toString(), { timeout: 15_000, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return r.data || {};
}

export async function youtubeAuthCallback({ code, state }) {
  const saved = readJson(YT_PATH, {});
  if (!state || !saved.state || state !== saved.state) throw new Error("OAuth state mismatch. Click Connect YouTube again.");
  const t = await googleToken({ code: String(code || ""), redirect_uri: googleConfig().redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Click Connect YouTube again and approve every checkbox.");
  const next = { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, scope: t.scope, connectedAt: new Date().toISOString() };
  writeJson(YT_PATH, next);
  try {
    const ch = await youtubeChannel();
    writeJson(YT_PATH, { ...next, channelId: ch?.id || "", channelTitle: ch?.snippet?.title || "" });
  } catch {
    /* channel lookup is cosmetic */
  }
  appendAudit({ action: "youtube connected", detail: "Weekly Shorts upload access granted", by: "pc owner" });
}

async function youtubeAccessToken() {
  const saved = readJson(YT_PATH, {});
  if (!saved.refreshToken) throw new Error("YouTube isn't connected. Click Connect YouTube on the Marketing page.");
  if (saved.accessToken && saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
  const t = await googleToken({ refresh_token: saved.refreshToken, grant_type: "refresh_token" });
  writeJson(YT_PATH, { ...saved, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 });
  return t.access_token;
}

async function youtubeChannel() {
  const token = await youtubeAccessToken();
  const r = await axios.get("https://www.googleapis.com/youtube/v3/channels", { params: { part: "snippet", mine: true }, headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 });
  return r.data?.items?.[0] || null;
}

// Monetization can't be set through the API: uploads inherit the channel's Upload defaults in YouTube Studio.
// Everything here keeps them ad-friendly: original visuals, generated sound effects only, not made for kids, public.
function youtubeMeta(entry) {
  return {
    snippet: { title: entry.youtubeTitle, description: entry.youtubeDescription, tags: entry.youtubeTags, categoryId: "20", defaultLanguage: "en" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true, license: "youtube" },
  };
}

async function uploadYouTube(entry, settings) {
  const token = await youtubeAccessToken();
  const file = path.join(SHORTS_DIR, entry.file);
  const size = fs.statSync(file).size;
  const init = await axios.post("https://www.googleapis.com/upload/youtube/v3/videos", youtubeMeta(entry), {
    params: { uploadType: "resumable", part: "snippet,status" },
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    timeout: 30_000,
  });
  const location = init.headers.location;
  if (!location) throw new Error("YouTube didn't return an upload URL.");
  const up = await axios.put(location, fs.createReadStream(file), {
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 10 * 60_000,
  });
  const v = up.data || {};
  const privacy = v.status?.privacyStatus || "";
  const note =
    privacy && privacy !== "public"
      ? `YouTube set it to ${privacy}: uploads from an unaudited Google project are locked private. Make it Public in YouTube Studio, or request the free API audit (see docs/weekly-shorts.md).`
      : "";
  return { id: v.id, url: `https://www.youtube.com/shorts/${v.id}`, privacy, note };
}

// ---------- Instagram (Graph API, Reels) ----------
const igSaved = () => readJson(IG_PATH, {});
const graph = (settings) => `https://graph.facebook.com/${settings.graphVersion || DEFAULT_SETTINGS.graphVersion}`;
const graphError = (e) => e.response?.data?.error?.message || e.message;

/** Exchanges a short-lived user token for a never-expiring Page token and finds the linked Instagram account. */
export async function connectInstagram({ appId, appSecret, userToken, pageId } = {}) {
  const { settings } = readState();
  if (!appId || !appSecret || !userToken) throw new Error("App ID, App secret and the user access token are all required.");
  try {
    const long = await axios.get(`${graph(settings)}/oauth/access_token`, {
      params: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken },
      timeout: 15_000,
    });
    const pageFields = "id,name,access_token,instagram_business_account{id,username}";
    const pages = await axios.get(`${graph(settings)}/me/accounts`, {
      params: { fields: pageFields, access_token: long.data.access_token, limit: 50 },
      timeout: 15_000,
    });
    const list = pages.data?.data || [];
    let page = list.find((p) => (pageId ? p.id === String(pageId) : p.instagram_business_account));
    // Facebook Login for Business sometimes returns an empty /me/accounts list even when
    // the user can read a known Page by id (granular Page grant).
    if (!page && pageId) {
      try {
        const direct = await axios.get(`${graph(settings)}/${encodeURIComponent(pageId)}`, {
          params: { fields: pageFields, access_token: long.data.access_token },
          timeout: 15_000,
        });
        if (direct.data?.id) page = direct.data;
      } catch {
        /* fall through to the empty-list error below */
      }
    }
    if (!page) throw new Error(list.length ? "None of your Facebook Pages has an Instagram Business/Creator account linked." : "The token can't see any Facebook Page. Grant pages_show_list.");
    if (!page.instagram_business_account) throw new Error(`Page "${page.name}" has no Instagram Business/Creator account linked.`);
    writeJson(IG_PATH, {
      appId: String(appId),
      pageId: page.id,
      pageName: page.name,
      igUserId: page.instagram_business_account.id,
      igUsername: page.instagram_business_account.username || "",
      accessToken: page.access_token,
      connectedAt: new Date().toISOString(),
    });
    appendAudit({ action: "instagram connected", detail: `Weekly Shorts publishing to @${page.instagram_business_account.username || page.instagram_business_account.id}`, by: "pc owner" });
    return instagramStatus();
  } catch (e) {
    throw new Error(`Instagram connect failed: ${graphError(e)}`);
  }
}

function instagramStatus() {
  const s = igSaved();
  return { connected: Boolean(s.accessToken && s.igUserId), username: s.igUsername || "", pageName: s.pageName || "", connectedAt: s.connectedAt || null };
}

async function waitForContainer(base, id, token) {
  for (let i = 0; i < 60; i++) {
    const r = await axios.get(`${base}/${id}`, { params: { fields: "status_code,status", access_token: token }, timeout: 15_000 });
    if (r.data.status_code === "FINISHED") return;
    if (r.data.status_code === "ERROR" || r.data.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the video: ${r.data.status || r.data.status_code}`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error("Instagram took more than 5 minutes to process the video.");
}

async function uploadInstagram(entry, settings) {
  const ig = igSaved();
  if (!ig.accessToken || !ig.igUserId) throw new Error("Instagram isn't connected. Use Connect Instagram on the Marketing page.");
  const base = graph(settings);
  const file = path.join(SHORTS_DIR, entry.file);
  const size = fs.statSync(file).size;
  const common = { media_type: "REELS", caption: entry.instagramCaption, share_to_feed: true, thumb_offset: 7500, access_token: ig.accessToken };
  let hostedKey = "";
  try {
    let containerId;
    if (settings.instagramUpload === "portal-url") {
      if (size > 24 * 1024 * 1024) throw new Error("Video is over the 25 MB Cloudflare KV limit.");
      const token = crypto.randomBytes(24).toString("hex");
      hostedKey = `short-media:${token}`;
      await kvPutFile(hostedKey, file, 7200);
      const c = await axios.post(`${base}/${ig.igUserId}/media`, null, { params: { ...common, video_url: `${PORTAL_MEDIA}/${token}.mp4` }, timeout: 30_000 });
      containerId = c.data.id;
    } else {
      const c = await axios.post(`${base}/${ig.igUserId}/media`, null, { params: { ...common, upload_type: "resumable" }, timeout: 30_000 });
      containerId = c.data.id;
      const uri = c.data.uri || `https://rupload.facebook.com/ig-api-upload/${settings.graphVersion}/${containerId}`;
      await axios.post(uri, fs.createReadStream(file), {
        headers: { Authorization: `OAuth ${ig.accessToken}`, offset: "0", file_size: String(size), "Content-Type": "application/octet-stream", "Content-Length": String(size) },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 10 * 60_000,
      });
    }
    await waitForContainer(base, containerId, ig.accessToken);
    const pub = await axios.post(`${base}/${ig.igUserId}/media_publish`, null, { params: { creation_id: containerId, access_token: ig.accessToken }, timeout: 60_000 });
    let url = "";
    try {
      const m = await axios.get(`${base}/${pub.data.id}`, { params: { fields: "permalink", access_token: ig.accessToken }, timeout: 15_000 });
      url = m.data.permalink || "";
    } catch {
      /* permalink is cosmetic */
    }
    return { id: pub.data.id, url: url || (ig.igUsername ? `https://www.instagram.com/${ig.igUsername}/reels/` : "") };
  } catch (e) {
    throw new Error(graphError(e));
  } finally {
    if (hostedKey) kvDelete(hostedKey).catch(() => {});
  }
}

// ---------- posting ----------
const PLATFORMS = {
  youtube: { label: "YouTube", connected: () => Boolean(readJson(YT_PATH, {}).refreshToken), upload: uploadYouTube },
  instagram: { label: "Instagram", connected: () => instagramStatus().connected, upload: uploadInstagram },
};
const posting = new Set();

function summarize(results) {
  const v = Object.values(results);
  if (v.length && v.every((r) => r.status === "posted")) return "posted";
  if (v.some((r) => r.status === "posted")) return "partial";
  if (v.some((r) => r.status === "failed" || r.status === "unknown")) return "failed";
  return "ready";
}

/** Posts to every enabled, connected platform not already posted. Never retries a platform marked posted/unknown. */
export async function postEntry(id, { by = "schedule" } = {}) {
  if (posting.has(id)) throw new Error("Already posting this Short.");
  posting.add(id);
  try {
    const { settings } = readState();
    const before = readState().history.find((h) => h.id === id);
    try {
      assertStillCurrent(before || {});
    } catch (err) {
      updateEntry(id, (e) => Object.assign(e, { status: "failed", error: err.message }));
      appendAudit({ action: "weekly short not posted", detail: err.message.slice(0, 300), by });
      notifyDesktop("Weekly Short not posted", err.message.slice(0, 200), MARKETING_URL);
      return readState().history.find((h) => h.id === id);
    }
    const entry = updateEntry(id, (e) => {
      e.status = "posting";
      e.error = "";
      e.results ||= {};
    });
    for (const [key, p] of Object.entries(PLATFORMS)) {
      if (!settings.platforms[key]) continue;
      const prior = entry.results[key]?.status;
      if (prior === "posted" || prior === "unknown") continue;
      if (!p.connected()) {
        updateEntry(id, (e) => (e.results[key] = { status: "skipped", error: `${p.label} isn't connected yet.`, at: new Date().toISOString() }));
        continue;
      }
      updateEntry(id, (e) => (e.results[key] = { status: "uploading", startedAt: new Date().toISOString() }));
      try {
        const r = await p.upload(entry, settings);
        updateEntry(id, (e) => (e.results[key] = { status: "posted", ...r, at: new Date().toISOString() }));
        appendAudit({ action: `weekly short posted (${key})`, detail: `${entry.name}: ${r.url}${r.note ? ` (${r.note})` : ""}`, by });
      } catch (err) {
        const msg = String(err.response?.data?.error?.message || err.message).slice(0, 400);
        updateEntry(id, (e) => (e.results[key] = { status: "failed", error: msg, at: new Date().toISOString() }));
        appendAudit({ action: `weekly short failed (${key})`, detail: `${entry.name}: ${msg}`, by });
      }
    }
    const done = updateEntry(id, (e) => {
      e.status = summarize(e.results);
      e.postedAt = new Date().toISOString();
    });
    const posted = Object.entries(done.results).filter(([, r]) => r.status === "posted");
    const failed = Object.entries(done.results).filter(([, r]) => r.status === "failed");
    if (posted.length) notifyDesktop("Weekly Short posted", `${done.name} is live on ${posted.map(([k]) => PLATFORMS[k].label).join(" + ")}.`, MARKETING_URL);
    if (failed.length) notifyDesktop("Weekly Short failed", `${failed.map(([k, r]) => `${PLATFORMS[k].label}: ${r.error}`).join(" | ")}`.slice(0, 200), MARKETING_URL);
    if (!posted.length && !failed.length) notifyDesktop("Weekly Short ready", "Connect YouTube / Instagram on the Marketing page to post it.", MARKETING_URL);
    return done;
  } finally {
    posting.delete(id);
  }
}

/** What would be sent, without uploading. When a platform is connected, its token is checked with a read-only call. */
export async function dryRun(id) {
  const s = readState();
  const entry = s.history.find((h) => h.id === id);
  if (!entry) throw new Error("Weekly Short not found.");
  const file = path.join(SHORTS_DIR, entry.file);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const out = { at: new Date().toISOString(), file: entry.file, bytes: size, platforms: {} };
  privacyCheck([entry.youtubeTitle, entry.youtubeDescription, entry.instagramCaption], s.settings.privacyBlocklist);
  assertStillCurrent(entry);
  out.priceCheck = `Video price $${Number(entry.price).toFixed(2)} matches the site.`;
  if (s.settings.platforms.youtube) {
    const yt = { enabled: true, connected: PLATFORMS.youtube.connected(), request: { endpoint: "POST youtube/v3/videos?uploadType=resumable&part=snippet,status", ...youtubeMeta(entry) }, quotaUnits: 1600 };
    if (yt.connected) {
      try {
        yt.channel = (await youtubeChannel())?.snippet?.title || "(no channel on this Google account)";
        yt.tokenOk = true;
      } catch (e) {
        yt.tokenOk = false;
        yt.error = e.response?.data?.error?.message || e.message;
      }
    }
    out.platforms.youtube = yt;
  }
  if (s.settings.platforms.instagram) {
    const st = instagramStatus();
    const ig = { enabled: true, connected: st.connected, account: st.username, method: s.settings.instagramUpload, request: { endpoint: "POST {ig-user-id}/media (REELS) → upload → media_publish", captionChars: entry.instagramCaption.length, hashtags: (entry.instagramCaption.match(/#\w+/g) || []).length } };
    if (st.connected) {
      try {
        const ig2 = igSaved();
        const r = await axios.get(`${graph(s.settings)}/${ig2.igUserId}`, { params: { fields: "username", access_token: ig2.accessToken }, timeout: 15_000 });
        ig.tokenOk = Boolean(r.data?.username);
      } catch (e) {
        ig.tokenOk = false;
        ig.error = graphError(e);
      }
    }
    out.platforms.instagram = ig;
  }
  updateEntry(id, (e) => (e.dryRun = { at: out.at, ok: Object.values(out.platforms).every((p) => !p.connected || p.tokenOk !== false) }));
  return out;
}

// ---------- weekly run ----------
async function createWeekly({ weekKey, trigger, forceAsk = false, productId }) {
  const s = readState();
  const id = `ws-${Date.now().toString(36)}`;
  s.history.unshift({ id, weekKey, trigger, status: "rendering", createdAt: new Date().toISOString() });
  saveState(s);
  let entry;
  try {
    const built = await buildShortEntry({ productId });
    entry = updateEntry(id, (e) => Object.assign(e, built, { status: "awaiting_approval" }));
  } catch (err) {
    updateEntry(id, (e) => Object.assign(e, { status: "failed", error: err.message }));
    appendAudit({ action: "weekly short failed (render)", detail: err.message.slice(0, 300), by: trigger });
    notifyDesktop("Weekly Short failed", err.message.slice(0, 200), MARKETING_URL);
    return readState().history.find((h) => h.id === id);
  }
  const ask = forceAsk || s.settings.mode !== "auto" || s.settings.firstRunReview;
  appendAudit({ action: "weekly short rendered", detail: `${entry.name} (${entry.file})${ask ? ", waiting for approval" : ", auto-posting"}`, by: trigger });
  if (ask) {
    notifyDesktop("Weekly Short ready to review", `${entry.name}: approve it on the Marketing page to post.`, MARKETING_URL);
    return entry;
  }
  return postEntry(id, { by: trigger });
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const s = readState();
    if (!s.settings.enabled) return;
    const now = Date.now();
    const slot = findSlot(now, s.settings, -1);
    if (!slot || slot.at < Date.parse(s.armedAt) || now - slot.at > s.settings.catchUpHours * 3600_000) return;
    if (s.history.some((h) => h.weekKey === slot.key)) return;
    let lease = pcLease.status();
    if (!lease.checkedAt || now - Date.parse(lease.checkedAt) > 10 * 60_000) lease = await pcLease.checkLease();
    if (!lease.holder) return;
    if (s.settings.skipKeys.includes(slot.key)) {
      s.history.unshift({ id: `ws-${now.toString(36)}`, weekKey: slot.key, trigger: "schedule", status: "skipped", createdAt: new Date().toISOString() });
      s.settings.skipKeys = s.settings.skipKeys.filter((k) => k !== slot.key);
      saveState(s);
      appendAudit({ action: "weekly short skipped", detail: `Week of ${slot.key} skipped by the owner`, by: "schedule" });
      return;
    }
    await createWeekly({ weekKey: slot.key, trigger: "schedule" });
  } catch (e) {
    console.warn("[weekly-shorts]", e.message);
  } finally {
    busy = false;
  }
}

/** Anything left mid-flight by a restart is marked, never resumed: no double posts. */
function recoverInterrupted() {
  const s = readState();
  let changed = false;
  for (const e of s.history) {
    if (e.status === "rendering") {
      Object.assign(e, { status: "failed", error: "Render was interrupted by a restart." });
      changed = true;
    }
    if (e.status === "posting") {
      for (const r of Object.values(e.results || {})) {
        if (r.status === "uploading") Object.assign(r, { status: "unknown", error: "Upload was interrupted by a restart. Check the channel before retrying." });
      }
      e.status = summarize(e.results || {});
      changed = true;
    }
  }
  if (changed) saveState(s);
}

let timer = null;
export function startWeeklyShortsScheduler() {
  if (timer) return;
  recoverInterrupted();
  setTimeout(tick, 90_000);
  timer = setInterval(tick, 5 * 60_000);
}

function publicState() {
  const s = readState();
  const yt = readJson(YT_PATH, {});
  const next = s.settings.enabled ? findSlot(Date.now(), s.settings, 1) : null;
  let redirectUri = YT_REDIRECT_DEFAULT;
  try {
    redirectUri = googleConfig().redirectUri;
  } catch {
    /* shown as not configured */
  }
  return {
    settings: s.settings,
    dayNames: DAYS,
    nextRun: next ? { at: new Date(next.at).toISOString(), key: next.key, skipped: s.settings.skipKeys.includes(next.key) } : null,
    effectiveMode: s.settings.mode === "auto" && !s.settings.firstRunReview ? "auto" : "ask",
    lease: { holder: pcLease.status().holder, reason: pcLease.status().reason },
    youtube: { connected: Boolean(yt.refreshToken), channelTitle: yt.channelTitle || "", connectedAt: yt.connectedAt || null, redirectUri },
    instagram: instagramStatus(),
    history: s.history.slice(0, 20).map((h) => ({ ...h, posting: posting.has(h.id) })),
  };
}

// ---------- routes ----------
const loopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
function ownerOnly(req, res, next) {
  if (!loopback(req)) return res.status(403).json({ ok: false, error: "Only from the portal on this PC." });
  next();
}
const wrap = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
};

export function createWeeklyShortsRouter() {
  const r = express.Router();
  r.use("/weekly-shorts", express.static(SHORTS_DIR));
  r.get("/api/marketing/weekly-shorts", wrap(() => publicState()));

  r.put(
    "/api/marketing/weekly-shorts/settings",
    ownerOnly,
    wrap((req) => {
      const b = req.body || {};
      const s = readState();
      const n = { ...s.settings };
      if ("enabled" in b) n.enabled = Boolean(b.enabled);
      if (b.day != null && Number(b.day) >= 0 && Number(b.day) <= 6) n.day = Number(b.day);
      if (/^\d{2}:\d{2}$/.test(b.time || "")) n.time = b.time;
      if (["auto", "ask"].includes(b.mode)) n.mode = b.mode;
      if (b.platforms) n.platforms = { youtube: Boolean(b.platforms.youtube), instagram: Boolean(b.platforms.instagram) };
      if (["resumable", "portal-url"].includes(b.instagramUpload)) n.instagramUpload = b.instagramUpload;
      if (Array.isArray(b.privacyBlocklist)) n.privacyBlocklist = b.privacyBlocklist.map((w) => String(w).trim()).filter(Boolean).slice(0, 30);
      const scheduleChanged = n.day !== s.settings.day || n.time !== s.settings.time || (n.enabled && !s.settings.enabled);
      s.settings = n;
      if (scheduleChanged) s.armedAt = new Date().toISOString();
      saveState(s);
      return publicState();
    })
  );

  r.post(
    "/api/marketing/weekly-shorts/skip",
    ownerOnly,
    wrap((req) => {
      const s = readState();
      const next = findSlot(Date.now(), s.settings, 1);
      if (!next) throw new Error("No upcoming run.");
      s.settings.skipKeys = req.body?.skip === false ? s.settings.skipKeys.filter((k) => k !== next.key) : [...new Set([...s.settings.skipKeys, next.key])].slice(-10);
      saveState(s);
      appendAudit({ action: req.body?.skip === false ? "weekly short un-skipped" : "weekly short skip", detail: `Week of ${next.key}`, by: "pc owner" });
      return publicState();
    })
  );

  r.post(
    "/api/marketing/weekly-shorts/generate",
    ownerOnly,
    wrap(async (req) => ({ entry: await createWeekly({ weekKey: `manual-${Date.now().toString(36)}`, trigger: "manual", forceAsk: true, productId: req.body?.productId }) }))
  );

  r.patch(
    "/api/marketing/weekly-shorts/:id",
    ownerOnly,
    wrap((req) => {
      const b = req.body || {};
      const s = readState();
      const current = s.history.find((h) => h.id === req.params.id);
      if (!current) throw new Error("Weekly Short not found.");
      const edits = {};
      if (typeof b.youtubeTitle === "string") edits.youtubeTitle = noAngles(b.youtubeTitle).slice(0, 100);
      if (typeof b.youtubeDescription === "string") edits.youtubeDescription = noAngles(b.youtubeDescription).slice(0, 4900);
      if (typeof b.instagramCaption === "string") edits.instagramCaption = b.instagramCaption.slice(0, 2200);
      const merged = { ...current, ...edits };
      privacyCheck([merged.youtubeTitle, merged.youtubeDescription, merged.instagramCaption], s.settings.privacyBlocklist);
      return { entry: updateEntry(req.params.id, (e) => Object.assign(e, edits)) };
    })
  );

  r.post(
    "/api/marketing/weekly-shorts/:id/approve",
    ownerOnly,
    wrap((req) => {
      const s = readState();
      const e = s.history.find((h) => h.id === req.params.id);
      if (!e) throw new Error("Weekly Short not found.");
      if (!["awaiting_approval", "ready", "failed", "partial"].includes(e.status) || !e.file) throw new Error(`Can't post a Short that is ${e.status}.`);
      privacyCheck([e.youtubeTitle, e.youtubeDescription, e.instagramCaption], s.settings.privacyBlocklist);
      assertStillCurrent(e);
      e.approvedAt = new Date().toISOString();
      s.settings.firstRunReview = false;
      saveState(s);
      appendAudit({ action: "weekly short approved", detail: e.name, by: "pc owner" });
      postEntry(e.id, { by: "pc owner" }).catch((err) => console.warn("[weekly-shorts] post failed:", err.message));
      return publicState();
    })
  );

  r.post(
    "/api/marketing/weekly-shorts/:id/reject",
    ownerOnly,
    wrap((req) => {
      updateEntry(req.params.id, (e) => {
        if (e.status === "posting") throw new Error("It's posting right now.");
        e.status = "rejected";
        e.rejectedAt = new Date().toISOString();
      });
      appendAudit({ action: "weekly short rejected", detail: req.params.id, by: "pc owner" });
      return publicState();
    })
  );

  r.post("/api/marketing/weekly-shorts/:id/dry-run", ownerOnly, wrap(async (req) => ({ dryRun: await dryRun(req.params.id) })));

  r.get("/api/marketing/youtube/auth/start", ownerOnly, wrap(() => ({ authUrl: youtubeAuthUrl() })));
  r.get("/api/marketing/youtube/auth/callback", async (req, res) => {
    try {
      await youtubeAuthCallback({ code: req.query.code, state: req.query.state });
      res.redirect("/inventory-marketing.html?youtube=connected#weekly-shorts");
    } catch (e) {
      const msg = String(e.response?.data?.error_description || e.message).replace(/[<>&]/g, "");
      res.status(400).send(`<!doctype html><meta charset="utf-8"><p>YouTube connect failed: ${msg}</p><p><a href="/inventory-marketing.html#weekly-shorts">Back to Marketing</a></p>`);
    }
  });
  r.post(
    "/api/marketing/youtube/disconnect",
    ownerOnly,
    wrap(() => {
      fs.rmSync(YT_PATH, { force: true });
      appendAudit({ action: "youtube disconnected", detail: "Weekly Shorts", by: "pc owner" });
      return publicState();
    })
  );

  r.post("/api/marketing/instagram/connect", ownerOnly, wrap(async (req) => ({ instagram: await connectInstagram(req.body || {}) })));
  r.post(
    "/api/marketing/instagram/disconnect",
    ownerOnly,
    wrap(() => {
      fs.rmSync(IG_PATH, { force: true });
      appendAudit({ action: "instagram disconnected", detail: "Weekly Shorts", by: "pc owner" });
      return publicState();
    })
  );
  return r;
}
