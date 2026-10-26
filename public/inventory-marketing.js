(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const TYPE_LABELS = {
    instagram_post: "Instagram post",
    instagram_story: "Instagram story",
    instagram_reel_script: "Instagram reel",
    youtube_pinned_comment: "YouTube pinned comment",
    youtube_description: "YouTube description",
    youtube_short_script: "YouTube Short",
    video_idea: "Video idea",
    promo_idea: "Promo idea",
    weekly_report: "Weekly report",
  };

  let drafts = [];
  let filter = "new";

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  const setStatus = (t) => ($("mkStatus").textContent = t || "");

  function render() {
    const list = drafts.filter((d) => filter === "all" || d.status === filter);
    for (const b of document.querySelectorAll("#mkTabs button")) {
      b.classList.toggle("active", b.dataset.filter === filter);
      if (b.dataset.filter === "new") b.textContent = `To review (${drafts.filter((d) => d.status === "new").length})`;
    }
    $("mkList").innerHTML = list.length
      ? list
          .map((d) => {
            const text = d.editedBody ?? d.body;
            const when = new Date(d.createdAt).toLocaleString();
            return `<article class="mk-card" data-id="${esc(d.id)}">
              <div class="mk-head">
                <span class="mk-type">${esc(TYPE_LABELS[d.type] || d.type)}</span>
                <h3>${esc(d.title || "Untitled")}</h3>
                <span class="mk-status s-${esc(d.status)}">${esc(d.status === "new" ? "To review" : d.status)}</span>
              </div>
              <div class="mk-meta">${esc(when)}${d.postAt ? ` · suggested post time: ${esc(d.postAt)}` : ""}${d.videoId ? ` · <a href="https://www.youtube.com/watch?v=${esc(d.videoId)}" target="_blank" rel="noopener">video</a>` : ""}${d.link ? ` · <a href="${esc(d.link)}" target="_blank" rel="noopener">link</a>` : ""}</div>
              <textarea data-body>${esc(text)}</textarea>
              ${d.notes ? `<p class="mk-notes">Why: ${esc(d.notes)}</p>` : ""}
              ${d.imageUrls?.length ? `<div class="mk-imgs">${d.imageUrls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="Open image to save it"><img src="${esc(u)}" alt=""></a>`).join("")}</div>` : ""}
              <div class="mk-actions">
                <button class="subtle" data-act="copy">Copy text</button>
                ${d.productIds?.length ? `<button class="subtle" data-short="${esc(d.productIds[0])}">Make promo Short</button>` : ""}
                ${d.status !== "approved" ? `<button class="ok" data-act="approved">Approve</button>` : ""}
                ${d.status !== "posted" ? `<button data-act="posted">Mark posted</button>` : ""}
                ${d.status !== "rejected" ? `<button class="no" data-act="rejected">Reject</button>` : ""}
              </div>
            </article>`;
          })
          .join("")
      : `<div class="mk-empty">${
          filter === "new"
            ? "<strong>You're all caught up.</strong>New drafts arrive daily. Click Check for new drafts to pull them now."
            : "<strong>Nothing here yet.</strong>Drafts you approve, post or reject show up under their tab."
        }</div>`;
  }

  async function loadDrafts() {
    drafts = (await api("/api/marketing/drafts")).drafts;
    render();
  }

  const MANUAL = { zelle: "Zelle", venmo: "Venmo" };
  const STATUS = { awaiting_payment: ["Awaiting payment", "wait"], paid: ["Paid", "paid"], cancelled: ["Cancelled", "cancel"] };

  function paymentCell(o) {
    const label = MANUAL[o.paymentMethod];
    if (o.paymentMethod === "paypal_invoice") return `PayPal invoice #${esc(o.invoiceNumber)} <span class="mk-badge paid">Paid</span>`;
    if (!label) return `PayPal <span class="mk-badge paid">Paid</span>`;
    const [text, cls] = STATUS[o.status] || [o.status, ""];
    const until = o.status === "awaiting_payment" && o.expiresAt ? `<div class="mk-sub">Memo ${esc(o.id)} · expires ${esc(new Date(o.expiresAt).toLocaleString())}</div>` : "";
    const why = o.status === "cancelled" && o.cancelReason ? `<div class="mk-sub">${esc(o.cancelReason)}</div>` : "";
    const mail = o.status === "paid" && o.paidEmail && !o.paidEmail.sent ? `<div class="mk-sub">Confirmation email not sent: ${esc(o.paidEmail.reason || "unknown")}</div>` : "";
    const buttons =
      o.status === "awaiting_payment"
        ? `<div class="mk-pay-actions"><button type="button" class="ok" data-paid="${esc(o.id)}">Mark paid</button><button type="button" class="no" data-cancel="${esc(o.id)}">Cancel</button></div>`
        : "";
    return `${label} <span class="mk-badge ${cls}">${esc(text)}</span>${until}${why}${mail}${buttons}`;
  }

  async function loadOrders() {
    const { orders } = await api("/api/store/web-orders");
    const awaiting = orders.some((o) => MANUAL[o.paymentMethod] && o.status === "awaiting_payment");
    $("mkScam").hidden = !awaiting;
    $("mkOrders").innerHTML = orders.length
      ? `<table class="mk-orders"><thead><tr><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Came from</th><th>Ship to</th><th>Print</th></tr></thead><tbody>${orders
          .slice(0, 50)
          .map((o) => {
            const a = o.shipTo?.address || {};
            const doc = (type) => `/order-doc.html?id=${encodeURIComponent(o.id)}&type=${type}`;
            return `<tr${o.status === "cancelled" ? ` class="mk-cancelled"` : ""}><td>${esc(new Date(o.createdAt).toLocaleDateString())}</td><td>${esc(o.lines.map((l) => `${l.qty}× ${l.name}`).join(", "))}</td><td>${money(o.total)}${Number(o.tax) ? `<div class="mk-sub">incl. ${money(o.tax)} CA tax</div>` : ""}</td><td>${paymentCell(o)}</td><td>${esc(o.ref || "direct")}</td><td>${esc(`${o.shipTo?.name || ""}, ${a.admin_area_2 || ""} ${a.admin_area_1 || ""}`)}</td><td class="mk-print"><a href="${doc("slip")}" target="_blank" rel="noopener"><button type="button" class="subtle">Packing slip</button></a><a href="${doc("invoice")}" target="_blank" rel="noopener"><button type="button" class="subtle">Invoice</button></a></td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<div class="mk-empty"><strong>No website orders yet.</strong>Orders placed on preeminentstore.com appear here.</div>`;
  }

  $("mkOrders").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-paid], button[data-cancel]");
    if (!btn) return;
    const id = btn.dataset.paid || btn.dataset.cancel;
    const paying = Boolean(btn.dataset.paid);
    const question = paying
      ? `Mark order ${id} as paid?\n\nOnly do this after you see the money in your bank or Venmo app with memo ${id}. Emails saying a payment is "pending" are scams.`
      : `Cancel order ${id}? Its stock goes back on the website.`;
    if (!confirm(question)) return;
    btn.disabled = true;
    $("mkOrdersStatus").textContent = paying ? "Marking paid and emailing the buyer…" : "Cancelling and releasing stock…";
    try {
      const r = await api(`/api/store/web-orders/${encodeURIComponent(id)}/${paying ? "mark-paid" : "cancel"}`, { method: "POST" });
      $("mkOrdersStatus").textContent = paying
        ? r.email?.sent
          ? `Marked paid. Confirmation emailed to ${r.email.to}.`
          : `Marked paid, but the confirmation email didn't send (${r.email?.reason || "unknown"}).`
        : "Cancelled. Stock is back on the website.";
    } catch (err) {
      $("mkOrdersStatus").textContent = err.message;
    }
    await loadOrders().catch(() => {});
  });

  let promoProducts = [];
  const productLabel = (p) => `${p.name} (${p.set || p.type}) · ${money(p.price)}`;

  function renderShorts(shorts) {
    $("psList").innerHTML = shorts.length
      ? shorts
          .map(
            (s) => `<div class="ps-card">
              <video src="/promo-shorts/${esc(s.file)}#t=7.5" controls preload="metadata" playsinline></video>
              <h3>${esc(s.name)} · ${money(s.price)}</h3>
              <textarea readonly>${esc(s.caption)}</textarea>
              <div class="mk-actions">
                <a href="/promo-shorts/${esc(s.file)}" download><button type="button">Download</button></a>
                <button type="button" class="subtle" data-copy-caption>Copy caption</button>
              </div>
            </div>`
          )
          .join("")
      : `<div class="mk-empty"><strong>No Shorts yet.</strong>Type a product name above, then click Make Short.</div>`;
  }

  async function loadShorts() {
    const r = await api("/api/marketing/promo-shorts");
    promoProducts = r.products;
    $("psProducts").innerHTML = promoProducts.map((p) => `<option value="${esc(productLabel(p))}"></option>`).join("");
    renderShorts(r.shorts);
  }

  async function makeShort(productId, hook = "", sticker = "") {
    $("psStatus").textContent = "Rendering (about 10 seconds)…";
    try {
      await api("/api/marketing/promo-shorts", { method: "POST", body: JSON.stringify({ productId, hook, sticker }) });
      $("psStatus").textContent = "Done. It's at the top of the list below.";
      await loadShorts();
      $("psList").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      $("psStatus").textContent = err.message;
    }
  }

  $("psMake").addEventListener("click", () => {
    const label = $("psSearch").value.trim();
    const p = promoProducts.find((x) => productLabel(x) === label) || promoProducts.find((x) => x.name.toLowerCase() === label.toLowerCase());
    if (!p) return ($("psStatus").textContent = "Pick a product from the suggestions list.");
    makeShort(p.id, $("psHook").value.trim(), $("psSticker").value.trim());
  });

  document.addEventListener("click", async (e) => {
    const short = e.target.closest("[data-short]");
    if (short) return makeShort(short.dataset.short);
    const cap = e.target.closest("[data-copy-caption]");
    if (cap) {
      await navigator.clipboard.writeText(cap.closest(".ps-card").querySelector("textarea").value);
      cap.textContent = "Copied";
      setTimeout(() => (cap.textContent = "Copy caption"), 1500);
      return;
    }
    const tab = e.target.closest("#mkTabs button");
    if (tab) {
      filter = tab.dataset.filter;
      return render();
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const card = btn.closest(".mk-card");
    const id = card.dataset.id;
    const body = card.querySelector("[data-body]").value;
    if (btn.dataset.act === "copy") {
      await navigator.clipboard.writeText(body);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy text"), 1500);
      return;
    }
    try {
      const { draft } = await api(`/api/marketing/drafts/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ status: btn.dataset.act, body }) });
      drafts = drafts.map((d) => (d.id === id ? draft : d));
      render();
    } catch (err) {
      setStatus(err.message);
    }
  });

  $("mkSync").addEventListener("click", async () => {
    setStatus("Checking…");
    try {
      const r = await api("/api/store/publish", { method: "POST" });
      setStatus(r.error ? `Problem: ${r.error}` : `${r.drafts?.pulled || 0} new draft(s), ${r.newOrders || 0} new order(s).`);
      await Promise.all([loadDrafts(), loadOrders()]);
    } catch (err) {
      setStatus(err.message);
    }
  });

  async function loadTaxReport() {
    const q = new URLSearchParams({ from: $("taxFrom").value, to: $("taxTo").value });
    $("taxCsv").href = `/api/store/sales-tax?${q}&format=csv`;
    const r = await api(`/api/store/sales-tax?${q}`);
    const cols = [
      ["Orders", "orders", false],
      ["Total sales (excl. tax)", "totalSales"],
      ["Out of state", "outOfStateSales"],
      ["CA taxable", "caTaxableSales"],
      ["CA shipping", "caShipping"],
      ["Tax collected", "taxCollected"],
      ["CA sales without tax", "caUntaxedSales"],
    ];
    const row = (m, label) =>
      `<tr><td>${esc(label)}</td>${cols.map(([, k, isMoney]) => `<td>${isMoney === false ? m[k] : money(m[k])}</td>`).join("")}<td>${Object.entries(m.districts)
        .map(([n, d]) => `${esc(n)}: ${money(d.taxableSales)}`)
        .join("<br>")}</td></tr>`;
    $("taxReport").innerHTML = r.months.length
      ? `<table class="mk-orders"><thead><tr><th>Month</th>${cols.map(([h]) => `<th>${esc(h)}</th>`).join("")}<th>District taxable sales</th></tr></thead><tbody>${r.months
          .map((m) => row(m, m.month))
          .join("")}${row(r.total, "Total")}</tbody></table>`
      : `<div class="mk-empty"><strong>No paid website orders in this range.</strong>Change the From and To dates, then click Show.</div>`;
  }
  $("taxFrom").value = `${new Date().getFullYear()}-01-01`;
  $("taxTo").value = new Date().toLocaleDateString("en-CA");
  $("taxLoad").addEventListener("click", () => loadTaxReport().catch((e) => ($("taxReport").textContent = e.message)));

  // ---------- Weekly Shorts ----------
  const WS_STATUS = {
    rendering: "Rendering…",
    awaiting_approval: "Waiting for your OK",
    posting: "Posting…",
    posted: "Posted",
    partial: "Partly posted",
    failed: "Failed",
    ready: "Ready (connect an account)",
    rejected: "Rejected",
    skipped: "Skipped",
  };
  let ws = null;
  let wsPoll = null;
  const wsStatus = (t) => ($("wsStatus").textContent = t || "");

  function wsResults(h) {
    return Object.entries(h.results || {})
      .map(([k, r]) => {
        const label = k === "youtube" ? "YouTube" : "Instagram";
        if (r.status === "posted") return `${label}: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url || "posted")}</a>${r.note ? `<div class="mk-sub">${esc(r.note)}</div>` : ""}`;
        return `${label}: ${esc(r.status)}${r.error ? ` (${esc(r.error)})` : ""}`;
      })
      .join("<br>");
  }

  function renderWeekly() {
    const s = ws.settings;
    const yt = ws.youtube;
    const ig = ws.instagram;
    $("wsConnections").innerHTML = `
      <span>YouTube: ${yt.connected ? `<strong>connected</strong>${yt.channelTitle ? ` to channel "${esc(yt.channelTitle)}"` : ` <em>(no channel found on that Google account: disconnect and pick the store's account/channel)</em>`} <button type="button" class="subtle" data-ws="yt-off">Disconnect</button>` : `<button type="button" data-ws="yt-on">Connect YouTube</button>`}</span>
      <span>Instagram: ${ig.connected ? `<strong>connected</strong>${ig.username ? ` (@${esc(ig.username)})` : ""} <button type="button" class="subtle" data-ws="ig-off">Disconnect</button>` : `<button type="button" data-ws="ig-on">Connect Instagram</button>`}</span>
      ${ws.lease.holder ? "" : `<span class="help">This PC isn't the active host right now, so the weekly run waits. (${esc(ws.lease.reason || "")})</span>`}`;
    $("wsDay").innerHTML = ws.dayNames.map((d, i) => `<option value="${i}"${i === s.day ? " selected" : ""}>${d}</option>`).join("");
    $("wsEnabled").checked = s.enabled;
    $("wsTime").value = s.time;
    $("wsMode").value = s.mode;
    $("wsYt").checked = s.platforms.youtube;
    $("wsIg").checked = s.platforms.instagram;
    if (document.activeElement !== $("wsBlock")) $("wsBlock").value = (s.privacyBlocklist || []).join(", ");
    const n = ws.nextRun;
    $("wsNext").textContent = n
      ? `Next: ${new Date(n.at).toLocaleString()}${n.skipped ? " (skipped)" : ""} · ${ws.effectiveMode === "auto" ? "auto-posts" : "waits for your approval"}${s.firstRunReview && s.mode === "auto" ? " (first one always waits)" : ""}`
      : "Weekly Shorts are off.";
    $("wsSkip").textContent = n?.skipped ? "Undo skip" : "Skip next week";
    $("wsSkip").dataset.skipped = n?.skipped ? "1" : "";
    const list = ws.history.filter((h) => h.status !== "skipped" || h.weekKey);
    $("wsList").innerHTML = list.length
      ? list
          .map((h) => {
            const canPost = ["awaiting_approval", "ready", "failed", "partial"].includes(h.status) && h.file && !h.posting;
            const editable = canPost && h.status !== "partial";
            return `<div class="ps-card" data-ws-id="${esc(h.id)}">
              ${h.file ? `<video src="/weekly-shorts/${esc(h.file)}" poster="/weekly-shorts/${esc(h.thumb || "")}" controls preload="none" playsinline></video>` : ""}
              <h3>${esc(h.name || (h.status === "skipped" ? "Skipped week" : "Weekly Short"))}${h.price ? ` · ${money(h.price)}` : ""}</h3>
              <div class="mk-sub">${esc(WS_STATUS[h.status] || h.status)} · ${esc(h.weekKey === "sample" ? "sample" : h.trigger || "")} · ${esc(new Date(h.createdAt).toLocaleString())}${h.why ? ` · why: ${esc(h.why)}` : ""}</div>
              ${h.error ? `<div class="mk-sub">${esc(h.error)}</div>` : ""}
              ${h.results ? `<div class="mk-sub">${wsResults(h)}</div>` : ""}
              ${h.file ? `<label class="mk-sub">YouTube title<input data-f="youtubeTitle" value="${esc(h.youtubeTitle)}" maxlength="100" ${editable ? "" : "readonly"} style="width:100%" /></label>
              <label class="mk-sub">YouTube description<textarea data-f="youtubeDescription" ${editable ? "" : "readonly"}>${esc(h.youtubeDescription)}</textarea></label>
              <label class="mk-sub">Instagram caption<textarea data-f="instagramCaption" ${editable ? "" : "readonly"}>${esc(h.instagramCaption)}</textarea></label>` : ""}
              <div class="mk-actions">
                ${canPost ? `<button type="button" class="ok" data-ws="approve">${h.status === "awaiting_approval" ? "Approve &amp; post" : "Post again (only what didn't post)"}</button>` : ""}
                ${h.file ? `<button type="button" class="subtle" data-ws="dry">Dry run</button>` : ""}
                ${editable ? `<button type="button" class="subtle" data-ws="save">Save text</button>` : ""}
                ${canPost && h.status !== "partial" ? `<button type="button" class="no" data-ws="reject">Reject</button>` : ""}
                ${h.file ? `<a href="/weekly-shorts/${esc(h.file)}" download><button type="button" class="subtle">Download</button></a>` : ""}
              </div>
            </div>`;
          })
          .join("")
      : `<div class="mk-empty"><strong>No weekly Shorts yet.</strong>The first one is made at the next scheduled time, or click Make one now.</div>`;
    clearTimeout(wsPoll);
    if (ws.history.some((h) => h.posting || h.status === "posting" || h.status === "rendering")) wsPoll = setTimeout(() => loadWeekly().catch(() => {}), 5000);
  }

  async function loadWeekly() {
    ws = await api("/api/marketing/weekly-shorts");
    renderWeekly();
  }

  $("wsSave").addEventListener("click", async () => {
    try {
      ws = await api("/api/marketing/weekly-shorts/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: $("wsEnabled").checked,
          day: Number($("wsDay").value),
          time: $("wsTime").value,
          mode: $("wsMode").value,
          platforms: { youtube: $("wsYt").checked, instagram: $("wsIg").checked },
          privacyBlocklist: $("wsBlock").value.split(",").map((x) => x.trim()).filter(Boolean),
        }),
      });
      renderWeekly();
      wsStatus("Saved.");
    } catch (err) {
      wsStatus(err.message);
    }
  });

  $("wsSkip").addEventListener("click", async () => {
    try {
      ws = await api("/api/marketing/weekly-shorts/skip", { method: "POST", body: JSON.stringify({ skip: !$("wsSkip").dataset.skipped }) });
      renderWeekly();
    } catch (err) {
      wsStatus(err.message);
    }
  });

  $("wsMakeNow").addEventListener("click", async () => {
    wsStatus("Rendering (about 10 seconds)…");
    try {
      await api("/api/marketing/weekly-shorts/generate", { method: "POST" });
      wsStatus("Done. Review it below.");
      await loadWeekly();
    } catch (err) {
      wsStatus(err.message);
    }
  });

  $("wsIgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    wsStatus("Connecting Instagram…");
    try {
      await api("/api/marketing/instagram/connect", { method: "POST", body: JSON.stringify({ appId: $("wsIgAppId").value.trim(), appSecret: $("wsIgSecret").value.trim(), userToken: $("wsIgToken").value.trim() }) });
      $("wsIgSecret").value = "";
      $("wsIgToken").value = "";
      $("wsIgForm").style.display = "none";
      wsStatus("Instagram connected.");
      await loadWeekly();
    } catch (err) {
      wsStatus(err.message);
    }
  });

  $("weekly-shorts").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-ws]");
    if (!btn) return;
    const act = btn.dataset.ws;
    const card = btn.closest("[data-ws-id]");
    const id = card?.dataset.wsId;
    try {
      if (act === "yt-on") return (window.location.href = (await api("/api/marketing/youtube/auth/start")).authUrl);
      if (act === "ig-on") return ($("wsIgForm").style.display = $("wsIgForm").style.display === "none" ? "" : "none");
      if (act === "yt-off" || act === "ig-off") {
        if (!confirm("Disconnect? Weekly Shorts stop posting there until you connect again.")) return;
        ws = await api(`/api/marketing/${act === "yt-off" ? "youtube" : "instagram"}/disconnect`, { method: "POST" });
        return renderWeekly();
      }
      if (act === "save" || act === "approve") {
        const body = {};
        for (const f of card.querySelectorAll("[data-f]")) if (!f.readOnly) body[f.dataset.f] = f.value;
        if (Object.keys(body).length) await api(`/api/marketing/weekly-shorts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
        if (act === "save") return wsStatus("Text saved.");
        if (!confirm("Post this Short publicly now to the connected accounts?")) return;
        ws = await api(`/api/marketing/weekly-shorts/${encodeURIComponent(id)}/approve`, { method: "POST" });
        wsStatus("Posting… links show on the card when done.");
        return renderWeekly();
      }
      if (act === "reject") {
        ws = await api(`/api/marketing/weekly-shorts/${encodeURIComponent(id)}/reject`, { method: "POST" });
        return renderWeekly();
      }
      if (act === "dry") {
        wsStatus("Dry run (nothing is posted)…");
        const { dryRun } = await api(`/api/marketing/weekly-shorts/${encodeURIComponent(id)}/dry-run`, { method: "POST" });
        const parts = Object.entries(dryRun.platforms).map(([k, p]) => `${k}: ${p.connected ? (p.tokenOk ? `ready${p.channel ? ` (${p.channel})` : p.account ? ` (@${p.account})` : ""}` : `token problem: ${p.error}`) : "not connected"}`);
        wsStatus(`Dry run OK. ${(dryRun.bytes / 1048576).toFixed(1)} MB. ${dryRun.priceCheck} ${parts.join(" · ")}`);
        return loadWeekly();
      }
    } catch (err) {
      wsStatus(err.message);
    }
  });

  if (/youtube=connected/.test(location.search)) wsStatus("YouTube connected.");

  async function loadLimited() {
    const { config: c, items, history } = await api("/api/store/limited-items");
    $("liRule").textContent = `The website shows at most ${c.maxShown} of each item below (the Sheet keeps the real count). After each paid website sale of one, a +${money(c.raiseAfterSale)} website raise is suggested under Raise after sale; the price changes only if you approve it. TCGplayer and eBay sales of these items get the regular raise-after-sale suggestion.${c.enabled && c.enabledAt ? ` On since ${new Date(c.enabledAt).toLocaleString()}.` : " Off: no effect on stock or prices."}`;
    $("liEnabled").checked = c.enabled;
    $("liItems").innerHTML = items.length
      ? `<table class="mk-orders"><thead><tr><th>Item</th><th>Site price</th><th>In stock</th><th>Shown</th></tr></thead><tbody>${items
          .map((i) => `<tr><td>${esc(i.name)}</td><td>${i.price == null ? "—" : money(i.price)}</td><td>${i.qty}</td><td>${i.shown}</td></tr>`)
          .join("")}</tbody></table>`
      : `<div class="mk-empty"><strong>No items listed yet.</strong>Confirm the list in docs/limited-items-rule.md first.</div>`;
    $("liHistory").innerHTML = history.length
      ? `<table class="mk-orders"><thead><tr><th>Date</th><th>Item</th><th>Order</th><th>Price</th></tr></thead><tbody>${history
          .map((h) => `<tr><td>${esc(new Date(h.at).toLocaleString())}</td><td>${esc(h.name)}</td><td>${esc(h.orderId)}</td><td>${money(h.from)} → ${money(h.to)}${h.proposed ? " (suggested)" : ""}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="help">No raises yet.</p>`;
  }

  $("liEnabled").addEventListener("change", async (e) => {
    const on = e.target.checked;
    if (!confirm(on ? "Turn on the limited-items rule? The website will show only a few units of each listed item and suggest a price raise for your review after every website sale." : "Turn off the limited-items rule?")) {
      e.target.checked = !on;
      return;
    }
    try {
      const res = await fetch("/api/store/limited-items/enabled", { method: "POST", headers: { "Content-Type": "application/json", "X-Portal-Owner": "1" }, body: JSON.stringify({ enabled: on }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Request failed");
      $("liStatus").textContent = on ? "On. The website updates on the next publish cycle." : "Off.";
    } catch (err) {
      $("liStatus").textContent = err.message;
    }
    await loadLimited().catch(() => {});
  });

  const ownerApi = (url, options = {}) => api(url, { ...options, headers: { "Content-Type": "application/json", "X-Portal-Owner": "1" } });
  const raStatus = (t) => ($("raStatus").textContent = t || "");
  const profitText = (x) => `${money(x.profit)}${x.profitPct == null ? "" : ` (${x.profitPct}% on cost)`}`;

  function renderRaises({ config: c, proposals }) {
    $("raRule").textContent = `When a sealed item sells on TCGplayer, eBay or the website and you still have stock, a suggested website raise shows up here: +${money(c.raise)} for items ${money(c.cheapBelow)} and up, about ${Math.round(c.cheapPct * 100)}% for cheaper ones, always ending in .99. Nothing changes until you Approve. Approving changes the website price only; raise TCGplayer or eBay yourself if you want them to match. Profit is after PayPal fees, the shipping label and tax, using the highest unit cost.`;
    const pending = proposals.filter((p) => p.status === "pending");
    const done = proposals.filter((p) => p.status !== "pending").slice(0, 15);
    const sales = (p) => p.sales.map((s) => `${s.qty}× on ${esc(s.channel)} ${esc(s.date)} at ${money(s.price)}`).join("<br>");
    $("raList").innerHTML =
      (pending.length
        ? `<table class="mk-orders"><thead><tr><th>Item</th><th>Sold</th><th>Left</th><th>Cost</th><th>TCG market</th><th>Site price</th><th>New price</th><th>Profit now → new</th><th></th></tr></thead><tbody>${pending
            .map(
              (p) => `<tr data-id="${esc(p.id)}">
                <td>${esc(p.title)}${p.locked ? ' <span class="mk-badge paid" title="Owner-reviewed price; approving moves the lock">Locked</span>' : ""}</td>
                <td>${sales(p)}</td>
                <td>${p.qtyLeft}</td>
                <td>${money(p.cost)}</td>
                <td>${p.market ? money(p.market) : "—"}</td>
                <td>${money(p.livePrice ?? p.currentPrice)}</td>
                <td><input type="number" step="1" min="0" data-price value="${p.suggestedPrice.toFixed(2)}" style="width: 7rem" /></td>
                <td>${profitText(p.atCurrent)} → ${profitText(p.atSuggested)}<br><span class="help">Floor ${money(p.floor)} (min ${p.minProfitPct}% profit)</span></td>
                <td><button class="ok" data-ra="approve">Approve</button> <button class="no" data-ra="skip">Skip</button></td>
              </tr>`
            )
            .join("")}</tbody></table>`
        : `<div class="mk-empty"><strong>No raises waiting.</strong>New ones appear a few minutes after a sale reaches the Sheet.</div>`) +
      (done.length
        ? `<table class="mk-orders"><thead><tr><th>Decided</th><th>Item</th><th>Result</th></tr></thead><tbody>${done
            .map((p) => `<tr><td>${esc(new Date(p.decidedAt).toLocaleString())}</td><td>${esc(p.title)}</td><td>${p.status === "approved" ? `${money(p.from)} → ${money(p.to)}` : "Skipped"}</td></tr>`)
            .join("")}</tbody></table>`
        : "");
  }

  const loadRaises = async () => renderRaises(await ownerApi("/api/store/raise-proposals"));

  $("raScan").addEventListener("click", async () => {
    raStatus("Checking…");
    try {
      const r = await ownerApi("/api/store/raise-proposals/scan", { method: "POST" });
      renderRaises(r);
      raStatus(r.created ? `${r.created} new suggestion(s).` : "No new sales to suggest a raise for.");
    } catch (err) {
      raStatus(err.message);
    }
  });

  $("raList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-ra]");
    if (!btn) return;
    const row = btn.closest("tr");
    const id = row.dataset.id;
    try {
      if (btn.dataset.ra === "skip") {
        await ownerApi(`/api/store/raise-proposals/${encodeURIComponent(id)}/skip`, { method: "POST" });
        raStatus("Skipped. The price stays the same.");
      } else {
        const price = Number(row.querySelector("[data-price]").value);
        if (!confirm(`Set the website price to ${money(Math.floor(price + 1e-9) + 0.99)}? TCGplayer and eBay are not changed.`)) return;
        btn.disabled = true;
        raStatus("Saving and updating the website…");
        const r = await ownerApi(`/api/store/raise-proposals/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ price }) });
        raStatus(`Website price set to ${money(r.proposal.to)}.${r.publish.error ? ` Upload problem: ${r.publish.error}` : r.publish.skipped ? " The website updates on the next publish cycle (about 5 minutes)." : ""}`);
      }
    } catch (err) {
      raStatus(err.message);
      btn.disabled = false;
    }
    await loadRaises().catch(() => {});
  });

  loadRaises().catch((e) => raStatus(e.message));
  loadWeekly().catch(() => ($("weekly-shorts").style.display = "none"));
  loadDrafts().catch((e) => setStatus(e.message));
  loadOrders().catch(() => {});
  loadTaxReport().catch(() => {});
  loadLimited().catch((e) => ($("liStatus").textContent = e.message));
  loadShorts().catch((e) => ($("psStatus").textContent = e.message));
})();
