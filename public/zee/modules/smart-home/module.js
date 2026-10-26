async function fetchDevices(force) {
  const res = await fetch(`/api/zee/smart-home/devices${force ? "?refresh=1" : ""}`);
  return res.json();
}

async function fetchStatus() {
  const res = await fetch("/api/zee/smart-home/status");
  return res.json();
}

async function postSwitch(deviceId, on) {
  const res = await fetch("/api/zee/smart-home/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, on }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "switch failed");
  return j;
}

async function startOauthConnect() {
  const res = await fetch("/api/zee/smart-home/oauth/start");
  const j = await res.json();
  if (!j.ok || !j.authUrl) throw new Error(j.error || "Could not start OAuth.");
  window.open(j.authUrl, "_blank", "noopener");
}

async function pasteOauthCallback(urlOrCode) {
  const res = await fetch("/api/zee/smart-home/oauth/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: urlOrCode }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "Could not finish OAuth.");
  return j;
}

async function disconnectOauth() {
  const res = await fetch("/api/zee/smart-home/oauth/disconnect", { method: "POST" });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "disconnect failed");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

const HIDDEN_DEVICE_KEYS = new Set(["home hub", "alexa", "amazon-echoshow", "amazon echo show"]);
const PINNED_DEVICE_ORDER = ["den corner", "office corner", "porch", "tree", "christmas", "dryerz", "washerz", "fridge"];
const INFO_ONLY_DEVICE_KEYS = new Set(["dryerz", "washerz", "fridge"]);

function normalizeLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ");
}

function displayLabel(label) {
  const normalized = normalizeLabel(label);
  if (normalized === "office corner" || normalized === "officer corner") return "Office Corner";
  return String(label || "Device");
}

function rankByPinnedOrder(label) {
  const n0 = normalizeLabel(label);
  const n = n0 === "officer corner" ? "office corner" : n0;
  const idx = PINNED_DEVICE_ORDER.indexOf(n);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function buildInfoOnlyText(device) {
  const name = normalizeLabel(device?.label);
  const telemetry = device?.telemetry || {};
  if (name === "dryerz") {
    const remaining = telemetry.dryerRemaining || telemetry.washerRemaining;
    const state = telemetry.dryerState || telemetry.washerState;
    return remaining
      ? `Cycle time remaining: ${remaining}`
      : `No cycle time detected${state ? ` (${state})` : ""}.`;
  }
  if (name === "washerz") {
    const remaining = telemetry.washerRemaining || telemetry.dryerRemaining;
    const state = telemetry.washerState || telemetry.dryerState;
    return remaining
      ? `Wash time remaining: ${remaining}`
      : `No wash cycle detected${state ? ` (${state})` : ""}.`;
  }
  if (name === "fridge") {
    return "Camera available on demand.";
  }
  return "Status only.";
}

function toggleHtml(deviceId, on, disabled, title) {
  const cls = on ? " zee-hn-toggle--on" : "";
  const dis = disabled ? " disabled" : "";
  const t = title ? ` title="${escapeAttr(title)}"` : "";
  return `<button type="button" class="zee-hn-toggle${cls}" role="switch" aria-checked="${
    on ? "true" : "false"
  }" data-device="${escapeAttr(deviceId)}"${dis}${t}>
      <span class="zee-hn-toggle-track">
        <span class="zee-hn-toggle-on" aria-hidden="true">ON</span>
        <span class="zee-hn-toggle-knob" aria-hidden="true"></span>
        <span class="zee-hn-toggle-off" aria-hidden="true">OFF</span>
      </span>
    </button>`;
}

export const smartHomeModule = {
  id: "smart-home",
  title: "Smart home",
  mount(el) {
    el.innerHTML = `
      <div class="zee-smart">
        <div class="zee-smart-toolbar">
          <button type="button" class="zee-btn zee-btn-sm" id="zee-smart-refresh">Refresh</button>
          <span class="zee-muted zee-smart-status" id="zee-smart-status"></span>
          <span class="zee-smart-auth" id="zee-smart-auth"></span>
        </div>
        <ul class="zee-smart-list" id="zee-smart-list"></ul>
        <p class="zee-muted zee-smart-foot" id="zee-smart-foot"></p>
      </div>
    `;
    const listEl = el.querySelector("#zee-smart-list");
    const statusEl = el.querySelector("#zee-smart-status");
    const authEl = el.querySelector("#zee-smart-auth");
    const footEl = el.querySelector("#zee-smart-foot");

    const wireConnectFlow = () => {
      authEl.querySelector("#zee-smart-connect")?.addEventListener("click", async () => {
        try {
          await startOauthConnect();
        } catch (e) {
          alert(String(e.message || e));
        }
      });
      authEl.querySelector("#zee-smart-finish")?.addEventListener("click", async () => {
        const input = /** @type {HTMLInputElement|null} */ (
          authEl.querySelector("#zee-smart-paste")
        );
        const v = input?.value?.trim();
        if (!v) {
          alert("Paste the full URL from your browser bar (https://httpbin.org/get?code=...&state=...).");
          return;
        }
        const btn = /** @type {HTMLButtonElement} */ (authEl.querySelector("#zee-smart-finish"));
        btn.disabled = true;
        btn.textContent = "...";
        try {
          await pasteOauthCallback(v);
          if (input) input.value = "";
          await render(true);
        } catch (e) {
          alert(String(e.message || e));
        } finally {
          btn.disabled = false;
          btn.textContent = "Finish";
        }
      });
    };

    const renderAuth = (status) => {
      if (!authEl) return;
      const auth = status?.auth;
      if (auth === "oauth") {
        authEl.innerHTML = `<span class="zee-smart-pill zee-smart-pill--ok" title="Long-lived OAuth refresh token; auto-renews.">OAuth\u00a0\u2713</span>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-smart-disconnect">Disconnect</button>`;
        authEl.querySelector("#zee-smart-disconnect")?.addEventListener("click", async () => {
          if (!confirm("Disconnect SmartThings OAuth? You'll fall back to the 24h PAT (if set).")) return;
          try {
            await disconnectOauth();
            await render(true);
          } catch (e) {
            alert(String(e.message || e));
          }
        });
      } else if (auth === "pat" || auth === "oauth-pending") {
        const pillHtml =
          auth === "pat"
            ? `<span class="zee-smart-pill zee-smart-pill--warn" title="Using 24h Personal Access Token. Switch to OAuth to stop expiring.">PAT\u00a0\u26a0</span>`
            : "";
        authEl.innerHTML = `${pillHtml}
          <button type="button" class="zee-btn zee-btn-xs" id="zee-smart-connect">1. Authorize</button>
          <input type="text" id="zee-smart-paste" class="zee-smart-paste" placeholder="2. Paste callback URL here" />
          <button type="button" class="zee-btn zee-btn-xs" id="zee-smart-finish">Finish</button>`;
        wireConnectFlow();
      } else {
        authEl.innerHTML = "";
      }
    };

    const renderHint = (data, status) => {
      if (!footEl) return;
      if (!data?.configured) {
        footEl.innerHTML =
          'Set <code>ZEE_SMARTTHINGS_TOKEN</code> (24h PAT) or configure OAuth (<code>ZEE_SMARTTHINGS_CLIENT_ID</code> + <code>_SECRET</code> + <code>_REDIRECT_URI</code>) for non-expiring access. PATs from <a href="https://account.smartthings.com/tokens" target="_blank" rel="noopener">account.smartthings.com/tokens</a>; OAuth via <code>smartthings apps:create</code>.';
        return;
      }
      const isOauth = status?.auth === "oauth";
      if (isOauth) {
        footEl.innerHTML =
          'Voice: say "Zee, turn off &lt;device name&gt;". Auth: OAuth (auto-refreshes; never expires while server runs).';
        return;
      }
      footEl.innerHTML =
        'To never refresh again: <strong>1.</strong> click <strong>Authorize</strong> (opens SmartThings in a new tab) <strong>2.</strong> sign in &amp; approve. You\u2019ll land on <code>httpbin.org/get?code=\u2026&amp;state=\u2026</code>. <strong>3.</strong> Copy the full URL from the browser bar, paste it above, click <strong>Finish</strong>.';
    };

    const render = async (force) => {
      try {
        const [data, status] = await Promise.all([
          fetchDevices(Boolean(force)),
          fetchStatus().catch(() => ({})),
        ]);
        if (statusEl) {
          if (!data.ok && data.configured) statusEl.textContent = data.error || "Error";
          else if (!data.configured) statusEl.textContent = "not configured";
          else {
            const all = Array.isArray(data.devices) ? data.devices : [];
            const visible = all.filter((d) => !HIDDEN_DEVICE_KEYS.has(normalizeLabel(d?.label)));
            const sw = visible.filter((d) => d.switchable !== false && !INFO_ONLY_DEVICE_KEYS.has(normalizeLabel(d?.label))).length;
            statusEl.textContent =
              sw === visible.length
                ? `${visible.length} switchable`
                : `${sw} switchable / ${visible.length} total`;
          }
        }
        renderAuth(status);
        renderHint(data, status);
        if (!listEl) return;
        if (!data.configured) {
          listEl.innerHTML = "";
          return;
        }
        if (!data.ok) {
          listEl.innerHTML = `<li class="zee-err">${escapeHtml(data.error || "SmartThings failed")}</li>`;
          return;
        }
        const devices = (Array.isArray(data.devices) ? data.devices : [])
          .filter((d) => !HIDDEN_DEVICE_KEYS.has(normalizeLabel(d?.label)))
          .sort((a, b) => {
            const rankA = rankByPinnedOrder(a?.label);
            const rankB = rankByPinnedOrder(b?.label);
            if (rankA !== rankB) return rankA - rankB;
            return displayLabel(a?.label).localeCompare(displayLabel(b?.label));
          });
        const hasOfficeCorner = devices.some((d) => {
          const n = normalizeLabel(d?.label);
          return n === "office corner" || n === "officer corner";
        });
        if (!hasOfficeCorner) {
          devices.unshift({
            id: "alexa-app:office-corner-placeholder",
            label: "Office Corner",
            on: null,
            switchable: false,
            source: "alexa-app",
            readOnlyReason: "Office Corner not yet discovered from SmartThings/Alexa API source.",
          });
        }
        if (!devices.length) {
          listEl.innerHTML = `<li class="zee-muted">No switchable devices found in your SmartThings location.</li>`;
          return;
        }
        listEl.innerHTML = devices
          .map((d) => {
            const deviceLabel = displayLabel(d.label);
            const infoOnly = INFO_ONLY_DEVICE_KEYS.has(normalizeLabel(d?.label));
            const switchable = !infoOnly && d.switchable !== false;
            const trail = infoOnly
              ? `<div class="zee-smart-device-info">
                  <div class="zee-smart-device-info-text">${escapeHtml(buildInfoOnlyText(d))}</div>
                  ${
                    normalizeLabel(d?.label) === "fridge"
                      ? '<button type="button" class="zee-btn zee-btn-xs" data-fridge-camera="1">Open camera</button>'
                      : ""
                  }
                </div>`
              : toggleHtml(
                  d.id,
                  Boolean(d.on),
                  !switchable,
                  switchable
                    ? ""
                    : "Read-only device in this module (no switch capability available)."
                );
            return `
            <li class="zee-smart-row">
              <div class="zee-smart-row-meta">
                <span class="zee-smart-name">${escapeHtml(deviceLabel)}</span>
              </div>
              ${trail}
            </li>`;
          })
          .join("");

        listEl.querySelectorAll("button.zee-hn-toggle:not([disabled])").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const deviceId = String(btn.getAttribute("data-device") || "");
            const wasOn = btn.classList.contains("zee-hn-toggle--on");
            const next = !wasOn;
            btn.setAttribute("disabled", "true");
            btn.classList.toggle("zee-hn-toggle--on", next);
            btn.setAttribute("aria-checked", next ? "true" : "false");
            try {
              await postSwitch(deviceId, next);
            } catch (err) {
              btn.classList.toggle("zee-hn-toggle--on", wasOn);
              btn.setAttribute("aria-checked", wasOn ? "true" : "false");
              alert(String(err.message || err));
            } finally {
              btn.removeAttribute("disabled");
            }
          });
        });
        listEl.querySelectorAll("button[data-fridge-camera='1']").forEach((btn) => {
          btn.addEventListener("click", () => {
            const fridgeCamUrl = String(window.localStorage.getItem("zee.fridgeCameraUrl") || "").trim();
            if (!fridgeCamUrl) {
              alert("Set fridge camera URL in localStorage key: zee.fridgeCameraUrl");
              return;
            }
            window.open(fridgeCamUrl, "_blank", "noopener");
          });
        });
      } catch (e) {
        if (listEl) listEl.innerHTML = `<li class="zee-err">${escapeHtml(String(e.message || e))}</li>`;
      }
    };

    el.querySelector("#zee-smart-refresh")?.addEventListener("click", () => render(true));
    render();
    const id = window.setInterval(() => render(false), 30_000);
    return { destroy: () => window.clearInterval(id) };
  },
};
