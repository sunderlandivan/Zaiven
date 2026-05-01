import { registry } from "./core/registry.js";
import { bus } from "./core/bus.js";
import {
  connectZeeVoice,
  disconnectZeeVoice,
  setMicMuted,
  setVoiceStatus,
  setVoiceHeard,
  setVoiceLevel,
  setVoiceWave,
  sendTextPrompt,
  isVoiceConnected,
} from "./core/voice.js";
import { timeModule } from "./modules/time/module.js";
import { stocksModule } from "./modules/stocks/module.js";
import { newsModule } from "./modules/news/module.js";
import { audiModule } from "./modules/audi/module.js";
import { gmailModule } from "./modules/gmail/module.js";
import { musicModule } from "./modules/music/module.js";
import { youtubeModule } from "./modules/youtube/module.js";
import { systemModule } from "./modules/system/module.js";

const grid = document.getElementById("zee-grid");
const btnVoice = document.getElementById("zee-btn-voice");
const btnCompact = document.getElementById("zee-btn-compact");
const voiceStatus = document.getElementById("zee-voice-status");
const voiceHeard = document.getElementById("zee-voice-heard");
const wakeStatus = document.getElementById("zee-wake-status");
const micMeter = document.getElementById("zee-mic-meter");
const root = document.getElementById("zee-root");

[timeModule, stocksModule, newsModule, audiModule, gmailModule, musicModule, youtubeModule, systemModule].forEach((m) =>
  registry.register(m)
);

if (grid) registry.mountAll(grid);

setVoiceStatus((s) => {
  if (voiceStatus) voiceStatus.textContent = s;
});
setVoiceHeard((s) => {
  if (voiceHeard) voiceHeard.textContent = `Heard: ${s}`;
});
setVoiceLevel((level) => drawMicLevel(level));
setVoiceWave((samples) => drawMicWave(samples));

const params = new URLSearchParams(location.search);
if (params.get("hud") === "1") document.body.classList.add("zee-hud-mode");
if (params.get("gmail") === "connected") {
  params.delete("gmail");
  const qs = params.toString();
  history.replaceState({}, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
}

let micMuted = false;
let wakeRecognizer = null;
let lastMeterLevel = 0;
const AWAKE_WINDOW_MS = 10_000;
let voiceArmed = false;
let awakeUntil = 0;
let awakeTimer = 0;
let wakeRestartTimer = 0;
let wakeLastError = "";
let wakeLastErrorAt = 0;
let wakeNetworkErrorCount = 0;
let wakeNetworkWindowStart = 0;
let wakeUnstable = false;
const LEGACY_ALWAYS_ON_VOICE = true;

if (wakeStatus) {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  wakeStatus.textContent = supported ? "Wake: available" : "Wake: unsupported";
}

function drawMicLevel(level) {
  lastMeterLevel = Number(level) || 0;
}

function drawMicWave(samples) {
  const cv = /** @type {HTMLCanvasElement | null} */ (micMeter);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(8, 24, 38, 0.92)";
  ctx.fillRect(0, 0, w, h);

  // Midline
  const mid = h * 0.5;
  ctx.strokeStyle = "rgba(255, 70, 90, 0.45)";
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!samples || samples.length < 2) {
    ctx.strokeStyle = "rgba(140,220,255,0.5)";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    return;
  }

  ctx.strokeStyle = "rgba(58,215,255,0.95)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * (w - 1);
    const norm = (samples[i] - 128) / 128;
    const y = mid + norm * (h * 0.43);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Glow accent intensity from RMS.
  const glow = Math.max(0.1, Math.min(1, lastMeterLevel));
  ctx.strokeStyle = `rgba(92,255,176,${0.2 * glow})`;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function setVoiceArmedUi() {
  if (!btnVoice) return;
  if (LEGACY_ALWAYS_ON_VOICE) {
    const live = isVoiceConnected();
    btnVoice.textContent = live ? "Voice on" : "Voice off";
    btnVoice.setAttribute("aria-pressed", live ? "true" : "false");
    return;
  }
  btnVoice.textContent = voiceArmed ? "Voice armed" : "Voice off";
  btnVoice.setAttribute("aria-pressed", voiceArmed ? "true" : "false");
}

function setWakeLabelSleeping() {
  if (wakeStatus) wakeStatus.textContent = wakeUnstable ? "Wake: unstable (direct listen mode)" : "Wake: ready (say 'Zee ...')";
}

async function sleepRealtime(reason = "idle") {
  awakeUntil = 0;
  if (awakeTimer) {
    window.clearTimeout(awakeTimer);
    awakeTimer = 0;
  }
  if (isVoiceConnected()) {
    await disconnectZeeVoice();
    setVoiceStatus(`Zee: sleeping (${reason})`);
  } else {
    setVoiceStatus("Zee: standing by");
  }
  setWakeLabelSleeping();
}

function scheduleSleepWindow() {
  if (awakeTimer) window.clearTimeout(awakeTimer);
  const ms = Math.max(0, awakeUntil - Date.now());
  awakeTimer = window.setTimeout(() => {
    sleepRealtime("wake window elapsed").catch(() => {});
  }, ms + 30);
}

async function ensureAwake() {
  if (!voiceArmed) return false;
  if (!isVoiceConnected()) {
    setVoiceStatus("Zee: waking...");
    await connectZeeVoice();
  }
  awakeUntil = Date.now() + AWAKE_WINDOW_MS;
  scheduleSleepWindow();
  if (wakeStatus) wakeStatus.textContent = "Wake: awake";
  return true;
}

async function startDirectListenWindow(ms = 120_000) {
  const awake = await ensureAwake().catch((e) => {
    setVoiceStatus(`Zee: ${String(e.message || e)}`);
    return false;
  });
  if (!awake) return false;
  awakeUntil = Date.now() + ms;
  scheduleSleepWindow();
  if (wakeStatus) wakeStatus.textContent = "Wake: direct listen active";
  setVoiceStatus("Zee: direct listening active (speak now)");
  return true;
}

function getWakeWordRecognizer() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recog = new SpeechRecognition();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = "en-US";
  return recog;
}

function parseWakeCommand(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return { woke: false, cmd: "" };
  const m = cleaned.match(/^(?:hey[\s,]+)?zee\b[\s,.:;-]*(.*)$/i);
  if (!m) return { woke: false, cmd: "" };
  return { woke: true, cmd: String(m[1] || "").trim() };
}

function normalizeWakeCommand(cmd) {
  let out = String(cmd || "").trim();
  if (!out) return out;
  out = out.replace(/\bshow\s+nvidia\b/i, "show stock NVDA");
  out = out.replace(/\bnvidia\s+stock\b/i, "stock NVDA");
  if (/^\s*play\s+/i.test(out) && !/\bmusic\b/i.test(out)) {
    out = out.replace(/^\s*play\s+/i, "play music ");
  }
  return out;
}

function handleLocalWakeCommand(cmd) {
  const t = String(cmd || "").toLowerCase();
  if (!t) return false;
  if (/close\s+(the\s+)?(spotlight|drill.?down|fore.?window|window)/i.test(t)) {
    bus.emit("spotlight:close", { target: "all" });
    setVoiceStatus("Zee: closing spotlight");
    return true;
  }
  const looksLikeNvidia = /\bnvda\b|\bnvidia\b|\bnivida\b|\bnvid(i|e)a\b/i.test(t);
  if (looksLikeNvidia) {
    registry.openModule("stocks");
    registry.focusModule("stocks");
    bus.emit("stock:spotlight", { symbol: "NVDA" });
    setVoiceStatus("Zee: opening NVDA spotlight");
    return true;
  }
  return false;
}

async function processSpokenCommand(rawCmd) {
  const cmd = normalizeWakeCommand(String(rawCmd || "").trim());
  if (!cmd) return;
  if (handleLocalWakeCommand(cmd)) {
    awakeUntil = Date.now() + AWAKE_WINDOW_MS;
    scheduleSleepWindow();
    if (wakeStatus) wakeStatus.textContent = "Wake: awake";
    return;
  }
  const awake = await ensureAwake().catch((e) => {
    setVoiceStatus(`Zee: ${String(e.message || e)}`);
    return false;
  });
  if (!awake) return;
  const sent = sendTextPrompt(cmd);
  if (!sent.ok) setVoiceStatus(`Zee: ${sent.error}`);
  else setVoiceStatus(`Zee: processing "${cmd}"`);
}

async function wakeOnly() {
  if (wakeUnstable) {
    await startDirectListenWindow(120_000);
    return;
  }
  const awake = await ensureAwake().catch((e) => {
    setVoiceStatus(`Zee: ${String(e.message || e)}`);
    return false;
  });
  if (!awake) return;
  setVoiceStatus("Zee: awake — awaiting command");
  if (voiceHeard) voiceHeard.textContent = "Heard: Zee (wake)";
}

function startWakeWordLoop() {
  if (wakeRecognizer) return;
  const recog = getWakeWordRecognizer();
  if (!recog) {
    if (voiceHeard) voiceHeard.textContent = "Heard: wake word unsupported in this browser";
    if (wakeStatus) wakeStatus.textContent = "Wake: unsupported";
    return;
  }
  wakeRecognizer = recog;
  setWakeLabelSleeping();
  setVoiceStatus("Zee: wake listener starting...");
  if (voiceHeard) voiceHeard.textContent = "Heard: say 'Zee, ...'";
  recog.onstart = () => {
    setVoiceStatus("Zee: wake listener active");
    if (wakeStatus) wakeStatus.textContent = wakeUnstable ? "Wake: unstable (direct listen mode)" : "Wake: ready (say 'Zee ...')";
  };
  recog.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const spoken = String(res[0]?.transcript || "").trim();
      if (!spoken) continue;
      if (!res.isFinal && !/\bzee\b/i.test(spoken)) continue;
      if (voiceHeard) voiceHeard.textContent = `Heard: ${spoken}`;
      const wakeParsed = parseWakeCommand(spoken);
      if (wakeParsed.woke) {
        if (!wakeParsed.cmd) {
          wakeOnly().catch(() => {});
        } else {
          processSpokenCommand(wakeParsed.cmd).catch(() => {});
        }
        continue;
      }
      if (Date.now() < awakeUntil) {
        processSpokenCommand(spoken).catch(() => {});
      }
    }
  };
  recog.onerror = (ev) => {
    const err = String(ev.error || "speech error");
    if (err === "network") {
      const now = Date.now();
      if (!wakeNetworkWindowStart || now - wakeNetworkWindowStart > 20_000) {
        wakeNetworkWindowStart = now;
        wakeNetworkErrorCount = 0;
      }
      wakeNetworkErrorCount += 1;
      if (wakeNetworkErrorCount >= 3) {
        wakeUnstable = true;
        stopWakeWordLoop();
        if (wakeStatus) wakeStatus.textContent = "Wake: unstable (direct listen mode)";
        startDirectListenWindow(30_000).catch(() => {});
        return;
      }
    }
    const now = Date.now();
    if (err !== wakeLastError || now - wakeLastErrorAt > 2500) {
      wakeLastError = err;
      wakeLastErrorAt = now;
      if (voiceHeard) voiceHeard.textContent = `Heard: ${err}`;
      if (wakeStatus) wakeStatus.textContent = wakeUnstable
        ? "Wake: unstable (direct listen mode)"
        : err === "network"
          ? "Wake: retrying..."
          : `Wake: ${err}`;
      setVoiceStatus(`Zee: wake error (${err})`);
    }
  };
  recog.onend = () => {
    if (voiceArmed && wakeRecognizer === recog) {
      if (wakeRestartTimer) window.clearTimeout(wakeRestartTimer);
      wakeRestartTimer = window.setTimeout(() => {
        try {
          recog.start();
        } catch {
          // Browser may throttle rapid restarts; timed retries continue.
        }
      }, 350);
    }
  };
  try {
    recog.start();
  } catch {
    // Ignore if browser blocks first start until user gesture.
  }
}

function stopWakeWordLoop() {
  if (!wakeRecognizer) return;
  if (wakeRestartTimer) {
    window.clearTimeout(wakeRestartTimer);
    wakeRestartTimer = 0;
  }
  try {
    wakeRecognizer.onend = null;
    wakeRecognizer.stop();
  } catch {
    // ignore
  }
  wakeRecognizer = null;
  if (wakeStatus) wakeStatus.textContent = "Wake: off";
}

async function toggleVoice() {
  if (!btnVoice) return;
  if (LEGACY_ALWAYS_ON_VOICE) {
    try {
      if (isVoiceConnected()) {
        stopWakeWordLoop();
        await disconnectZeeVoice();
        if (wakeStatus) wakeStatus.textContent = "Wake: off";
        setVoiceStatus("Zee: voice idle");
      } else {
        await connectZeeVoice();
        if (wakeStatus) wakeStatus.textContent = "Wake: legacy on";
        setVoiceStatus("Zee: listening");
      }
    } catch (e) {
      setVoiceStatus(`Zee: ${String(e.message || e)}`);
    } finally {
      setVoiceArmedUi();
    }
    return;
  }
  if (voiceArmed) {
    voiceArmed = false;
    stopWakeWordLoop();
    wakeUnstable = false;
    await sleepRealtime("disabled");
    micMuted = false;
    setMicMuted(false);
    setVoiceArmedUi();
    return;
  }
  voiceArmed = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    setVoiceStatus(`Zee: mic permission required (${String(e.message || e)})`);
  }
  // Deterministic path: always connect live voice when armed.
  const awake = await ensureAwake().catch((e) => {
    setVoiceStatus(`Zee: ${String(e.message || e)}`);
    return false;
  });
  if (!awake) {
    setVoiceArmedUi();
    return;
  }
  if (wakeUnstable) {
    awakeUntil = Date.now() + 120_000;
    scheduleSleepWindow();
    if (wakeStatus) wakeStatus.textContent = "Wake: direct listen active";
    setVoiceStatus("Zee: live voice active (speak now)");
    sendTextPrompt("Say: Zee online.");
  } else {
    startWakeWordLoop();
    if (wakeStatus) wakeStatus.textContent = "Wake: live";
    setVoiceStatus("Zee: live voice active (say Zee or speak)");
    sendTextPrompt("Say: Zee online.");
  }
  setVoiceArmedUi();
}

btnVoice?.addEventListener("click", () => toggleVoice());

btnCompact?.addEventListener("click", () => {
  document.body.classList.toggle("zee-hud-mode");
});

window.addEventListener("keydown", (e) => {
  if (e.altKey && (e.code === "KeyZ" || e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    root?.classList.toggle("zee-off");
  }
  if (e.altKey && (e.code === "KeyM" || e.key === "m")) {
    e.preventDefault();
    if (isVoiceConnected()) {
      micMuted = !micMuted;
      setMicMuted(micMuted);
      setVoiceStatus(micMuted ? "Zee: mic muted (Alt+M)" : "Zee: listening");
    }
  }
  if (e.altKey && (e.code === "KeyEnter" || e.key === "Enter")) {
    e.preventDefault();
    if (isVoiceConnected()) sendTextPrompt("Status check. Briefly summarize dashboard highlights.");
  }
});

window.zee = {
  registry,
  connectVoice: connectZeeVoice,
  disconnectVoice: disconnectZeeVoice,
  toggleVoice,
};

drawMicLevel(0);
setVoiceArmedUi();
