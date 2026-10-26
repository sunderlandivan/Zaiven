// node --test server/limitedItems.test.js   (in-memory I/O only; never touches data/ or Cloudflare)
import assert from "node:assert/strict";
import test from "node:test";
import { applyLimitedItemRaises, capStockItems, limitedConfig, planRaises, setLimitedEnabled, shownQty } from "./limitedItems.js";

const ON_AT = "2026-10-10T00:00:00.000Z";
const cfgOn = (extra = {}) => limitedConfig({ limitedItems: { enabled: true, enabledAt: ON_AT, itemIds: ["704144", "692963"], ...extra } });
const order = (id, lines, extra = {}) => ({ id, paymentMethod: "paypal", createdAt: "2026-10-11T00:00:00.000Z", lines, ...extra });
const stock = () => ({
  704144: { n: "30th Celebration PC ETB", p: 999.99, q: 2, f: 79.58 },
  692963: { n: "The Hobbit CBD", p: 1999.99, q: 4, f: 598.53 },
  270481: { n: "Uprising Case", p: 242.99, q: 11, f: 232.4 },
});

function fakeIo({ settings, orders, history = [], lease = true }) {
  const io = {
    settings: structuredClone(settings),
    history: [...history],
    notes: [],
    holdsLease: () => lease,
    readSettings: () => structuredClone(io.settings),
    writeSettings: (s) => (io.settings = structuredClone(s)),
    readOrders: () => orders,
    readStock: stock,
    readCostFloors: () => ({}),
    readHistory: () => [...io.history],
    writeHistory: (h) => (io.history = [...h]),
    proposals: { proposals: [], seen: {} },
    readProposals: () => structuredClone(io.proposals),
    writeProposals: (s) => (io.proposals = structuredClone(s)),
    notify: (title, msg) => io.notes.push(msg),
    now: () => "2026-10-11T01:00:00.000Z",
  };
  return io;
}

test("stock cap: listed items show at most maxShown, others untouched", () => {
  const items = capStockItems(stock(), cfgOn());
  assert.equal(items["704144"].q, 1);
  assert.equal(items["692963"].q, 1);
  assert.equal(items["270481"].q, 11);
  assert.equal(shownQty("692963", 0, cfgOn()), 0);
  assert.equal(capStockItems(stock(), cfgOn({ maxShown: 3 }))["692963"].q, 3);
});

test("disabled: no cap, no raises, no writes", () => {
  const off = limitedConfig({ limitedItems: { enabled: false, enabledAt: ON_AT, itemIds: ["704144", "692963"] } });
  assert.deepEqual(capStockItems(stock(), off), stock());
  assert.equal(shownQty("704144", 2, off), 2);
  const io = fakeIo({ settings: { limitedItems: { ...off }, priceOverrides: {} }, orders: [order("A", [{ id: "704144", qty: 1, price: 999.99 }])] });
  assert.deepEqual(applyLimitedItemRaises(io), []);
  assert.deepEqual(io.settings.priceOverrides, {});
  assert.deepEqual(io.notes, []);
  assert.deepEqual(limitedConfig({}), { enabled: false, maxShown: 1, raiseAfterSale: 100, itemIds: [] });
});

test("one proposal per item per order, even when reprocessed; prices are never written", () => {
  const io = fakeIo({ settings: { limitedItems: cfgOn(), priceOverrides: { 270481: 242.99 } }, orders: [order("A", [{ id: "704144", qty: 1, price: 999.99, name: "30th PC ETB" }, { id: "270481", qty: 1, price: 242.99 }])] });
  const before = structuredClone(io.settings);
  const first = applyLimitedItemRaises(io);
  assert.equal(first.length, 1);
  assert.deepEqual(io.settings, before);
  const [p] = io.proposals.proposals;
  assert.equal(io.proposals.proposals.length, 1);
  assert.deepEqual([p.itemId, p.status, p.source, p.currentPrice, p.suggestedPrice, p.qtyLeft], ["704144", "pending", "limited-items", 999.99, 1099.99, 1]);
  assert.deepEqual(p.sales, [{ channel: "Website", orderNumber: "A", date: "2026-10-11", qty: 1, price: 999.99 }]);
  assert.equal(io.notes.length, 1);
  assert.match(io.notes[0], /30th PC ETB sold on the website \(order A\)\. Suggested \$999\.99 → \$1099\.99\. Nothing changes until you approve/);
  assert.deepEqual(applyLimitedItemRaises(io), []);
  assert.deepEqual(applyLimitedItemRaises(io), []);
  assert.equal(io.proposals.proposals.length, 1);
  assert.equal(io.history.length, 1);
  assert.equal(io.history[0].proposalId, p.id);
});

test("owner-locked prices are never changed; the proposal notes the lock", () => {
  const io = fakeIo({ settings: { limitedItems: cfgOn(), priceOverrides: {}, lockedPrices: { 704144: 999.99, 270481: 242.99 } }, orders: [order("A", [{ id: "704144", qty: 1, price: 999.99 }])] });
  assert.equal(applyLimitedItemRaises(io)[0].to, 1099.99);
  assert.deepEqual(io.settings.lockedPrices, { 704144: 999.99, 270481: 242.99 });
  assert.deepEqual(io.settings.priceOverrides, {});
  assert.equal(io.proposals.proposals[0].locked, true);
});

test("more sales of an item join its pending proposal instead of making a second one", () => {
  const io = fakeIo({
    settings: { limitedItems: cfgOn(), priceOverrides: { 692963: 2199.99 } },
    orders: [order("A", [{ id: "692963", qty: 1, price: 1999.99 }]), order("B", [{ id: "692963", qty: 1, price: 1999.99 }])],
  });
  const r = applyLimitedItemRaises(io);
  assert.deepEqual(r.map((x) => x.merged), [false, true]);
  assert.equal(io.proposals.proposals.length, 1);
  assert.equal(io.proposals.proposals[0].suggestedPrice, 2299.99);
  assert.deepEqual(io.proposals.proposals[0].sales.map((s) => s.orderNumber), ["A", "B"]);
  assert.equal(io.notes.length, 1);
  assert.equal(io.settings.priceOverrides["692963"], 2199.99);
  const later = fakeIo({ settings: io.settings, orders: [order("C", [{ id: "692963", qty: 1, price: 1999.99 }])], history: io.history });
  later.proposals = io.proposals;
  assert.equal(applyLimitedItemRaises(later)[0].merged, true);
  assert.equal(later.proposals.proposals.length, 1);
});

test("never below cost: the raised price is at least the profit floor", () => {
  const items = { 704144: { n: "x", p: 50.99, q: 2, f: 400 } };
  const r = planRaises({ cfg: cfgOn(), orders: [order("A", [{ id: "704144", qty: 1, price: 50.99 }])], stockItems: items, overrides: {}, history: [] });
  assert.equal(r[0].to, 400.99);
  assert.ok(r.every((x) => x.to > x.from && x.to >= items["704144"].f));
});

test("floor uses the highest unit cost, not the average", () => {
  const items = { 704144: { n: "x", p: 50.99, q: 2, f: 80 } };
  const costFloors = { 704144: { maxCost: 500, floor: 660.4 } };
  const r = planRaises({ cfg: cfgOn(), orders: [order("A", [{ id: "704144", qty: 1, price: 50.99 }])], stockItems: items, overrides: {}, history: [], costFloors });
  assert.equal(r[0].to, 660.99);
  const io = fakeIo({ settings: { limitedItems: cfgOn(), priceOverrides: {} }, orders: [order("A", [{ id: "692963", qty: 1, price: 1999.99 }])] });
  io.readCostFloors = () => ({ 692963: { maxCost: 2500, floor: 3300 } });
  assert.equal(applyLimitedItemRaises(io)[0].to, 3300.99);
});

test("only paid, non-test, non-cancelled orders after the rule was turned on", () => {
  const line = [{ id: "704144", qty: 1, price: 999.99 }];
  const orders = [
    order("OLD", line, { createdAt: "2026-10-09T00:00:00.000Z" }),
    order("TEST", line, { test: true }),
    order("ZWAIT", line, { paymentMethod: "zelle", status: "awaiting_payment" }),
    order("ZCANCEL", line, { paymentMethod: "zelle", status: "cancelled" }),
    order("ZPAID", line, { paymentMethod: "zelle", status: "paid", createdAt: "2026-10-09T00:00:00.000Z", paidAt: "2026-10-11T00:00:00.000Z" }),
  ];
  const r = planRaises({ cfg: cfgOn(), orders, stockItems: stock(), overrides: {}, history: [] });
  assert.deepEqual(r.map((x) => x.orderId), ["ZPAID"]);
});

test("passive host (no lease) never raises", () => {
  const io = fakeIo({ settings: { limitedItems: cfgOn(), priceOverrides: {} }, orders: [order("A", [{ id: "704144", qty: 1, price: 999.99 }])], lease: false });
  assert.deepEqual(applyLimitedItemRaises(io), []);
  assert.deepEqual(io.settings.priceOverrides, {});
  assert.deepEqual(io.proposals.proposals, []);
});

test("turning on stamps enabledAt once; prices are untouched by the toggle", () => {
  const io = fakeIo({ settings: { limitedItems: { enabled: false, maxShown: 1, raiseAfterSale: 100, itemIds: ["704144"] }, priceOverrides: { 1: 5 } }, orders: [] });
  assert.equal(setLimitedEnabled(true, io).enabledAt, "2026-10-11T01:00:00.000Z");
  io.now = () => "2026-12-01T00:00:00.000Z";
  assert.equal(setLimitedEnabled(true, io).enabledAt, "2026-10-11T01:00:00.000Z");
  assert.equal(setLimitedEnabled(false, io).enabled, false);
  assert.deepEqual(io.settings.priceOverrides, { 1: 5 });
});
