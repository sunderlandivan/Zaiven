import { getValidAccessToken } from "../server/gmailOrders.js";
import axios from "axios";

const token = await getValidAccessToken();
const headers = { Authorization: "Bearer " + token };

const queries = [
  "newer_than:5d from:tcgplayer.com",
  "newer_than:5d (ebay OR ebay.com) (sold OR sale OR shipped OR label OR tracking)",
  "newer_than:3d (shipped OR tracking OR \"You sold\" OR \"item sold\" OR \"order confirmed\")",
];

for (const q of queries) {
  const list = await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
    headers, params: { q, maxResults: 10 },
  });
  console.log("\n===", q, "est", list.data.resultSizeEstimate, "===");
  for (const m of list.data.messages || []) {
    const full = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`, {
      headers, params: { format: "metadata", metadataHeaders: ["Subject", "From", "Date"] },
    });
    const h = Object.fromEntries((full.data.payload?.headers || []).map((x) => [x.name, x.value]));
    console.log((h.Date || "").slice(0, 28), "|", (h.From || "").slice(0, 40), "|", (h.Subject || "").slice(0, 100));
  }
}
