(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const shortId = (id) => String(id || "").slice(-8);
  const taxName = (o) => `Sales tax (${o.taxInfo?.state || "CA"}${o.taxInfo?.rate ? ` ${+(o.taxInfo.rate * 100).toFixed(3)}%` : ""})`;

  const STORE = { name: "The PreEminent Store", email: "sales@preeminentstore.com", site: "preeminentstore.com" };
  const POLICY = `We ship within the United States only. All sales are final, except damaged or wrong items reported within 3 days of delivery to ${STORE.email}.`;

  const SAMPLE = {
    id: "5TY05013RG002845M",
    captureId: "3C679366HH908993F",
    createdAt: new Date().toISOString(),
    ref: "sample",
    lines: [
      { id: "s1", qty: 1, name: "Arcane Rising Booster Box [Unlimited Edition]", title: "Arcane Rising Booster Box [Unlimited Edition] - Arcane Rising (ARC)", single: false, price: 189.99 },
      { id: "s2", qty: 2, name: "Compendium of Rathe Booster Box", title: "Compendium of Rathe Booster Box - Compendium of Rathe (PEN)", single: false, price: 104.5 },
      { id: "s3", qty: 3, name: "Enlightened Strike", title: "Enlightened Strike (Rainbow Foil) - Welcome to Rathe", single: true, price: 4.25 },
    ],
    subtotal: 411.74,
    shipping: 10.99,
    tax: 31.91,
    taxInfo: { state: "CA", zip: "92501", rate: 0.0775, taxable: 411.74, districts: [{ name: "Riverside County Transportation Commission", rate: 0.005 }] },
    total: 454.64,
    payer: { name: "Jordan Sample", email: "jordan.sample@example.com" },
    shipTo: { name: "Jordan Sample", address: { address_line_1: "123 Example Street", address_line_2: "Apt 4B", admin_area_2: "Riverside", admin_area_1: "CA", postal_code: "92501", country_code: "US" } },
  };

  const params = new URLSearchParams(location.search);
  const type = params.get("type") === "invoice" ? "invoice" : "slip";

  function addressHtml(name, a = {}, company = "") {
    const cityLine = [a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [name, company, a.address_line_1, a.address_line_2, cityLine].filter(Boolean).map(esc).join("<br>");
  }

  function header(o, title) {
    const date = new Date(o.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return `<header>
        <img src="/store/brand/mark.png" alt="" />
        <div class="brand">
          <h1>The PreEminent <em>Store</em></h1>
          <div>${esc(STORE.site)} · ${esc(STORE.email)}</div>
        </div>
        <div class="doc-title">
          <h2>${esc(title)}</h2>
          <div>Order <strong>#${esc(shortId(o.id))}</strong></div>
          <div>${esc(date)}</div>
        </div>
      </header>`;
  }

  const itemName = (l) => `<div class="item-name">${esc(l.title || l.name)}</div><div class="item-kind">${l.single ? "Single card" : "Sealed product"}</div>`;

  function slip(o) {
    const count = o.lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    return `<div class="sheet">
      ${header(o, "Packing slip")}
      <div class="parties">
        <div><h3>Ship to</h3><div class="addr">${addressHtml(o.shipTo?.name, o.shipTo?.address, o.shipTo?.company)}</div></div>
        <div><h3>Order</h3><div class="addr">#${esc(shortId(o.id))}<br><span class="muted">${count} item${count === 1 ? "" : "s"} in this package</span></div></div>
      </div>
      <h3 class="items-title">Packed items</h3>
      <table>
        <thead><tr><th class="check">Packed</th><th class="qty">Qty</th><th>Item</th></tr></thead>
        <tbody>${o.lines.map((l) => `<tr><td class="check"><span class="box"></span></td><td class="qty">${esc(l.qty)}</td><td>${itemName(l)}</td></tr>`).join("")}</tbody>
      </table>
      <div class="thanks">
        <h3>Thank you for your order!</h3>
        <p>We hope you pull something amazing. Tag us so we can see it!</p>
        <p><strong>Instagram</strong> @thepreeminentstore · <strong>YouTube</strong> @thezaiven · <strong>${esc(STORE.site)}</strong></p>
      </div>
      <footer>${esc(STORE.name)} · ${esc(STORE.site)}</footer>
    </div>`;
  }

  function paymentLine(o) {
    const label = { zelle: "Zelle", venmo: "Venmo" }[o.paymentMethod];
    if (o.paymentMethod === "paypal_invoice") return `<strong>Paid in full via PayPal invoice #${esc(o.invoiceNumber)}.</strong> Transaction ID ${esc(o.captureId || "—")}`;
    if (!label) return `<strong>Paid in full via PayPal.</strong> Capture ID ${esc(o.captureId || "—")} · PayPal order ${esc(o.id)}`;
    if (o.status === "paid") return `<strong>Paid in full via ${label}.</strong> Order ${esc(o.id)}`;
    if (o.status === "cancelled") return `<strong>Cancelled.</strong> ${label} payment was not received. Order ${esc(o.id)}`;
    return `<strong>Awaiting ${label} payment.</strong> Order ${esc(o.id)}`;
  }

  function invoice(o) {
    const payer = o.payer || {};
    return `<div class="sheet">
      ${header(o, "Receipt")}
      <div class="parties">
        <div><h3>Bill to</h3><div class="addr">${esc(payer.name || o.shipTo?.name)}${payer.company ? `<br>${esc(payer.company)}` : ""}${payer.email ? `<br><span class="muted">${esc(payer.email)}</span>` : ""}</div></div>
        <div><h3>Ship to</h3><div class="addr">${addressHtml(o.shipTo?.name, o.shipTo?.address, o.shipTo?.company)}</div></div>
      </div>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
        <tbody>${o.lines.map((l) => `<tr><td>${itemName(l)}</td><td class="num">${esc(l.qty)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.price * l.qty)}</td></tr>`).join("")}</tbody>
      </table>
      <table class="totals">
        <tr><td>Subtotal</td><td class="num">${money(o.subtotal)}</td></tr>
        <tr><td>Shipping</td><td class="num">${Number(o.shipping) ? money(o.shipping) : "Free"}</td></tr>
        ${Number(o.tax) ? `<tr><td>${esc(taxName(o))}</td><td class="num">${money(o.tax)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="num">${money(o.total)}</td></tr>
      </table>
      <div class="paid">${paymentLine(o)}</div>
      ${o.note ? `<p class="policy"><strong>Note:</strong> ${esc(o.note)}</p>` : ""}
      <p class="policy"><strong>Store policy:</strong> ${esc(POLICY)}</p>
      <footer>${esc(STORE.name)} LLC · ${esc(STORE.email)} · ${esc(STORE.site)}</footer>
    </div>`;
  }

  async function loadOrder() {
    if (params.get("sample")) return SAMPLE;
    const res = await fetch(`/api/store/web-orders/${encodeURIComponent(params.get("id") || "")}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Order not found.");
    return json.order;
  }

  const other = type === "slip" ? "invoice" : "slip";
  $("docSwitch").textContent = other === "slip" ? "Show packing slip" : "Show invoice";
  $("docSwitch").addEventListener("click", () => {
    params.set("type", other);
    params.set("noprint", "1");
    location.search = params.toString();
  });

  loadOrder()
    .then(async (o) => {
      document.title = `${type === "slip" ? "Packing slip" : "Invoice"} #${shortId(o.id)} — ${STORE.name}`;
      $("doc").innerHTML = type === "slip" ? slip(o) : invoice(o);
      if (params.get("noprint")) return;
      await Promise.all([document.fonts?.ready, ...[...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r))))]);
      window.print();
    })
    .catch((err) => ($("doc").innerHTML = `<div class="error">${esc(err.message)}</div>`));
})();
