import axios from "axios";

const OPENAI_REALTIME_CALLS = "https://api.openai.com/v1/realtime/calls";
const OPENAI_CLIENT_SECRETS = "https://api.openai.com/v1/realtime/client_secrets";

export const ZEE_INSTRUCTIONS = `You are "Zee", a calm, precise AI copilot with a subtle Jarvis-like tone—efficient, respectful, and slightly futuristic. You help the user manage their day: dashboard modules (time, stocks, news, vehicle, Gmail, music, YouTube, smart home, social, system performance), voice control, and brief spoken summaries when asked.

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
- If the user ends the interaction (e.g. "that was all", "that's all", "that will be all", "we're done", "stand down", "good night", "goodbye", "go to sleep"), you MUST call end_voice_session as a tool call BEFORE speaking. Do not just say "shutting down" — actually invoke the tool. The user's voice button must flip to "Voice off" and incur no further API charges. Note that the transcriber may write your name "Zee" as the letter "Z"; treat both as the same wake word.
- For stocks, news, email, or music actions, prefer tools over guessing.
- Keep your voice and style stable and professional.
- If a tool fails, say what happened briefly and suggest a fix (e.g. connect Gmail, set API keys).
- For Audi / myAudi vehicle status (mileage, fuel, EV battery), use get_audi_vehicle (and get_audi_connect_status if login state is unclear). Do not invent numbers.
- For "Zee, turn on/off <device name>" call control_smart_device with action="on"|"off" and the spoken device name (SmartThings will fuzzy match). If the user says "Alexa, ..." treat it like "Zee, ...". If the device cannot be matched, briefly read back the suggestions returned by the tool.
- For "show ring camera", "open doorbell", or "open ring" call open_ring_view.
- For "where is my car" or "locate the Audi" call get_vehicle_location.
- For "video call <name>" / "call <name>" / "start a meeting" / "start a Zoom call", use start_video_call (with name + optional platform) or start_instant_meeting. Confirm briefly which platform was used. Available platforms: meet, zoom, teams, discord.
- To end the active call (e.g. "end call", "hang up", "close the call", "end the meeting"), call end_video_call. This closes the popup window and the in-HUD call console. Confirm briefly that the call is ended.
- If the user asks "who can I call" or similar, use list_call_contacts to read back saved contacts and their preferred platforms.
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
            enum: [
              "time", "stocks", "news", "audi", "gmail", "music", "youtube",
              "system", "smart-home", "communications", "ring",
            ],
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
            enum: [
              "time", "stocks", "news", "audi", "gmail", "music", "youtube",
              "system", "smart-home", "communications", "ring",
            ],
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
            enum: [
              "time", "stocks", "news", "audi", "gmail", "music", "youtube",
              "system", "smart-home", "communications", "ring",
            ],
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
      name: "resume_youtube_video",
      description: "Resume/unpause the currently opened Youtube video in the foreground window.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "end_voice_session",
      description: "End the current OpenAI Realtime voice session to save cost (disconnect mic/WebRTC).",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_system_stats",
      description: "Return latest system performance stats (CPU, memory, disk, uptime, and available temps).",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_audi_connect_status",
      description:
        "Return whether Zee has an active myAudi / Audi Connect session on the server (linked or not), region, and optional configured VIN.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_audi_vehicle",
      description:
        "Fetch a concise live vehicle snapshot from Audi Connect (odometer, fuel level/range, EV SOC/range) after myAudi login on the server.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_vehicle_location",
      description:
        "Get latest vehicle GPS coordinates from Audi if available, otherwise fallback provider (e.g. LoJack when configured).",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "open_ring_view",
      description: "Open/focus the Ring module and trigger drill-down doorbell camera view.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "list_smart_devices",
      description: "List switchable Smart Home devices (SmartThings) by label and current on/off state.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "control_smart_device",
      description:
        "Turn a SmartThings smart-home device on or off by name (case-insensitive, partial match). Use when the user says e.g. 'Zee, turn off the kitchen light'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Device name as it appears in SmartThings (e.g. 'Kitchen Light')." },
          action: { type: "string", enum: ["on", "off"] },
        },
        required: ["name", "action"],
      },
    },
    {
      type: "function",
      name: "list_call_contacts",
      description:
        "List the user's saved video-call contacts (name + preferred platform). Use when the user asks who they can call.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "start_video_call",
      description:
        "Start a video call to a saved contact by name (case-insensitive, partial match). Optionally override the platform. Returns the meeting URL; the HUD opens it in a popup window and copies the link to clipboard.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Contact name (e.g. 'Mom', 'Alex')." },
          platform: {
            type: "string",
            enum: ["meet", "zoom", "teams", "discord"],
            description: "Optional override of the contact's preferred platform.",
          },
          email_link: {
            type: "boolean",
            description: "If true, also email the link to the contact (uses Gmail send if scoped, otherwise mailto).",
          },
        },
        required: ["name"],
      },
    },
    {
      type: "function",
      name: "end_video_call",
      description:
        "End the active video call. Closes the call popup window and dismisses the in-HUD call console. Use when the user says 'end call', 'hang up', 'close the call', or 'end the meeting'.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "start_instant_meeting",
      description:
        "Spin up an instant meeting URL on the requested platform. Use when the user says 'start a meeting' or 'start a Zoom call'. Default platform is meet.",
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["meet", "zoom", "teams"],
          },
          subject: { type: "string", description: "Optional meeting subject." },
        },
      },
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
