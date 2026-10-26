(function () {
  "use strict";
  const { api, esc, money, when, ready } = window.Cloud;
  const $ = (id) => document.getElementById(id);
  let page = 1;
  let timer = null;

  // Sheets returns dates as serial day numbers (days since 1899-12-30).
  const sheetDate = (v) => (typeof v === "number" ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : String(v ?? ""));

  async function load() {
    const q = new URLSearchParams({ page: String(page), pageSize: "50", q: $("soldSearch").value.trim() });
    try {
      const r = await api(`/api/sold?${q}`);
      $("soldAt").textContent = r.at ? `The Sold 2026 tab of your Google Sheet, read-only, newest rows first. Read from the Sheet ${when(r.at)}.` : "The Sheet hasn't been read yet. The owner can run it from Cloud Status.";
      const t = r.totals;
      const card = (l, v) => `<div class="card"><div class="card-label">${l}</div><div class="card-value">${v}</div></div>`;
      $("soldKpis").innerHTML = [card("Rows", r.total), card("Units", t.units), card("Sold total", money(t.sold)), card("Shipping", money(t.shipping)), card("Fees", money(t.fees)), card("Cost", money(t.cost))].join("");
      $("soldTable").querySelector("tbody").innerHTML =
        r.rows
          .map((x) => `<tr><td>${esc(sheetDate(x.date))}</td><td>${esc(x.itemId)}</td><td class="num">${esc(x.qty)}</td><td class="num">${money(x.soldUnit)}</td><td class="num">${money(x.soldTotal)}</td><td class="num">${money(x.shipping)}</td><td class="num">${money(x.fees)}</td><td class="num">${money(x.cost)}</td></tr>`)
          .join("") || '<tr><td colspan="8" class="empty-cell">No rows.</td></tr>';
      const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
      $("soldPager").innerHTML = `<button type="button" class="subtle" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Newer</button><span class="muted">Page ${page} of ${pages}</span><button type="button" class="subtle" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Older</button>`;
    } catch (e) {
      $("soldAt").textContent = e.message;
    }
  }

  $("soldSearch").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((page = 1), load()), 250);
  });
  $("soldReload").addEventListener("click", load);
  $("soldPager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) (page = Number(b.dataset.page)), load();
  });
  ready.then(load);
})();
