(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let state = null;
  let sheetRows = [];

  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Request failed");
    return json.data ?? json;
  }

  function setStatus(text) {
    $("syncStatus").textContent = text;
  }

  function renderKpis() {
    const g = state.gmail || {};
    const last = state.lastRun;
    const card = (label, value, cls = "") =>
      `<article class="card ${cls}"><div class="card-label">${label}</div><div class="card-value">${value}</div></article>`;
    $("syncKpis").innerHTML = [
      card("Google login", g.connected ? "Connected" : "Not connected", g.connected ? "" : "sync-bad"),
      card("Sheet write access", g.sheetsAccess ? "Granted" : "Needs reconnect", g.sheetsAccess ? "" : "sync-bad"),
      card("Auto mode", state.settings.enabled ? `Every ${state.settings.intervalMinutes} min` : "Off"),
      card("Waiting for review", state.needsReview.length),
      card("Last run", last ? new Date(last.at).toLocaleString() : "Never"),
    ].join("");
    if (last?.error) setStatus(`Last run problem: ${last.error}`);
  }

  function rowOptions(selected, { purchaseTabOnly = false, inStockOnly = false } = {}) {
    const purchaseTab = state.settings.purchaseTab;
    const list = sheetRows.filter(
      (r) => (!purchaseTabOnly || r.tab === purchaseTab) && (!inStockOnly || Number(r.qty) > 0)
    );
    const opts = [`<option value="">Pick a sheet row…</option>`];
    for (const r of list) {
      const sel = r.itemId === selected ? "selected" : "";
      opts.push(`<option value="${esc(r.itemId)}" ${sel}>[${esc(r.tab)} · qty ${r.qty}] ${esc(r.itemId)}</option>`);
    }
    return opts.join("");
  }

  function lineRow(ev, line, idx) {
    const isPurchase = ev.kind === "purchase";
    const plan = line.plan?.action || "review";
    const suggested = line.match?.itemId || "";
    const actions = isPurchase
      ? [
          ["raise", "Add to existing row (raise Qty)"],
          ["new", "Add as new row in " + state.settings.purchaseTab],
          ["skip", "Skip (not inventory)"],
        ]
      : [
          ["sell", "Sold from sheet row (lower Qty)"],
          ["single", "Log as single (cost $0)"],
          ["skip", "Skip"],
        ];
    const defaultAction =
      plan !== "review" ? plan : isPurchase ? (suggested ? "raise" : "new") : suggested ? "sell" : "single";
    const actionSel = actions
      .map(([v, l]) => `<option value="${v}" ${v === defaultAction ? "selected" : ""}>${l}</option>`)
      .join("");
    const priceField = isPurchase ? "unitCost" : "unitPrice";
    const priceVal = isPurchase ? line.unitCost : line.unitPrice;
    const applied = line.applied ? `<span class="stock-status stock-status-ok">Written</span>` : "";
    const err = line.error ? `<div class="sync-error">${esc(line.error)}</div>` : "";
    const note = line.plan?.note ? `<div class="help">${esc(line.plan.note)}</div>` : "";
    const scoreNote = line.match ? `<div class="help">Best guess: ${esc(line.match.itemId)} (${line.match.score}% match)</div>` : "";
    return `<tr data-index="${idx}">
      <td>${esc(line.description)}${scoreNote}${note}${err}</td>
      <td><input class="sync-num" data-field="qty" type="number" min="1" value="${esc(line.qty)}" ${line.applied ? "disabled" : ""}/></td>
      <td><input class="sync-num" data-field="${priceField}" type="number" step="0.01" value="${esc(priceVal ?? "")}" ${line.applied ? "disabled" : ""}/></td>
      <td><select data-field="action" ${line.applied ? "disabled" : ""}>${actionSel}</select></td>
      <td><select data-field="targetItemId" ${line.applied ? "disabled" : ""}>${rowOptions(suggested, { purchaseTabOnly: false, inStockOnly: !isPurchase })}</select>
        ${isPurchase ? `<input data-field="newItemId" type="text" placeholder="New row Item ID" value="${esc(line.description)}" ${line.applied ? "disabled" : ""}/>` : ""}
      </td>
      <td>${applied}</td>
    </tr>`;
  }

  function renderReview() {
    const list = state.needsReview || [];
    $("reviewEmpty").hidden = list.length > 0;
    $("reviewList").innerHTML = list
      .map((ev) => {
        const kindLabel = ev.kind === "purchase" ? "Purchase" : ev.kind === "sale" ? "Sale" : "Notice";
        const totals = ev.totals?.total ? ` · Email total ${money(ev.totals.total)}` : "";
        const priceHead = ev.kind === "purchase" ? "Cost w/ tax (each)" : "Sold price (each)";
        const body = ev.lines?.length
          ? `<div class="table-wrap"><table class="tax-sheet sync-lines">
              <thead><tr><th>Item from email</th><th>Qty</th><th>${priceHead}</th><th>What to do</th><th>Sheet row</th><th></th></tr></thead>
              <tbody>${ev.lines.map((l, i) => lineRow(ev, l, i)).join("")}</tbody>
            </table></div>`
          : "";
        return `<div class="sync-event panel-inner" data-id="${esc(ev.id)}">
          <div class="tax-section-head">
            <div>
              <strong>${kindLabel} · ${esc(ev.vendor)}</strong> · ${esc(ev.date)}${ev.orderNumber ? ` · Order ${esc(ev.orderNumber)}` : ""}${totals}
              <div class="help">${esc(ev.subject || "")}</div>
              ${ev.parseNote ? `<div class="help sync-warn">${esc(ev.parseNote)}</div>` : ""}
            </div>
            <div class="row">
              ${ev.lines?.length ? `<button type="button" class="sync-apply-btn">Write to sheet</button>` : ""}
              <button type="button" class="subtle sync-ignore-btn">${ev.lines?.length ? "Ignore" : "Dismiss"}</button>
            </div>
          </div>
          ${body}
        </div>`;
      })
      .join("");
  }

  function describeResult(r) {
    if (r.action === "qty_raised") return `${r.tab} row ${r.row}: Qty ${r.from} → ${r.to}`;
    if (r.action === "qty_lowered") return `${r.tab} row ${r.row}: Qty ${r.from} → ${r.to}`;
    if (r.action === "row_added") return `${r.tab}: new row ${r.row} (qty ${r.qty})`;
    if (r.action === "sold_row_added") return `${r.tab}: logged row ${r.row}`;
    if (r.action === "sold_row_exists") return `${r.tab}: already logged (row ${r.row})`;
    return r.action;
  }

  function renderRecent() {
    const rows = state.recent || [];
    const tbody = document.querySelector("#recentTable tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No sheet updates yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((ev) => {
        const items = (ev.lines || []).map((l) => `${l.qty}× ${esc(l.description)}`).join("<br>");
        const changes =
          ev.status === "ignored"
            ? "Ignored"
            : (ev.results || []).map((r) => esc(describeResult(r))).join("<br>") || "—";
        return `<tr><td>${esc(ev.date)}</td><td>${esc(ev.vendor)}</td><td>${esc(ev.kind)}</td><td>${items}</td><td>${changes}</td></tr>`;
      })
      .join("");
  }

  function fillSettings() {
    const s = state.settings;
    $("setEnabled").checked = Boolean(s.enabled);
    $("setAutoApply").checked = Boolean(s.autoApply);
    $("setInterval").value = s.intervalMinutes;
    $("setTrackFrom").value = s.trackFrom || "";
    $("setPurchaseTab").value = s.purchaseTab;
    $("setSoldTab").value = s.soldTab;
    $("setStockTabs").value = (s.stockTabs || []).join(", ");
    $("setSenders").value = (s.extraPurchaseSenders || []).join(", ");
    $("setSheetId").value = s.spreadsheetId;
  }

  async function loadRows() {
    if (!state?.gmail?.sheetsAccess) return;
    try {
      sheetRows = await api("/api/sheet-sync/rows");
    } catch (e) {
      setStatus(`Could not read the sheet: ${e.message}`);
    }
  }

  async function load() {
    state = await api("/api/sheet-sync");
    await loadRows();
    renderKpis();
    fillSettings();
    renderReview();
    renderRecent();
  }

  function collectEdits(card) {
    return [...card.querySelectorAll("tr[data-index]")].map((tr) => {
      const get = (f) => tr.querySelector(`[data-field="${f}"]`);
      const edit = { index: Number(tr.dataset.index), action: get("action")?.value };
      for (const f of ["qty", "unitCost", "unitPrice", "targetItemId", "newItemId"]) {
        const el = get(f);
        if (el && !el.disabled) edit[f] = el.value;
      }
      return edit;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("syncReloadBtn").addEventListener("click", () => load().catch((e) => setStatus(e.message)));

    $("syncRunBtn").addEventListener("click", async () => {
      setStatus("Checking Gmail and updating the sheet… this can take a minute.");
      try {
        const r = await api("/api/sheet-sync/run", { method: "POST" });
        await load();
        setStatus(
          r.error
            ? `Run stopped: ${r.error}`
            : r.skipped
              ? r.reason
              : `Done: ${r.newEvents} new email(s), ${r.applied} written to the sheet, ${r.needsReview} waiting for review.`
        );
      } catch (e) {
        setStatus(e.message);
      }
    });

    $("syncConnectBtn").addEventListener("click", async () => {
      try {
        const r = await api("/api/orders/gmail/auth/start?return=sheet-sync");
        window.location.href = r.authUrl;
      } catch (e) {
        setStatus(e.message);
      }
    });

    $("syncTestBtn").addEventListener("click", async () => {
      $("syncTestResult").textContent = "Testing…";
      try {
        const tabs = await api("/api/sheet-sync/test", { method: "POST" });
        $("syncTestResult").innerHTML = tabs
          .map((t) =>
            t.ok
              ? `✅ <strong>${esc(t.tab)}</strong>: ${t.rows} rows, header on row ${t.headerRow}, columns found: ${esc(t.columns.join(", "))}`
              : `❌ <strong>${esc(t.tab)}</strong>: ${esc(t.error)}`
          )
          .join("<br>");
      } catch (e) {
        $("syncTestResult").textContent = e.message;
      }
    });

    $("syncSaveSettingsBtn").addEventListener("click", async () => {
      try {
        await api("/api/sheet-sync/settings", {
          method: "PUT",
          body: JSON.stringify({
            enabled: $("setEnabled").checked,
            autoApply: $("setAutoApply").checked,
            intervalMinutes: $("setInterval").value,
            trackFrom: $("setTrackFrom").value,
            purchaseTab: $("setPurchaseTab").value.trim(),
            soldTab: $("setSoldTab").value.trim(),
            stockTabs: $("setStockTabs").value,
            extraPurchaseSenders: $("setSenders").value,
            spreadsheetId: $("setSheetId").value.trim(),
          }),
        });
        await load();
        setStatus("Settings saved.");
      } catch (e) {
        setStatus(e.message);
      }
    });

    $("reviewList").addEventListener("click", async (ev) => {
      const card = ev.target.closest(".sync-event");
      if (!card) return;
      const id = card.dataset.id;
      try {
        if (ev.target.closest(".sync-ignore-btn")) {
          await api(`/api/sheet-sync/events/${encodeURIComponent(id)}/ignore`, { method: "POST" });
          await load();
          setStatus("Ignored.");
        } else if (ev.target.closest(".sync-apply-btn")) {
          setStatus("Writing to the sheet…");
          const result = await api(`/api/sheet-sync/events/${encodeURIComponent(id)}/resolve`, {
            method: "POST",
            body: JSON.stringify({ lines: collectEdits(card), apply: true }),
          });
          await load();
          setStatus(result.status === "applied" ? "Written to the sheet." : `Partly written — check the highlighted lines.`);
        }
      } catch (e) {
        setStatus(e.message);
      }
    });

    if (new URLSearchParams(location.search).get("gmail") === "connected") {
      setStatus("Google connected. Click Test sheet access to confirm the sheet is reachable.");
    }
    load().catch((e) => setStatus(e.message));
  });
})();
