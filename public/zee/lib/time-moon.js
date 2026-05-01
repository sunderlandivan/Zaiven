const SYNODIC = 29.530588853;

const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

/** @param {Date} d */
export function getZeeTimePayload(d = new Date()) {
  const moon = getMoonInfo(d);
  return {
    isoLocal: d.toString(),
    date: d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    moon,
  };
}

/** @param {Date} d */
function getMoonInfo(d) {
  const knownNew = Date.UTC(2000, 0, 6, 18, 14, 0, 0);
  const t = d.getTime();
  const daysSince = (t - knownNew) / 86400000;
  const age = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC;
  const illumination = Math.round(100 * 0.5 * (1 - Math.cos(2 * Math.PI * phase)));
  const idx = Math.min(PHASE_NAMES.length - 1, Math.floor(phase * 8));
  return {
    phaseName: PHASE_NAMES[idx],
    illuminationPct: illumination,
    ageDays: Number(age.toFixed(2)),
  };
}
