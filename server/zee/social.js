/**
 * Meta Graph API helpers for unread DM counts.
 *
 * IMPORTANT — Meta does NOT expose personal Facebook Messenger or personal
 * Instagram DMs through any public API. Only the following are supported:
 *
 *  - Facebook Page conversations (`pages_messaging`).
 *      Requires a long-lived **Page Access Token** for a Facebook Page you admin.
 *      Endpoint: GET /{PAGE_ID}/conversations?fields=unread_count
 *
 *  - Instagram DMs for **Business or Creator** accounts that are linked
 *    to a Facebook Page (`instagram_manage_messages`).
 *      Endpoint: GET /{IG_USER_ID}/conversations?platform=instagram&fields=unread_count
 *
 * Set up at https://developers.facebook.com/ — your app needs review for the
 * messaging scopes. Without these, the social module shows "Not connected".
 */
import axios from "axios";

const FB_PAGE_ID_ENV = "ZEE_FACEBOOK_PAGE_ID";
const FB_PAGE_TOKEN_ENV = "ZEE_FACEBOOK_PAGE_TOKEN";
const IG_USER_ID_ENV = "ZEE_INSTAGRAM_USER_ID";
const IG_TOKEN_ENV = "ZEE_INSTAGRAM_TOKEN";
const GRAPH_VERSION = process.env.ZEE_META_GRAPH_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

let cache = { at: 0, payload: null };
const CACHE_TTL = 25_000;

function env(name) {
  return String(process.env[name] || "").trim();
}

function isFbConfigured() {
  return Boolean(env(FB_PAGE_ID_ENV) && env(FB_PAGE_TOKEN_ENV));
}

function isIgConfigured() {
  return Boolean(env(IG_USER_ID_ENV) && env(IG_TOKEN_ENV));
}

async function fetchUnreadCount({ id, accessToken, platform }) {
  const params = {
    fields: "unread_count",
    access_token: accessToken,
    limit: 50,
  };
  if (platform) params.platform = platform;
  const res = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(id)}/conversations`, {
    params,
    timeout: 10_000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`Graph ${platform || "fb"} error (${res.status}): ${JSON.stringify(res.data).slice(0, 220)}`);
  }
  const items = Array.isArray(res.data?.data) ? res.data.data : [];
  let total = 0;
  let convosWithUnread = 0;
  for (const c of items) {
    const u = Number(c.unread_count) || 0;
    if (u > 0) {
      total += u;
      convosWithUnread += 1;
    }
  }
  return { unreadTotal: total, conversationsWithUnread: convosWithUnread, conversations: items.length };
}

/**
 * Returns combined Facebook Page + Instagram DM pending counts.
 */
export async function getSocialPending({ force = false } = {}) {
  if (!force && cache.payload && Date.now() - cache.at < CACHE_TTL) {
    return cache.payload;
  }
  const out = {
    facebook: { configured: isFbConfigured(), connected: false, unread: 0, error: null },
    instagram: { configured: isIgConfigured(), connected: false, unread: 0, error: null },
    note:
      "Meta Graph API only exposes conversations for Facebook Pages and Instagram Business/Creator accounts. Personal account DMs are not accessible.",
  };

  if (out.facebook.configured) {
    try {
      const r = await fetchUnreadCount({
        id: env(FB_PAGE_ID_ENV),
        accessToken: env(FB_PAGE_TOKEN_ENV),
      });
      out.facebook.connected = true;
      out.facebook.unread = r.unreadTotal;
      out.facebook.conversationsWithUnread = r.conversationsWithUnread;
      out.facebook.conversations = r.conversations;
    } catch (e) {
      out.facebook.error = String(e.message || e);
    }
  }

  if (out.instagram.configured) {
    try {
      const r = await fetchUnreadCount({
        id: env(IG_USER_ID_ENV),
        accessToken: env(IG_TOKEN_ENV),
        platform: "instagram",
      });
      out.instagram.connected = true;
      out.instagram.unread = r.unreadTotal;
      out.instagram.conversationsWithUnread = r.conversationsWithUnread;
      out.instagram.conversations = r.conversations;
    } catch (e) {
      out.instagram.error = String(e.message || e);
    }
  }

  cache = { at: Date.now(), payload: out };
  return out;
}

export function getSocialStatus() {
  return {
    facebookConfigured: isFbConfigured(),
    instagramConfigured: isIgConfigured(),
    envHints: {
      facebook: [FB_PAGE_ID_ENV, FB_PAGE_TOKEN_ENV],
      instagram: [IG_USER_ID_ENV, IG_TOKEN_ENV],
      graphVersion: "ZEE_META_GRAPH_VERSION (default v21.0)",
    },
  };
}
