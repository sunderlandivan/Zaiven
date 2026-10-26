// PC side of the host lease (rules in portalLeaseCore.js). The publish cycle calls checkLease() first and runs its write
// jobs only while this PC holds the lease; otherwise the PC stays passive ("cloud is in charge").
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { kvGetJsonOrNull, kvPutMany } from "./cloudflareKv.js";
import { notifyDesktop } from "./desktopNotify.js";
import { HANDOVER_KEY, LEASE_KEY, decideLease, forceTakeLease, leaseExpired, leaseSummary, newerLease } from "./portalLeaseCore.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_PATH = path.join(ROOT, "data", "portal-lease-audit.json");
// Mark paid / Cancel re-check the lease if the last check is older than one publish cycle.
const STALE_MS = 6 * 60_000;

export function appendAudit(entry) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
  } catch {
    /* first entry */
  }
  list.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(list.slice(-200), null, 2));
}

/** kv / notify / audit are injectable so tests never touch Cloudflare. */
export function createPcLease({
  me = { host: "pc", id: `pc:${os.hostname()}` },
  get = kvGetJsonOrNull,
  put = (key, value) => kvPutMany({ [key]: JSON.stringify(value) }),
  notify = notifyDesktop,
  audit = appendAudit,
  log = (msg) => console.log(`[portal-lease] ${msg}`),
  clock = Date.now,
} = {}) {
  let last = { checkedAt: null, holder: false, state: "unknown", reason: "Not checked yet.", lease: null, handover: null, error: "" };
  let written = null;
  let chain = Promise.resolve();
  const write = async (lease) => {
    await put(LEASE_KEY, lease);
    written = lease;
  };
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  const holdsLease = (now = clock()) => Boolean(last.holder && last.lease && last.lease.holder === me.id && !leaseExpired(last.lease, now));

  async function checkNow() {
    const now = clock();
    const wasHolder = holdsLease(now);
    try {
      const getRetry = (key) => get(key).catch(() => get(key));
      const read = await getRetry(LEASE_KEY);
      const handover = await getRetry(HANDOVER_KEY);
      const lease = newerLease(read, written);
      const d = decideLease({ lease, handover, me, now });
      if (d.write) await write(d.write);
      last = { checkedAt: new Date(now).toISOString(), holder: d.holder, state: d.state, reason: d.reason, lease: d.write || lease, handover, error: "" };
      if (d.state === "claimed" || d.state === "released" || d.holder !== wasHolder) log(d.reason);
      if (d.state === "released") {
        audit({ action: "lease released", detail: d.reason, by: me.id });
        notify("Portal: cloud is now in charge", "The PC portal handed the store's order and stock jobs to the cloud portal and is now passive.");
      } else if (d.state === "claimed") {
        audit({ action: "lease claimed", detail: d.reason, by: me.id });
      }
    } catch (e) {
      last = { ...last, checkedAt: new Date(now).toISOString(), holder: false, state: "error", reason: "Passive this cycle: couldn't read the lease from Cloudflare.", error: e.message };
      if (wasHolder) log(`lease check failed, skipping write jobs this cycle: ${e.message}`);
    }
    return status();
  }

  /** Owner "take" on the PC: only when the lease is missing, expired, or handed back to the PC. */
  async function takeNow(by = "pc owner") {
    const now = clock();
    const lease = newerLease(await get(LEASE_KEY), written);
    const next = forceTakeLease({ lease, me, now, by });
    await write(next);
    const was = lease ? `${lease.holder || `handed to ${lease.host}`}, ${leaseExpired(lease, now) ? "expired" : "live"}` : "missing";
    last = { checkedAt: new Date(now).toISOString(), holder: true, state: "claimed", reason: "Active host (taken by the owner).", lease: next, handover: null, error: "" };
    audit({ action: "lease force-taken", detail: `PC took the lease (was ${was})`, by });
    log(`owner took the lease (was ${was})`);
    return status();
  }

  function status() {
    const now = clock();
    return {
      me: me.id,
      holder: holdsLease(now),
      state: last.state,
      reason: last.reason,
      checkedAt: last.checkedAt,
      error: last.error,
      lease: leaseSummary(last.lease, me, now),
      handover: last.handover ? { to: last.handover.to, requestedAt: last.handover.requestedAt, by: last.handover.by } : null,
    };
  }

  return {
    me,
    holdsLease,
    status,
    checkLease: () => serial(checkNow),
    takeLease: (by) => serial(() => takeNow(by)),
    /** For owner actions outside the cycle (Mark paid, Cancel): refresh if stale, then refuse unless this PC holds the lease. */
    async requireLease() {
      if (!last.checkedAt || clock() - Date.parse(last.checkedAt) > STALE_MS) await serial(checkNow);
      if (!holdsLease()) throw new Error(`Passive — cloud is in charge. ${last.reason} Use the cloud portal for this.`);
    },
  };
}

export const pcLease = createPcLease();
