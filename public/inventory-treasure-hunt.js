const $ = (id) => document.getElementById(id);

/** Row order matches Latest hits table; used by Log deal buttons. */
let treasureScanFindingsCache = [];
let treasureLastScanAt = null;

/** Matches server defaults / passive scan (no per-run UI). */
const TREASURE_SCAN_FIXED = {
  minSavingsPctBelowCost: 8,
  taxPct: 8,
  shippingPerUnit: 10.99,
};

const QUICK_STORES = [
  {
    label: "TCGplayer",
    href: (q) => `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(q)}`,
  },
  {
    label: "eBay",
    href: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  {
    label: "Google Shopping",
    href: (q) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`,
  },
  {
    label: "Stomping Grounds TCG",
    href: (q) => `https://www.stompinggroundstcg.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    label: "Double Infinity Gaming",
    href: (q) => `https://doubleinfinitygaming.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    label: "Shop app",
    href: (q) => `https://shop.app/search?q=${encodeURIComponent(q)}`,
  },
  {
    label: "TCGPlayer + sealed (Google)",
    href: (q) =>
      `https://www.google.com/search?q=${encodeURIComponent(`${q} tcg sealed buy`)}`,
  },
];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const f = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${f}` : `$${f}`;
}

async function logDealFromScanHit(index, buttonEl) {
  const f = treasureScanFindingsCache[index];
  if (!f) return;
  const landed = Number.isFinite(Number(f.landedMarketPrice))
    ? Number(f.landedMarketPrice)
    : Number(f.marketPrice);
  const dealPrice = Number.isFinite(landed) ? landed : Number(f.marketPrice);
  if (!Number.isFinite(dealPrice) || dealPrice <= 0) {
    setStatus("Cannot log deal: missing price on this row.");
    return;
  }
  const productQuery = String(f.productName || "").trim();
  if (!productQuery) {
    setStatus("Cannot log deal: missing product name.");
    return;
  }
  const vUrl = [f.vendorUrl, f.tcgplayerUrl].find((u) => u && /^https?:\/\//i.test(String(u)));
  const when = treasureLastScanAt ? new Date(treasureLastScanAt).toLocaleString() : "";
  const notes = when
    ? `Treasure Hunt auto-scan @ ${when}. Est. landed price (incl. scan tax/ship).`
    : "Treasure Hunt auto-scan. Est. landed price (incl. scan tax/ship).";
  const payload = {
    productQuery,
    storeLabel: String(f.vendorName || "TCGplayer").trim() || "TCGplayer",
    dealPrice,
    notes,
    status: "watching",
  };
  if (vUrl) payload.dealUrl = String(vUrl);
  if (f.inventoryItemId) payload.inventoryItemId = String(f.inventoryItemId);

  const prev = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = "…";
  try {
    await api("POST", "/api/treasure-hunt", payload);
    await refresh();
    setStatus("Deal logged from scan hit.");
  } catch (err) {
    buttonEl.disabled = false;
    buttonEl.textContent = prev;
    setStatus(err.message);
  }
}

async function api(method, url, body = undefined) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "Request failed");
  return j;
}

function setStatus(text) {
  const el = $("treasureStatus");
  if (el) el.textContent = text;
}

function currentQuery() {
  return String($("searchQuery")?.value || "").trim() || String(document.querySelector('[name="productQuery"]')?.value || "").trim();
}

function wireQuickStores() {
  const host = $("quickStoreButtons");
  if (!host) return;
  host.innerHTML = "";
  for (const s of QUICK_STORES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "treasure-store-chip subtle";
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      const q = currentQuery();
      if (!q) {
        setStatus("Type a product name in the search box (or Log a deal) first.");
        return;
      }
      window.open(s.href(q), "_blank", "noopener,noreferrer");
    });
    host.appendChild(btn);
  }
}

function fillSkuSelect(skus) {
  const sel = $("inventoryMatchSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "— Auto-match from product title —";
  sel.appendChild(o0);
  const sorted = [...skus].sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
  for (const s of sorted) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.productName} (cost ${money(s.unitCost)} · qty ${s.quantity})`;
    sel.appendChild(o);
  }
}

function renderScanResults(scan) {
  const tbody = document.querySelector("#scanFindingsTable tbody");
  const errEl = $("scanErrors");
  treasureScanFindingsCache = Array.isArray(scan?.findings) ? [...scan.findings] : [];
  treasureLastScanAt = scan?.at || null;
  if (errEl) {
    errEl.textContent = "";
    if (Array.isArray(scan?.errors) && scan.errors.length) {
      errEl.textContent = `Some rows could not be priced: ${scan.errors
        .slice(0, 5)
        .map((e) => e.error || "")
        .join(" · ")}`;
    }
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!scan?.findings?.length) {
    const tr = document.createElement("tr");
    const msg = scan?.at
      ? "No items met your deal rule on the last run."
      : "No scan yet — use “Run scan now” above.";
    tr.innerHTML = `<td colspan="7">${escapeHtml(msg)}</td>`;
    tbody.appendChild(tr);
    return;
  }
  scan.findings.forEach((f, i) => {
    const list = Number(f.marketPrice);
    const landed = Number.isFinite(Number(f.landedMarketPrice))
      ? Number(f.landedMarketPrice)
      : Number.isFinite(list)
        ? list
        : NaN;
    const save = Number(f.savingsPerUnit);
    const saveCell = Number.isFinite(save) ? `<span class="treasure-pos">${money(save)}</span>` : "—";
    const vName = escapeHtml(f.vendorName || "TCGplayer");
    const vUrl = [f.vendorUrl, f.tcgplayerUrl].find((u) => u && /^https?:\/\//i.test(String(u)));
    const vendorCell = vUrl
      ? `<a href="${escapeHtml(String(vUrl))}" target="_blank" rel="noopener noreferrer">${vName}</a>`
      : vName;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(f.productName || "")}</td>
      <td>${money(f.unitCost)}</td>
      <td>${money(f.marketPrice)}</td>
      <td>${Number.isFinite(landed) ? money(landed) : "—"}</td>
      <td>${saveCell}</td>
      <td>${vendorCell}</td>
    `;
    const tdAct = document.createElement("td");
    tdAct.className = "treasure-hit-actions-col";
    const logBtn = document.createElement("button");
    logBtn.type = "button";
    logBtn.className = "table-btn subtle treasure-log-hit-btn";
    logBtn.textContent = "Log deal";
    logBtn.dataset.hitIndex = String(i);
    logBtn.title = "Add this hit to your deal log (est. landed price)";
    tdAct.appendChild(logBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

function updateScanBanner(scan) {
  const el = $("scanProgress");
  if (!el) return;
  if (!scan?.at) {
    el.textContent = "";
    return;
  }
  const n = scan.findings?.length || 0;
  const scanned = Number(scan.meta?.scannedItems);
  const eligible = Number(scan.meta?.inventoryEligible);
  const tax = Number(scan.meta?.taxPct);
  const ship = Number(scan.meta?.shippingPerUnit);
  let landedNote = "landed = list + tax + flat ship.";
  if (Number.isFinite(tax) && tax > 0) landedNote += ` Tax ${tax}%.`;
  if (Number.isFinite(ship) && ship > 0) landedNote += ` Ship $${ship.toFixed(2)}/unit.`;
  if (scan.meta?.scanTruncatedByHardCap && Number.isFinite(eligible) && Number.isFinite(scanned)) {
    landedNote += ` Only ${scanned} of ${eligible} eligible rows were scanned (server safety cap — set TREASURE_SCAN_MAX_ITEMS_HARD_CAP to raise).`;
  } else if (
    Number.isFinite(eligible) &&
    Number.isFinite(scanned) &&
    scanned < eligible &&
    scan.meta?.scanMaxItems != null
  ) {
    landedNote += ` Scanned ${scanned} of ${eligible} eligible rows (max-items limit).`;
  }
  const scannedLabel = Number.isFinite(scanned) ? scanned : "?";
  el.textContent = `Last scan ${new Date(scan.at).toLocaleString()} — checked ${scannedLabel} item(s), ${n} bargain hit(s). ${landedNote}`;
}

function renderDeals(deals) {
  const tbody = document.querySelector("#dealsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const d of deals) {
    const tr = document.createElement("tr");
    const when = d.createdAt ? new Date(d.createdAt).toLocaleString() : "—";
    const link =
      d.dealUrl && /^https?:\/\//i.test(d.dealUrl)
        ? `<a href="${escapeHtml(d.dealUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`
        : "—";
    const sav = d.savingsPerUnit;
    const savCell =
      sav == null || !Number.isFinite(sav)
        ? "—"
        : `<span class="${sav > 0 ? "treasure-pos" : sav < 0 ? "treasure-neg" : ""}">${money(sav)}</span>`;
    const cost = d.ourUnitCost != null && Number.isFinite(d.ourUnitCost) ? money(d.ourUnitCost) : "—";
    const matchName = d.matchedInventory?.productName
      ? escapeHtml(d.matchedInventory.productName.slice(0, 48)) + (d.matchedInventory.productName.length > 48 ? "…" : "")
      : "—";

    tr.innerHTML = `
      <td>${escapeHtml(when)}</td>
      <td>${escapeHtml(d.productQuery || "")}</td>
      <td>${escapeHtml(d.storeLabel || "")}</td>
      <td>${money(d.dealPrice)} · ${link}</td>
      <td>${cost}</td>
      <td>${savCell}</td>
      <td>
        <select data-deal-id="${escapeHtml(d.id)}" class="treasure-status-select">
          <option value="watching" ${d.status === "watching" ? "selected" : ""}>Watching</option>
          <option value="bought" ${d.status === "bought" ? "selected" : ""}>Bought</option>
          <option value="passed" ${d.status === "passed" ? "selected" : ""}>Passed</option>
        </select>
      </td>
      <td title="${d.matchedInventory ? escapeHtml(d.matchedInventory.productName) : ""}">${matchName}</td>
      <td><button type="button" class="table-btn subtle" data-delete="${escapeHtml(d.id)}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".treasure-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.dealId;
      try {
        await api("PATCH", `/api/treasure-hunt/${encodeURIComponent(id)}`, { status: sel.value });
        setStatus("Status updated.");
      } catch (e) {
        setStatus(e.message);
      }
    });
  });

  tbody.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete");
      if (!window.confirm("Remove this deal from the log?")) return;
      try {
        await api("DELETE", `/api/treasure-hunt/${encodeURIComponent(id)}`);
        await refresh();
        setStatus("Deal removed.");
      } catch (e) {
        setStatus(e.message);
      }
    });
  });
}

async function refresh() {
  const data = await api("GET", "/api/treasure-hunt");
  renderDeals(data.deals);
  renderScanResults(data.scan);
  updateScanBanner(data.scan);
}

async function init() {
  wireQuickStores();
  $("searchQuery")?.addEventListener("input", () => {
    const pq = document.querySelector('[name="productQuery"]');
    if (pq && !String(pq.value || "").trim()) pq.value = $("searchQuery").value;
  });

  try {
    const { skus } = await api("GET", "/api/treasure-hunt/inventory-skus");
    fillSkuSelect(skus);
  } catch {
    fillSkuSelect([]);
  }

  await refresh();

  $("scanFindingsTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-hit-index]");
    if (!btn || btn.disabled) return;
    const idx = Number(btn.dataset.hitIndex);
    if (!Number.isInteger(idx) || idx < 0) return;
    await logDealFromScanHit(idx, btn);
  });

  $("scanForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("scanSubmitBtn");
    if (btn) btn.disabled = true;
    const prog = $("scanProgress");
    if (prog) prog.textContent = "Scanning… full inventory runs can take a while (one brief pause per row).";
    try {
      await api("POST", "/api/treasure-hunt/scan", { ...TREASURE_SCAN_FIXED });
      await refresh();
      document.dispatchEvent(new CustomEvent("treasure-nav-refresh"));
      setStatus("Scan finished.");
    } catch (err) {
      setStatus(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("markTreasureSeenBtn")?.addEventListener("click", async () => {
    try {
      await api("POST", "/api/treasure-hunt/mark-seen", {});
      document.dispatchEvent(new CustomEvent("treasure-nav-refresh"));
      setStatus("Sidebar alert cleared.");
    } catch (err) {
      setStatus(err.message);
    }
  });

  $("dealForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      productQuery: String(fd.get("productQuery") || "").trim(),
      storeLabel: String(fd.get("storeLabel") || "").trim(),
      dealUrl: String(fd.get("dealUrl") || "").trim(),
      dealPrice: Number(fd.get("dealPrice")),
      notes: String(fd.get("notes") || "").trim(),
      status: String(fd.get("status") || "watching"),
      inventoryItemId: String(fd.get("inventoryItemId") || "").trim() || null,
    };
    try {
      await api("POST", "/api/treasure-hunt", payload);
      e.target.reset();
      $("inventoryMatchSelect").value = "";
      await refresh();
      setStatus("Deal saved.");
    } catch (err) {
      setStatus(err.message);
    }
  });
}

init().catch((e) => setStatus(`Load failed: ${e.message}`));
