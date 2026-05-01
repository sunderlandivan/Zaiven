import axios from "axios";

const OPENAI_REALTIME_CALLS = "https://api.openai.com/v1/realtime/calls";
const OPENAI_CLIENT_SECRETS = "https://api.openai.com/v1/realtime/client_secrets";

export const ZEE_INSTRUCTIONS = `You are "Zee", a calm, precise AI copilot with a subtle Jarvis-like tone—efficient, respectful, and slightly futuristic. You help the user manage their day: dashboard modules (time, stocks, news, vehicle, Gmail, music, youtube, system performance), voice control, and brief spoken summaries when asked.

Locked voice persona profile (persistent):
- Voice profile: EN-GB
- Accent: Standard British
- Tone: Youthful
- Persistent: true
- Address user as: "Sir"

Rules:
- Keep spoken replies concise unless the user asks for detail.
- When the user asks to show, open, focus, or hide a module, use the provided tools.
- If the user asks "show Nvidia" / "show NVDA" / "drill down stock", call spotlight_stock with the symbol.
- If the user asks to close a spotlight/drill-down/fore-window overlay, call close_spotlight (do not close the base module).
- For stocks, news, email, or music actions, prefer tools over guessing.
- Keep your voice and style stable and professional.
- If a tool fails, say what happened briefly and suggest a fix (e.g. connect Gmail, set API keys).
- Optionally address the user as "Sir" only if it feels natural, not every sentence.`;

function openaiHeaders() {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("Missing OPENAI_API_KEY environment variable.");
  return {
    Authorization: `Bearer ${key}`,
  };
}

export function getRealtimeModel() {
  return String(process.env.OPENAI_REALTIME_MODEL || "gpt-realtime").trim();
}

/**
 * Tool definitions for Realtime session (OpenAI function tools).
 * @returns {unknown[]}
 */
export function getZeeRealtimeTools() {
  return [
    {
      type: "function",
      name: "open_module",
      description: "Show or expand a dashboard module by id.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            enum: ["time", "stocks", "news", "audi", "gmail", "music", "youtube", "system"],
          },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "close_module",
      description: "Hide or minimize a dashboard module by id.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            enum: ["time", "stocks", "news", "audi", "gmail", "music", "youtube", "system"],
          },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "focus_module",
      description: "Bring attention to a module (highlight / scroll into view).",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            enum: ["time", "stocks", "news", "audi", "gmail", "music", "youtube", "system"],
          },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "get_time",
      description: "Return current local date, time, and moon phase summary for the HUD.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_stock",
      description: "Fetch latest quote and recent daily closes for a US ticker symbol.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "e.g. NVDA, SPY" } },
        required: ["symbol"],
      },
    },
    {
      type: "function",
      name: "spotlight_stock",
      description:
        "Open a centered drill-down stock spotlight window with charts and metrics (RSI, highs/lows, 52-week levels). Use when user asks to show or drill into a stock like NVIDIA.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "e.g. NVDA, SPY" } },
        required: ["symbol"],
      },
    },
    {
      type: "function",
      name: "close_spotlight",
      description: "Close any active centered drill-down spotlight/fore-window overlay.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["stock", "all"],
          },
        },
      },
    },
    {
      type: "function",
      name: "get_news",
      description: "Fetch short headlines for a topic feed key.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["nvidia", "star_citizen", "steam", "world"],
          },
        },
        required: ["topic"],
      },
    },
    {
      type: "function",
      name: "play_music",
      description: "Play a track from the local music library matching a search query (title/artist/path).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "pause_music",
      description: "Pause music playback in the music module.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "next_track",
      description: "Skip to the next track in the music queue.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "set_volume",
      description: "Set music player volume 0.0 to 1.0.",
      parameters: {
        type: "object",
        properties: { level: { type: "number", minimum: 0, maximum: 1 } },
        required: ["level"],
      },
    },
    {
      type: "function",
      name: "read_email",
      description: "Read a recent Gmail message summary by 1-based index from the inbox list.",
      parameters: {
        type: "object",
        properties: { index: { type: "integer", minimum: 1, maximum: 20 } },
      },
    },
    {
      type: "function",
      name: "summarize_inbox",
      description: "Summarize the top few recent Gmail messages (subjects and senders).",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "open_youtube_video",
      description: "Open the Youtube module and play a video by index from the current thumbnail list.",
      parameters: {
        type: "object",
        properties: { index: { type: "integer", minimum: 1, maximum: 8 } },
      },
    },
    {
      type: "function",
      name: "pause_youtube_video",
      description: "Pause the currently playing Youtube video in the foreground window.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_system_stats",
      description: "Return latest system performance stats (CPU, memory, disk, uptime, and available temps).",
      parameters: { type: "object", properties: {} },
    },
  ];
}

export function buildSessionObject() {
  const voice = String(process.env.OPENAI_REALTIME_VOICE || "marin").trim() || "marin";
  const speedRaw = Number(process.env.OPENAI_REALTIME_SPEED || 1.0);
  const speed = Number.isFinite(speedRaw) ? Math.max(0.8, Math.min(1.3, speedRaw)) : 1.15;
  return {
    type: "realtime",
    model: getRealtimeModel(),
    instructions: ZEE_INSTRUCTIONS,
    tools: getZeeRealtimeTools(),
    tool_choice: "auto",
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 550,
          create_response: true,
          interrupt_response: true,
        },
        transcription: {
          model: "gpt-4o-mini-transcribe",
        },
      },
      output: { voice, speed },
    },
  };
}

export function buildSessionConfigJson() {
  return JSON.stringify(buildSessionObject());
}

/**
 * Server-side WebRTC SDP exchange (unified interface). Keeps OPENAI_API_KEY off the client.
 * @param {string} offerSdp
 * @returns {Promise<string>} answer SDP text
 */
export async function relayRealtimeSdp(offerSdp) {
  const sdp = String(offerSdp || "").trim();
  if (!sdp) throw new Error("Missing SDP offer.");

  const session = buildSessionConfigJson();
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", session);

  const res = await fetch(OPENAI_REALTIME_CALLS, {
    method: "POST",
    headers: openaiHeaders(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI realtime/calls failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return text;
}

/**
 * Optional: ephemeral client secret for browser-direct calls (if CORS allows).
 * @returns {Promise<{ value: string, expires_at?: number, raw: unknown }>}
 */
export async function createClientSecret() {
  const session = buildSessionObject();

  try {
    const res = await axios.post(
      OPENAI_CLIENT_SECRETS,
      { session },
      { headers: { ...openaiHeaders(), "Content-Type": "application/json" }, timeout: 20000 }
    );
    const data = res.data || {};
    const value = String(data.value || data.client_secret?.value || "").trim();
    if (!value) throw new Error("No ephemeral value in response.");
    return {
      value,
      expires_at: data.expires_at ?? data.client_secret?.expires_at,
      raw: data,
    };
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 400) : e.message;
    throw new Error(`client_secrets failed: ${msg}`);
  }
}
