(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  function setStatus(text) {
    const el = $("physStatus");
    if (el) el.textContent = text || "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function kpi(label, value) {
    return `<div class="dashboard-kpi"><div class="dashboard-kpi-label">${esc(label)}</div><div class="dashboard-kpi-value">${esc(value)}</div></div>`;
  }

  function render(report) {
    const s = report.summary || {};
    $("physKpis").innerHTML = [
      kpi("Walkthrough", report.walkthroughStatus || "—"),
      kpi("Compared", report.comparedAt ? new Date(report.comparedAt).toLocaleString() : "—"),
      kpi("Unchanged SKUs", report.unchanged ?? "—"),
      kpi("Changed SKUs", report.changed ?? "—"),
      kpi("Soft open", `${s.stillOpenSkus ?? 0} SKUs / ${s.stillOpenUnits ?? 0} units`),
      kpi("New PIDs", s.newPidSkus ?? 0),
    ].join("");

    $("physNote").textContent =
      "Sheet is warehouse truth. Soft lines are baseline drops not fully explained by post-count sales or known reclasses. FIN Play soft gap remains the main mid-size leftover.";

    const openBody = (report.stillOpen || [])
      .map(
        (r) => `<tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.pid || "—")}</td>
        <td>${esc(r.before)}</td>
        <td>${esc(r.after)}</td>
        <td>${esc(r.delta)}</td>
        <td>${esc(r.softShortage)}</td>
        <td>${esc(r.note || r.kind || "")}</td>
      </tr>`
      )
      .join("");
    $("physOpenTable").querySelector("tbody").innerHTML = openBody || `<tr><td colspan="7">None</td></tr>`;

    const raiseBody = (report.raises || [])
      .map(
        (r) => `<tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.pid || "—")}</td>
        <td>${esc(r.before)}</td>
        <td>${esc(r.after)}</td>
        <td>${esc(r.delta)}</td>
        <td>${esc(r.note || r.kind || "")}</td>
      </tr>`
      )
      .join("");
    $("physRaiseTable").querySelector("tbody").innerHTML = raiseBody || `<tr><td colspan="6">None</td></tr>`;

    const newBody = (report.newPids || [])
      .map(
        (r) => `<tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.pid)}</td>
        <td>${esc(r.qty)}</td>
      </tr>`
      )
      .join("");
    $("physNewTable").querySelector("tbody").innerHTML = newBody || `<tr><td colspan="3">None</td></tr>`;
  }

  async function load(refresh) {
    setStatus(refresh ? "Re-comparing sheet…" : "Loading…");
    try {
      const q = refresh ? "?refresh=1" : "";
      const { data } = await api(`/api/physical-inventory${q}`);
      render(data);
      setStatus(refresh ? "Sheet re-compared." : "Ready.");
    } catch (e) {
      setStatus(e.message || String(e));
    }
  }

  $("physReloadBtn")?.addEventListener("click", () => load(false));
  $("physRefreshBtn")?.addEventListener("click", () => load(true));
  load(false);
})();
