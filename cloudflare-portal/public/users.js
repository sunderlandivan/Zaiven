(function () {
  "use strict";
  const { api, esc, when, ready } = window.Cloud;
  const $ = (id) => document.getElementById(id);
  let auditPage = 1;
  let timer = null;

  async function loadUsers() {
    const { users } = await api("/api/users");
    $("usersTable").innerHTML = `<thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Added</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users
      .map(
        (u) => `<tr data-email="${esc(u.email)}">
          <td>${esc(u.email)}</td><td>${esc(u.name)}</td>
          <td>${u.protected ? `<span class="role-pill role-${esc(u.role)}">${esc(u.role)}</span>` : `<select class="user-role" aria-label="Role for ${esc(u.email)}">${["viewer", "staff", "manager"].map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}</select>`}</td>
          <td>${esc(when(u.added_at))}${u.added_by && u.added_by !== "seed" ? ` by ${esc(u.added_by)}` : ""}</td>
          <td>${esc(when(u.last_login_at))}</td>
          <td>${u.protected ? '<span class="muted">owner</span>' : '<button type="button" class="subtle user-remove">Remove</button>'}</td>
        </tr>`
      )
      .join("")}</tbody>`;
  }

  async function loadAudit() {
    const q = new URLSearchParams({ page: String(auditPage), pageSize: "50", q: $("auditSearch").value.trim() });
    const r = await api(`/api/audit?${q}`);
    $("auditTable").innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Role</th><th>What</th><th>Result</th><th>Detail</th><th>IP</th></tr></thead><tbody>${
      r.entries.map((e) => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.email)}</td><td>${esc(e.role)}</td><td>${esc(e.action)}</td><td>${esc(e.status ?? "")}</td><td>${esc(e.detail)}</td><td>${esc(e.ip)}</td></tr>`).join("") || '<tr><td colspan="7" class="empty-cell">Nothing logged yet.</td></tr>'
    }</tbody>`;
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    $("auditPager").innerHTML = `<button type="button" class="subtle" data-page="${auditPage - 1}" ${auditPage <= 1 ? "disabled" : ""}>Newer</button><span class="muted">Page ${auditPage} of ${pages} · ${r.total} entries</span><button type="button" class="subtle" data-page="${auditPage + 1}" ${auditPage >= pages ? "disabled" : ""}>Older</button>`;
  }

  async function loadSessions() {
    const r = await api("/api/sessions");
    $("sessionsHelp").textContent = `Sessions end after ${r.sessionHours} hours, or after ${r.idleMinutes} minutes without activity. "Sign out everyone" ends every session, yours included.`;
    $("sessionsTable").innerHTML = `<thead><tr><th>Who</th><th>Signed in</th><th>Last active</th><th>IP</th><th>Country</th><th>Browser</th><th></th></tr></thead><tbody>${
      r.sessions
        .map(
          (s) => `<tr><td>${esc(s.email)}</td><td>${esc(when(s.created_at))}</td><td>${esc(when(s.last_seen_at))}</td><td>${esc(s.ip)}</td><td>${esc(s.country)}</td><td>${esc(s.ua.slice(0, 60))}</td>
            <td><button type="button" class="subtle session-revoke" data-email="${esc(s.email)}">Sign out ${esc(s.email.split("@")[0])}</button></td></tr>`
        )
        .join("") || '<tr><td colspan="7" class="empty-cell">No active sessions.</td></tr>'
    }</tbody>`;
  }

  async function revoke(email) {
    try {
      const r = await api("/api/sessions/revoke", { method: "POST", body: JSON.stringify(email ? { email } : {}) });
      $("sessionsOut").textContent = `Ended ${r.revoked} session(s).`;
    } catch (e) {
      $("sessionsOut").textContent = e.message;
    }
    await Promise.all([loadSessions(), loadAudit()]).catch(() => {});
  }

  $("signOutAll").addEventListener("click", () => {
    if (confirm("Sign out everyone, including you? Everyone has to sign in with Google again.")) revoke("");
  });
  $("sessionsReload").addEventListener("click", () => loadSessions().catch((e) => ($("sessionsOut").textContent = e.message)));
  $("sessionsTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".session-revoke");
    if (btn && confirm(`Sign out every session of ${btn.dataset.email}?`)) revoke(btn.dataset.email);
  });

  async function save(email, role, name) {
    try {
      const { user } = await api("/api/users", { method: "POST", body: JSON.stringify({ email, role, name }) });
      $("userOut").textContent = `${user.created ? "Added" : "Updated"} ${user.email} as ${user.role}.`;
    } catch (e) {
      $("userOut").textContent = e.message;
    }
    await Promise.all([loadUsers(), loadAudit()]);
  }

  $("userForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    save(String(f.get("email")), String(f.get("role")), String(f.get("name") || "")).then(() => e.target.reset());
  });
  $("usersTable").addEventListener("change", (e) => {
    const sel = e.target.closest(".user-role");
    if (!sel) return;
    const tr = sel.closest("tr");
    save(tr.dataset.email, sel.value, tr.children[1].textContent);
  });
  $("usersTable").addEventListener("click", async (e) => {
    const btn = e.target.closest(".user-remove");
    if (!btn) return;
    const email = btn.closest("tr").dataset.email;
    if (!confirm(`Remove ${email}? They lose access immediately.`)) return;
    try {
      await api(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
      $("userOut").textContent = `Removed ${email}.`;
    } catch (err) {
      $("userOut").textContent = err.message;
    }
    await Promise.all([loadUsers(), loadAudit()]);
  });
  $("auditSearch").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((auditPage = 1), loadAudit()), 250);
  });
  $("auditReload").addEventListener("click", () => loadAudit());
  $("auditPager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) (auditPage = Number(b.dataset.page)), loadAudit();
  });
  ready.then(() => Promise.all([loadUsers(), loadAudit(), loadSessions()]).catch((e) => ($("userOut").textContent = e.message)));
})();
