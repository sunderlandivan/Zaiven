/**
 * Communications backend: meeting URL generation + invite delivery.
 *
 * Supported platforms (no extra OAuth required):
 *   - Meet   : opens https://meet.google.com/new (the user shares the URL after creation)
 *   - Zoom   : uses the contact's stored personal meeting URL OR ZEE_ZOOM_PERSONAL_URL
 *   - Teams  : opens https://teams.microsoft.com/l/meeting/new (anyone with link can join)
 *   - Discord: deep-link to /users/{id} so the user can hit "video call" in DM
 *
 * Email delivery: prefers the existing Gmail OAuth (if scoped for gmail.send),
 * otherwise returns a mailto: URL the client can open in the user's default mail
 * client. We never require new credentials for the MVP.
 */
import axios from "axios";
import {
  getValidZeeGmailAccessToken,
  getZeeGmailScope,
  getZeeGmailTargetEmail,
} from "./gmail.js";

const TEAMS_NEW_MEETING = "https://teams.microsoft.com/l/meeting/new?subject=";
const MEET_NEW = "https://meet.google.com/new";

/**
 * @typedef {{ platform: string, url: string, embeddable: boolean, instructions?: string }} MeetingLink
 */

/**
 * @param {{ platform?: string, contactName?: string, contact?: any }} opts
 * @returns {MeetingLink}
 */
export function generateMeetingLink(opts = {}) {
  const platform = String(opts.platform || "meet").toLowerCase();
  const contactName = String(opts.contactName || opts.contact?.name || "").trim();
  const c = opts.contact || null;

  switch (platform) {
    case "meet": {
      return {
        platform: "meet",
        url: MEET_NEW,
        embeddable: false,
        instructions:
          "Google Meet creates the meeting URL on-the-fly. Once Meet opens, copy the address from the new tab to share.",
      };
    }
    case "zoom": {
      const personal = (c?.zoomUrl || process.env.ZEE_ZOOM_PERSONAL_URL || "").trim();
      if (personal) {
        return { platform: "zoom", url: personal, embeddable: false };
      }
      return {
        platform: "zoom",
        url: "https://zoom.us/start/videomeeting",
        embeddable: false,
        instructions:
          "No Zoom personal meeting URL on file. Set the contact's zoomUrl, or set ZEE_ZOOM_PERSONAL_URL on the server, to skip this step.",
      };
    }
    case "teams": {
      const teamsEmail = (c?.teamsEmail || c?.email || "").trim();
      if (teamsEmail) {
        return {
          platform: "teams",
          url: `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(teamsEmail)}&withVideo=true`,
          embeddable: false,
          instructions: `Direct-dials ${teamsEmail} on Teams.`,
        };
      }
      const subject = encodeURIComponent(`Zee meeting with ${contactName || "you"}`);
      return { platform: "teams", url: `${TEAMS_NEW_MEETING}${subject}`, embeddable: false };
    }
    case "discord": {
      const id = (c?.discordUserId || "").trim();
      if (id) {
        return {
          platform: "discord",
          url: `https://discord.com/users/${encodeURIComponent(id)}`,
          embeddable: false,
          instructions: "Opens DM with this user. Click the camera icon in Discord to start the video call.",
        };
      }
      return {
        platform: "discord",
        url: "https://discord.com/channels/@me",
        embeddable: false,
        instructions: "No Discord user id on file. Add discordUserId to call them directly next time.",
      };
    }
    default:
      throw new Error(`Unknown platform "${platform}".`);
  }
}

function mailtoUrl({ to, subject, body }) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(to || "")}${qs ? `?${qs}` : ""}`;
}

function buildRfc822({ to, from, subject, body }) {
  const lines = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    `Subject: ${subject || ""}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body || "",
  ].filter((x) => x !== null);
  return lines.join("\r\n");
}

function base64Url(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Send a meeting invite email. Returns { sent: true } if Gmail send succeeded,
 * otherwise { sent: false, mailto } so the client can fall back to opening the
 * user's default mail client.
 */
export async function sendInviteEmail({ to, subject, body, fromHint }) {
  const safeTo = String(to || "").trim();
  if (!safeTo) return { sent: false, mailto: null, error: "No recipient email on contact." };

  const scope = getZeeGmailScope();
  const canSend = scope && /\bgmail\.send\b|\bgmail\.modify\b|\bgmail\.compose\b|mail\.google\.com\/?$/.test(scope);

  if (!canSend) {
    return {
      sent: false,
      mailto: mailtoUrl({ to: safeTo, subject, body }),
      hint:
        "Zee's Gmail token is read-only; opening your default mail client instead. To send directly, re-authorize Gmail with send permission.",
    };
  }

  let accessToken = null;
  try {
    accessToken = await getValidZeeGmailAccessToken();
  } catch (e) {
    return { sent: false, mailto: mailtoUrl({ to: safeTo, subject, body }), error: String(e.message || e) };
  }

  try {
    const raw = base64Url(buildRfc822({ to: safeTo, from: fromHint, subject, body }));
    const res = await axios.post(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { raw },
      {
        timeout: 12_000,
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        validateStatus: () => true,
      }
    );
    if (res.status >= 200 && res.status < 300) {
      return { sent: true, messageId: res.data?.id || null };
    }
    return {
      sent: false,
      mailto: mailtoUrl({ to: safeTo, subject, body }),
      error: `Gmail send failed (${res.status}): ${JSON.stringify(res.data).slice(0, 240)}`,
    };
  } catch (e) {
    return { sent: false, mailto: mailtoUrl({ to: safeTo, subject, body }), error: String(e.message || e) };
  }
}

export function getMailtoLink(args) {
  return mailtoUrl(args);
}

/* ---------- Gmail-driven "Meet recent contacts" import ---------- */

const RFC5322_HEADER = /(?:"([^"]+)"|([^<,]+?))\s*<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;

/**
 * Parse a To/From/Cc header like:
 *   "Alex Smith" <alex@x.com>, bob@y.com, "Carol" <carol@z.com>
 * @returns {{ name: string|null, email: string }[]}
 */
function parseAddressList(headerVal) {
  const out = [];
  if (!headerVal) return out;
  const seen = new Set();
  let m;
  RFC5322_HEADER.lastIndex = 0;
  while ((m = RFC5322_HEADER.exec(headerVal)) !== null) {
    let name = (m[1] || m[2] || "").trim().replace(/^"+|"+$/g, "");
    let email = (m[3] || m[4] || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ name: name || null, email });
  }
  return out;
}

function isCalendarOrNoreply(email) {
  const e = String(email || "").toLowerCase();
  return (
    !e ||
    e.endsWith("@google.com") ||
    e.endsWith("@calendar.google.com") ||
    e.endsWith("@resource.calendar.google.com") ||
    e.startsWith("calendar-noreply@") ||
    e.startsWith("noreply@") ||
    e.startsWith("no-reply@") ||
    e.startsWith("mailer-daemon@") ||
    e.startsWith("postmaster@")
  );
}

/**
 * Search Gmail for messages mentioning meet.google.com (the user is on either
 * end of the meeting), pull To/From/Cc, dedupe, count occurrences, and return
 * a ranked list of (name + email) suggestions ready to import as contacts.
 *
 * Uses only the existing gmail.readonly scope - no extra OAuth required.
 *
 * @param {{ max?: number, maxScan?: number }} [opts]
 */
export async function importMeetSuggestionsFromGmail(opts = {}) {
  const accessToken = await getValidZeeGmailAccessToken();
  const ownEmail = String(getZeeGmailTargetEmail() || "").toLowerCase();
  const maxScan = Math.max(20, Math.min(500, Number(opts.maxScan ?? 200)));
  const maxOut = Math.max(5, Math.min(80, Number(opts.max ?? 40)));
  const query = String(
    opts.query ||
      'meet.google.com OR "Google Meet" OR from:calendar-noreply@google.com'
  );

  const headers = { Authorization: `Bearer ${accessToken}` };

  const idsRes = await axios.get(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    {
      headers,
      params: { q: query, maxResults: maxScan },
      timeout: 15_000,
      validateStatus: () => true,
    }
  );
  if (idsRes.status < 200 || idsRes.status >= 300) {
    throw new Error(
      `Gmail messages.list failed (${idsRes.status}): ${JSON.stringify(idsRes.data).slice(0, 200)}`
    );
  }
  const messages = Array.isArray(idsRes.data?.messages) ? idsRes.data.messages : [];
  if (!messages.length) {
    return { suggestions: [], scanned: 0, ownEmail, query };
  }

  /** @type {Map<string, { name: string|null, email: string, count: number, lastSeen: string|null }>} */
  const tally = new Map();

  let scanned = 0;
  for (const m of messages) {
    if (!m?.id) continue;
    let detail;
    try {
      const r = await axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`,
        {
          headers,
          params: {
            format: "metadata",
            metadataHeaders: ["From", "To", "Cc", "Date"],
          },
          timeout: 12_000,
          validateStatus: () => true,
        }
      );
      if (r.status < 200 || r.status >= 300) continue;
      detail = r.data;
    } catch {
      continue;
    }
    scanned += 1;
    const hdrs = Array.isArray(detail?.payload?.headers) ? detail.payload.headers : [];
    const dateStr = (hdrs.find((h) => /^date$/i.test(h.name))?.value) || null;
    /** @type {{ name: string|null, email: string }[]} */
    const people = [];
    for (const key of ["From", "To", "Cc"]) {
      const v = hdrs.find((h) => h.name?.toLowerCase() === key.toLowerCase())?.value;
      if (v) people.push(...parseAddressList(v));
    }
    for (const p of people) {
      if (!p.email) continue;
      if (ownEmail && p.email === ownEmail) continue;
      if (isCalendarOrNoreply(p.email)) continue;
      const cur = tally.get(p.email);
      if (cur) {
        cur.count += 1;
        if (!cur.name && p.name) cur.name = p.name;
        if (dateStr && (!cur.lastSeen || new Date(dateStr) > new Date(cur.lastSeen))) {
          cur.lastSeen = dateStr;
        }
      } else {
        tally.set(p.email, { name: p.name, email: p.email, count: 1, lastSeen: dateStr });
      }
    }
  }

  const suggestions = [...tally.values()]
    .sort((a, b) => b.count - a.count || (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, maxOut)
    .map((x) => ({
      name: x.name || x.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      email: x.email,
      meetCount: x.count,
      lastSeen: x.lastSeen,
    }));

  return { suggestions, scanned, ownEmail, query };
}

export function getCommStatus() {
  const scope = getZeeGmailScope();
  const canGmailSend =
    scope && /\bgmail\.send\b|\bgmail\.modify\b|\bgmail\.compose\b|mail\.google\.com\/?$/.test(scope);
  return {
    platforms: ["meet", "zoom", "teams", "discord"],
    embeddable: [],
    gmailScope: scope || null,
    canGmailSend: Boolean(canGmailSend),
    zoomPersonalUrlSet: Boolean(String(process.env.ZEE_ZOOM_PERSONAL_URL || "").trim()),
  };
}
