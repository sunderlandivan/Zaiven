import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CATALOG_PATH } from "./storeCatalog.js";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const STOREFRONT = path.join(ROOT, "storefront");
export const PROMO_DIR = path.join(ROOT, "data", "promo-shorts");
const INDEX_PATH = path.join(PROMO_DIR, "index.json");

export const HOOKS = [
  "My wallet when it sees this 👀",
  'POV: you said "just one more pack" 🫠',
  "Me pretending I don't need another box 🙃",
  "Nobody:\nMe at 2am: 🛒",
  "Rate my self-control:\n0/10 😅",
  "Sealed. Unlike my financial decisions 💸",
  "This box has more hits than my dating life 💔",
  "Therapist: what do we say?\nMe: ADD TO CART 🛒",
  "Warning: may cause sudden pack ripping ⚠️",
  "I came for one pack.\nI left with this 😳",
];
export const SINGLE_HOOKS = [
  "This card deserves a sleeve AND a toploader 🛡️",
  "Found my new binder MVP 🏆",
  "Pulled it? No.\nBought it? Absolutely 😎",
  "Me skipping 40 packs and just buying the card 🧠",
];
export const STICKERS = [
  "Cheaper than therapy 🧠",
  "Your wallet: 😭",
  "Ramen for a week? Worth it 🍜",
  "Totally an investment 📈",
  "Don't tell your partner 🤫",
  "Treat yourself (again) 🎁",
  "Self-control has left the chat 🚪",
];
export const CHEAP_STICKERS = ["Less than a coffee ☕", "Pocket change 🪙", "Basically free 😤"];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

export function listPromoProducts() {
  return readCatalog()
    .items.filter((i) => i.image)
    .map((i) => ({ id: i.id, name: i.name, set: i.set, type: i.type, price: i.price, low: i.low }));
}

export function listPromoShorts() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return [];
  }
}

function captionFor(item, url, hook) {
  const tags = { pokemon: "#pokemon #pokemontcg", magic: "#mtg #magicthegathering", fab: "#fleshandblood", weiss: "#weissschwarz", riftbound: "#riftbound" };
  return [
    hook.replace(/\n/g, " "),
    `${item.name}, $${item.price.toFixed(2)} at The PreEminent Store.${item.low ? " Low stock!" : ""}`,
    `Shop: ${url}`,
    `Factory sealed, ships fast within the US.`,
    `${tags[item.game] || "#tcg"} #tcg #sealedproduct #shorts #funny`,
  ].join("\n");
}

/**
 * Renders a 12-second 1080x1920 product promo (YouTube Shorts / Instagram Reels) with a joke hook, animated reveal,
 * price stamp, sticker and sound effects. hook/sticker default to a random joke.
 */
export async function makePromoShort(productId, { hook, sticker } = {}) {
  const item = readCatalog().items.find((i) => i.id === String(productId));
  if (!item) throw new Error("That product isn't in the store right now.");
  const image = path.join(STOREFRONT, item.image || "");
  if (!item.image || !fs.existsSync(image)) throw new Error("That product has no photo yet.");

  const single = item.type === "Single";
  const finalHook = String(hook || "").trim().slice(0, 90) || pick(single ? [...SINGLE_HOOKS, ...HOOKS.slice(0, 3)] : HOOKS);
  const finalSticker = String(sticker || "").trim().slice(0, 40) || pick(item.price < 8 ? CHEAP_STICKERS : STICKERS);

  fs.mkdirSync(PROMO_DIR, { recursive: true });
  const file = `${item.id}-${Date.now()}.mp4`;
  const specPath = path.join(os.tmpdir(), `promo-${Date.now()}.json`);
  fs.writeFileSync(
    specPath,
    JSON.stringify({
      out: path.join(PROMO_DIR, file),
      image,
      name: item.name,
      set: item.set,
      game: item.game,
      price: item.price,
      low: item.low,
      hook: finalHook,
      sticker: finalSticker,
      seed: Date.now() % 100000,
    })
  );
  try {
    await run(process.execPath, [path.join(ROOT, "server", "promoRender.js"), specPath], { cwd: ROOT, timeout: 240000, windowsHide: true });
  } catch (e) {
    throw new Error(`Render failed: ${(e.stderr || e.message).trim().slice(-300)}`);
  } finally {
    fs.rmSync(specPath, { force: true });
  }

  const url = `https://preeminentstore.com/p/${item.id}?ref=yt-short`;
  const entry = {
    file,
    productId: item.id,
    name: item.name,
    price: item.price,
    hook: finalHook,
    sticker: finalSticker,
    createdAt: new Date().toISOString(),
    caption: captionFor(item, url, finalHook),
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify([entry, ...listPromoShorts()].slice(0, 100), null, 2));
  return entry;
}
