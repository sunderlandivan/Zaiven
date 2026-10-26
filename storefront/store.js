(() => {
  const GAMES = {
    pokemon: { label: "Pokémon", color: "#ffcc4d" },
    magic: { label: "Magic", color: "#ff7a45" },
    fab: { label: "Flesh and Blood", color: "#ff4f6d" },
    weiss: { label: "Weiss Schwarz", color: "#ff8fd8" },
    riftbound: { label: "Riftbound", color: "#22d3ee" },
    onepiece: { label: "One Piece", color: "#4d9bff" },
    gundam: { label: "Gundam", color: "#9ae66e" },
    accessories: { label: "Accessories", color: "#b9b3d9" },
    other: { label: "Other", color: "#b9b3d9" },
  };
  const CART_KEY = "preeminent-cart";
  const $ = (s) => document.querySelector(s);
  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let items = [];
  let shipping = { standard: 10.99, single: 1.49, freeOver: null, promoText: "" };
  let newIds = new Set();
  const state = { game: "", type: "", q: "", sort: "featured" };
  let deckGame = "";
  let cart = loadCart();
  // Custom decks only show in their own section; the Vault, game tiles and hero are sealed product and singles.
  const shopItems = () => items.filter((i) => !i.deck);

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
  }
  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    renderCartCount();
  }
  const byId = (id) => items.find((i) => i.id === id);

  // ---------- data ----------
  async function load() {
    let res = await fetch("api/catalog").catch(() => null);
    if (!res?.ok) res = await fetch(`catalog.json?v=${Date.now()}`);
    const data = await res.json();
    items = data.items || [];
    shipping = { ...shipping, ...data.shipping };
    renderShippingInfo();
    newIds = new Set([...items].filter((i) => i.addedRow).sort((a, b) => b.addedRow - a.addedRow).slice(0, 10).map((i) => i.id));
    for (const id of Object.keys(cart)) {
      const it = byId(id);
      if (!it) delete cart[id];
    }
    saveCart();
    if (data.updatedAt) $("#updated").textContent = `Stock updated ${new Date(data.updatedAt).toLocaleString()}.`;
    renderHero();
    renderGameTiles();
    renderChips();
    renderTypes();
    render();
    renderDecks();
    routeFromHash();
    if (jumpToShop && !productIdFromUrl()) $("#shop").scrollIntoView();
    else if (location.hash === "#decks" && !$("#decks").hidden) $("#decks").scrollIntoView();
  }

  function renderDecks() {
    const decks = items.filter((i) => i.deck);
    $("#decks").hidden = !decks.length;
    if (!decks.length) return;
    const counts = {};
    for (const i of decks) counts[i.game] = (counts[i.game] || 0) + 1;
    if (deckGame && !counts[deckGame]) deckGame = "";
    const chip = (key, label, n, color) =>
      `<button class="chip${deckGame === key ? " active" : ""}" data-deck-game="${key}" style="--c:${color}">${esc(label)}<small>${n}</small></button>`;
    $("#deckChips").innerHTML =
      chip("", "All decks", decks.length, "#ff6a1a") +
      Object.keys(GAMES).filter((g) => counts[g]).map((g) => chip(g, GAMES[g].label, counts[g], GAMES[g].color)).join("");
    $("#deckGrid").innerHTML = decks.filter((i) => !deckGame || i.game === deckGame).map(cardHtml).join("");
  }

  function renderGameTiles() {
    const tiles = Object.entries(GAMES)
      .filter(([key]) => !["other", "accessories"].includes(key))
      .map(([key, g]) => {
        const list = shopItems().filter((i) => i.game === key);
        if (!list.length) return "";
        const hero = list.filter((i) => i.image && !/case/i.test(i.name)).sort((a, b) => b.addedRow - a.addedRow || b.price - a.price)[0];
        return `<button class="game-tile" data-tile="${key}" style="--c:${g.color}">
          ${hero ? `<img src="${esc(hero.image)}" alt="" loading="lazy">` : ""}
          <strong>${esc(g.label)}</strong><span>${list.length} products</span>
        </button>`;
      });
    $("#gameTiles").innerHTML = tiles.join("");
  }

  function productIdFromUrl() {
    const m = location.pathname.match(/^\/p\/([^/]+)/) || location.hash.match(/^#p\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function routeFromHash() {
    const id = productIdFromUrl();
    if (id && byId(id)) openProduct(id, false);
    else if (!$("#productModal").hidden) closeAll(false);
  }
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("popstate", routeFromHash);

  // Where the shopper came from (?ref=youtube, ?ref=ig-post…) is kept for a week and attached to their order.
  const REF_KEY = "preeminent-ref";
  const refParam = new URLSearchParams(location.search).get("ref");
  if (refParam) localStorage.setItem(REF_KEY, JSON.stringify({ ref: refParam.slice(0, 60), at: Date.now() }));
  function currentRef() {
    try {
      const r = JSON.parse(localStorage.getItem(REF_KEY));
      return r && Date.now() - r.at < 7 * 864e5 ? r.ref : "";
    } catch {
      return "";
    }
  }

  function renderShippingInfo() {
    $("#perkShip").textContent = money(shipping.standard);
    $("#perkSingle").textContent = money(shipping.single);
    const promo = shipping.promoText || (shipping.freeOver ? `Free shipping on orders over ${money(shipping.freeOver)}` : "");
    $("#promoBar").textContent = promo;
    $("#promoBar").hidden = !promo;
  }

  const deckRate = (i) => (i.ship === "deck" && i.shipCost > 0 ? i.shipCost : 0);

  /** One flat charge per order: standard if anything sealed is in the cart, else the custom-deck rate, else the single-card rate. */
  function shippingFor(lines, subtotal) {
    if (!lines.length) return 0;
    const sealed = lines.some((l) => l.i.ship !== "single" && !deckRate(l.i));
    if (shipping.freeOver && subtotal >= shipping.freeOver) return 0;
    return sealed ? shipping.standard : Math.max(0, ...lines.map((l) => deckRate(l.i))) || shipping.single;
  }

  function renderHero() {
    const newest = (game) =>
      shopItems().filter((i) => i.image && i.game === game && !/case/i.test(i.name)).sort((a, b) => b.addedRow - a.addedRow || b.price - a.price)[0];
    const chosen = [newest("magic"), newest("fab"), newest("pokemon")].filter(Boolean);
    $("#heroStack").innerHTML = chosen.map((i) => `<div class="stack-card" data-id="${esc(i.id)}"><img src="${esc(i.image)}" alt="${esc(i.name)}"></div>`).join("");
    const sets = [...new Set(shopItems().filter((i) => i.ship !== "single").map((i) => i.set).filter(Boolean))].slice(0, 24);
    const words = sets.map((s) => `<span>${esc(s)}</span>`).join("");
    $("#marquee").innerHTML = words + words;
  }

  function renderChips() {
    const counts = {};
    for (const i of shopItems()) counts[i.game] = (counts[i.game] || 0) + 1;
    const order = Object.keys(GAMES).filter((g) => counts[g]);
    const chip = (key, label, n, color) =>
      `<button class="chip${state.game === key ? " active" : ""}" data-game="${key}" style="--c:${color}">${esc(label)}<small>${n}</small></button>`;
    $("#gameChips").innerHTML =
      chip("", "All", shopItems().length, "#ff6a1a") + order.map((g) => chip(g, GAMES[g].label, counts[g], GAMES[g].color)).join("");
  }

  function renderTypes() {
    const types = [...new Set(shopItems().map((i) => i.type).filter(Boolean))].sort();
    $("#typeFilter").innerHTML = `<option value="">All types</option>` + types.map((t) => `<option>${esc(t)}</option>`).join("");
  }

  // ---------- grid ----------
  function filtered() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = shopItems().filter(
      (i) =>
        (!state.game || i.game === state.game) &&
        (!state.type || i.type === state.type) &&
        words.every((w) => `${i.title} ${i.type} ${GAMES[i.game]?.label}`.toLowerCase().includes(w))
    );
    const sorters = {
      featured: (a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || (newIds.has(b.id) ? 1 : 0) - (newIds.has(a.id) ? 1 : 0) || b.price - a.price,
      new: (a, b) => b.addedRow - a.addedRow || b.price - a.price,
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(sorters[state.sort] || sorters.featured);
  }

  function cardHtml(i, idx) {
    const g = GAMES[i.game] || GAMES.other;
    const low = i.low;
    return `
      <article class="card${i.deck ? " deck-card" : ""}" data-id="${esc(i.id)}" style="animation-delay:${Math.min(idx, 16) * 35}ms">
        <div class="card-media">
          ${low ? `<span class="badge low">Low stock</span>` : ""}
          ${newIds.has(i.id) ? `<span class="badge new">New</span>` : ""}
          ${i.image ? `<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy">` : `<span class="placeholder">${esc(i.name.slice(0, 1))}</span>`}
        </div>
        <div class="card-body">
          <span class="card-game" style="color:${g.color}">${esc(g.label)}</span>
          <h3 class="card-name">${esc(i.name)}</h3>
          <p class="card-set">${esc(i.set || i.type)}${i.condition && !i.deck ? ` · ${esc(i.condition)}` : ""}</p>
          <div class="card-foot">
            <span class="price">${money(i.price)}</span>
            <button class="add-btn" data-add="${esc(i.id)}" aria-label="Add to cart">+</button>
          </div>
        </div>
      </article>`;
  }

  function render() {
    const list = filtered();
    $("#resultNote").textContent = `${list.length} product${list.length === 1 ? "" : "s"}${state.q ? ` matching “${state.q}”` : ""}`;
    $("#grid").innerHTML = list.length ? list.map(cardHtml).join("") : `<div class="empty">Nothing matches that yet. Try another search or game.</div>`;
  }

  // Holo foil tilt that follows the cursor.
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.(".card");
    if (!card || matchMedia("(hover: none)").matches) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
    card.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
    card.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
  });
  document.addEventListener("pointerout", (e) => {
    const card = e.target.closest?.(".card");
    if (card && !card.contains(e.relatedTarget)) {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    }
  });

  // ---------- product modal ----------
  function openProduct(id, pushUrl = true) {
    const i = byId(id);
    if (!i) return;
    if (pushUrl && productIdFromUrl() !== id) history.pushState(null, "", `/p/${encodeURIComponent(id)}`);
    document.title = `${i.name} · The PreEminent Store`;
    const g = GAMES[i.game] || GAMES.other;
    const low = i.low;
    const photos = i.images?.length > 1 ? i.images : [];
    $("#modalBody").innerHTML = `
      <div class="modal-media${photos.length ? " has-thumbs" : ""}">${i.image ? `<img id="modalImg" src="${esc(i.image)}" alt="${esc(i.name)}">` : `<span class="placeholder">${esc(i.name.slice(0, 1))}</span>`}
        ${photos.length ? `<div class="modal-thumbs">${photos.map((src, n) => `<button type="button" class="${n ? "" : "active"}" data-photo="${esc(src)}" aria-label="Photo ${n + 1}"><img src="${esc(src)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="modal-info">
        <span class="card-game" style="color:${g.color}">${esc(g.label)}${i.deck ? " · Custom Deck" : ""}</span>
        <h3>${esc(i.name)}</h3>
        <span class="price">${money(i.price)}</span>
        <span class="stock-pill${low ? " low" : ""}">${low ? "Low stock" : "In stock"}</span>
        ${i.deck ? `<p class="deck-note">Hand-built by us from cards we pulled in our own openings, so the cards are opened (not factory sealed). This is a custom deck, not an official ${esc(g.label)} product. Ready to play, great for new players and veterans alike.</p>` : ""}
        <dl>
          ${i.includes?.length ? `<dt>Includes</dt><dd>${i.includes.map(esc).join(", ")}</dd>` : ""}
          ${i.set ? `<dt>${i.deck ? "Format" : "Set"}</dt><dd>${esc(i.set)}${i.code ? ` (${esc(i.code)})` : ""}</dd>` : ""}
          ${i.type ? `<dt>Type</dt><dd>${esc(i.type)}</dd>` : ""}
          ${i.rarity ? `<dt>Rarity</dt><dd>${esc(i.rarity)}</dd>` : ""}
          <dt>Condition</dt><dd>${esc(i.condition || (i.deck ? "Opened cards, built by us" : "Factory sealed"))}</dd>
          <dt>Shipping</dt><dd>${deckRate(i) ? `${money(deckRate(i))} flat on deck orders (${money(shipping.standard)} if your order includes sealed product)` : `${money(i.ship === "single" ? shipping.single : shipping.standard)} flat per order`}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn btn-primary" data-add="${esc(i.id)}">Add to cart</button>
          <button class="btn btn-ghost" data-share="${esc(i.id)}">Share</button>
        </div>
      </div>`;
    show("#productModal");
  }

  async function shareProduct(id) {
    const i = byId(id);
    if (!i) return;
    const url = `${location.origin}/p/${encodeURIComponent(id)}`;
    try {
      if (navigator.share) return await navigator.share({ title: i.name, text: `${i.name} — ${money(i.price)}`, url });
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      /* share sheet dismissed */
    }
  }

  // ---------- cart ----------
  function addToCart(id) {
    const i = byId(id);
    if (!i) return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    const c = $("#cartCount");
    c.classList.remove("bump");
    void c.offsetWidth;
    c.classList.add("bump");
    toast(`Added ${i.name}`);
    render();
    if (!$("#cart").hidden) renderCart();
    if (!$("#productModal").hidden) openProduct(id);
  }

  function renderCartCount() {
    $("#cartCount").textContent = Object.values(cart).reduce((s, n) => s + n, 0);
  }

  function renderCart() {
    const lines = cartLines();
    $("#cartLines").innerHTML = lines.length
      ? lines
          .map(
            ({ i, n }) => `
        <div class="cart-line">
          <div class="thumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : ""}</div>
          <div>
            <h4>${esc(i.name)}</h4>
            <div class="muted">${money(i.price)} each</div>
            <div class="qty">
              <button data-dec="${esc(i.id)}" aria-label="Less">−</button><span>${n}</span><button data-inc="${esc(i.id)}" aria-label="More">+</button>
            </div>
          </div>
          <div class="line-total">${money(i.price * n)}<button class="remove" data-remove="${esc(i.id)}">Remove</button></div>
        </div>`
          )
          .join("")
      : `<div class="cart-empty">Your cart is empty.<br>Go find something shiny.</div>`;
    const subtotal = lines.reduce((s, l) => s + l.i.price * l.n, 0);
    const ship = shippingFor(lines, subtotal);
    $("#cartSubtotal").textContent = money(subtotal);
    $("#cartShipping").innerHTML = !lines.length ? "–" : ship ? money(ship) : `<span class="free">FREE</span>`;
    $("#cartTotal").textContent = money(subtotal + ship);
    const toFree = shipping.freeOver && lines.length && ship ? shipping.freeOver - subtotal : 0;
    $("#shipNote").textContent = `${toFree > 0 ? `Add ${money(toFree)} more for free shipping. ` : ""}We ship within the US only. Sales tax applies to California addresses.`;
    $("#checkoutBtn").disabled = !lines.length;
  }

  // ---------- overlays ----------
  function show(sel) {
    $(sel).hidden = false;
    $("#scrim").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeAll(clearUrl = true) {
    for (const sel of ["#cart", "#productModal", "#checkoutModal", "#scrim"]) $(sel).hidden = true;
    document.body.style.overflow = "";
    document.title = "The PreEminent Store · Sealed TCG Products";
    if (clearUrl && productIdFromUrl()) history.pushState(null, "", "/");
  }

  function cartLines() {
    return Object.entries(cart).map(([id, n]) => ({ i: byId(id), n })).filter((l) => l.i);
  }

  const checkoutMarkup = $(".checkout-body").innerHTML;

  function openCheckout() {
    const lines = cartLines();
    if (!lines.length) return;
    $(".checkout-body").innerHTML = checkoutMarkup;
    const subtotal = lines.reduce((s, l) => s + l.i.price * l.n, 0);
    const ship = shippingFor(lines, subtotal);
    $("#checkoutLines").innerHTML = lines
      .map(
        ({ i, n }) => `<div class="co-line">
          <div class="thumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : ""}<b>${n}</b></div>
          <span>${esc(i.name)}</span><strong>${money(i.price * n)}</strong>
        </div>`
      )
      .join("");
    $("#coSubtotal").textContent = money(subtotal);
    $("#coShipping").innerHTML = ship ? money(ship) : `<span class="free">FREE</span>`;
    $("#coTotal").textContent = money(subtotal + ship);
    $("#cart").hidden = true;
    show("#checkoutModal");
    renderPayPal();
    renderManualPay(subtotal + ship);
  }

  /** Checkout summary with the server's totals for a known ship-to address (q from api/quote and friends). */
  function showTotals(q) {
    if (!$("#coTotal")) return;
    $("#coSubtotal").textContent = money(q.subtotal);
    $("#coShipping").innerHTML = q.shipping ? money(q.shipping) : `<span class="free">FREE</span>`;
    $("#coTaxLabel").textContent = q.taxLabel || "Sales tax";
    $("#coTax").textContent = money(q.tax);
    $("#coTax").classList.remove("tax-pending");
    $("#coTotal").textContent = money(q.total);
  }

  function resetTax() {
    const lines = cartLines();
    const subtotal = lines.reduce((s, l) => s + l.i.price * l.n, 0);
    if (!$("#coTax")) return;
    $("#coTaxLabel").textContent = "Sales tax (CA)";
    $("#coTax").textContent = "Calculated at checkout";
    $("#coTax").classList.add("tax-pending");
    $("#coTotal").textContent = money(subtotal + shippingFor(lines, subtotal));
  }

  const cartPayload = () => Object.entries(cart).map(([id, qty]) => ({ id, qty }));

  let quoteSeq = 0;
  async function quoteForAddress({ line1, city, state, zip }) {
    const seq = ++quoteSeq;
    if (!US_STATES.includes(state) || !/^\d{5}(-\d{4})?$/.test(zip)) return resetTax();
    const { ok, data } = await postJson("api/quote", { cart: cartPayload(), shipTo: { line1, city, state, zip } }).catch(() => ({ ok: false }));
    if (seq !== quoteSeq) return;
    if (ok) showTotals(data);
    else resetTax();
  }

  let configP = null;
  function loadConfig() {
    configP ||= fetch("api/config")
      .then((r) => r.json())
      .catch((e) => {
        configP = null;
        throw e;
      });
    return configP;
  }

  // ---------- PayPal ----------
  let paypalSdk = null;
  function loadPayPal() {
    paypalSdk ||= loadConfig()
      .then(
        ({ paypalClientId }) =>
          new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=USD&intent=capture&enable-funding=venmo`;
            s.onload = () => resolve(window.paypal);
            s.onerror = reject;
            document.head.appendChild(s);
          })
      )
      .catch((e) => {
        paypalSdk = null;
        throw e;
      });
    return paypalSdk;
  }

  const setPayStatus = (msg) => {
    const el = $("#payStatus");
    if (el) el.textContent = msg || "";
  };

  async function postJson(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function renderPayPal() {
    let paypal;
    try {
      paypal = await loadPayPal();
    } catch {
      setPayStatus("Couldn't load PayPal. Check your connection and reopen checkout.");
      return;
    }
    const box = $("#paypalButtons");
    if (!box || $("#checkoutModal").hidden) return;
    box.innerHTML = "";
    paypal
      .Buttons({
        style: { layout: "vertical", shape: "pill", color: "gold", label: "pay" },
        createOrder: async () => {
          setPayStatus("");
          const { ok, data } = await postJson("api/paypal/create-order", { cart: cartPayload(), ref: currentRef() });
          if (!ok) {
            setPayStatus(data.error || "Couldn't start checkout. Please try again.");
            throw new Error(data.error || "create-order failed");
          }
          return data.id;
        },
        // Re-prices the PayPal order for the buyer's address (California sales tax) before they pay.
        onShippingAddressChange: async (data, actions) => {
          if (data.shippingAddress?.countryCode !== "US") return actions.reject(data.errors?.COUNTRY_ERROR);
          const { ok, data: out } = await postJson("api/paypal/shipping-change", { orderID: data.orderID, shippingAddress: data.shippingAddress }).catch(() => ({ ok: false, data: {} }));
          if (!ok) return actions.reject(data.errors?.ADDRESS_ERROR);
          showTotals(out);
        },
        onApprove: async (data, actions) => {
          setPayStatus("Confirming your payment…");
          const { ok, data: out } = await postJson("api/paypal/capture-order", { orderID: data.orderID });
          if (out.issue === "INSTRUMENT_DECLINED") {
            setPayStatus(out.error);
            return actions.restart();
          }
          if (out.taxChanged) return confirmTaxedTotal(data.orderID, out);
          if (!ok) return setPayStatus(out.error || "The payment didn't go through. You have not been charged.");
          orderComplete(out);
        },
        onCancel: () => {
          setPayStatus("");
          resetTax();
        },
        onError: () => {
          if (!$("#payStatus")?.textContent) setPayStatus("Something went wrong with PayPal. You have not been charged. Please try again.");
        },
      })
      .render(box)
      .catch(() => setPayStatus("Couldn't load PayPal. Please reopen checkout."));
  }

  /** PayPal approved a total without the sales tax for the final address: show the right total and pay on confirm. */
  function confirmTaxedTotal(orderID, q) {
    showTotals(q);
    const el = $("#payStatus");
    if (!el) return;
    const total = Number(q.total).toFixed(2);
    el.innerHTML = `${esc(q.error)} <button type="button" class="btn btn-primary btn-block" id="confirmTaxBtn">Pay ${money(q.total)}</button>`;
    $("#confirmTaxBtn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      setPayStatus("Confirming your payment…");
      const { ok, data: out } = await postJson("api/paypal/capture-order", { orderID, confirmTotal: total }).catch(() => ({ ok: false, data: {} }));
      if (out.taxChanged) return confirmTaxedTotal(orderID, out);
      if (!ok) return setPayStatus(out.error || "The payment didn't go through. You have not been charged.");
      orderComplete(out);
    });
  }

  // ---------- Zelle / direct Venmo (paid by hand, shipped once the owner confirms) ----------
  const MANUAL_LABELS = { zelle: "Zelle", venmo: "Venmo" };
  const US_STATES =
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  let manualCfg = {};
  let manualMethod = "";

  async function renderManualPay(total) {
    let cfg;
    try {
      cfg = (await loadConfig()).manualPay || {};
    } catch {
      return;
    }
    const box = $("#manualPay");
    if (!box || $("#checkoutModal").hidden) return;
    manualCfg = cfg;
    manualMethod = "";
    const enabled = Object.keys(MANUAL_LABELS).filter((m) => cfg[m]?.enabled);
    if (!enabled.length) return;
    $("#manualState").innerHTML = `<option value="">State</option>` + US_STATES.map((s) => `<option>${s}</option>`).join("");
    if (cfg.venmo?.handle) $("#venmoHandleLabel").textContent = `(@${cfg.venmo.handle})`;
    const notes = [];
    for (const m of enabled) {
      const btn = box.querySelector(`[data-manual="${m}"]`);
      btn.hidden = false;
      if (total > cfg[m].maxOrder) {
        btn.disabled = true;
        notes.push(`${MANUAL_LABELS[m]} is available for orders up to ${money(cfg[m].maxOrder)}.`);
      }
    }
    const hold = Math.max(...enabled.map((m) => cfg[m].holdHours || 24));
    $("#manualNote").textContent = [`We hold your items for ${hold} hours and ship after your payment is confirmed.`, ...notes].join(" ");
    box.hidden = false;
  }

  function chooseManual(method) {
    manualMethod = method;
    for (const b of document.querySelectorAll("[data-manual]")) b.classList.toggle("active", b.dataset.manual === method);
    $("#manualForm").hidden = false;
    $("#manualSubmit").textContent = `Place order, then pay with ${MANUAL_LABELS[method]}`;
    setPayStatus("");
    $("#manualForm").elements.name.focus();
  }

  async function submitManual(e) {
    e.preventDefault();
    const f = e.target.elements;
    const v = (k) => f[k].value.trim();
    const problem =
      (v("name").length < 2 && "Please enter your full name.") ||
      (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email")) && "Please enter a valid email address.") ||
      ((!v("line1") || !v("city")) && "Please enter your street address and city.") ||
      (!US_STATES.includes(v("state")) && "Please choose your state. We ship within the US only.") ||
      (!/^\d{5}(-\d{4})?$/.test(v("zip")) && "Please enter a valid 5-digit ZIP code.");
    if (problem) return setPayStatus(problem);
    setPayStatus("Placing your order…");
    $("#manualSubmit").disabled = true;
    const { ok, data } = await postJson("api/manual/create-order", {
      method: manualMethod,
      cart: cartPayload(),
      ref: currentRef(),
      buyer: { name: v("name"), email: v("email") },
      shipTo: { line1: v("line1"), line2: v("line2"), city: v("city"), state: v("state"), zip: v("zip") },
    }).catch(() => ({ ok: false, data: {} }));
    if ($("#manualSubmit")) $("#manualSubmit").disabled = false;
    if (!ok) return setPayStatus(data.error || "Couldn't place your order. Please try again.");
    manualOrderPlaced(data, v("email"));
  }

  const copyBtn = (value) => `<button type="button" class="copy-btn" data-copy="${esc(value)}">Copy</button>`;

  function manualOrderPlaced(order, email) {
    cart = {};
    saveCart();
    render();
    const pay = order.pay || manualCfg[order.method] || {};
    const amount = money(order.total);
    const venmo = order.method === "venmo";
    const link = venmo
      ? `https://venmo.com/${encodeURIComponent(pay.handle)}?txn=pay&amount=${Number(order.total).toFixed(2)}&note=${encodeURIComponent(order.id)}`
      : "";
    const details = venmo
      ? `<p class="pay-lead">Send <strong>${amount}</strong> to <strong>@${esc(pay.handle)}</strong> on Venmo with your order number in the note.</p>
         <dl class="pay-details">
           <dt>Venmo</dt><dd>@${esc(pay.handle)} ${copyBtn(`@${pay.handle}`)}</dd>
           <dt>Note</dt><dd class="mono">${esc(order.id)} ${copyBtn(order.id)}</dd>
           <dt>Amount</dt><dd>${amount} ${copyBtn(Number(order.total).toFixed(2))}</dd>
         </dl>
         <a class="btn venmo-pay" href="${esc(link)}" target="_blank" rel="noopener">Pay ${amount} on Venmo</a>
         <p class="fine">The button works best on your phone. On a computer, open the Venmo app and search for <strong>@${esc(pay.handle)}</strong>.</p>
         <p class="fine">If Venmo asks, choose <strong>"Purchase"</strong>, not friends &amp; family.</p>`
      : `<p class="pay-lead">Send <strong>${amount}</strong> with Zelle to <strong>${esc(pay.email)}</strong> and put your order number in the memo.</p>
         <dl class="pay-details">
           <dt>Zelle to</dt><dd>${esc(pay.email)} ${copyBtn(pay.email)}</dd>
           ${pay.displayName ? `<dt>Name</dt><dd>${esc(pay.displayName)}</dd>` : ""}
           <dt>Memo</dt><dd class="mono">${esc(order.id)} ${copyBtn(order.id)}</dd>
           <dt>Amount</dt><dd>${amount} ${copyBtn(Number(order.total).toFixed(2))}</dd>
         </dl>
         <p class="fine">Use Zelle in your own bank's app. We'll never ask you to pay anyone else.</p>`;
    $(".checkout-body").innerHTML = `
      <div class="order-done manual-done">
        <h3>Order received!</h3>
        <p>Your items are reserved. Complete your order with ${MANUAL_LABELS[order.method]}:</p>
        <span class="order-no">Order ${esc(order.id)}</span>
        <div class="pay-card ${esc(order.method)}">
          <div class="pay-amount">${amount}</div>
          ${Number(order.tax) ? `<p class="pay-tax">Includes ${money(order.tax)} ${esc((order.taxLabel || "CA sales tax").replace(/^S/, "s"))}</p>` : ""}
          ${details}
        </div>
        <ul class="pay-rules">
          <li>We ship after the payment arrives (usually same or next day).</li>
          <li>Unpaid orders are cancelled after ${esc(pay.holdHours || 24)} hours.</li>
          <li>We emailed these instructions to <strong>${esc(email)}</strong>.</li>
        </ul>
        <button class="btn btn-primary" data-close>Keep shopping</button>
      </div>`;
  }

  document.addEventListener("submit", (e) => {
    if (e.target.id === "manualForm") submitManual(e);
  });
  let quoteTimer;
  const onAddressInput = (e) => {
    const f = e.target.form;
    if (f?.id !== "manualForm" || !["line1", "city", "state", "zip"].includes(e.target.name)) return;
    clearTimeout(quoteTimer);
    const v = (k) => f.elements[k].value.trim();
    quoteTimer = setTimeout(() => quoteForAddress({ line1: v("line1"), city: v("city"), state: v("state"), zip: v("zip") }), 500);
  };
  document.addEventListener("input", onAddressInput);
  document.addEventListener("change", onAddressInput);

  function orderComplete(out) {
    const id = typeof out === "string" ? out : out?.id;
    cart = {};
    saveCart();
    render();
    $(".checkout-body").innerHTML = `
      <div class="order-done">
        <h3>Thank you!</h3>
        <p>Your order is confirmed. PayPal has emailed your receipt.</p>
        <span class="order-no">Order ${esc(id)}</span>
        <div id="gcrOptIn"></div>
        <p class="fine">We'll pack it carefully and ship it soon. Questions? Reply to your receipt or see our <a class="mail" href="info#contact">contact page</a>.</p>
        <button class="btn btn-primary" data-close>Keep shopping</button>
      </div>`;
    if (out && typeof out === "object") renderGoogleCustomerReview(out);
  }

  /** Google Customer Reviews opt-in (Merchant Center Reviews add-on). */
  function renderGoogleCustomerReview({ id, email, deliveryCountry, estimatedDeliveryDate }) {
    if (!id || !email) return;
    window.__gcrOptIn = {
      merchant_id: 5871019770,
      order_id: String(id),
      email: String(email),
      delivery_country: String(deliveryCountry || "US"),
      estimated_delivery_date: String(estimatedDeliveryDate || ""),
    };
    window.renderOptIn = function () {
      const cfg = window.__gcrOptIn;
      if (!cfg?.estimated_delivery_date || !window.gapi?.load) return;
      window.gapi.load("surveyoptin", () => {
        window.gapi.surveyoptin.render(cfg);
      });
    };
    if (!document.getElementById("gcrPlatform")) {
      const s = document.createElement("script");
      s.id = "gcrPlatform";
      s.src = "https://apis.google.com/js/platform.js?onload=renderOptIn";
      s.async = true;
      document.body.appendChild(s);
    } else {
      window.renderOptIn();
    }
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a, .card, .stack-card, .scrim");
    if (!t) return;
    if (t.dataset.manual) return chooseManual(t.dataset.manual);
    if (t.dataset.copy !== undefined) {
      navigator.clipboard?.writeText(t.dataset.copy).then(() => toast("Copied"), () => {});
      return;
    }
    if (t.dataset.add) { e.stopPropagation(); return addToCart(t.dataset.add); }
    if (t.dataset.inc) return addToCart(t.dataset.inc);
    if (t.dataset.share) return shareProduct(t.dataset.share);
    if (t.dataset.dec) {
      cart[t.dataset.dec] = (cart[t.dataset.dec] || 1) - 1;
      if (cart[t.dataset.dec] <= 0) delete cart[t.dataset.dec];
      saveCart(); renderCart(); render();
      return;
    }
    if (t.dataset.remove) { delete cart[t.dataset.remove]; saveCart(); renderCart(); render(); return; }
    if (t.dataset.game !== undefined) { state.game = t.dataset.game; renderChips(); render(); return; }
    if (t.dataset.deckGame !== undefined) { deckGame = t.dataset.deckGame; renderDecks(); return; }
    if (t.dataset.photo) {
      $("#modalImg").src = t.dataset.photo;
      for (const b of document.querySelectorAll("[data-photo]")) b.classList.toggle("active", b === t);
      return;
    }
    if (t.dataset.sort) { state.sort = t.dataset.sort; $("#sort").value = t.dataset.sort; render(); return; }
    if (t.dataset.close !== undefined || t.id === "scrim") return closeAll();
    if (t.id === "cartBtn") { renderCart(); show("#cart"); return; }
    if (t.id === "checkoutBtn") return openCheckout();
    if (t.dataset.tile) {
      state.game = t.dataset.tile;
      renderChips();
      render();
      $("#shop").scrollIntoView();
      return;
    }
    if (t.classList.contains("card") || t.classList.contains("stack-card")) return openProduct(t.dataset.id);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      render();
      if (state.q && window.scrollY < $("#shop").offsetTop - 200) $("#shop").scrollIntoView();
    }, 150);
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#typeFilter").addEventListener("change", (e) => { state.type = e.target.value; render(); });

  function spawnEmbers(count = 26) {
    const box = $("#embers");
    if (!box || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    box.innerHTML = Array.from({ length: count }, () => {
      const size = 2 + Math.random() * 4;
      return `<i style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${9 + Math.random() * 12}s;animation-delay:${-Math.random() * 20}s;--drift:${Math.round(Math.random() * 160 - 80)}px"></i>`;
    }).join("");
  }

  async function loadVideos() {
    const { videos = [] } = await fetch("api/youtube").then((r) => r.json());
    const list = videos.filter((v) => !v.short).slice(0, 4);
    if (!list.length) return;
    $("#videoGrid").innerHTML = list
      .map(
        (v) => `<a class="video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
          <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy"><span>${esc(v.title)}</span></a>`
      )
      .join("");
    $("#videos").hidden = false;
  }

  async function loadReviews() {
    const { reviews = [], source = "" } = await fetch("reviews.json").then((r) => r.json());
    if (!reviews.length) return;
    const platform = source.replace(/ buyer feedback$/, "") || "marketplace";
    const card = (r) => `<article class="review">
        <p>“${esc(r.text)}”</p>
        <footer><strong>${esc(r.name)}</strong><span>${esc(platform)} buyer${r.date ? ` · ${esc(r.date.slice(0, 7))}` : ""}</span></footer>
      </article>`;
    const cards = reviews.map(card).join("");
    $("#reviewTrack").innerHTML = cards + cards;
    $("#reviewTotal").textContent = `Selected feedback our ${platform} buyers left for our seller account`;
    $("#reviews").hidden = false;
    raveBar(reviews);
  }

  // Top-of-page banner: rotates the punchiest short quotes (shipping, packaging, extras).
  function raveBar(reviews) {
    const bar = $("#raveBar");
    if (!bar) return;
    const hooks = /fast|quick|prompt|ship|packag|protect|extra|bonus|gift|freebie|note|sticker|perk|A\+/gi;
    const quotes = reviews
      .filter((r) => r.text.length <= 95)
      .map((r) => ({ r, score: (r.text.match(hooks) || []).length * 10 - r.text.length / 20 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((q) => q.r);
    if (!quotes.length) return;
    const quoteEl = $("#raveQuote");
    const show = (r) => {
      quoteEl.innerHTML = `<q>${esc(r.text)}</q> <cite>\u2014 ${esc(r.name)}</cite>`;
    };
    bar.setAttribute("aria-label", "Read feedback from our TCGplayer buyers");
    show(quotes[0]);
    bar.hidden = false;
    bar.addEventListener("click", (e) => {
      e.preventDefault();
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      $("#reviews").scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });
    if (quotes.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let paused = false;
    bar.addEventListener("mouseenter", () => (paused = true));
    bar.addEventListener("mouseleave", () => (paused = false));
    setInterval(() => {
      if (paused || document.hidden) return;
      quoteEl.classList.add("out");
      setTimeout(() => {
        i = (i + 1) % quotes.length;
        show(quotes[i]);
        quoteEl.classList.remove("out");
      }, 350);
    }, 4200);
  }

  // Link targets for posts and bios: ?game=pokemon, ?sort=new, ?q=obsidian
  function applyUrlFilters() {
    const p = new URLSearchParams(location.search);
    if (p.get("game") && GAMES[p.get("game")]) state.game = p.get("game");
    if (p.get("sort")) state.sort = p.get("sort");
    if (p.get("q")) state.q = p.get("q");
    if (state.sort !== "featured") $("#sort").value = state.sort;
    if (state.q) $("#search").value = state.q;
    return p.has("game") || p.has("sort") || p.has("q");
  }

  spawnEmbers();
  renderCartCount();
  const jumpToShop = applyUrlFilters();
  loadVideos().catch(() => {});
  loadReviews().catch(() => {});
  load().catch(() => {
    $("#grid").innerHTML = `<div class="empty">Couldn't load inventory. Please refresh.</div>`;
  });
})();
