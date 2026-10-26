// The host lease in the shared KV namespace (rules in server/portalLeaseCore.js, shared with the PC portal).
// The cloud runs write jobs only in active mode AND while it holds the lease; in shadow mode it never claims and
// hands back anything it holds.
import { HANDOVER_KEY, LEASE_KEY, decideLease, forceTakeLease, leaseExpired, leaseSummary, newerLease, pendingHandover, releaseLease } from "../../server/portalLeaseCore.js";
import { logActivity, readDoc, writeDoc } from "./docs.js";
import { getRole } from "./orders.js";

export const CLOUD_ME = { host: "cloud", id: "cloud:preeminent-portal" };
// D1 is strongly consistent; KV reads (from a cron in another location) can lag the cloud's own writes by a minute.
const LAST_WRITE_DOC = "lease-last-write";

export async function readLease(env) {
  const [kv, mine] = await Promise.all([env.STORE.get(LEASE_KEY, "json"), readDoc(env, LAST_WRITE_DOC, null)]);
  return newerLease(kv, mine);
}
const readHandover = (env) => env.STORE.get(HANDOVER_KEY, "json");
async function writeLease(env, lease) {
  await env.STORE.put(LEASE_KEY, JSON.stringify(lease));
  await writeDoc(env, LAST_WRITE_DOC, lease);
}

async function clearHandover(env) {
  if (await readHandover(env)) await env.STORE.delete(HANDOVER_KEY);
}

const holds = (lease, now = Date.now()) => Boolean(lease && lease.holder === CLOUD_ME.id && !leaseExpired(lease, now));

/** True only when the cloud may run write jobs right now: active mode and a live lease held by the cloud. */
export async function canWrite(env, role = null) {
  if ((role || (await getRole(env)).role) !== "active") return false;
  return holds(await readLease(env));
}

/** "active" (holds the lease), "passive" (active mode, waiting for the lease) or "shadow". */
export async function hostMode(env, role = null) {
  const r = role || (await getRole(env)).role;
  if (r !== "active") return "shadow";
  return holds(await readLease(env)) ? "active" : "passive";
}

/**
 * Once per cron tick: claim, renew, hand over or stay passive. One KV read; a write only when something changes
 * or the lease is inside its last 11 minutes.
 */
export async function syncLease(env, role) {
  const lease = await readLease(env);
  const d = decideLease({ lease, me: CLOUD_ME, mayClaim: role === "active" });
  if (d.write) await writeLease(env, d.write);
  if (d.state === "claimed") await clearHandover(env);
  if (d.state === "claimed" || d.state === "released") await logActivity(env, "lease", d.reason);
  return { holder: d.holder, state: d.state, reason: d.reason };
}

export async function leaseStatus(env) {
  const [lease, handover, role] = await Promise.all([readLease(env), readHandover(env), getRole(env)]);
  return {
    me: CLOUD_ME.id,
    role: role.role,
    mode: role.role !== "active" ? "shadow" : holds(lease) ? "active" : "passive",
    lease: leaseSummary(lease, CLOUD_ME),
    handover: handover ? { to: handover.to, requestedAt: handover.requestedAt, by: handover.by, pending: Boolean(pendingHandover(lease, handover)) } : null,
  };
}

export class LeaseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Owner actions from Cloud Status. Returns a short audit detail plus the new status. */
export async function leaseAction(env, action, email) {
  const role = (await getRole(env)).role;
  const lease = await readLease(env);
  const now = Date.now();
  let detail;
  if (action === "request") {
    if (role !== "active") throw new LeaseError(409, "Make the cloud active first. It stays passive until the PC hands over the lease.");
    if (holds(lease, now)) throw new LeaseError(409, "The cloud already holds the lease.");
    if (!lease || leaseExpired(lease, now)) throw new LeaseError(409, "No live lease to hand over (the PC portal isn't renewing it). Use Force take instead.");
    await env.STORE.put(HANDOVER_KEY, JSON.stringify({ to: "cloud", requestedAt: new Date(now).toISOString(), by: email }));
    detail = `handover to cloud requested (lease held by ${lease.holder || lease.host})`;
  } else if (action === "cancel") {
    await clearHandover(env);
    detail = "handover request cancelled";
  } else if (action === "release") {
    if (!holds(lease, now) && !(lease && lease.host === "cloud" && !lease.holder)) throw new LeaseError(409, "The cloud doesn't hold the lease.");
    await writeLease(env, releaseLease(CLOUD_ME, "pc", now, email));
    await clearHandover(env);
    detail = "lease handed back to the PC portal";
  } else if (action === "take") {
    if (role !== "active") throw new LeaseError(409, "Make the cloud active first.");
    let next;
    try {
      next = forceTakeLease({ lease, me: CLOUD_ME, now, by: email });
    } catch (e) {
      throw new LeaseError(409, e.message);
    }
    await writeLease(env, next);
    await clearHandover(env);
    detail = `lease force-taken by the cloud (was ${lease ? `${lease.holder || `handed to ${lease.host}`}, ${leaseExpired(lease, now) ? "expired" : "live"}` : "missing"})`;
  } else {
    throw new LeaseError(400, "action must be request, cancel, release or take");
  }
  await logActivity(env, "lease", detail);
  return { detail, status: await leaseStatus(env) };
}

/** Called when the owner switches the cloud to shadow: drop any pending request and hand back a lease the cloud holds. */
export async function onShadow(env, email) {
  await clearHandover(env);
  const lease = await readLease(env);
  if (lease && lease.host === "cloud" && (lease.holder === CLOUD_ME.id || !lease.holder)) {
    await writeLease(env, releaseLease(CLOUD_ME, "pc", Date.now(), email));
    return "lease handed back to the PC portal";
  }
  return "";
}
