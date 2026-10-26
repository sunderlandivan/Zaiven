import { registry } from "./registry.js";
import { bus } from "./bus.js";
import { getZeeTimePayload } from "../lib/time-moon.js";
import { getZeeAudioConstraint } from "./devices.js";

/** @type {RTCPeerConnection | null} */
let pc = null;
/** @type {RTCDataChannel | null} */
let dc = null;
/** @type {MediaStream | null} */
let localStream = null;

/** @type {(s: string) => void} */
let onStatus = () => {};
/** @type {(s: string) => void} */
let onHeard = () => {};
/** @type {(level: number) => void} */
let onLevel = () => {};
/** @type {(samples: Uint8Array) => void} */
let onWave = () => {};
/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {MediaStreamAudioSourceNode | null} */
let micSource = null;
let levelRaf = 0;
/** @type {string[]} */
let pendingPrompts = [];
/** @type {Set<string>} */
let handledCallIds = new Set();

export function setVoiceStatus(fn) {
  onStatus = fn;
}

export function setVoiceHeard(fn) {
  onHeard = fn;
}

export function setVoiceLevel(fn) {
  onLevel = fn;
}

export function setVoiceWave(fn) {
  onWave = fn;
}

function status(s) {
  onStatus(s);
}

/**
 * Centralized end-of-session: dispatches an event so the UI/wake-loop can
 * apply a cooldown immediately, then fully tears down the WebRTC session
 * (which is what actually stops the OpenAI Realtime billing).
 *
 * Safe to call from any code path (local phrase, tool call, button click).
 */
export function endZeeVoiceSession(reason = "explicit") {
  status("Zee: ending session — voice off.");
  // Dispatch BEFORE disconnect so app.js can mark the button "Voice off"
  // and arm a wake cooldown without waiting on the teardown promise.
  window.dispatchEvent(new CustomEvent("zee:voice-end-session", { detail: { reason } }));
  // Fire-and-forget disconnect — the function itself is bulletproof and the
  // caller doesn't need to await teardown.
  disconnectZeeVoice().catch(() => {});
}

function heard(s) {
  onHeard(s);
}

function stopLevelMonitor() {
  if (levelRaf) cancelAnimationFrame(levelRaf);
  levelRaf = 0;
  try {
    micSource?.disconnect();
  } catch {
    // ignore
  }
  micSource = null;
  try {
    analyser?.disconnect();
  } catch {
    // ignore
  }
  analyser = null;
  try {
    audioCtx?.close();
  } catch {
    // ignore
  }
  audioCtx = null;
  onLevel(0);
  onWave(new Uint8Array(0));
}

function startLevelMonitor() {
  if (!localStream) return;
  stopLevelMonitor();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  micSource = audioCtx.createMediaStreamSource(localStream);
  micSource.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const n = (buf[i] - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / buf.length);
    onLevel(Math.min(1, rms * 3.8));
    onWave(buf.slice());
    levelRaf = requestAnimationFrame(tick);
  };
  tick();
}

async function executeTool(name, args) {
  try {
    switch (name) {
      case "open_module":
        return registry.openModule(String(args.id || ""));
      case "close_module":
        return registry.closeModule(String(args.id || ""));
      case "focus_module":
        return registry.focusModule(String(args.id || ""));
      case "get_time":
        return getZeeTimePayload();
      case "get_stock": {
        const sym = String(args.symbol || "").toUpperCase().trim();
        if (!sym) return { ok: false, error: "symbol required" };
        bus.emit("stock:spotlight", { symbol: sym });
        registry.openModule("stocks");
        registry.focusModule("stocks");
        const res = await fetch(`/api/zee/stocks?symbols=${encodeURIComponent(sym)}`);
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return j.data?.[sym] || j.data;
      }
      case "spotlight_stock": {
        const sym = String(args.symbol || "").toUpperCase().trim();
        if (!sym) return { ok: false, error: "symbol required" };
        registry.openModule("stocks");
        registry.focusModule("stocks");
        bus.emit("stock:spotlight", { symbol: sym });
        const detailRes = await fetch(`/api/zee/stocks/detail?symbol=${encodeURIComponent(sym)}`);
        const detailJson = await detailRes.json();
        if (!detailJson.ok) return { ok: false, error: detailJson.error };
        return detailJson.data;
      }
      case "close_spotlight": {
        const target = String(args.target || "all").toLowerCase();
        bus.emit("spotlight:close", { target: target === "stock" ? "stock" : "all" });
        return { ok: true, closed: target === "stock" ? "stock" : "all" };
      }
      case "get_news": {
        const topic = String(args.topic || "").trim();
        const res = await fetch(`/api/zee/news?topic=${encodeURIComponent(topic)}`);
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return { topic, headlines: (j.articles || []).slice(0, 6).map((a) => a.title) };
      }
      case "play_music": {
        const result = await new Promise((resolve) => {
          bus.emit("music:play", { query: args.query, reply: resolve });
          setTimeout(() => resolve({ ok: false, error: "music module timeout" }), 1400);
        });
        return result;
      }
      case "pause_music":
        bus.emit("music:pause", {});
        return { ok: true };
      case "next_track":
        bus.emit("music:next", {});
        return { ok: true };
      case "set_volume":
        bus.emit("music:volume", { level: Number(args.level) });
        return { ok: true, level: Number(args.level) };
      case "read_email": {
        const idx = Math.max(1, Math.min(20, Number(args.index ?? 1)));
        const res = await fetch("/api/zee/gmail/messages?max=20");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        const msgs = j.data?.messages || [];
        const m = msgs[idx - 1];
        if (!m) return { ok: false, error: "no message at that index" };
        return { subject: m.subject, from: m.from, preview: (m.preview || m.snippet || "").slice(0, 600) };
      }
      case "summarize_inbox": {
        const res = await fetch("/api/zee/gmail/messages?max=8");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        const msgs = j.data?.messages || [];
        return {
          count: msgs.length,
          lines: msgs.map((m) => `${m.subject} - ${m.from}`),
        };
      }
      case "open_youtube_video": {
        const idx = Math.max(1, Math.min(8, Number(args.index ?? 1)));
        registry.openModule("youtube");
        registry.focusModule("youtube");
        const result = bus.emit("youtube:open", { index: idx });
        return result || { ok: true, index: idx };
      }
      case "pause_youtube_video":
        bus.emit("youtube:pause", {});
        return { ok: true };
      case "resume_youtube_video":
        bus.emit("youtube:resume", {});
        return { ok: true };
      case "end_voice_session":
        endZeeVoiceSession("tool");
        return { ok: true, ended: true };
      case "get_system_stats": {
        const res = await fetch("/api/zee/system/stats");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return j.data || {};
      }
      case "get_audi_connect_status": {
        const res = await fetch("/api/zee/audi/connect/status");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return {
          connected: Boolean(j.connected),
          country: j.country,
          vinConfigured: Boolean(j.vinConfigured),
          vin: j.vin || null,
          updatedAt: j.updatedAt ?? null,
        };
      }
      case "list_smart_devices": {
        const res = await fetch("/api/zee/smart-home/devices");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return {
          devices: (j.devices || []).map((d) => ({ label: d.label, on: d.on })),
        };
      }
      case "control_smart_device": {
        const name = String(args.name || "").trim();
        const action = String(args.action || "").toLowerCase();
        if (!name) return { ok: false, error: "device name required" };
        if (action !== "on" && action !== "off") return { ok: false, error: "action must be 'on' or 'off'" };
        const res = await fetch("/api/zee/smart-home/by-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, on: action === "on" }),
        });
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error, matched: j.matched, suggestions: j.devices };
        registry.openModule("smart-home");
        return { ok: true, on: j.on, deviceName: j.device?.label };
      }
      case "list_call_contacts": {
        const res = await fetch("/api/zee/comm/contacts");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return {
          contacts: (j.contacts || []).map((c) => ({
            name: c.name,
            preferredPlatform: c.preferredPlatform,
            email: c.email,
          })),
        };
      }
      case "start_video_call": {
        const name = String(args.name || "").trim();
        if (!name) return { ok: false, error: "name required" };
        const platform = args.platform ? String(args.platform).toLowerCase() : null;
        const sendEmail = Boolean(args.email_link);
        const res = await fetch("/api/zee/comm/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, platform, sendEmail }),
        });
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        registry.openModule("communications");
        registry.focusModule("communications");
        // Hand off to the Communications module so the call appears in the in-HUD drill-down.
        window.dispatchEvent(
          new CustomEvent("zee:comm-call", { detail: { link: j.link, contact: j.contact } })
        );
        return {
          ok: true,
          contact: j.contact?.name,
          platform: j.link?.platform,
          url: j.link?.url,
          emailed: Boolean(j.invite?.sent),
        };
      }
      case "end_video_call": {
        window.dispatchEvent(new CustomEvent("zee:comm-end-call"));
        return { ok: true, ended: true };
      }
      case "start_instant_meeting": {
        const platform = args.platform ? String(args.platform).toLowerCase() : "meet";
        const subject = String(args.subject || "").trim() || null;
        const res = await fetch("/api/zee/comm/quick-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, subject }),
        });
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        registry.openModule("communications");
        registry.focusModule("communications");
        window.dispatchEvent(new CustomEvent("zee:comm-call", { detail: { link: j.link } }));
        return { ok: true, platform: j.link?.platform, url: j.link?.url };
      }
      case "get_audi_vehicle": {
        registry.openModule("audi");
        registry.focusModule("audi");
        window.dispatchEvent(new CustomEvent("zee:audi-refresh"));
        const res = await fetch("/api/zee/audi/connect/vehicle");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        const d = j.data || {};
        const odoKm = Number(d.odometerKm);
        const odoMi = Number.isFinite(odoKm) ? odoKm * 0.621371 : null;
        const fuelMi = Number.isFinite(Number(d.fuelRangeKm)) ? Number(d.fuelRangeKm) * 0.621371 : null;
        const evMi = Number.isFinite(Number(d.evRangeKm)) ? Number(d.evRangeKm) * 0.621371 : null;
        const ax = d.access || {};
        const accessLines = [];
        for (const row of [...(ax.doors || []), ...(ax.windows || []), ...(ax.lights || [])]) {
          if (row?.label) accessLines.push(`${row.label}: ${row.states || "—"}`);
        }
        return {
          vin: d.vin,
          nickname: d.nickname,
          model: d.model,
          modelYear: d.modelYear,
          odometerMi: odoMi,
          odometerKm: Number.isFinite(odoKm) ? odoKm : null,
          fuelLevelPct: d.fuelPct ?? null,
          fuelRangeMi: fuelMi,
          fuelRangeKm: d.fuelRangeKm ?? null,
          batteryPct: d.batteryPct ?? null,
          evRangeMi: evMi,
          evRangeKm: d.evRangeKm ?? null,
          closuresAndLights: accessLines.slice(0, 16),
        };
      }
      case "get_vehicle_location": {
        registry.openModule("audi");
        registry.focusModule("audi");
        const res = await fetch("/api/zee/audi/location");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return {
          provider: j.provider || null,
          latitude: j.latitude,
          longitude: j.longitude,
          mapsUrl:
            Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude))
              ? `https://www.google.com/maps?q=${j.latitude},${j.longitude}`
              : null,
        };
      }
      case "open_ring_view":
        registry.openModule("ring");
        registry.focusModule("ring");
        window.dispatchEvent(new CustomEvent("zee:ring-open"));
        return { ok: true };
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// End-of-session phrases said by the USER. Tolerant of "Zee" being misheard
// as "Z". Pre-stripping handles trailing "Zee"/"Z" tokens so the regex itself
// just looks for the sentence stem.
const END_SESSION_RE =
  /\b(that will be all|that'?ll be all|that was all|that'?s all|that is all|we'?re done|we are done|goodbye|good\s*night|stand down|end (the )?(voice )?session|stop listening|sleep now|that's enough|that is enough|go to sleep|shut down (now|voice)?|power off)\b/i;

// Phrases said by ZEE that confirm she's ending (used as a fallback in case
// the model speaks the confirmation but forgets to call end_voice_session).
// Keep this tight — false positives would shut down a live session.
const ZEE_CONFIRM_END_RE =
  /\b(shut(ting)? down (the |this )?(session|voice|now)|ending (the |this )?(session|voice)|powering (down|off)|voice (is )?off( now)?|going (to sleep|offline)|see you (later|next time)|standing down|going (silent|dark))\b/i;

// Surface a tiny window-level debug array so we can ask the user to dump
// `window.__zeeRealtimeEvents` if the parser is missing events.
if (typeof window !== "undefined") {
  window.__zeeRealtimeEvents = window.__zeeRealtimeEvents || [];
}

function normalizeForEndCheck(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\.\!\?,;:]+$/g, "")
    .replace(/\b(zee|z)\b\s*$/i, "")
    .trim();
}

function isAssistantTranscriptEvent(type) {
  // Zee speaking back to the user — never use these to end the session.
  return /^response\./i.test(type) && /transcript/i.test(type);
}

function maybeCaptureTranscript(msg) {
  const t = String(msg.type || "");
  if (!t.includes("transcript")) return;
  const text = String(
    msg.transcript ||
      msg.delta ||
      msg.text ||
      msg.item?.content?.[0]?.transcript ||
      msg.item?.content?.[0]?.text ||
      ""
  ).trim();
  if (!text) return;

  // Append a small ring of events for diagnostics (no PII beyond what the
  // user already sees in the "Heard" status). Cap to last 50.
  try {
    const ring = window.__zeeRealtimeEvents;
    ring.push({ ts: Date.now(), type: t, text });
    if (ring.length > 50) ring.splice(0, ring.length - 50);
  } catch {}

  heard(text);
  window.dispatchEvent(new CustomEvent("zee:voice-activity"));

  if (isAssistantTranscriptEvent(t)) {
    // Fallback: Zee said something like "shutting down the session" but never
    // called end_voice_session. Trust her words and tear the session down.
    if (ZEE_CONFIRM_END_RE.test(text)) {
      endZeeVoiceSession("zee-confirm-end");
    }
    return;
  }

  // User-side end-of-session check, co-located with the "Heard:" writer so
  // anything visible to the user as a heard transcript is also evaluated.
  const target = normalizeForEndCheck(text);
  if (target && END_SESSION_RE.test(target)) {
    endZeeVoiceSession("transcript-phrase");
  }
}

function extractTranscriptText(msg) {
  return String(
    msg?.transcript ||
      msg?.delta ||
      msg?.text ||
      msg?.item?.content?.[0]?.transcript ||
      msg?.item?.content?.[0]?.text ||
      ""
  ).trim();
}

function maybeRunDirectVoiceCommand(msg) {
  const t = String(msg?.type || "");
  // Permissive filter: any transcript-bearing event for non-assistant role.
  const isTranscriptEvent = /transcript/i.test(t) || /input_audio/i.test(t);
  if (!isTranscriptEvent) return false;
  if (isAssistantTranscriptEvent(t)) return false;
  const role = String(msg?.item?.role || msg?.role || "").toLowerCase();
  if (role === "assistant") return false;
  const spoken = extractTranscriptText(msg).toLowerCase();
  if (!spoken) return false;

  const target = normalizeForEndCheck(spoken) || spoken;
  if (
    END_SESSION_RE.test(target) ||
    /\bthat\b.*\b(was|is|will be)\b.*\ball\b/i.test(target)
  ) {
    endZeeVoiceSession("user-phrase");
    return true;
  }

  if (/\b(ring|doorbell)\b/.test(spoken) && /\b(open|show|view|camera|feed)\b/.test(spoken)) {
    registry.openModule("ring");
    registry.focusModule("ring");
    window.dispatchEvent(new CustomEvent("zee:ring-open"));
    status("Zee: opening Ring camera");
    return true;
  }

  if (/\b(where|locate|location|find)\b/.test(spoken) && /\b(audi|car|vehicle)\b/.test(spoken)) {
    runVehicleLocation();
    return true;
  }

  /* "Zee, end the call" / "hang up" / "close the call" -> end active video call */
  if (parseEndCall(spoken)) {
    window.dispatchEvent(new CustomEvent("zee:comm-end-call"));
    status("Zee: ending the call");
    return true;
  }

  if (/\bclose\b/.test(spoken) && /\b(it|that|this|window|video|stock|spotlight|foreground|drill)\b/.test(spoken)) {
    if (/\b(video|youtube)\b/.test(spoken)) {
      bus.emit("spotlight:close", { target: "youtube" });
      status("Zee: closing video window");
    } else if (/\b(stock|nvidia|nvda)\b/.test(spoken)) {
      bus.emit("spotlight:close", { target: "stock" });
      status("Zee: closing stock window");
    } else {
      bus.emit("spotlight:close", { target: "all" });
      status("Zee: closing spotlight");
    }
    return true;
  }

  if (
    /\b(nvda|nvidia)\b/.test(spoken) &&
    (/(open|show|spotlight|foreground|drill)/i.test(spoken) || /\bnvidia\s+stock\b|\bnvda\s+stock\b/i.test(spoken))
  ) {
    registry.openModule("stocks");
    registry.focusModule("stocks");
    bus.emit("stock:spotlight", { symbol: "NVDA" });
    status("Zee: opening NVDA spotlight");
    return true;
  }

  if ((/\b(pause|stop)\b/.test(spoken) && /\b(video|youtube)\b/.test(spoken)) || /\bpause\b.*\bthis\b.*\bvideo\b/.test(spoken)) {
    bus.emit("youtube:pause", {});
    status("Zee: pausing video");
    return true;
  }
  if ((/\b(unpause|resume|continue|play)\b/.test(spoken) && /\b(video|youtube)\b/.test(spoken)) || /\bresume\b.*\bvideo\b/.test(spoken)) {
    bus.emit("youtube:resume", {});
    status("Zee: resuming video");
    return true;
  }

  if (/\b(youtube|video)\b/.test(spoken) && /(open|show|play|first|1st|one)/i.test(spoken)) {
    registry.openModule("youtube");
    registry.focusModule("youtube");
    const idxMatch = spoken.match(/\b(?:video\s*)?(\d+)\b/);
    const idx = idxMatch ? Math.max(1, Math.min(8, Number(idxMatch[1]))) : 1;
    bus.emit("youtube:open", { index: idx });
    status(`Zee: opening YouTube video ${idx}`);
    return true;
  }

  /* "Zee, turn off the kitchen light" -> SmartThings */
  const smart = parseTurnOnOff(spoken);
  if (smart) {
    runSmartCommand(smart.action, smart.name);
    return true;
  }

  /* "Zee, video call <name>" / "Zee, call <name> on Zoom" -> Communications */
  const callCmd = parseVideoCall(spoken);
  if (callCmd) {
    runVideoCall(callCmd.name, callCmd.platform);
    return true;
  }

  /* "Zee, start a (meet|zoom|teams) meeting" -> Instant meeting */
  const instant = parseInstantMeeting(spoken);
  if (instant) {
    runInstantMeeting(instant.platform);
    return true;
  }

  return false;
}

/**
 * Parse "(zee,)? turn (on|off|off the|on the) <device name>".
 * Strips trailing politeness/please.
 */
function parseTurnOnOff(spoken) {
  const m = /\bturn\s+(on|off)\s+(?:the\s+|my\s+)?(.+?)(?:\s+please)?\.?$/i.exec(spoken);
  if (!m) return null;
  const action = String(m[1]).toLowerCase();
  let name = String(m[2]).trim();
  name = name.replace(/\b(?:please|now|for me)\b/gi, "").trim();
  if (!name) return null;
  return { action, name };
}

/**
 * Parse "(zee,)? (video )?call <name>(?:\s+(on|via|using)\s+(meet|google meet|zoom|teams|microsoft teams|discord))?".
 * Avoids matching the SmartThings-style "turn on/off X" or generic phone-call requests with no name.
 */
function parseVideoCall(spoken) {
  if (!/\bcall\b/.test(spoken)) return null;
  const m = /\b(?:video\s+)?call\s+(?:my\s+|the\s+)?([\w'\- .]+?)(?:\s+(?:on|via|using|with|over)\s+(google\s+meet|meet|zoom|microsoft\s+teams|teams|discord))?\s*\.?$/i.exec(
    spoken
  );
  if (!m) return null;
  let name = String(m[1] || "").trim();
  name = name.replace(/\b(?:please|now|right now|for me|on (?:the )?(?:phone|video))\b/gi, "").trim();
  if (!name) return null;
  if (/^(me|myself|now|him|her|them|someone|anyone)$/i.test(name)) return null;
  let platform = null;
  const raw = String(m[2] || "").toLowerCase();
  if (/meet/.test(raw)) platform = "meet";
  else if (/zoom/.test(raw)) platform = "zoom";
  else if (/teams/.test(raw)) platform = "teams";
  else if (/discord/.test(raw)) platform = "discord";
  return { name, platform };
}

/**
 * Parse end-call utterances: "end call", "hang up", "close the call",
 * "end the meeting", "drop the call", "end the video call". Conservative on
 * purpose so it doesn't collide with "end voice session" / "close window".
 */
function parseEndCall(spoken) {
  if (/\bend\s+(?:the\s+)?(?:video\s+)?(?:call|meeting)\b/i.test(spoken)) return true;
  if (/\bhang\s*up\b/i.test(spoken)) return true;
  if (/\bdrop\s+(?:the\s+)?(?:video\s+)?(?:call|meeting)\b/i.test(spoken)) return true;
  if (/\bclose\s+(?:the\s+)?(?:call|meeting|call\s*window)\b/i.test(spoken)) return true;
  return false;
}

/** "Zee, start a meeting" / "spin up a Zoom call" / "create a Meet" */
function parseInstantMeeting(spoken) {
  if (!/\b(start|spin\s*up|create|open|launch|new)\b/.test(spoken)) return null;
  if (!/\b(meeting|room|call|video\s*chat)\b/.test(spoken)) return null;
  let platform = "meet";
  if (/\bzoom\b/.test(spoken)) platform = "zoom";
  else if (/\bteams\b|\bmicrosoft\s+teams\b/.test(spoken)) platform = "teams";
  else if (/\bgoogle\s+meet\b|\bmeet\b/.test(spoken)) platform = "meet";
  return { platform };
}

async function runVideoCall(name, platform) {
  status(`Zee: calling ${name}${platform ? ` on ${platform}` : ""}...`);
  try {
    const res = await fetch("/api/zee/comm/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, platform }),
    });
    const j = await res.json();
    if (!j.ok) {
      status(`Zee: ${j.error || "call failed"}`);
      return;
    }
    registry.openModule("communications");
    registry.focusModule("communications");
    window.dispatchEvent(
      new CustomEvent("zee:comm-call", { detail: { link: j.link, contact: j.contact } })
    );
    status(`Zee: ${j.contact?.name || name} -> ${j.link?.platform}`);
  } catch (e) {
    status(`Zee: call failed (${String(e.message || e).slice(0, 80)})`);
  }
}

async function runInstantMeeting(platform) {
  status(`Zee: spinning up ${platform} meeting...`);
  try {
    const res = await fetch("/api/zee/comm/quick-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    const j = await res.json();
    if (!j.ok) {
      status(`Zee: ${j.error || "instant meeting failed"}`);
      return;
    }
    registry.openModule("communications");
    registry.focusModule("communications");
    window.dispatchEvent(new CustomEvent("zee:comm-call", { detail: { link: j.link } }));
    status(`Zee: ${j.link?.platform} ready`);
  } catch (e) {
    status(`Zee: instant meeting failed (${String(e.message || e).slice(0, 80)})`);
  }
}

async function runSmartCommand(action, name) {
  status(`Zee: turning ${action} ${name}...`);
  try {
    const res = await fetch("/api/zee/smart-home/by-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, on: action === "on" }),
    });
    const j = await res.json();
    if (!j.ok) {
      const hint = Array.isArray(j.devices) && j.devices.length ? ` (try: ${j.devices.slice(0, 4).join(", ")})` : "";
      status(`Zee: ${j.error || "smart command failed"}${hint}`);
      return;
    }
    registry.openModule("smart-home");
    status(`Zee: ${j.device?.label || name} → ${action.toUpperCase()}`);
  } catch (e) {
    status(`Zee: smart command failed (${String(e.message || e).slice(0, 80)})`);
  }
}

async function runVehicleLocation() {
  status("Zee: locating vehicle...");
  try {
    const res = await fetch("/api/zee/audi/location");
    const j = await res.json();
    if (!j.ok) {
      status(`Zee: ${j.error || "location unavailable"}`);
      return;
    }
    registry.openModule("audi");
    registry.focusModule("audi");
    status(`Zee: vehicle located via ${j.provider}`);
    if (Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude))) {
      window.open(`https://www.google.com/maps?q=${j.latitude},${j.longitude}`, "_blank", "noopener");
    }
  } catch (e) {
    status(`Zee: location failed (${String(e.message || e).slice(0, 80)})`);
  }
}

async function handleFunctionCalls(channel, calls) {
  if (!Array.isArray(calls) || !calls.length) return false;
  let handledAny = false;
  let endedSession = false;
  status("Zee: running tools...");
  for (const item of calls) {
    const callId = String(item?.call_id || "");
    const name = String(item?.name || "");
    if (!callId || !name) continue;
    if (handledCallIds.has(callId)) continue;
    handledCallIds.add(callId);
    let args = {};
    try {
      args = JSON.parse(String(item.arguments || "{}"));
    } catch {
      args = {};
    }
    if (name === "end_voice_session") endedSession = true;
    const result = await executeTool(name, args);
    // After end_voice_session the data channel is intentionally closed; don't
    // try to write to it (and definitely don't trip a "listening" status).
    if (channel.readyState !== "open") continue;
    try {
      channel.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result ?? {}),
          },
        })
      );
    } catch {
      // channel may have closed mid-write; ignore.
    }
    handledAny = true;
  }
  if (handledAny && !endedSession && channel.readyState === "open") {
    try { channel.send(JSON.stringify({ type: "response.create" })); } catch { /* ignore */ }
    status("Zee: listening");
  }
  return handledAny;
}

/**
 * @param {RTCDataChannel} channel
 */
function wireDataChannel(channel) {
  channel.addEventListener("message", async (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data || "{}"));
    } catch {
      return;
    }
    maybeCaptureTranscript(msg);
    maybeRunDirectVoiceCommand(msg);

    const t = msg.type;
    if (t === "response.done") {
      const out = Array.isArray(msg.response?.output) ? msg.response.output : [];
      const calls = out.filter((x) => x && x.type === "function_call");
      await handleFunctionCalls(channel, calls);
    }
    // Some realtime sessions emit function calls as output items before response.done.
    if (t === "response.output_item.done") {
      const item = msg.item;
      if (item?.type === "function_call") {
        await handleFunctionCalls(channel, [item]);
      }
    }
    if (t === "error") {
      status(`Zee error: ${msg.error?.message || JSON.stringify(msg.error || msg).slice(0, 120)}`);
    }
  });
}

async function fetchSdpAnswerDirect(offerSdp) {
  const tokenRes = await fetch("/api/zee/voice/token");
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.ok || !tokenJson.ephemeralKey) {
    throw new Error(tokenJson?.error || "Failed to get ephemeral realtime token.");
  }
  const res = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offerSdp,
    headers: {
      Authorization: `Bearer ${tokenJson.ephemeralKey}`,
      "Content-Type": "application/sdp",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Direct realtime call failed (${res.status}): ${text.slice(0, 220)}`);
  return text;
}

async function fetchSdpAnswerViaServerRelay(offerSdp) {
  const sdpRes = await fetch("/api/zee/voice/sdp", {
    method: "POST",
    body: offerSdp || "",
    headers: { "Content-Type": "application/sdp" },
  });
  const raw = await sdpRes.text();
  if (!sdpRes.ok) {
    let detail = raw;
    try {
      const j = JSON.parse(raw);
      detail = j.error || raw;
    } catch {
      // keep plain text
    }
    throw new Error(detail || `Relay SDP failed (${sdpRes.status})`);
  }
  return raw;
}

export function sendTextPrompt(text) {
  const prompt = String(text || "").trim();
  if (!prompt) return { ok: false, error: "empty prompt" };
  if (!dc) return { ok: false, error: "voice channel not ready" };
  if (dc.readyState !== "open") {
    pendingPrompts.push(prompt);
    return { ok: true, queued: true };
  }
  heard(prompt);
  status("Zee: processing command...");
  dc.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    })
  );
  dc.send(JSON.stringify({ type: "response.create" }));
  return { ok: true };
}

export async function connectZeeVoice() {
  if (pc) await disconnectZeeVoice();
  status("Zee: requesting microphone...");
  // Prefer the saved Zee mic (e.g. AT2020USB+) if one is resolved; otherwise
  // fall back to the system default.
  const audioConstraint = await getZeeAudioConstraint().catch(() => true);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
  } catch (err) {
    if (audioConstraint && audioConstraint !== true) {
      // Constrained mic is unavailable (e.g. unplugged); retry with default.
      status("Zee: preferred mic unavailable, using system default...");
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } else {
      throw err;
    }
  }
  startLevelMonitor();

  pc = new RTCPeerConnection();
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudio.setAttribute("playsinline", "true");
  remoteAudio.dataset.zeeRemote = "1";
  document.body.appendChild(remoteAudio);

  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
  };

  for (const track of localStream.getAudioTracks()) {
    pc.addTrack(track, localStream);
  }

  dc = pc.createDataChannel("oai-events");
  handledCallIds = new Set();
  wireDataChannel(dc);
  dc.addEventListener("open", () => {
    status("Zee: voice link ready");
    if (pendingPrompts.length) {
      const toSend = [...pendingPrompts];
      pendingPrompts = [];
      for (const p of toSend) sendTextPrompt(p);
    }
  });
  dc.addEventListener("close", () => status("Zee: voice channel closed"));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  status("Zee: negotiating with OpenAI...");
  let answerSdp = "";
  let directErr = "";
  try {
    answerSdp = await fetchSdpAnswerDirect(offer.sdp || "");
  } catch (e) {
    directErr = String(e.message || e);
    status("Zee: direct connect failed, trying relay...");
  }
  if (!answerSdp) {
    try {
      answerSdp = await fetchSdpAnswerViaServerRelay(offer.sdp || "");
    } catch (relayErr) {
      const relayText = String(relayErr.message || relayErr);
      throw new Error(`Direct: ${directErr || "n/a"} | Relay: ${relayText}`);
    }
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  status("Zee: listening");
  pc.addEventListener("connectionstatechange", () => {
    if (pc?.connectionState === "failed") status("Zee: connection failed");
  });

  // Let the HUD reliably start/refresh its budget session *after* the WebRTC session is established.
  // This avoids a race where passive watchdog sees "connected" before app.js sets session timers.
  window.dispatchEvent(new CustomEvent("zee:voice-connected"));
}

export async function disconnectZeeVoice() {
  status("Zee: disconnecting...");
  try {
    dc?.close();
  } catch {
    // ignore
  }
  dc = null;
  pendingPrompts = [];
  handledCallIds = new Set();
  try {
    pc?.getSenders().forEach((s) => s.track?.stop());
    pc?.close();
  } catch {
    // ignore
  }
  pc = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  stopLevelMonitor();
  document.querySelectorAll('audio[data-zee-remote="1"]').forEach((el) => el.remove());
  status("Zee: voice idle");
  window.dispatchEvent(new CustomEvent("zee:voice-disconnected"));
}

export function setMicMuted(muted) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = !muted;
  });
}

export function isVoiceConnected() {
  return Boolean(pc && !["closed", "failed", "disconnected"].includes(String(pc.connectionState || "")));
}
