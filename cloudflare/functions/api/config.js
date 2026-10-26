import { json } from "../../lib/store.js";
import { manualPayConfig } from "../../lib/manualPay.js";

export async function onRequestGet({ env }) {
  return json({ paypalClientId: env.PAYPAL_CLIENT_ID, manualPay: await manualPayConfig(env) });
}
