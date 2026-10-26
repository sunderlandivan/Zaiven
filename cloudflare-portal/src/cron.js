import { logActivity, writeDoc } from "./docs.js";
import { GoogleBudget } from "./google.js";
import { syncLease } from "./lease.js";
import { getRole, peekKvOrders, publishCycle } from "./orders.js";
import { mirrorSheet } from "./sheet.js";

/**
 * Runs every 5 minutes. Every tick checks the host lease (src/lease.js). Shadow mode, and active mode without the lease
 * (the PC portal is still in charge), only read: a KV peek every 15 minutes and a Sheet mirror every 30. Only the
 * lease holder in active mode runs the PC portal's publish cycle.
 */
export async function runTick(env, scheduledTime = Date.now(), { forceAll = false } = {}) {
  const minute = new Date(scheduledTime).getUTCMinutes();
  const { role } = await getRole(env);
  const out = { at: new Date().toISOString(), role };
  try {
    out.lease = await syncLease(env, role);
    if (role === "active" && out.lease.holder) out.publish = await publishCycle(env, { writer: true });
    else if (forceAll || minute % 15 < 5) out.peek = { count: (await peekKvOrders(env)).count };
  } catch (e) {
    out.error = e.message;
  }
  if (forceAll || minute % 30 < 5) {
    try {
      out.sheet = await mirrorSheet(env, new GoogleBudget(10));
    } catch (e) {
      out.sheetError = e.message;
    }
  }
  await writeDoc(env, "cron-state", out);
  const problems = [out.error, out.sheetError, out.publish?.error].filter(Boolean);
  if (problems.length) await logActivity(env, "error", problems.join(" | "));
  else if (out.publish?.newOrders || out.sheet?.changed) {
    await logActivity(env, "cron", `orders pulled: ${out.publish?.newOrders || 0}; sheet changed: ${Boolean(out.sheet?.changed)}`);
  }
  return out;
}
