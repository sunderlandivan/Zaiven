const ALERT_PREFIX = "[Distributor reply]";
const ALERT_HEADER = "X-PreEminent-Alert";
const MAX_RAW_BYTES = 512 * 1024;
const SNIPPET_CHARS = 500;

export default {
  async email(message, env, ctx) {
    // Delivery comes first and must never depend on the alert path.
    await message.forward(env.FORWARD_TO);

    try {
      await maybeAlert(message, env);
    } catch (e) {
      console.log(`Alert failed (mail was forwarded): ${e?.stack || e}`);
    }
  },
};

async function maybeAlert(message, env) {
  const subject = decodeWords(message.headers.get("subject") || "(no subject)");
  const fromHeader = decodeWords(message.headers.get("from") || "");
  const envelopeFrom = String(message.from || "");

  const alertAddress = addressOf(env.ALERT_FROM || "");
  if (message.headers.get(ALERT_HEADER)) return;
  if (subject.startsWith(ALERT_PREFIX)) return;
  if (alertAddress && [envelopeFrom, addressOf(fromHeader)].some((a) => a.toLowerCase() === alertAddress)) return;

  const distributor = await matchDistributor(env, { subject, fromHeader, envelopeFrom });
  if (!distributor) return;

  let snippet = "";
  try {
    snippet = await readSnippet(message);
  } catch (e) {
    console.log(`Snippet unavailable: ${e?.message || e}`);
  }

  const received = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
  const text = [
    `Distributor: ${distributor}`,
    `From: ${fromHeader || envelopeFrom}`,
    `Subject: ${subject}`,
    `Received: ${received} (Pacific)`,
    "",
    snippet || "(no text preview)",
    "",
    "The full message was forwarded to your inbox as usual.",
  ].join("\n");

  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.ALERT_FROM,
      to: [env.ALERT_TO],
      reply_to: addressOf(fromHeader) || envelopeFrom || undefined,
      subject: `${ALERT_PREFIX} ${distributor}: ${subject}`.slice(0, 250),
      text,
      headers: { [ALERT_HEADER]: "1" },
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  console.log(`Alert sent for ${distributor}: ${subject}`);
}

async function matchDistributor(env, { subject, fromHeader, envelopeFrom }) {
  if (env.TEST_SUBJECT_TOKEN && subject.includes(env.TEST_SUBJECT_TOKEN)) return "TEST (alert check)";

  let list = env.DISTRIBUTORS || "";
  try {
    const override = env.STORE && (await env.STORE.get("email-alerts:distributors"));
    if (override) list = override;
  } catch {}

  const domains = [envelopeFrom, addressOf(fromHeader)].map((a) => a.split("@")[1]?.toLowerCase()).filter(Boolean);
  const name = fromHeader.toLowerCase();
  for (const pair of list.split(",")) {
    const [rawDomain, rawLabel] = pair.split("=");
    const domain = (rawDomain || "").trim().toLowerCase();
    if (!domain) continue;
    const label = (rawLabel || domain).trim();
    const brand = domain.split(".")[0];
    if (domains.some((d) => d === domain || d.endsWith(`.${domain}`))) return label;
    if (brand.length >= 4 && name.includes(brand)) return label;
  }
  return null;
}

function addressOf(value) {
  const m = String(value).match(/<([^>]+)>/) || String(value).match(/([^\s,;"]+@[^\s,;"]+)/);
  return m ? m[1].trim().toLowerCase() : "";
}

/* ---------- minimal MIME reading for a plain-text preview ---------- */

async function readSnippet(message) {
  const reader = message.raw.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_RAW_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c.subarray(0, Math.min(c.length, size - off)), off);
    off += c.length;
  }
  const raw = new TextDecoder("latin1").decode(bytes);
  const part = findTextPart(raw);
  if (!part) return "";
  let text = decodeBody(part.body, part.encoding, part.charset);
  if (part.html) text = htmlToText(text);
  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS).trimEnd()}...` : text;
}

function splitHead(entity) {
  const i = entity.search(/\r?\n\r?\n/);
  if (i < 0) return { head: entity, body: "" };
  const sep = entity.slice(i).match(/^\r?\n\r?\n/)[0];
  return { head: entity.slice(0, i), body: entity.slice(i + sep.length) };
}

function headerValue(head, name) {
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}

function param(value, key) {
  const m = value.match(new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m ? m[1] ?? m[2] : "";
}

function findTextPart(entity, depth = 0) {
  if (depth > 6) return null;
  const { head, body } = splitHead(entity);
  const type = headerValue(head, "content-type") || "text/plain";
  const mime = type.split(";")[0].trim().toLowerCase();
  const encoding = headerValue(head, "content-transfer-encoding").toLowerCase();
  const charset = param(type, "charset") || "utf-8";

  if (mime.startsWith("multipart/")) {
    const boundary = param(type, "boundary");
    if (!boundary) return null;
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
    let html = null;
    for (const p of parts) {
      const found = findTextPart(p.replace(/^\r?\n/, ""), depth + 1);
      if (found && !found.html) return found;
      if (found && !html) html = found;
    }
    return html;
  }
  if (mime === "text/plain") return { body, encoding, charset, html: false };
  if (mime === "text/html") return { body, encoding, charset, html: true };
  return null;
}

function decodeBody(body, encoding, charset) {
  let bytes;
  if (encoding === "base64") {
    const bin = atob(body.replace(/[^A-Za-z0-9+/=]/g, ""));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } else if (encoding === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "");
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        out.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else out.push(s.charCodeAt(i) & 0xff);
    }
    bytes = Uint8Array.from(out);
  } else {
    bytes = Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** RFC 2047 encoded-words in headers (=?utf-8?B?...?= / =?utf-8?Q?...?=). */
function decodeWords(value) {
  return String(value).replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    try {
      const bin = enc.toUpperCase() === "B"
        ? atob(data)
        : data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder(cs).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return data;
    }
  });
}
