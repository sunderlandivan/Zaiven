/**
 * Shared sidebar: Treasure Hunt alert when an auto-scan finds bargains you have not reviewed yet.
 */
async function refreshTreasureNav() {
  try {
    const res = await fetch("/api/treasure-hunt/summary");
    const j = await res.json();
    if (!j.ok) return;
    document.querySelectorAll('a.nav-link[href="/inventory-treasure-hunt.html"]').forEach((a) => {
      if (j.showNavAlert) {
        a.classList.add("treasure-nav-alert");
        a.title = "Treasure Hunt: new hits from your last auto-scan — click to review";
      } else {
        a.classList.remove("treasure-nav-alert");
        a.removeAttribute("title");
      }
    });
  } catch {
    /* offline or server down */
  }
}

/** Sheet Sync: review-count badge on the nav link, and a banner on every page when Google sign-in is needed. */
async function refreshSheetSyncNav() {
  try {
    const res = await fetch("/api/sheet-sync/health");
    const j = await res.json();
    if (!j.ok) return;
    const h = j.data;
    document.querySelectorAll('a.nav-link[href="/inventory-sheet-sync.html"]').forEach((a) => {
      let badge = a.querySelector(".sync-nav-badge");
      if (h.reviewCount > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "sync-nav-badge";
          a.appendChild(badge);
        }
        badge.textContent = String(h.reviewCount);
        a.title = `${h.reviewCount} item(s) waiting for your review`;
      } else {
        badge?.remove();
        a.removeAttribute("title");
      }
    });
    let banner = document.getElementById("syncLoginBanner");
    if (h.enabled && h.loginProblem) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "syncLoginBanner";
        banner.className = "sync-login-banner";
        banner.innerHTML =
          'Sheet Sync is paused — Google sign-in expired. <a href="/api/orders/gmail/auth/start?return=sheet-sync">Reconnect Google</a> (sign in as iv3nsun@gmail.com).';
        document.body.prepend(banner);
      }
    } else {
      banner?.remove();
    }
  } catch {
    /* offline or server down */
  }
}

/** Host lease: is this PC running the store's order/stock jobs, or is the cloud portal in charge? */
async function refreshLeaseNav() {
  try {
    const j = await (await fetch("/api/portal-lease")).json();
    if (!j.ok) return;
    let box = document.getElementById("leaseNav");
    if (!box) {
      box = document.createElement("div");
      box.id = "leaseNav";
      box.className = "help";
      box.innerHTML = '<span class="badge"></span>';
      document.querySelector(".nav-pane .nav-links")?.after(box);
      box.addEventListener("click", takeLeaseBack);
    }
    const badge = box.firstElementChild;
    badge.className = `badge ${j.holder ? "paid" : "wait"}`;
    badge.textContent = j.holder ? "Active host" : j.state === "expired" ? "Passive — lease expired" : "Passive — cloud is in charge";
    box.title = `${j.reason}${j.state === "expired" ? " Click to take the lease back on this PC." : ""}`;
    box.dataset.state = j.state;
  } catch {
    /* offline or server down */
  }
}

async function takeLeaseBack() {
  const box = document.getElementById("leaseNav");
  if (box?.dataset.state !== "expired") return;
  if (!confirm("Take the lease back on this PC? Do this only if the cloud portal is stopped or set to shadow.")) return;
  const j = await (await fetch("/api/portal-lease/take", { method: "POST", headers: { "X-Portal-Owner": "1" } })).json().catch(() => ({}));
  if (!j.ok) alert(j.error || "Couldn't take the lease.");
  refreshLeaseNav();
}

/** Marketing: count of suggested price raises (after a sale) waiting for the owner. */
async function refreshRaiseNav() {
  try {
    const j = await (await fetch("/api/store/raise-proposals/count")).json();
    if (!j.ok) return;
    document.querySelectorAll('a.nav-link[href="/inventory-marketing.html"]').forEach((a) => {
      let badge = a.querySelector(".sync-nav-badge");
      if (j.pending > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "sync-nav-badge";
          a.appendChild(badge);
        }
        badge.textContent = String(j.pending);
        a.title = `${j.pending} price raise(s) waiting for your review`;
      } else {
        badge?.remove();
        a.removeAttribute("title");
      }
    });
  } catch {
    /* offline or server down */
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshTreasureNav();
  refreshSheetSyncNav();
  refreshLeaseNav();
  refreshRaiseNav();
  setInterval(refreshTreasureNav, 90_000);
  setInterval(refreshSheetSyncNav, 90_000);
  setInterval(refreshLeaseNav, 90_000);
  setInterval(refreshRaiseNav, 90_000);
});

document.addEventListener("treasure-nav-refresh", () => {
  refreshTreasureNav();
});
