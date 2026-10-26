/**
 * Communications module — video calling launcher.
 *
 * Two modes: quick-call buttons (Meet/Zoom/Teams) and a contact list with
 * preferred-platform call buttons. Meeting URLs open in a popup window and
 * are copied to the clipboard so you can paste them anywhere.
 */
import { fetchDevicePrefs, syncDevicesWithPermission } from "../../core/devices.js";

const PLATFORM_LABELS = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Teams",
  discord: "Discord",
};

const PLATFORM_DEFAULT_ORDER = ["meet", "zoom", "teams", "discord"];

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}

async function api(path, opts = {}) {
  const res = await fetch(`/api/zee/comm${path}`, opts);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "Request failed");
  return j;
}

async function fetchContacts() {
  return (await api("/contacts")).contacts || [];
}
async function fetchStatus() {
  return await api("/status");
}
async function quickCall(platform) {
  return (await api("/quick-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  })).link;
}
async function callContact({ contactId, name, sendEmail, platform }) {
  return await api("/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, name, sendEmail, platform }),
  });
}
async function saveContact(payload, id) {
  if (id) {
    return (await api(`/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })).contact;
  }
  return (await api("/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })).contact;
}
async function deleteContact(id) {
  await api(`/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
}
async function inviteEmail({ to, subject, body }) {
  return await api("/invite-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, body }),
  });
}
async function fetchMeetSuggestions() {
  return await api("/import-meet-suggestions");
}
async function acceptMeetSuggestions(picks) {
  return await api("/import-meet-suggestions/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ picks }),
  });
}

function renderEmpty(listEl) {
  listEl.innerHTML = `<li class="zee-comm-empty">No contacts yet. Click <strong>Add</strong> to save someone.</li>`;
}

function pillsForContact(c) {
  const order = [c.preferredPlatform, ...PLATFORM_DEFAULT_ORDER.filter((p) => p !== c.preferredPlatform)];
  return order
    .map(
      (p) =>
        `<button type="button" class="zee-comm-platform-btn ${
          p === c.preferredPlatform ? "zee-comm-platform-btn--primary" : ""
        }" data-platform="${escAttr(p)}" data-contact="${escAttr(c.id)}" title="Call ${escAttr(
          c.name
        )} via ${escAttr(PLATFORM_LABELS[p] || p)}">${escHtml(PLATFORM_LABELS[p] || p)}</button>`
    )
    .join("");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function flashStatus(statusEl, msg, ms = 2400) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  if (statusEl._zeeT) window.clearTimeout(statusEl._zeeT);
  statusEl._zeeT = window.setTimeout(() => {
    statusEl.textContent = "";
  }, ms);
}

function openContactModal({ initial, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "zee-comm-modal";
  overlay.innerHTML = `
    <div class="zee-comm-modal-card">
      <div class="zee-comm-modal-head">
        <span>${initial ? "Edit contact" : "New contact"}</span>
        <button type="button" class="zee-btn zee-btn-xs" data-action="close">Close</button>
      </div>
      <form class="zee-comm-form">
        <label>Name<input name="name" required value="${escAttr(initial?.name || "")}" /></label>
        <label>Preferred platform
          <select name="preferredPlatform">
            ${PLATFORM_DEFAULT_ORDER.map(
              (p) =>
                `<option value="${escAttr(p)}" ${
                  (initial?.preferredPlatform || "meet") === p ? "selected" : ""
                }>${escHtml(PLATFORM_LABELS[p])}</option>`
            ).join("")}
          </select>
        </label>
        <label>Email<input name="email" type="email" placeholder="for Meet & email invites" value="${escAttr(initial?.email || "")}" /></label>
        <label>Phone (optional)<input name="phone" value="${escAttr(initial?.phone || "")}" /></label>
        <label>Zoom personal URL (optional)<input name="zoomUrl" placeholder="https://zoom.us/j/..." value="${escAttr(initial?.zoomUrl || "")}" /></label>
        <label>Teams email (optional, for direct dial)<input name="teamsEmail" type="email" value="${escAttr(initial?.teamsEmail || "")}" /></label>
        <label>Discord user id (optional, for DM deep link)<input name="discordUserId" value="${escAttr(initial?.discordUserId || "")}" /></label>
        <label>Notes<input name="notes" value="${escAttr(initial?.notes || "")}" /></label>
        <div class="zee-comm-form-actions">
          <button type="submit" class="zee-btn zee-btn-sm">${initial ? "Save" : "Create"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]')?.addEventListener("click", close);
  const form = overlay.querySelector("form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    try {
      const c = await saveContact(payload, initial?.id);
      close();
      onSave?.(c);
    } catch (err) {
      alert(String(err.message || err));
    }
  });
}

function openMeetImportModal({ onImported, statusEl }) {
  const overlay = document.createElement("div");
  overlay.className = "zee-comm-modal";
  overlay.innerHTML = `
    <div class="zee-comm-modal-card zee-comm-import-card">
      <div class="zee-comm-modal-head">
        <span>Import from Meet history</span>
        <button type="button" class="zee-btn zee-btn-xs" data-action="close">Close</button>
      </div>
      <p class="zee-muted zee-comm-import-note">
        Scanning your Gmail for messages mentioning <strong>meet.google.com</strong> over the past year.
        We'll surface the people you've actually been on Meet calls with so you can add them as contacts.
      </p>
      <div class="zee-comm-import-status" id="zee-comm-import-status">Scanning…</div>
      <ul class="zee-comm-import-list" id="zee-comm-import-list"></ul>
      <div class="zee-comm-import-actions">
        <button type="button" class="zee-btn zee-btn-sm" id="zee-comm-import-all">Select all</button>
        <button type="button" class="zee-btn zee-btn-sm" id="zee-comm-import-none">Select none</button>
        <button type="button" class="zee-btn zee-btn-sm zee-comm-import-confirm" id="zee-comm-import-confirm" disabled>Import 0</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]')?.addEventListener("click", close);

  const listUl = overlay.querySelector("#zee-comm-import-list");
  const importStatus = overlay.querySelector("#zee-comm-import-status");
  const confirmBtn = /** @type {HTMLButtonElement} */ (overlay.querySelector("#zee-comm-import-confirm"));
  const selectAllBtn = overlay.querySelector("#zee-comm-import-all");
  const selectNoneBtn = overlay.querySelector("#zee-comm-import-none");

  const updateConfirmCount = () => {
    const checked = overlay.querySelectorAll("input.zee-comm-import-check:checked").length;
    confirmBtn.textContent = `Import ${checked}`;
    confirmBtn.disabled = checked === 0;
  };

  let suggestions = [];
  (async () => {
    try {
      const r = await fetchMeetSuggestions();
      suggestions = r.suggestions || [];
      if (importStatus) {
        importStatus.textContent = suggestions.length
          ? `Found ${suggestions.length} contacts across ${r.scanned} scanned emails. Select who to import.`
          : `No Meet contacts found in your Gmail history (scanned ${r.scanned} messages).`;
      }
      if (!suggestions.length) {
        confirmBtn.disabled = true;
        return;
      }
      listUl.innerHTML = suggestions
        .map(
          (s, i) => `
            <li class="zee-comm-import-row">
              <label>
                <input type="checkbox" class="zee-comm-import-check" data-idx="${i}" checked />
                <span class="zee-comm-import-name">${escHtml(s.name)}</span>
                <span class="zee-muted">${escHtml(s.email)}</span>
                <span class="zee-comm-import-meta">${s.meetCount}x</span>
              </label>
            </li>
          `
        )
        .join("");
      overlay.querySelectorAll("input.zee-comm-import-check").forEach((cb) =>
        cb.addEventListener("change", updateConfirmCount)
      );
      updateConfirmCount();
    } catch (e) {
      if (importStatus) importStatus.textContent = `Error: ${String(e.message || e)}`;
    }
  })();

  selectAllBtn?.addEventListener("click", () => {
    overlay.querySelectorAll("input.zee-comm-import-check").forEach((cb) => {
      /** @type {HTMLInputElement} */ (cb).checked = true;
    });
    updateConfirmCount();
  });
  selectNoneBtn?.addEventListener("click", () => {
    overlay.querySelectorAll("input.zee-comm-import-check").forEach((cb) => {
      /** @type {HTMLInputElement} */ (cb).checked = false;
    });
    updateConfirmCount();
  });

  confirmBtn.addEventListener("click", async () => {
    const picks = [...overlay.querySelectorAll("input.zee-comm-import-check:checked")]
      .map((cb) => Number(cb.getAttribute("data-idx")))
      .filter((i) => Number.isFinite(i))
      .map((i) => suggestions[i])
      .filter(Boolean);
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Importing…";
    try {
      const r = await acceptMeetSuggestions(picks);
      flashStatus(statusEl, `Imported ${r.total} contacts.`);
      close();
      onImported?.();
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = `Import ${picks.length}`;
      alert(String(e.message || e));
    }
  });
}

/**
 * Build (once) the in-HUD call drill-down modal that animates from the
 * Communications panel and acts as a control console while the actual call
 * runs in a separate browser window (Meet/Zoom/Teams forbid iframe embedding).
 */
function ensureCallModal(hostPanel) {
  let modal = document.getElementById("zee-call-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "zee-call-modal";
  modal.className = "zee-stock-modal zee-call-modal zee-panel-hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Active call");
  modal.innerHTML = `
    <div class="zee-stock-modal-card zee-call-modal-card" id="zee-call-modal-card">
      <div class="zee-stock-modal-head">
        <div class="zee-call-title" id="zee-call-title">Calling…</div>
        <button class="zee-btn zee-btn-sm" id="zee-call-close" type="button">End</button>
      </div>
      <div class="zee-call-body">
        <div class="zee-call-platform" id="zee-call-platform"></div>
        <label class="zee-call-url-label">Meeting link
          <input type="text" id="zee-call-url" readonly />
        </label>
        <div class="zee-call-actions">
          <button class="zee-btn zee-btn-sm" id="zee-call-launch" type="button">Open call window</button>
          <button class="zee-btn zee-btn-sm" id="zee-call-copy" type="button">Copy link</button>
          <button class="zee-btn zee-btn-sm" id="zee-call-email" type="button">Email link</button>
        </div>
        <div class="zee-call-note" id="zee-call-note"></div>
        <div class="zee-call-status" id="zee-call-status"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal._zeeHostPanel = hostPanel || null;
  // Click-outside dismisses the drill-down but leaves the call running so the
  // user can keep using the HUD. Only the End button (or voice "end call")
  // actually closes the call window.
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) hideCallModal(modal, { keepWindowOpen: true });
  });
  modal.querySelector("#zee-call-close")?.addEventListener("click", () => hideCallModal(modal));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal.classList.contains("zee-stock-modal-open")) {
      hideCallModal(modal, { keepWindowOpen: true });
    }
  });
  // Voice / external trigger to end the active call.
  window.addEventListener("zee:comm-end-call", () => hideCallModal(modal));
  return modal;
}

// Build a `window.open` features string that centers the popup on the
// current screen. Uses `screen.availLeft/availTop` so multi-monitor setups
// open the call on the same display the HUD is on, not the primary.
function buildCenteredPopupFeatures({ width = 1180, height = 760 } = {}) {
  const sw = Number(window.screen?.availWidth || window.screen?.width || 1920);
  const sh = Number(window.screen?.availHeight || window.screen?.height || 1080);
  const sl = Number(window.screen?.availLeft || 0);
  const st = Number(window.screen?.availTop || 0);
  const w = Math.min(width, Math.max(640, sw - 80));
  const h = Math.min(height, Math.max(480, sh - 80));
  const left = Math.round(sl + (sw - w) / 2);
  const top = Math.round(st + (sh - h) / 2);
  return `popup,width=${w},height=${h},left=${left},top=${top}`;
}

function hideCallModal(modal, { keepWindowOpen = false } = {}) {
  if (!modal) return;
  modal.classList.remove("zee-stock-modal-open");
  setTimeout(() => modal.classList.add("zee-panel-hidden"), 200);
  if (modal._zeeWatchInterval) {
    window.clearInterval(modal._zeeWatchInterval);
    modal._zeeWatchInterval = 0;
  }
  if (!keepWindowOpen && modal._zeeCallWindow && !modal._zeeCallWindow.closed) {
    try { modal._zeeCallWindow.close(); } catch { /* cross-origin or already gone */ }
  }
  modal._zeeCallWindow = null;
}

function showCallModal(modal, payload) {
  const { link, contact, hostPanel } = payload;
  const title = modal.querySelector("#zee-call-title");
  const platformEl = modal.querySelector("#zee-call-platform");
  const urlEl = /** @type {HTMLInputElement} */ (modal.querySelector("#zee-call-url"));
  const noteEl = modal.querySelector("#zee-call-note");
  const statusEl = modal.querySelector("#zee-call-status");
  const launchBtn = modal.querySelector("#zee-call-launch");
  const copyBtn = modal.querySelector("#zee-call-copy");
  const emailBtn = modal.querySelector("#zee-call-email");

  const platformLabel = PLATFORM_LABELS[link.platform] || link.platform;
  if (title) title.textContent = contact?.name ? `Calling ${contact.name}` : `${platformLabel} meeting`;
  if (platformEl) platformEl.textContent = platformLabel + (contact?.email ? ` · ${contact.email}` : "");
  if (urlEl) urlEl.value = link.url || "";
  if (noteEl) {
    const baseNote = link.instructions
      ? link.instructions
      : `${platformLabel} runs in its own window. Use the controls here to copy or email the link.`;
    const deviceHint =
      link.platform === "meet"
        ? " In Meet, click the 3-dot menu → Settings to pick EMEET SmartCam Nova 4k + AT2020USB+ once; Meet remembers your choice."
        : "";
    noteEl.textContent = baseNote + deviceHint;
  }
  if (statusEl) statusEl.textContent = "";

  // Auto-launch the call window once and remember it so we can close it later.
  // Note: NO `noopener` here — that would null out the window reference and
  // prevent us from calling .close() on it programmatically.
  const existing = modal._zeeCallWindow;
  if (existing && !existing.closed) {
    try { existing.location.href = link.url; existing.focus(); } catch { /* cross-origin */ }
  } else {
    modal._zeeCallWindow = window.open(link.url, "_blank", buildCenteredPopupFeatures());
  }

  // Watch for the user closing the popup themselves and auto-collapse the drill-down.
  if (modal._zeeWatchInterval) window.clearInterval(modal._zeeWatchInterval);
  modal._zeeWatchInterval = window.setInterval(() => {
    const w = modal._zeeCallWindow;
    if (!w || w.closed) {
      window.clearInterval(modal._zeeWatchInterval);
      modal._zeeWatchInterval = 0;
      hideCallModal(modal, { keepWindowOpen: true });
    }
  }, 800);

  // Copy to clipboard.
  copyToClipboard(link.url).then((ok) => {
    if (statusEl) statusEl.textContent = ok ? "Link copied to clipboard." : "Could not copy link automatically.";
  });

  // Wire buttons (replace previous handlers on each show).
  launchBtn?.replaceWith(launchBtn.cloneNode(true));
  copyBtn?.replaceWith(copyBtn.cloneNode(true));
  emailBtn?.replaceWith(emailBtn.cloneNode(true));
  modal.querySelector("#zee-call-launch")?.addEventListener("click", () => {
    if (modal._zeeCallWindow && !modal._zeeCallWindow.closed) {
      try { modal._zeeCallWindow.focus(); return; } catch { /* fallthrough to reopen */ }
    }
    modal._zeeCallWindow = window.open(link.url, "_blank", buildCenteredPopupFeatures());
  });
  modal.querySelector("#zee-call-copy")?.addEventListener("click", async () => {
    const ok = await copyToClipboard(link.url);
    if (statusEl) statusEl.textContent = ok ? "Link copied." : "Copy failed.";
  });
  const emailTo = contact?.email || "";
  if (emailTo) {
    modal.querySelector("#zee-call-email")?.addEventListener("click", async () => {
      const subject = `Quick video call: ${contact?.name || ""}`.trim();
      const body = `Hi ${contact?.name || "there"},\n\nJoin me on ${platformLabel}:\n${link.url}\n\n— Zee`;
      try {
        const r = await inviteEmail({ to: emailTo, subject, body });
        if (statusEl) {
          if (r.sent) statusEl.textContent = `Emailed ${emailTo}.`;
          else if (r.mailto) {
            window.open(r.mailto, "_blank", "noopener");
            statusEl.textContent = `Opened your mail client (Gmail send not authorized yet).`;
          } else {
            statusEl.textContent = r.error || "Email failed.";
          }
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = String(e.message || e);
      }
    });
  } else {
    const btn = modal.querySelector("#zee-call-email");
    if (btn) {
      btn.setAttribute("disabled", "true");
      btn.title = "No email on file for this contact.";
    }
  }

  // Animate in from the host panel.
  const card = modal.querySelector("#zee-call-modal-card");
  const rect = (hostPanel || modal._zeeHostPanel)?.getBoundingClientRect?.();
  const dx = rect ? rect.left + rect.width / 2 - window.innerWidth / 2 : 0;
  const dy = rect ? rect.top + rect.height / 2 - window.innerHeight / 2 : 0;
  card?.style.setProperty("--from-x", `${dx}px`);
  card?.style.setProperty("--from-y", `${dy}px`);
  modal.classList.remove("zee-panel-hidden");
  requestAnimationFrame(() => modal.classList.add("zee-stock-modal-open"));
}

/**
 * Apply a meeting link by opening the in-HUD call console (drill-down).
 */
function applyLink({ link, contact }, { statusEl, hostPanel, callModal }) {
  if (!link?.url) return;
  showCallModal(callModal, { link, contact, hostPanel });
  flashStatus(statusEl, contact?.name ? `${contact.name} — call window open` : "Call window open");
}

export const communicationsModule = {
  id: "communications",
  title: "Communications",
  mount(el) {
    el.innerHTML = `
      <div class="zee-comm">
        <div class="zee-comm-toolbar">
          <span class="zee-comm-section-label">Quick call</span>
          <button type="button" class="zee-btn zee-btn-xs zee-comm-quick" data-platform="meet">Meet</button>
          <button type="button" class="zee-btn zee-btn-xs zee-comm-quick" data-platform="zoom">Zoom</button>
          <button type="button" class="zee-btn zee-btn-xs zee-comm-quick" data-platform="teams">Teams</button>
        </div>
        <div class="zee-comm-toolbar zee-comm-toolbar--secondary">
          <span class="zee-comm-section-label">Contacts</span>
          <span class="zee-comm-status" id="zee-comm-status"></span>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-comm-add">+ Add</button>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-comm-sync" title="Scan your Gmail for past Meet invites and import attendees as contacts">Sync from Meet</button>
          <label class="zee-comm-email-toggle" title="Send the meeting URL to the contact's email when calling">
            <input type="checkbox" id="zee-comm-email" /> Email link
          </label>
        </div>
        <div class="zee-comm-devices" id="zee-comm-devices">
          <span class="zee-comm-section-label">Devices</span>
          <span class="zee-comm-device-pill" data-kind="camera">
            <span class="zee-comm-device-dot"></span>
            <span class="zee-comm-device-label">…</span>
          </span>
          <span class="zee-comm-device-pill" data-kind="microphone">
            <span class="zee-comm-device-dot"></span>
            <span class="zee-comm-device-label">…</span>
          </span>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-comm-device-sync" title="Grant camera+mic access once so Zee can match your saved devices by name">Sync devices</button>
          <button type="button" class="zee-btn zee-btn-xs" id="zee-comm-sound-settings" title="Open Windows Sound settings to set system-wide defaults">OS sound</button>
        </div>
        <ul class="zee-comm-list" id="zee-comm-list"></ul>
        <p class="zee-muted zee-comm-foot" id="zee-comm-foot"></p>
      </div>
    `;
    const listEl = /** @type {HTMLUListElement} */ (el.querySelector("#zee-comm-list"));
    const statusEl = /** @type {HTMLElement} */ (el.querySelector("#zee-comm-status"));
    const footEl = /** @type {HTMLElement} */ (el.querySelector("#zee-comm-foot"));
    const emailCheckbox = /** @type {HTMLInputElement} */ (el.querySelector("#zee-comm-email"));
    const hostPanel = el.closest(".zee-panel");
    const callModal = ensureCallModal(hostPanel);
    const devicesEl = /** @type {HTMLElement} */ (el.querySelector("#zee-comm-devices"));
    const renderDevicePrefs = (prefs) => {
      if (!prefs) return;
      for (const kind of ["camera", "microphone"]) {
        const pill = devicesEl.querySelector(`.zee-comm-device-pill[data-kind="${kind}"]`);
        if (!pill) continue;
        const labelEl = pill.querySelector(".zee-comm-device-label");
        const dotEl = pill.querySelector(".zee-comm-device-dot");
        const resolved = Boolean(prefs[kind]?.deviceId);
        const label = prefs[kind]?.label || "(none)";
        if (labelEl) labelEl.textContent = `${kind === "camera" ? "Cam" : "Mic"}: ${label}`;
        pill.classList.toggle("zee-comm-device-pill--matched", resolved);
        pill.classList.toggle("zee-comm-device-pill--unmatched", !resolved);
        if (dotEl) dotEl.title = resolved ? "Matched in browser" : "Not matched yet — click Sync devices";
      }
    };

    fetchDevicePrefs().then(renderDevicePrefs).catch(() => {
      /* network race on first load — refresh tick will retry */
    });

    el.querySelector("#zee-comm-device-sync")?.addEventListener("click", async (ev) => {
      const btn = /** @type {HTMLButtonElement} */ (ev.currentTarget);
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const r = await syncDevicesWithPermission({ requireVideo: true });
        renderDevicePrefs(r.prefs);
        const bits = [];
        if (r.matched.camera) bits.push("camera matched");
        else bits.push("camera NOT found");
        if (r.matched.microphone) bits.push("mic matched");
        else bits.push("mic NOT found");
        flashStatus(statusEl, `Devices: ${bits.join(", ")}.`, 4500);
        if (!r.matched.camera || !r.matched.microphone) {
          console.info(
            "[zee-devices] available labels:",
            r.labels?.cameras,
            r.labels?.microphones
          );
        }
      } catch (e) {
        flashStatus(statusEl, `Devices sync failed: ${String(e.message || e).slice(0, 100)}`, 5000);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

    el.querySelector("#zee-comm-sound-settings")?.addEventListener("click", () => {
      // Hidden anchor click avoids replacing history. Browser will hand the URI
      // off to the Windows ms-settings:// scheme handler.
      const a = document.createElement("a");
      a.href = "ms-settings:sound";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    let contacts = [];
    let status = null;

    const refresh = async () => {
      try {
        [contacts, status] = await Promise.all([fetchContacts(), fetchStatus().catch(() => null)]);
      } catch (e) {
        listEl.innerHTML = `<li class="zee-err">${escHtml(String(e.message || e))}</li>`;
        return;
      }
      if (!contacts.length) {
        renderEmpty(listEl);
      } else {
        listEl.innerHTML = contacts
          .map(
            (c) => `
              <li class="zee-comm-row" data-contact-id="${escAttr(c.id)}">
                <div class="zee-comm-row-meta">
                  <span class="zee-comm-name">${escHtml(c.name)}</span>
                  ${c.email ? `<span class="zee-muted">${escHtml(c.email)}</span>` : ""}
                </div>
                <div class="zee-comm-row-actions">${pillsForContact(c)}</div>
                <div class="zee-comm-row-tools">
                  <button type="button" class="zee-btn zee-btn-xs" data-action="edit">Edit</button>
                  <button type="button" class="zee-btn zee-btn-xs" data-action="delete">Del</button>
                </div>
              </li>
            `
          )
          .join("");
      }
      if (footEl) {
        const canSend = status?.canGmailSend;
        footEl.innerHTML = canSend
          ? 'Voice: say "Zee, video call &lt;name&gt;". Meeting opens in a popup and the link is copied to your clipboard. Email link sends from your Gmail.'
          : 'Voice: say "Zee, video call &lt;name&gt;". Meeting opens in a popup and the link is copied to your clipboard. Email link will open your default mail client (Zee\u2019s Gmail token is read-only). Re-authorize Gmail to enable direct send.';
      }
    };

    const callRow = async (contactId, platform) => {
      try {
        const r = await callContact({
          contactId,
          platform,
          sendEmail: Boolean(emailCheckbox?.checked),
        });
        applyLink(r, { statusEl, hostPanel, callModal });
        if (r.invite?.sent) {
          flashStatus(statusEl, `${r.contact.name} \u00b7 link emailed.`);
        } else if (r.invite?.mailto) {
          window.open(r.invite.mailto, "_blank", "noopener");
        }
      } catch (e) {
        alert(String(e.message || e));
      }
    };

    listEl.addEventListener("click", async (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (!target) return;
      const row = target.closest("[data-contact-id]");
      const contactId = row?.getAttribute("data-contact-id") || "";
      if (!contactId) return;
      const action = target.getAttribute("data-action");
      const platform = target.getAttribute("data-platform");
      if (platform) {
        await callRow(contactId, platform);
        return;
      }
      if (action === "edit") {
        const contact = contacts.find((c) => c.id === contactId);
        if (contact) openContactModal({ initial: contact, onSave: refresh });
        return;
      }
      if (action === "delete") {
        const contact = contacts.find((c) => c.id === contactId);
        if (!contact) return;
        if (!confirm(`Delete contact "${contact.name}"?`)) return;
        try {
          await deleteContact(contactId);
          await refresh();
        } catch (err) {
          alert(String(err.message || err));
        }
      }
    });

    el.querySelectorAll(".zee-comm-quick").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const platform = btn.getAttribute("data-platform") || "meet";
        try {
          const link = await quickCall(platform);
          applyLink({ link, contact: null }, { statusEl, hostPanel, callModal });
        } catch (e) {
          alert(String(e.message || e));
        }
      })
    );

    el.querySelector("#zee-comm-add")?.addEventListener("click", () =>
      openContactModal({ onSave: refresh })
    );

    el.querySelector("#zee-comm-sync")?.addEventListener("click", () =>
      openMeetImportModal({ onImported: refresh, statusEl })
    );

    window.addEventListener("zee:comm-call", async (ev) => {
      const detail = /** @type {CustomEvent<{name?: string, platform?: string, link?: any}>} */ (ev).detail || {};
      // Two cases:
      //  1) link is supplied directly (voice paths) -> just open the drill-down.
      //  2) only a name is supplied -> resolve the contact and call them.
      if (detail.link?.url) {
        applyLink({ link: detail.link, contact: detail.contact || null }, { statusEl, hostPanel, callModal });
        return;
      }
      if (!detail.name) return;
      try {
        const r = await callContact({
          name: detail.name,
          platform: detail.platform,
          sendEmail: Boolean(emailCheckbox?.checked),
        });
        applyLink(r, { statusEl, hostPanel, callModal });
      } catch (e) {
        flashStatus(statusEl, String(e.message || e), 3500);
      }
    });

    refresh();
    const id = window.setInterval(refresh, 60_000);
    return { destroy: () => window.clearInterval(id) };
  },
};

/** Allows other modules / voice to invoke a call from outside. */
export function dispatchCommCall(name, platform) {
  window.dispatchEvent(new CustomEvent("zee:comm-call", { detail: { name, platform } }));
}
