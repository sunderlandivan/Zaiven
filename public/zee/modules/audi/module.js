function milesFromKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return null;
  return n * 0.621371;
}

function fmtNum(n, digits = 0) {
  if (!Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtPct(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))}%`;
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderAccessRows(rows) {
  if (!rows || !rows.length) return "";
  return rows
    .map(
      (r) =>
        `<div class="zee-audi-access-row"><span>${escAttr(r.label)}</span><span>${escAttr(r.states)}</span></div>`
    )
    .join("");
}

export const audiModule = {
  id: "audi",
  title: "Vehicle — Audi",
  mount(el) {
    el.innerHTML = `
      <div class="zee-audi">
        <div class="zee-audi-toolbar">
          <span class="zee-audi-status zee-dim" data-role="conn">Audi Connect: checking…</span>
          <span class="zee-audi-toolbar-spacer"></span>
          <button type="button" class="zee-btn zee-btn-ghost" data-action="locate">Locate</button>
          <button type="button" class="zee-btn" data-action="signin">Sign in</button>
          <button type="button" class="zee-btn zee-btn-ghost" data-action="refresh">Refresh</button>
          <button type="button" class="zee-btn zee-btn-ghost" data-action="logout">Sign out</button>
        </div>
        <div class="zee-audi-visual-frame">
          <img
            src="/api/zee/audi/image"
            alt="Audi render"
            class="zee-audi-photo zee-audi-photo-cutout"
            loading="lazy"
            onerror="this.onerror=null;this.src='/zee/assets/audi.svg';this.classList.add('zee-audi-fallback');"
          />
        </div>
        <div class="zee-audi-stats zee-audi-stats-primary">
          <div class="zee-stat">
            <span class="zee-stat-label">Odometer</span>
            <span class="zee-stat-value" data-role="odo">—</span>
          </div>
          <div class="zee-stat">
            <span class="zee-stat-label">Fuel level</span>
            <span class="zee-stat-value" data-role="fuelpct">—</span>
          </div>
          <div class="zee-stat">
            <span class="zee-stat-label">Fuel range</span>
            <span class="zee-stat-value" data-role="fuelrange">—</span>
          </div>
        </div>
        <div class="zee-audi-model zee-dim" data-role="model"></div>
        <div class="zee-audi-access-wrap" data-role="access-wrap" hidden>
          <div class="zee-audi-access-section" data-role="sec-doors" hidden>
            <div class="zee-audi-access-h">Doors · hood · tailgate</div>
            <div class="zee-audi-access" data-role="doors"></div>
          </div>
          <div class="zee-audi-access-section" data-role="sec-windows" hidden>
            <div class="zee-audi-access-h">Windows · roof</div>
            <div class="zee-audi-access" data-role="windows"></div>
          </div>
          <div class="zee-audi-access-section" data-role="sec-lights" hidden>
            <div class="zee-audi-access-h">Lights</div>
            <div class="zee-audi-access" data-role="lights"></div>
          </div>
        </div>
        <div class="zee-audi-stats zee-audi-stats-secondary">
          <div class="zee-stat">
            <span class="zee-stat-label">Powertrain</span>
            <span class="zee-stat-value zee-dim">Gasoline telemetry</span>
          </div>
          <div class="zee-stat">
            <span class="zee-stat-label">Location</span>
            <span class="zee-stat-value zee-dim" data-role="loc">—</span>
          </div>
        </div>
        <div class="zee-audi-foot zee-dim" data-role="hint"></div>
      </div>
    `;

    const connEl = el.querySelector('[data-role="conn"]');
    const modelEl = el.querySelector('[data-role="model"]');
    const odoEl = el.querySelector('[data-role="odo"]');
    const fuelPctEl = el.querySelector('[data-role="fuelpct"]');
    const fuelRangeEl = el.querySelector('[data-role="fuelrange"]');
    const hintEl = el.querySelector('[data-role="hint"]');
    const locEl = el.querySelector('[data-role="loc"]');
    const accessWrap = el.querySelector('[data-role="access-wrap"]');
    const secDoors = el.querySelector('[data-role="sec-doors"]');
    const secWindows = el.querySelector('[data-role="sec-windows"]');
    const secLights = el.querySelector('[data-role="sec-lights"]');
    const doorsEl = el.querySelector('[data-role="doors"]');
    const windowsEl = el.querySelector('[data-role="windows"]');
    const lightsEl = el.querySelector('[data-role="lights"]');

    let pollTimer = null;

    async function refreshStatus() {
      try {
        const res = await fetch("/api/zee/audi/connect/status");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "status failed");
        const bits = [];
        bits.push(j.connected ? "linked" : "not linked");
        if (j.country) bits.push(String(j.country));
        if (j.vinConfigured && j.vin) bits.push(`VIN ${j.vin}`);
        connEl.textContent = `Audi Connect: ${bits.join(" · ")}`;
        connEl.classList.toggle("zee-dim", !j.connected);
        return j;
      } catch (e) {
        connEl.textContent = `Audi Connect: error (${String(e.message || e)})`;
        connEl.classList.add("zee-dim");
        return { connected: false };
      }
    }

    function applyVehicle(data) {
      if (!data) {
        modelEl.textContent = "";
        odoEl.textContent = "—";
        fuelPctEl.textContent = "—";
        fuelRangeEl.textContent = "—";
        if (accessWrap) accessWrap.hidden = true;
        return;
      }
      const labelParts = [];
      if (data.nickname) labelParts.push(data.nickname);
      if (data.model) labelParts.push(data.model);
      if (data.modelYear) labelParts.push(String(data.modelYear));
      if (data.vin) labelParts.push(data.vin);
      modelEl.textContent = labelParts.join(" · ");

      const mi = milesFromKm(data.odometerKm);
      odoEl.textContent = mi != null ? `${fmtNum(mi, 0)} mi (${fmtNum(data.odometerKm, 0)} km)` : "—";

      fuelPctEl.textContent = fmtPct(data.fuelPct);

      const fuelMi = milesFromKm(data.fuelRangeKm);
      fuelRangeEl.textContent =
        fuelMi != null ? `${fmtNum(fuelMi, 0)} mi (${fmtNum(data.fuelRangeKm, 0)} km)` : "—";

      const ax = data.access;
      const doorRows = Array.isArray(ax?.doors) ? ax.doors : [];
      const winRows = Array.isArray(ax?.windows) ? ax.windows : [];
      const lightRows = Array.isArray(ax?.lights) ? ax.lights : [];
      const hasAccess = doorRows.length + winRows.length + lightRows.length > 0;
      if (accessWrap && doorsEl && windowsEl && lightsEl && secDoors && secWindows && secLights) {
        if (!hasAccess) {
          accessWrap.hidden = true;
        } else {
          accessWrap.hidden = false;
          doorsEl.innerHTML = renderAccessRows(doorRows);
          windowsEl.innerHTML = renderAccessRows(winRows);
          lightsEl.innerHTML = renderAccessRows(lightRows);
          secDoors.hidden = doorRows.length === 0;
          secWindows.hidden = winRows.length === 0;
          secLights.hidden = lightRows.length === 0;
        }
      }
    }

    async function refreshVehicle() {
      hintEl.textContent = "";
      try {
        const res = await fetch("/api/zee/audi/connect/vehicle");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "vehicle failed");
        applyVehicle(j.data);
      } catch (e) {
        applyVehicle(null);
        const msg = String(e.message || e);
        hintEl.textContent =
          /\(401\)|\(403\)|\b401\b|\b403\b/.test(msg) && !msg.includes("refresh")
            ? `${msg} Try Refresh; if it persists, Sign out then Sign in.`
            : msg;
      }
    }

    async function fullRefresh() {
      const st = await refreshStatus();
      if (st.connected) await refreshVehicle();
      else {
        applyVehicle(null);
        hintEl.textContent = "Sign in with myAudi credentials, or set ZEE_AUDI_EMAIL / ZEE_AUDI_PASSWORD in User env and use Sign in.";
      }
    }

    async function locateVehicle() {
      if (locEl) locEl.textContent = "Locating...";
      try {
        const res = await fetch("/api/zee/audi/location");
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "location failed");
        const lat = Number(j.latitude);
        const lon = Number(j.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("No coordinates");
        if (locEl) locEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} (${j.provider})`;
        window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank", "noopener");
      } catch (e) {
        if (locEl) locEl.textContent = "Unavailable";
        hintEl.textContent = String(e.message || e);
      }
    }

    el.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
      fullRefresh();
    });

    el.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
      hintEl.textContent = "";
      try {
        const res = await fetch("/api/zee/audi/connect/logout", { method: "POST" });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "logout failed");
        await fullRefresh();
      } catch (e) {
        hintEl.textContent = String(e.message || e);
      }
    });

    el.querySelector('[data-action="signin"]')?.addEventListener("click", async () => {
      hintEl.textContent = "";
      const email = window.prompt("myAudi email (or cancel to use ZEE_AUDI_EMAIL env)")?.trim() || "";
      const password = window.prompt("myAudi password (or cancel to use ZEE_AUDI_PASSWORD env)") || "";
      try {
        const res = await fetch("/api/zee/audi/connect/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "login failed");
        await fullRefresh();
      } catch (e) {
        hintEl.textContent = String(e.message || e);
      }
    });
    el.querySelector('[data-action="locate"]')?.addEventListener("click", () => {
      locateVehicle();
    });

    fullRefresh();
    pollTimer = window.setInterval(fullRefresh, 120000);

    window.addEventListener(
      "zee:audi-refresh",
      () => {
        fullRefresh();
      },
      false
    );

    return {
      destroy() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = null;
      },
    };
  },
};
