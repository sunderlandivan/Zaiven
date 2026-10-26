/**
 * Browser-side device-preference helper.
 *
 * Workflow:
 *  1) Server stores user-friendly device labels (e.g. "EMEET SmartCam Nova 4k").
 *  2) Browser enumerates devices via mediaDevices.enumerateDevices(), label-matches
 *     against the saved prefs, and patches the matching deviceId back to the server.
 *  3) Other modules (voice.js etc.) read the saved deviceId and pass it as a
 *     getUserMedia constraint.
 *
 * enumerateDevices() only returns labels after the user has granted permission
 * to that kind. We therefore expose `syncDevicesWithPermission()` that asks for
 * audio + (optionally) video permission, enumerates, matches, persists, and
 * stops the stream immediately.
 */

const DEVICES_API = "/api/zee/devices";

/** Fetch saved prefs (server-trusted). */
export async function fetchDevicePrefs() {
  const res = await fetch(DEVICES_API);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "fetch devices failed");
  return j.prefs;
}

/** Patch saved prefs. Pass partial { camera: {...}, microphone: {...} }. */
export async function saveDevicePrefs(patch) {
  const res = await fetch(DEVICES_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "save devices failed");
  return j.prefs;
}

/**
 * Loose label match: case-insensitive, ignores punctuation/whitespace,
 * accepts substring in either direction. Returns the best (highest-score)
 * MediaDeviceInfo or null.
 */
function loosely(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scoreMatch(targetLabel, candidate) {
  const t = loosely(targetLabel);
  const c = loosely(candidate.label);
  if (!t || !c) return 0;
  if (t === c) return 100;
  if (c.includes(t)) return 80;
  if (t.includes(c)) return 70;
  // token overlap
  const tTokens = String(targetLabel).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const cTokens = String(candidate.label).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const overlap = tTokens.filter((x) => cTokens.includes(x)).length;
  if (overlap >= Math.max(2, Math.floor(tTokens.length * 0.6))) return 50 + overlap;
  return 0;
}

function findBestMatch(targetLabel, devices) {
  let best = null;
  let bestScore = 0;
  for (const d of devices) {
    const s = scoreMatch(targetLabel, d);
    if (s > bestScore) {
      best = d;
      bestScore = s;
    }
  }
  return bestScore >= 50 ? best : null;
}

/**
 * @returns {Promise<{
 *   prefs: any,
 *   matched: { camera: boolean, microphone: boolean },
 *   labels: { cameras: string[], microphones: string[] },
 *   permissionDenied?: boolean,
 *   error?: string,
 * }>}
 */
export async function syncDevicesWithPermission({ requireVideo = true } = {}) {
  const prefs = await fetchDevicePrefs();
  const matched = { camera: false, microphone: false };
  const labels = { cameras: [], microphones: [] };

  if (!navigator.mediaDevices?.enumerateDevices) {
    return { prefs, matched, labels, error: "mediaDevices not supported" };
  }

  // Open a stream to make labels visible. Stop tracks immediately afterward.
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: requireVideo,
    });
  } catch (e) {
    return {
      prefs,
      matched,
      labels,
      permissionDenied: true,
      error: String(e?.message || e),
    };
  }

  let devices;
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } finally {
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  }

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");
  labels.cameras = cams.map((d) => d.label).filter(Boolean);
  labels.microphones = mics.map((d) => d.label).filter(Boolean);

  const camMatch = findBestMatch(prefs.camera.label, cams);
  const micMatch = findBestMatch(prefs.microphone.label, mics);

  const now = new Date().toISOString();
  const patch = {};
  if (camMatch) {
    matched.camera = true;
    patch.camera = {
      label: prefs.camera.label,
      deviceId: camMatch.deviceId,
      groupId: camMatch.groupId || null,
      lastSeenAt: now,
    };
  }
  if (micMatch) {
    matched.microphone = true;
    patch.microphone = {
      label: prefs.microphone.label,
      deviceId: micMatch.deviceId,
      groupId: micMatch.groupId || null,
      lastSeenAt: now,
    };
  }

  let savedPrefs = prefs;
  if (Object.keys(patch).length) {
    try { savedPrefs = await saveDevicePrefs(patch); } catch { /* keep server prefs */ }
  }

  return { prefs: savedPrefs, matched, labels };
}

/**
 * Build a getUserMedia audio constraint that prefers the saved Zee mic if a
 * matched deviceId exists. Falls back to plain `true`.
 */
export async function getZeeAudioConstraint() {
  try {
    const prefs = await fetchDevicePrefs();
    const id = prefs?.microphone?.deviceId;
    if (id) return { deviceId: { ideal: id }, echoCancellation: true, noiseSuppression: true };
  } catch {
    /* fall through */
  }
  return true;
}
