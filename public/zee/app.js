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

const grid = document.getElementById("zee-grid");
const btnVoice = document.getElementById("zee-btn-voice");
const btnCompact = document.getElementById("zee-btn-compact");
const voiceStatus = document.getElementById("zee-voice-status");
const voiceHeard = document.getElementById("zee-voice-heard");
const wakeStatus = document.getElementById("zee-wake-status");
const micMeter = document.getElementById("zee-mic-meter");
const root = document.getElementById("zee-root");

[timeModule, stocksModule, newsModule, audiModule, gmailModule, musicModule].forEach((m) => registry.register(m));

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
let voiceArmed = true;
let awakeUntil = 0;
let awakeTimer = 0;

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
  btnVoice.textContent = voiceArmed ? "Voice armed" : "Voice off";
  btnVoice.setAttribute("aria-pressed", voiceArmed ? "true" : "false");
}

function setWakeLabelSleeping() {
  if (wakeStatus) wakeStatus.textContent = "Wake: ready (say 'Zee ...')";
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

function getWakeWordRecognizer() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recog = new SpeechRecognition();
  recog.continuous = true;
  recog.interimResults = false;
  recog.lang = "en-US";
  return recog;
}

function parseWakeCommand(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  const m = cleaned.match(/^(?:hey[\s,]+)?zee[\s,.:;-]*(.+)$/i);
  return m ? String(m[1] || "").trim() : "";
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
  if (voiceHeard) voiceHeard.textContent = "Heard: say 'Zee, ...'";
  recog.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (!res.isFinal) continue;
      const spoken = String(res[0]?.transcript || "").trim();
      if (!spoken) continue;
      if (voiceHeard) voiceHeard.textContent = `Heard: ${spoken}`;
      const wakeCmd = parseWakeCommand(spoken);
      if (wakeCmd) {
        processSpokenCommand(wakeCmd).catch(() => {});
        continue;
      }
      if (Date.now() < awakeUntil) {
        processSpokenCommand(spoken).catch(() => {});
      }
    }
  };
  recog.onerror = (ev) => {
    const err = String(ev.error || "speech error");
    if (voiceHeard) voiceHeard.textContent = `Heard: ${err}`;
    if (wakeStatus) wakeStatus.textContent = `Wake: ${err}`;
  };
  recog.onend = () => {
    if (voiceArmed && wakeRecognizer === recog) {
      try {
        recog.start();
      } catch {
        // Browser may throttle rapid restarts; next end cycle retries.
      }
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
  if (voiceArmed) {
    voiceArmed = false;
    stopWakeWordLoop();
    await sleepRealtime("disabled");
    micMuted = false;
    setMicMuted(false);
    setVoiceArmedUi();
    return;
  }
  voiceArmed = true;
  startWakeWordLoop();
  setVoiceStatus("Zee: standing by");
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
startWakeWordLoop();
