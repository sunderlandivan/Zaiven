// node --test server/storeCatalog.test.js   (pure helpers only; no Sheet, TCGplayer or file writes)
import assert from "node:assert/strict";
import test from "node:test";
import { explicitFloor, floorFor, inStockCatalog, labelKind, lockedPriceFor, minPriceFor, worstCaseTaxRate } from "./storeCatalog.js";
import { capStockItems, limitedConfig } from "./limitedItems.js";
import { applyDeckSales, ebayTitleMatches } from "./customDecks.js";
import { priceCart } from "../cloudflare/lib/store.js";

const salesTax = { enabled: true, baseRate: 0.0725, districts: [{ rate: 0.005 }, { rate: 0.01 }] };
const settings = {
  floorModel: "explicit",
  pricing: { feeRate: 0.15, minProfitPct: 0.1 },
  shipping: { standard: 10.99, single: 1.49 },
  salesTax,
  floor: { paypalPct: 0.0349, paypalFixed: 0.49, minProfitExisting: 0.15, minProfitNew: 0.1, reviewedOn: "2026-10-09", labels: { small: 6.11, etb: 9.47, box: 9.96, case: 23.05 } },
};
// Two rows: 3 units at $100 and 1 unit at $200 -> average $125, highest $200.
const box = { title: "Test - Play Booster Display - Test (TST)", type: "Box", ship: "standard", sheet: { cost: 125, maxCost: 200, shipping: 10.99 } };

/** Profit the owner's rule sees at price p (tax-inclusive PayPal fee, net shipping, tax not income). */
function profitAt(p, cost, label) {
  const fee = 0.0349 * (p + 10.99 + p * 0.0875) + 0.49;
  return p - fee - Math.max(0, label - 10.99) - cost;
}

test("locked price wins over the floor, up or down; the floor only flags it", () => {
  assert.deepEqual(lockedPriceFor(183.99, 171.12), { price: 183.99, belowFloor: false });
  assert.deepEqual(lockedPriceFor(29.99, 400), { price: 29.99, belowFloor: true });
  assert.equal(lockedPriceFor(undefined, 50), null);
  assert.equal(lockedPriceFor(0, 50), null);
});

test("PayPal fee includes worst-case CA tax on the price; floor is the lowest price at the profit minimum", () => {
  assert.equal(worstCaseTaxRate(salesTax), 0.0875);
  assert.equal(worstCaseTaxRate({ enabled: false, baseRate: 0.0725 }), 0);
  const f = explicitFloor({ cost: 200, minProfit: 0.15, shipCharged: 10.99, label: 9.96, taxRate: 0.0875, paypalPct: 0.0349, paypalFixed: 0.49 });
  assert.ok(profitAt(f, 200, 9.96) >= 0.15 * 200 - 1e-9);
  assert.ok(profitAt(f - 0.01, 200, 9.96) < 0.15 * 200);
  const noTax = explicitFloor({ cost: 200, minProfit: 0.15, shipCharged: 10.99, label: 9.96, taxRate: 0, paypalPct: 0.0349, paypalFixed: 0.49 });
  assert.ok(f > noTax);
  assert.equal(explicitFloor({ cost: 0, minProfit: 0.15, shipCharged: 10.99, label: 9.96, taxRate: 0.0875, paypalPct: 0.0349, paypalFixed: 0.49 }), 0);
});

test("net shipping counts only when the label costs more than the buyer pays (cases)", () => {
  const args = { cost: 1000, minProfit: 0.15, shipCharged: 10.99, taxRate: 0.0875, paypalPct: 0.0349, paypalFixed: 0.49 };
  const caseFloor = explicitFloor({ ...args, label: 23.05 });
  const boxFloor = explicitFloor({ ...args, label: 9.96 });
  assert.ok(caseFloor > boxFloor);
  assert.ok(profitAt(caseFloor, 1000, 23.05) >= 150 - 1e-9);
  assert.equal(labelKind("Fujimi Fantasia Bunko Vol. 2 Booster Box Case - X"), "case");
  assert.equal(labelKind("Origins - Booster Display - Origins (OGN)"), "box");
  assert.equal(labelKind("Perfect Order Booster Bundle - ME03"), "small");
  assert.equal(labelKind("Pitch Black Elite Trainer Box - ME05"), "etb");
});

test("existing items need 15% profit on the HIGHEST cost, new items 10%", () => {
  const existing = floorFor(box, settings, { isNew: false });
  const fresh = floorFor(box, settings, { isNew: true });
  assert.ok(existing > fresh);
  assert.ok(profitAt(existing, 200, 9.96) >= 30 - 1e-9 && profitAt(existing - 0.01, 200, 9.96) < 30);
  assert.ok(profitAt(fresh, 200, 9.96) >= 20 - 1e-9 && profitAt(fresh - 0.01, 200, 9.96) < 20);
});

test("public catalog hides sold-out items, keeps prices, and brings restocks back", () => {
  const catalog = { updatedAt: "x", count: 4, items: [{ id: "a", price: 999.99 }, { id: "b", price: 49.99 }, { id: "c", price: 10.99 }, { id: "d", price: 5.99 }] };
  const stock = { a: { q: 4 }, b: { q: 0 }, c: { q: 2 } };
  const pub = inStockCatalog(catalog, stock);
  assert.deepEqual(pub.items.map((i) => i.id), ["a", "c"]);
  assert.equal(pub.count, 2);
  assert.deepEqual(pub.items.map((i) => i.price), [999.99, 10.99]);
  assert.equal(catalog.items.length, 4);
  assert.deepEqual(inStockCatalog(catalog, { ...stock, b: { q: 3 } }).items.map((i) => i.id), ["a", "b", "c"]);
});

test("limited items (show 1) stay listed while real stock > 0", () => {
  const cfg = limitedConfig({ limitedItems: { enabled: true, enabledAt: "2026-10-09T00:00:00Z", itemIds: ["a", "b"] } });
  const stock = capStockItems({ a: { q: 7 }, b: { q: 0 } }, cfg);
  assert.deepEqual(inStockCatalog({ items: [{ id: "a" }, { id: "b" }] }, stock).items.map((i) => i.id), ["a"]);
  assert.equal(stock.a.q, 1);
});

test("custom decks: synced website sales and later eBay sales lower stock once; sold-out decks drop off", () => {
  const ebayTitle = "Pokemon Standard Alakazam POWER Premade TCG Deck! Great 4 Starters & Veterans!";
  const file = {
    capturedFromEbayAt: "2026-10-09",
    decks: [
      { id: "deck-1", qty: 1, ebay: { title: ebayTitle } },
      { id: "deck-2", qty: 3, ebay: { title: "Pokemon Standard Grass Water Premade TCG Deck! Great 4 Starters & Veterans!" } },
    ],
  };
  const orders = [
    { id: "INV-9", lines: [{ id: "deck-2", qty: 1 }, { id: "618893", qty: 1 }] },
    { id: "INV-10", lines: [{ id: "deck-2", qty: 1 }] },
  ];
  const events = [
    { id: "web:INV-9", status: "applied" },
    { id: "web:INV-10", status: "needs_review" },
    { id: "ebay:old", source: "ebay", status: "applied", createdAt: "2026-10-01T00:00:00Z", lines: [{ description: ebayTitle, qty: 1 }] },
    { id: "ebay:new", source: "ebay", status: "applied", createdAt: "2026-10-10T00:00:00Z", lines: [{ description: "Pokemon Standard Alakazam POWER Premade TCG Deck! Gr", qty: 1 }] },
  ];
  assert.equal(applyDeckSales(file, { orders, events }), 2);
  assert.deepEqual(file.decks.map((d) => d.qty), [0, 2]);
  assert.equal(applyDeckSales(file, { orders, events }), 0);
  assert.deepEqual(file.decks.map((d) => d.qty), [0, 2]);
  assert.deepEqual(inStockCatalog({ items: [{ id: "deck-1" }, { id: "deck-2" }] }, { "deck-1": { q: 0 }, "deck-2": { q: 2 } }).items.map((i) => i.id), ["deck-2"]);
  assert.ok(!ebayTitleMatches("Pokemon Standard", ebayTitle));
});

test("checkout shipping: deck-only orders pay the deck rate; sealed in the cart means standard only", () => {
  const stock = {
    shipping: { standard: 10.99, single: 1.49, freeOver: null },
    items: {
      deck: { n: "Deck", t: "Deck", p: 14.99, q: 2, s: "deck", sh: 5.68 },
      deck2: { n: "Deck 2", t: "Deck 2", p: 24.99, q: 1, s: "deck", sh: 5.68 },
      box: { n: "Box", t: "Box", p: 99.99, q: 3, s: "standard" },
      card: { n: "Card", t: "Card", p: 3, q: 3, s: "single" },
    },
  };
  const ship = (cart) => priceCart(stock, cart).shipping;
  assert.equal(ship([{ id: "deck", qty: 1 }]), 568);
  assert.equal(ship([{ id: "deck", qty: 2 }, { id: "deck2", qty: 1 }]), 568);
  assert.equal(ship([{ id: "deck", qty: 1 }, { id: "card", qty: 1 }]), 568);
  assert.equal(ship([{ id: "deck", qty: 1 }, { id: "box", qty: 1 }]), 1099);
  assert.equal(ship([{ id: "box", qty: 1 }]), 1099);
  assert.equal(ship([{ id: "card", qty: 2 }]), 149);
  assert.equal(priceCart(stock, [{ id: "deck", qty: 1 }]).total, 1499 + 568);
  assert.equal(priceCart({ ...stock, items: { deck: { ...stock.items.deck, sh: undefined } } }, [{ id: "deck", qty: 1 }]).shipping, 1099);
});

test("legacy model is unchanged: sheet formula on the average cost", () => {
  const legacy = floorFor(box, { ...settings, floorModel: "legacy" });
  assert.equal(legacy, minPriceFor(125, 10.99, settings.pricing));
  assert.equal(legacy, 163.71);
});
