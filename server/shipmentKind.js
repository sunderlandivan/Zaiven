/**
 * Singles (individual cards) ship in plain envelopes without tracking; sealed product and larger
 * orders ship with a USPS label. Classification is computed on read and never persisted.
 */

const SEALED_RE = new RegExp(
  [
    "booster\\s+(?:display|box|bundle|pack|case|brick)",
    "(?:play|collector|set|draft|jumpstart|sleeved|bonus|omega|beyond|prerelease)\\s+boosters?",
    "elite\\s+trainer\\s+box",
    "trainer\\s+box",
    "\\betb\\b",
    "commander(?:'s)?\\s+(?:deck|bundle|collection)",
    "precon",
    "(?:starter|theme|structure|battle|league\\s+battle|challenger|intro|planeswalker)\\s+(?:deck|kit|set)s?",
    "bundle",
    "\\bdisplay\\b",
    "collection",
    "(?:mini|collector'?s?|poke\\s?ball|stacking|holiday|premium)\\s+tins?",
    "\\btins?\\s*$",
    "blister",
    "prerelease\\s+(?:kit|pack)",
    "gift\\s+(?:box|set)",
    "build\\s*(?:&|and)\\s*battle",
    "box\\s+set",
    "(?:booster|display|sealed)\\s+case",
    "\\bsealed\\b",
    "\\bunopened\\b",
    "\\d-pack",
    "deck\\s+box",
  ].join("|"),
  "i"
);

/** Bare product-form words; weaker than SEALED_RE because card names use them too ("Pack Rat", "Case of the …"). */
const SEALED_WORD_RE = /\b(?:boosters?|box(?:es)?|etbs?|bundles?|(?<!^)cases?|decks?|collections?|tins?|displays?|packs?)\b(?!\s+(?:of|rat)\b)/i;

const PLACEHOLDER_RE = /^tcgplayer order\b/i;

function itemTexts(order) {
  const out = [];
  for (const li of Array.isArray(order?.lineItems) ? order.lineItems : []) {
    const d = String(li?.description || "").trim();
    if (d) out.push(d);
  }
  const p = String(order?.productName || "").trim();
  if (p && !PLACEHOLDER_RE.test(p)) out.push(p);
  return out;
}

/** @returns {{ kind: "singles"|"sealed"|"unknown", reason: string }} */
export function classifyShipmentKind(order) {
  const hint = String(order?.itemConditionHint || "");
  if (hint === "sealed") return { kind: "sealed", reason: "sale email lists Unopened items" };
  const texts = itemTexts(order);
  const sealedText = texts.find((t) => SEALED_RE.test(t));
  if (sealedText) return { kind: "sealed", reason: "sealed product name" };
  if (/expedit|priority|express/i.test(String(order?.shippingType || ""))) {
    return { kind: "unknown", reason: "expedited shipping" };
  }
  if (hint === "singles") return { kind: "singles", reason: "sale email lists card conditions" };
  if (texts.some((t) => SEALED_WORD_RE.test(t))) return { kind: "sealed", reason: "sealed product word" };
  if (texts.length) return { kind: "singles", reason: "card names only" };
  const ship = Number(order?.shippingCost || 0);
  if (ship > 0 && ship < 2) return { kind: "singles", reason: "envelope-rate shipping" };
  const total = Number(order?.orderAmount || order?.salePrice || 0);
  if (total > 0 && total < 20) return { kind: "singles", reason: "small total, no item info" };
  return { kind: "unknown", reason: "no item info" };
}

/** tracked | no_tracking (manual/stamp mark) | canceled | singles_no_tracking | missing */
export function computeTrackingState(order, kind = classifyShipmentKind(order).kind) {
  if (String(order?.trackingNumber || "").trim()) return "tracked";
  if (order?.noTrackingNeeded) return "no_tracking";
  if (/cancel|refund/i.test(String(order?.status || ""))) return "canceled";
  if (kind === "singles") return "singles_no_tracking";
  return "missing";
}

export function decorateOrderShipment(order) {
  const { kind, reason } = classifyShipmentKind(order);
  return {
    ...order,
    shipmentKind: kind,
    shipmentKindReason: reason,
    trackingState: computeTrackingState(order, kind),
  };
}
