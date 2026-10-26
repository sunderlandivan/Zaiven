async function fetchPending(force) {
  const res = await fetch(`/api/zee/social/pending${force ? "?refresh=1" : ""}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "social pending failed");
  return j;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pendingRow(label, info, helpUrl) {
  if (!info) return "";
  if (!info.configured) {
    return `
      <li class="zee-social-row zee-social-row--idle">
        <span class="zee-social-name">${escapeHtml(label)}</span>
        <span class="zee-muted">not connected</span>
      </li>`;
  }
  if (info.error) {
    return `
      <li class="zee-social-row zee-social-row--err">
        <span class="zee-social-name">${escapeHtml(label)}</span>
        <span class="zee-err">${escapeHtml(info.error)}</span>
      </li>`;
  }
  const n = Number(info.unread || 0);
  if (!n) {
    return `
      <li class="zee-social-row zee-social-row--clear">
        <span class="zee-social-name">${escapeHtml(label)}</span>
        <span class="zee-muted">No pending DMs</span>
      </li>`;
  }
  const url = helpUrl || "#";
  return `
    <li class="zee-social-row zee-social-row--alert">
      <span class="zee-social-name">${escapeHtml(label)}</span>
      <a class="zee-social-count" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open ${escapeHtml(
        label
      )}">${n} pending</a>
    </li>`;
}

export const socialModule = {
  id: "social",
  title: "Social",
  mount(el) {
    el.innerHTML = `
      <div class="zee-social">
        <ul class="zee-social-list" id="zee-social-list"></ul>
        <p class="zee-muted zee-social-foot" id="zee-social-foot">…</p>
      </div>
    `;
    const listEl = el.querySelector("#zee-social-list");
    const footEl = el.querySelector("#zee-social-foot");

    const render = async (force) => {
      try {
        const data = await fetchPending(Boolean(force));
        if (listEl) {
          listEl.innerHTML = [
            pendingRow("Facebook", data.facebook, "https://www.facebook.com/messages/t/"),
            pendingRow("Instagram", data.instagram, "https://www.instagram.com/direct/inbox/"),
          ].join("");
        }
        if (footEl) {
          const noPersonal =
            "Personal Facebook / Instagram DMs are not exposed by Meta APIs. Counts shown require a Facebook Page (and Instagram Business/Creator linked to it).";
          if (data.facebook?.configured || data.instagram?.configured) {
            footEl.textContent = "Polling Meta Graph every 30s.";
          } else {
            footEl.textContent = noPersonal;
          }
        }
      } catch (e) {
        if (listEl) listEl.innerHTML = `<li class="zee-err">${escapeHtml(String(e.message || e))}</li>`;
      }
    };

    render();
    const id = window.setInterval(() => render(false), 30_000);
    return { destroy: () => window.clearInterval(id) };
  },
};
