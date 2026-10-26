(function () {
  "use strict";
  const { api, esc, money, ready, SHADOW_TIP } = window.Cloud;
  const $ = (id) => document.getElementById(id);

  const yesNo = (v) => (v ? "On" : "Off");
  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const panel = (title, html) => `<section class="panel"><h2>${esc(title)}</h2>${html}</section>`;

  function render(s, sheet, names) {
    const ship = s.shipping || {};
    const tax = s.salesTax || {};
    const mp = s.manualPayments || {};
    const overrides = Object.entries(s.priceOverrides || {});
    const freeOver = typeof ship.freeOver === "object" ? `<pre class="json">${esc(JSON.stringify(ship.freeOver, null, 2))}</pre>` : money(ship.freeOver);
    $("setBody").innerHTML = [
      panel("Contact", kv([["Contact email", esc(s.contactEmail || "—")]])),
      panel("Shipping", kv([["Standard", money(ship.standard)], ["Singles", money(ship.single)], ["Free shipping over", freeOver], ["Promo text", esc(ship.promoText || "—")]])),
      panel("Sales tax", kv([["Collect tax", yesNo(tax.enabled)], ["Details", `<pre class="json">${esc(JSON.stringify(tax, null, 2))}</pre>`]])),
      panel(
        "Zelle / Venmo checkout",
        ["zelle", "venmo"]
          .map((k) => `<h3 style="margin:6px 0">${k === "zelle" ? "Zelle" : "Venmo"}</h3>${kv(Object.entries(mp[k] || {}).map(([f, v]) => [f, esc(typeof v === "object" ? JSON.stringify(v) : v)]))}`)
          .join("") || '<p class="muted">Defaults.</p>'
      ),
      panel(
        `Price overrides (${overrides.length})`,
        overrides.length
          ? `<div class="table-wrap scroll-x"><table class="tax-sheet"><thead><tr><th>Item</th><th class="num">Price</th></tr></thead><tbody>${overrides.map(([id, v]) => `<tr><td>${esc(names[id] || id)}</td><td class="num">${typeof v === "number" ? money(v) : esc(JSON.stringify(v))}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">None.</p>'
      ),
      sheet ? panel("Google Sheet", kv([["Spreadsheet ID", esc(sheet.spreadsheetId)], ["Purchases tab", esc(sheet.purchaseTab)], ["Sales tab", esc(sheet.soldTab)], ["Tabs the cloud reads", esc((sheet.stockTabs || []).join(", "))], ["Never read here", esc((sheet.excludedTabs || []).join(", ") || "—")]])) : "",
    ].join("");
    $("setJson").value = JSON.stringify(s, null, 2);
  }

  async function load(who) {
    try {
      const [{ settings }, sync, stock] = await Promise.all([api("/api/store/settings"), api("/api/sheet-sync").catch(() => null), api("/api/store/stock").catch(() => null)]);
      const names = Object.fromEntries(Object.entries(stock?.stock?.items || {}).map(([id, it]) => [id, it.t || it.n]));
      render(settings, sync?.data?.settings, names);
    } catch (e) {
      $("setBody").innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
    const active = who.portalMode === "active";
    $("setJson").readOnly = !active;
    if (!active) {
      $("setSave").disabled = true;
      $("setSave").title = SHADOW_TIP;
      $("setSave").classList.add("cloud-locked");
      $("setOut").textContent = "Read-only until switch-over. Change settings on the PC portal for now.";
    }
  }

  $("setSave").addEventListener("click", async () => {
    try {
      await api("/api/store/settings", { method: "PUT", body: $("setJson").value });
      $("setOut").textContent = "Saved. The next publish pushes it to the website.";
    } catch (e) {
      $("setOut").textContent = e.message;
    }
  });
  ready.then(load);
})();
