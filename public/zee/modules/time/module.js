import { getZeeTimePayload } from "../../lib/time-moon.js";

let timer = 0;
let weatherTimer = 0;

const PERRIS_LAT = 33.7825;
const PERRIS_LON = -117.2286;

async function fetchLocalWeather() {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(PERRIS_LAT));
  u.searchParams.set("longitude", String(PERRIS_LON));
  u.searchParams.set("current", "temperature_2m,cloud_cover,precipitation,precipitation_probability");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("precipitation_unit", "inch");
  u.searchParams.set("timezone", "America/Los_Angeles");
  const res = await fetch(u.toString());
  const j = await res.json();
  const c = j.current || {};
  return {
    temperatureF: Number(c.temperature_2m),
    cloudCover: Number(c.cloud_cover),
    precipProb: Number(c.precipitation_probability),
    precipIn: Number(c.precipitation),
  };
}

export const timeModule = {
  id: "time",
  title: "Chrono / Luna",
  mount(el) {
    el.innerHTML = `
      <div class="zee-time">
        <div class="zee-time-date" id="zee-time-date"></div>
        <div class="zee-time-clock" id="zee-time-clock"></div>
        <div class="zee-moon">
          <div class="zee-moon-disc" id="zee-moon-disc" aria-hidden="true"></div>
          <div class="zee-moon-meta">
            <div class="zee-moon-name" id="zee-moon-name"></div>
            <div class="zee-moon-illum" id="zee-moon-illum"></div>
          </div>
        </div>
        <div class="zee-weather" id="zee-weather">
          <div class="zee-weather-title">Perris, CA 92571</div>
          <div class="zee-weather-row"><span>Temp</span><strong id="zee-w-temp">—</strong></div>
          <div class="zee-weather-row"><span>Clouds</span><strong id="zee-w-cloud">—</strong></div>
          <div class="zee-weather-row"><span>Precip %</span><strong id="zee-w-prob">—</strong></div>
          <div class="zee-weather-row"><span>Precip</span><strong id="zee-w-amt">—</strong></div>
        </div>
      </div>
    `;
    const tick = () => {
      const p = getZeeTimePayload();
      const dateEl = el.querySelector("#zee-time-date");
      const clockEl = el.querySelector("#zee-time-clock");
      const nameEl = el.querySelector("#zee-moon-name");
      const illumEl = el.querySelector("#zee-moon-illum");
      const disc = el.querySelector("#zee-moon-disc");
      if (dateEl) dateEl.textContent = p.date;
      if (clockEl) clockEl.textContent = p.time;
      if (nameEl) nameEl.textContent = p.moon.phaseName;
      if (illumEl) illumEl.textContent = `Illumination ~${p.moon.illuminationPct}%`;
      if (disc) {
        const lit = p.moon.illuminationPct / 100;
        disc.style.setProperty("--lit", String(lit));
      }
    };
    const updateWeather = async () => {
      try {
        const w = await fetchLocalWeather();
        const tempEl = el.querySelector("#zee-w-temp");
        const cloudEl = el.querySelector("#zee-w-cloud");
        const probEl = el.querySelector("#zee-w-prob");
        const amtEl = el.querySelector("#zee-w-amt");
        if (tempEl) tempEl.textContent = Number.isFinite(w.temperatureF) ? `${w.temperatureF.toFixed(1)} F` : "—";
        if (cloudEl) cloudEl.textContent = Number.isFinite(w.cloudCover) ? `${Math.round(w.cloudCover)}%` : "—";
        if (probEl) probEl.textContent = Number.isFinite(w.precipProb) ? `${Math.round(w.precipProb)}%` : "—";
        if (amtEl) amtEl.textContent = Number.isFinite(w.precipIn) ? `${w.precipIn.toFixed(2)} in` : "—";
      } catch {
        const box = el.querySelector("#zee-weather");
        if (box) box.classList.add("zee-muted");
      }
    };
    tick();
    updateWeather();
    timer = window.setInterval(tick, 1000);
    weatherTimer = window.setInterval(updateWeather, 300000);
    return {
      destroy() {
        if (timer) window.clearInterval(timer);
        if (weatherTimer) window.clearInterval(weatherTimer);
      },
    };
  },
};
