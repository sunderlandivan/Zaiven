(function () {
  "use strict";
  const { api, esc, when, ready } = window.Cloud;
  const $ = (id) => document.getElementById(id);
  const card = (label, value, sub = "", bad = false) => `<div class="card"><div class="card-label">${esc(label)}</div><div class="card-value">${value}</div><div class="help ${bad ? "err" : ""}">${sub}</div></div>`;

  async function load() {
    const [s, { docs }] = await Promise.all([api("/api/status"), api("/api/docs")]);
    const sheet = s.sheet?.summary || {};
    const cronErr = s.cron?.error || s.cron?.sheetError;
    $("stCards").innerHTML = [
      card(
        "Mode",
        esc(s.lease?.mode || s.role.role),
        { active: "The cloud holds the lease: it pulls orders, writes the Sheet and pushes stock.", passive: "Active mode, but the PC portal holds the lease, so the cloud stays read-only." }[s.lease?.mode] || "Read-only. The PC portal is the active host."
      ),
      card("Last check", esc(when(s.cron?.at)), esc(cronErr || "ok"), Boolean(cronErr)),
      card("Orders waiting on the website", esc(s.kvPending?.count ?? "–"), `checked ${esc(when(s.kvPending?.at))}`),
      card("Sheet mirror", Object.entries(sheet).map(([t, v]) => `${esc(t)}: ${v.rows}`).join("<br>") || "–", `changed ${esc(when(s.sheet?.changedAt))}`),
      card("Last publish", esc(when(s.publish?.lastRunAt)), `${esc(s.publish?.lastRunBy || "PC")} ${s.publish?.lastError ? esc(s.publish.lastError) : ""}`, Boolean(s.publish?.lastError)),
      card("Sheet writes", s.sheetWrites ? "on" : "off", "used only in active mode"),
    ].join("");
    $("stMode").textContent = `Now: ${s.role.role}${s.role.since ? ` since ${when(s.role.since)}` : ""}${s.lease?.mode === "passive" ? " (passive: waiting for the lease)" : ""}.`;
    const l = s.lease?.lease || {};
    const h = s.lease?.handover;
    $("stLease").textContent = !l.present
      ? "No lease yet. The PC portal claims it on its next cycle."
      : `${l.mine ? "The cloud holds the lease" : l.holder ? `Held by ${l.holder}` : `Handed over to the ${l.host === "pc" ? "PC" : "cloud"}, not claimed yet`}; ${l.expired ? "expired" : "expires"} ${when(l.expiresAt)} (last written by ${l.by || "?"}).` +
        (h ? ` Handover to ${h.to} requested by ${h.by} ${when(h.requestedAt)}${h.pending ? ", waiting for the PC portal" : ""}.` : "");
    const activeRole = s.role.role === "active";
    $("stLeaseRequest").disabled = !activeRole || l.mine || !l.present || l.expired || Boolean(h?.pending);
    $("stLeaseCancel").disabled = !h;
    $("stLeaseTake").disabled = !activeRole || l.mine || (l.present && !l.expired && !(l.host === "cloud" && !l.holder));
    $("stLeaseRelease").disabled = !(l.mine || (l.host === "cloud" && !l.holder));
    $("stActivity").innerHTML = `<thead><tr><th>When</th><th>Kind</th><th>Message</th></tr></thead><tbody>${(s.activity || []).map((a) => `<tr><td>${esc(when(a.at))}</td><td>${esc(a.kind)}</td><td>${esc(a.message)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty-cell">Nothing yet.</td></tr>'}</tbody>`;
    $("stDocs").innerHTML = `<thead><tr><th>Doc</th><th class="num">Size</th><th>Updated</th><th>Source</th></tr></thead><tbody>${docs.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${(d.size / 1024).toFixed(1)} KB</td><td>${esc(when(d.updated_at))}</td><td>${esc(d.source)}</td></tr>`).join("")}</tbody>`;
  }

  async function run(btn, path, done) {
    btn.disabled = true;
    $("stOut").textContent = "Running…";
    try {
      const r = await api(path, { method: "POST" });
      $("stOut").textContent = done(r);
      await load();
    } catch (e) {
      $("stOut").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  $("stTick").addEventListener("click", () => run($("stTick"), "/api/cron/run", (r) => r.error || r.sheetError || "Done."));
  $("stMirror").addEventListener("click", () => run($("stMirror"), "/api/sheet-sync/mirror", (r) => (r.changed ? "Sheet changed; mirror updated." : "No changes in the Sheet.")));
  $("stShadow").addEventListener("click", async () => {
    await api("/api/role", { method: "POST", body: JSON.stringify({ role: "shadow" }) }).catch((e) => alert(e.message));
    location.reload();
  });
  $("stActive").addEventListener("click", async () => {
    const typed = prompt("Only after the PC portal is stopped. Type exactly: PC portal is stopped");
    if (typed !== "PC portal is stopped") return;
    await api("/api/role", { method: "POST", body: JSON.stringify({ role: "active", confirm: typed }) }).catch((e) => alert(e.message));
    location.reload();
  });
  async function lease(action, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    await api("/api/lease", { method: "POST", body: JSON.stringify({ action }) }).catch((e) => alert(e.message));
    await load().catch(() => {});
  }
  $("stLeaseRequest").addEventListener("click", () => lease("request"));
  $("stLeaseCancel").addEventListener("click", () => lease("cancel"));
  $("stLeaseTake").addEventListener("click", () => lease("take", "Take the lease now? Only do this if the PC portal is stopped or its lease has expired."));
  $("stLeaseRelease").addEventListener("click", () => lease("release", "Hand the lease back to the PC portal? The cloud stops pulling orders now; the PC takes over on its next cycle."));
  ready.then(() => load().catch((e) => ($("stCards").innerHTML = `<p class="err">${esc(e.message)}</p>`)));
})();
