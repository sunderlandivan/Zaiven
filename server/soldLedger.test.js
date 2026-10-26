import test from "node:test";
import assert from "node:assert/strict";
import { mapColumns, soldRowHasOrder, SOLD_EXTRA_HEADERS } from "./sheetLedger.js";
import { orderDbSaleEvent } from "./emailIntake.js";

const SOLD_HEADERS = [
  "Item ID", "Item name", "Type", "Qty", "Cost w/ Tax", "Total Inv $", "Sold 4", "Sold 4 Ttl",
  "Shipping Charged", "Fees", "Actual Net", "Profit", "Profit %", "Fees %", "Date",
  ...SOLD_EXTRA_HEADERS,
];

test("Sold 2026 tax columns are recognised", () => {
  const cols = mapColumns(SOLD_HEADERS);
  const at = (h) => SOLD_HEADERS.indexOf(h);
  assert.equal(cols.orderNumber, at("Order #"));
  assert.equal(cols.channel, at("Channel"));
  assert.equal(cols.marketTax, at(SOLD_EXTRA_HEADERS[2]));
  assert.equal(cols.ourTax, at(SOLD_EXTRA_HEADERS[3]));
  assert.equal(cols.labelCost, at("Label Cost"));
  assert.equal(cols.refund, at("Refund"));
  assert.equal(cols.feeBasis, at("Fee Basis"));
  assert.equal(cols.notes, at("Notes"));
  assert.equal(cols.date, at("Date"));
  assert.equal(cols.fees, at("Fees"));
});

test("order-number dedupe matches one of several order numbers on a row, per item", () => {
  const row = { itemId: "SWSH10 Booster Pack", orderNumber: "DC5D041D-4078DF-FED62, 14-14373-92507" };
  assert.ok(soldRowHasOrder(row, "dc5d041d-4078df-fed62", "SWSH10 Booster Pack"));
  assert.ok(soldRowHasOrder(row, "14-14373-92507"));
  assert.ok(!soldRowHasOrder(row, "DC5D041D-4078DF-FED62", "Other item"));
  assert.ok(!soldRowHasOrder(row, "DC5D041D-4078DF"));
  assert.ok(!soldRowHasOrder(row, ""));
});

test("manual Orders-page sales become Sold 2026 events", () => {
  const ev = orderDbSaleEvent({
    id: "ord_123", platform: "local", productName: "Aetherdrift Play Booster Display", quantity: 2,
    salePrice: 300, feeAmount: 0, purchaseDate: "2026-10-11", status: "Shipped",
  });
  assert.equal(ev.id, "manual:ord_123");
  assert.equal(ev.orderNumber, "ord_123");
  assert.equal(ev.vendor, "In person (manual)");
  assert.equal(ev.shippingCharged, 0);
  assert.equal(ev.orderGross, 300);
  assert.deepEqual(ev.lines, [{ description: "Aetherdrift Play Booster Display", qty: 2 }]);
  assert.ok(ev.parseConfident);
});

test("manual eBay entries are held for review; canceled and junk orders are skipped", () => {
  const ebay = orderDbSaleEvent({ id: "ord_9", platform: "ebay", productName: "Deck", quantity: 1, salePrice: 40, purchaseDate: "2026-10-11" });
  assert.equal(ebay.parseConfident, false);
  assert.match(ebay.parseNote, /eBay sale email/);
  assert.equal(orderDbSaleEvent({ id: "x", platform: "local", productName: "A", salePrice: 5, purchaseDate: "2026-10-11", status: "Canceled" }), null);
  assert.equal(orderDbSaleEvent({
    orderNumber: "E402B8AB-C0FB7C-073D4", platform: "tcgplayer", productName: "TCGplayer Order E402B8AB-C0FB7C-073D4",
    lineItems: [], orderAmount: 0, purchaseDate: "2026-10-01", status: "Open",
  }), null);
});

test("TCGplayer orders keep real fees and marketplace tax", () => {
  const ev = orderDbSaleEvent({
    orderNumber: "DC5D041D-592B81-BEC83", platform: "tcgplayer", purchaseDate: "2026-10-10", status: "Completed",
    orderAmount: 1101.97, buyerTax: 91, buyerTaxActual: 91, feesActual: 146.64, feeAmount: 140,
    lineItems: [{ description: "Tarkir Dragonstorm Collector Booster Display", quantity: 2 }],
  });
  assert.equal(ev.id, "tcgplayer:DC5D041D-592B81-BEC83");
  assert.equal(ev.orderFees, 146.64);
  assert.equal(ev.feeBasis, "actual");
  assert.equal(ev.marketTax, 91);
  assert.equal(ev.orderGross, 1010.97);
  assert.equal(ev.shippingCharged, undefined);
});
