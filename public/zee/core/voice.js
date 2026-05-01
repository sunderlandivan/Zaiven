import { registry } from "./registry.js";
import { bus } from "./bus.js";
import { getZeeTimePayload } from "../lib/time-moon.js";

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
      case "get_system_stats": {
        const res = await fetch("/api/zee/system/stats");
        const j = await res.json();
        if (!j.ok) return { ok: false, error: j.error };
        return j.data || {};
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function maybeCaptureTranscript(msg) {
  const t = String(msg.type || "");
  if (t.includes("transcript")) {
    const text = String(
      msg.transcript ||
        msg.delta ||
        msg.text ||
        msg.item?.content?.[0]?.transcript ||
        msg.item?.content?.[0]?.text ||
        ""
    ).trim();
    if (text) heard(text);
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
  // Only use user input-audio transcription events for deterministic local shortcuts.
  if (!/^conversation\.item\.input_audio_transcription/i.test(t)) return false;
  const spoken = extractTranscriptText(msg).toLowerCase();
  if (!spoken) return false;

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

  if (/\b(youtube|video)\b/.test(spoken) && /(open|show|play|first|1st|one)/i.test(spoken)) {
    registry.openModule("youtube");
    registry.focusModule("youtube");
    const idxMatch = spoken.match(/\b(?:video\s*)?(\d+)\b/);
    const idx = idxMatch ? Math.max(1, Math.min(8, Number(idxMatch[1]))) : 1;
    bus.emit("youtube:open", { index: idx });
    status(`Zee: opening YouTube video ${idx}`);
    return true;
  }
  return false;
}

async function handleFunctionCalls(channel, calls) {
  if (!Array.isArray(calls) || !calls.length) return false;
  let handledAny = false;
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
    const result = await executeTool(name, args);
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
    handledAny = true;
  }
  if (handledAny) {
    channel.send(JSON.stringify({ type: "response.create" }));
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
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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
