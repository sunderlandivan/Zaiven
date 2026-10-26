(function () {
  "use strict";
  const { api, esc, money, when, atLeast, ready, SHADOW_TIP } = window.Cloud;
  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 20;
  const MANUAL = { zelle: "Zelle", venmo: "Venmo" };
  let page = 1;
  let me = null;
  let timer = null;

  function statusBadge(o) {
    if (o.status === "cancelled") return '<span class="badge cancel">Cancelled</span>';
    if (MANUAL[o.paymentMethod] && o.status === "awaiting_payment") return '<span class="badge wait">Awaiting payment</span>';
    if (o.shippingLabels?.length) return '<span class="badge ship">Label bought</span>';
    return '<span class="badge paid">Paid · to ship</span>';
  }

  function address(o) {
    const a = o.shipTo?.address || {};
    const city = [a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [o.shipTo?.name, o.shipTo?.company, a.address_line_1, a.address_line_2, city, a.country_code && a.country_code !== "US" ? a.country_code : ""].filter(Boolean).map(esc).join("<br>");
  }

  function card(o) {
    const manager = atLeast(me.role, "manager");
    const open = MANUAL[o.paymentMethod] && o.status === "awaiting_payment";
    const locked = me.portalMode !== "active";
    const lockAttr = locked ? ` disabled title="${esc(SHADOW_TIP)}"` : "";
    const lockCls = locked ? " cloud-locked" : "";
    const doc = (type) => `/order-doc.html?id=${encodeURIComponent(o.id)}&type=${type}&noprint=1`;
    return `<article class="wo-card${o.status === "cancelled" ? " cancelled" : ""}">
      <div class="wo-head">
        <span class="wo-id">#${esc(String(o.id).slice(-8))}</span>
        ${statusBadge(o)}
        ${o.test ? '<span class="badge">test</span>' : ""}
        <span class="muted">${esc(when(o.createdAt))}</span>
        ${manager ? `<span class="wo-total">${money(o.total)}</span>` : ""}
      </div>
      <ul class="wo-lines">${(o.lines || []).map((l) => `<li>${esc(l.qty)}× ${esc(l.title || l.name)}${l.single ? ' <span class="muted">(single)</span>' : ""}</li>`).join("")}</ul>
      <details class="wo-ship"><summary>Ship to ${esc(o.shipTo?.name || "")}</summary><div>${address(o)}</div>${o.note ? `<p>Buyer note: ${esc(o.note)}</p>` : ""}</details>
      <div class="wo-ship">${manager ? `${esc(MANUAL[o.paymentMethod] || (o.paymentMethod === "paypal_invoice" ? "PayPal invoice" : "PayPal"))} · ` : ""}came from ${esc(o.ref || "direct")}${o.expiresAt && open ? ` · hold expires ${esc(when(o.expiresAt))}` : ""}${o.cancelReason ? ` · ${esc(o.cancelReason)}` : ""}</div>
      <div class="wo-actions">
        <a href="${doc("slip")}" target="_blank" rel="noopener"><button type="button" class="subtle">Packing slip</button></a>
        ${manager ? `<a href="${doc("invoice")}" target="_blank" rel="noopener"><button type="button" class="subtle">Invoice</button></a>` : ""}
        ${manager && open ? `<button type="button" class="${lockCls}" data-paid="${esc(o.id)}"${lockAttr}>Mark paid</button><button type="button" class="subtle${lockCls}" data-cancel="${esc(o.id)}"${lockAttr}>Cancel</button>` : ""}
      </div>
    </article>`;
  }

  async function load() {
    $("woStatusLine").textContent = "Loading…";
    const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: $("woSearch").value.trim(), status: $("woStatus").value });
    try {
      const r = await api(`/api/store/web-orders?${q}`);
      $("woList").innerHTML = r.orders.map(card).join("") || '<div class="muted">No orders match.</div>';
      const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
      $("woStatusLine").textContent = `${r.total} order(s)`;
      $("woPager").innerHTML = pages > 1 ? `<button type="button" class="subtle" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Newer</button><span class="muted">Page ${page} of ${pages}</span><button type="button" class="subtle" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Older</button>` : "";
    } catch (e) {
      $("woStatusLine").textContent = e.message;
    }
  }

  async function pending() {
    if (!atLeast(me.role, "manager")) return;
    try {
      const p = await api("/api/store/kv-pending");
      $("woPending").textContent = `${p.count} new order(s) waiting on the website to be pulled in (checked ${when(p.at)}).`;
    } catch {
      /* optional */
    }
  }

  $("woSearch").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((page = 1), load()), 250);
  });
  $("woStatus").addEventListener("change", () => ((page = 1), load()));
  $("woReload").addEventListener("click", load);
  $("woPager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) (page = Number(b.dataset.page)), load();
  });
  $("woList").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-paid], button[data-cancel]");
    if (!b || b.disabled) return;
    const id = b.dataset.paid || b.dataset.cancel;
    const paying = Boolean(b.dataset.paid);
    if (!confirm(paying ? `Mark order ${id} as paid?\n\nOnly after you see the money in your bank or Venmo app with memo ${id}.` : `Cancel order ${id}? Its stock goes back on the website.`)) return;
    try {
      await api(`/api/store/web-orders/${encodeURIComponent(id)}/${paying ? "mark-paid" : "cancel"}`, { method: "POST" });
      load();
    } catch (err) {
      $("woStatusLine").textContent = err.message;
    }
  });

  ready.then((who) => {
    me = who;
    load();
    pending();
  });
})();
