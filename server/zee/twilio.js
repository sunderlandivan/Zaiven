import fs from "fs";
import path from "path";
import axios from "axios";

const DATA_PATH = path.join(process.cwd(), "data", "zee-twilio-state.json");

function readState() {
  try {
    if (!fs.existsSync(DATA_PATH)) return { events: [] };
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return { events: [] };
    if (!Array.isArray(raw.events)) raw.events = [];
    return raw;
  } catch {
    return { events: [] };
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(next, null, 2), "utf8");
}

function pushEvent(type, payload) {
  const st = readState();
  st.events = Array.isArray(st.events) ? st.events : [];
  st.events.push({
    at: Date.now(),
    type,
    payload: payload || {},
  });
  if (st.events.length > 60) st.events = st.events.slice(-60);
  writeState(st);
}

function env(name) {
  return String(process.env[name] || "").trim();
}

export function getTwilioStatus() {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_PHONE_NUMBER");
  const forwardTo = env("TWILIO_FORWARD_TO");
  const webhookBase = env("TWILIO_WEBHOOK_BASE_URL");
  const st = readState();
  return {
    configured: Boolean(accountSid && authToken && fromNumber),
    accountSidSet: Boolean(accountSid),
    authTokenSet: Boolean(authToken),
    fromNumber: fromNumber || null,
    forwardTo: forwardTo || null,
    webhookBase: webhookBase || null,
    recentEvents: (st.events || []).slice(-8).reverse(),
  };
}

export function getTwilioVoiceTwiml({ from, to, callSid } = {}) {
  const forwardTo = env("TWILIO_FORWARD_TO");
  pushEvent("voice-webhook", { from, to, callSid, forwarded: Boolean(forwardTo) });
  if (!forwardTo) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Zee call handler is online, but forwarding number is not configured.</Say>
  <Hangup/>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" callerId="${escapeXml(env("TWILIO_PHONE_NUMBER"))}">
    <Number>${escapeXml(forwardTo)}</Number>
  </Dial>
</Response>`;
}

export function recordTwilioStatusCallback(payload) {
  pushEvent("status-callback", payload || {});
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function createTwilioOutboundCall({ to }) {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_PHONE_NUMBER");
  const webhookBase = env("TWILIO_WEBHOOK_BASE_URL");
  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, error: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER." };
  }
  if (!webhookBase) {
    return { ok: false, error: "Set TWILIO_WEBHOOK_BASE_URL to your public HTTPS host for Twilio webhooks." };
  }
  const cleanTo = String(to || "").trim();
  if (!cleanTo) return { ok: false, error: "to required" };
  try {
    const body = new URLSearchParams({
      To: cleanTo,
      From: fromNumber,
      Url: `${webhookBase.replace(/\/$/, "")}/api/zee/twilio/voice`,
      StatusCallback: `${webhookBase.replace(/\/$/, "")}/api/zee/twilio/status-callback`,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST",
    });
    const res = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
      body.toString(),
      {
        auth: { username: accountSid, password: authToken },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `Twilio call failed (${res.status})`, detail: res.data };
    }
    pushEvent("outbound-call", { to: cleanTo, sid: res.data?.sid || null });
    return { ok: true, sid: res.data?.sid || null, status: res.data?.status || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
