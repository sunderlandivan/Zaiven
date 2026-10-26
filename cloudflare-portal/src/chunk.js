/** D1 rejects SQL statements over 100 KB; parts stay well under that even after quote escaping. */
export const PART_BYTES = 80_000;

/** Splits text into parts of at most PART_BYTES UTF-8 bytes (with ' doubled), never inside a surrogate pair. */
export function splitParts(text) {
  const parts = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length;
    const b = c === 39 ? 2 : c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + b > PART_BYTES) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += b;
    if (pair) i++;
  }
  parts.push(text.slice(start));
  return parts;
}
