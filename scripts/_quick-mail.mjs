import { getValidAccessToken } from "../server/gmailOrders.js";
import axios from "axios";
const token = await getValidAccessToken();
const headers = { Authorization: "Bearer " + token };
const queries = [
  "newer_than:7d Merchant Center",
  "newer_than:7d counterfeit OR misrepresentation",
  "newer_than:14d from:ebay.com",
  "newer_than:7d from:tcgplayer.com",
];
for (const q of queries) {
  const list = await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/messages", { headers, params: { q, maxResults: 8 } });
  const msgs = list.data.messages || [];
  console.log("\nQ:", q, "est", list.data.resultSizeEstimate);
  for (const m of msgs.slice(0, 5)) {
    const full = await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + m.id, { headers, params: { format: "metadata", metadataHeaders: ["Subject", "From", "Date"] } });
    const h = Object.fromEntries((full.data.payload?.headers || []).map((x) => [x.name, x.value]));
    console.log("-", (h.Date || "").slice(0, 25), "|", (h.Subject || "").slice(0, 95));
  }
}
