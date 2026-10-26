async function getStatus() {
  const res = await fetch("/api/zee/home-network/status");
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "status failed");
  return j.data;
}

async function getDevices() {
  const res = await fetch("/api/zee/home-network/devices");
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "devices failed");
  return j;
}

async function postSpeedTest(force) {
  const res = await fetch("/api/zee/home-network/speed-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "speed test failed");
  return j;
}

async function postDeviceAllow(mac, allow) {
  const res = await fetch("/api/zee/home-network/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mac, allow }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "device update failed");
  return j;
}

/** Pill ON/OFF switch (replaces checkbox). */
function netToggleHtml(mac, allowed, disabled, title) {
  const on = allowed ? "true" : "false";
  const cls = allowed ? " zee-hn-toggle--on" : "";
  const dis = disabled ? " disabled" : "";
  const ti = title ? ` title="${escapeAttr(title)}"` : "";
  const label = `Internet for ${mac}`;
  return `<button type="button" class="zee-hn-toggle${cls}" role="switch" aria-checked="${on}" aria-label="${escapeAttr(
    label
  )}" data-mac="${escapeAttr(mac)}"${dis}${ti}>
      <span class="zee-hn-toggle-track">
        <span class="zee-hn-toggle-on" aria-hidden="true">ON</span>
        <span class="zee-hn-toggle-knob" aria-hidden="true"></span>
        <span class="zee-hn-toggle-off" aria-hidden="true">OFF</span>
      </span>
    </button>`;
}

export const homeNetworkModule = {
  id: "home-network",
  title: "Home network",
  mount(el) {
    el.innerHTML = `
      <div class="zee-home-net" id="zee-home-net-root">
        <div class="zee-home-net-row"><span class="zee-muted">WAN</span><strong id="zee-hn-wan">—</strong></div>
        <div class="zee-home-net-row"><span class="zee-muted">Down</span><strong id="zee-hn-dl">—</strong></div>
        <div class="zee-home-net-actions">
          <button type="button" class="zee-btn zee-btn-sm" id="zee-hn-speed">Speed test</button>
        </div>
        <div class="zee-home-net-dev" id="zee-hn-dev"></div>
        <p class="zee-muted zee-home-net-foot" id="zee-hn-hint"></p>
      </div>
    `;
    const wanEl = el.querySelector("#zee-hn-wan");
    const dlEl = el.querySelector("#zee-hn-dl");
    const devEl = el.querySelector("#zee-hn-dev");
    const hintEl = el.querySelector("#zee-hn-hint");

    const render = async () => {
      try {
        const st = await getStatus();
        if (wanEl) {
          wanEl.textContent = st.internetOk ? `${st.internetLatencyMs ?? "?"} ms` : "Down";
          wanEl.className = st.internetOk ? "zee-up" : "zee-down";
        }
        const sp = st.speed;
        if (dlEl) {
          dlEl.textContent =
            sp?.downloadMbps != null
              ? `${sp.downloadMbps} Mbps`
              : "—";
          dlEl.className = "";
        }
        if (hintEl) {
          hintEl.textContent = st.routerConfigured
            ? "Router SOAP: LAN only. Access control must stay enabled on the Nighthawk."
            : "Set ZEE_NETGEAR_PASSWORD (+ optional ZEE_NETGEAR_SOAP_URL) on the PC running Node to toggle devices.";
        }

        let dj = { ok: false, router: false, targets: st.targets || [], merged: [] };
        try {
          dj = await getDevices();
        } catch (err) {
          dj = {
            ok: false,
            router: Boolean(st.routerConfigured),
            error: String(err.message || err),
            targets: st.targets || [],
            merged: [],
          };
        }
        if (hintEl && dj.error) {
          hintEl.textContent = `Router busy/unreachable (${dj.error}). Desired allow/block is saved and will apply when SOAP is back.`;
        }
        if (devEl) {
          if (dj.router && !dj.ok && !(dj.merged || []).length) {
            devEl.innerHTML = `<div class="zee-err">${escapeHtml(dj.error || "Router unreachable")}</div>`;
            return;
          }
          if (!dj.router) {
            devEl.innerHTML = (dj.targets || [])
              .map(
                (t) => `
              <div class="zee-home-net-target" data-mac="${escapeAttr(t.mac)}">
                <div class="zee-home-net-target-meta">
                  <span class="zee-home-net-name">${escapeHtml(t.label)}</span>
                  <span class="zee-muted">${escapeHtml(t.ip || "")}</span>
                </div>
                ${netToggleHtml(t.mac, true, true, "Configure router env on server")}
              </div>`
              )
              .join("");
            return;
          }
          const merged = dj.merged || [];
          devEl.innerHTML = merged
            .map((t) => {
              const allowed = t.desiredAllow !== false && (t.allowOrBlock || "Allow") !== "Block";
              const onRouter = t.onRouter;
              const pending = Boolean(t.pending) && !allowed;
              const note = !onRouter
                ? pending
                  ? `<span class="zee-err">blocked when it reconnects</span>`
                  : `<span class="zee-err">off LAN?</span>`
                : pending
                  ? `<span class="zee-err">blocking…</span>`
                  : "";
              return `
              <div class="zee-home-net-target" data-mac="${escapeAttr(t.mac)}">
                <div class="zee-home-net-target-meta">
                  <span class="zee-home-net-name">${escapeHtml(t.routerName || t.label)}</span>
                  <span class="zee-muted">${escapeHtml(t.routerIp || t.ip || "")}</span>
                  ${note}
                </div>
                ${netToggleHtml(t.mac, allowed, false, onRouter ? "" : "Not on LAN now — toggle still saved and applied when it reconnects")}
              </div>`;
            })
            .join("");

          devEl.querySelectorAll("button.zee-hn-toggle:not([disabled])").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const mac = String(btn.getAttribute("data-mac") || "");
              const wasOn = btn.classList.contains("zee-hn-toggle--on");
              const next = !wasOn;
              btn.setAttribute("disabled", "true");
              btn.classList.toggle("zee-hn-toggle--on", next);
              btn.setAttribute("aria-checked", next ? "true" : "false");
              try {
                await postDeviceAllow(mac, next);
              } catch (err) {
                btn.classList.toggle("zee-hn-toggle--on", wasOn);
                btn.setAttribute("aria-checked", wasOn ? "true" : "false");
                alert(String(err.message || err));
              } finally {
                btn.removeAttribute("disabled");
              }
            });
          });
        }
      } catch (e) {
        if (wanEl) wanEl.textContent = "Err";
        if (hintEl) hintEl.textContent = String(e.message || e);
      }
    };

    el.querySelector("#zee-hn-speed")?.addEventListener("click", async () => {
      const btn = el.querySelector("#zee-hn-speed");
      if (btn) btn.setAttribute("disabled", "true");
      try {
        await postSpeedTest(true);
        await render();
      } catch (err) {
        alert(String(err.message || err));
      } finally {
        btn?.removeAttribute("disabled");
      }
    });

    render();
    const id = window.setInterval(render, 45_000);
    return { destroy: () => window.clearInterval(id) };
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
