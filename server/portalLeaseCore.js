// Pure lease rules shared by the PC portal (server/portalLease.js) and the cloud portal (cloudflare-portal/src/lease.js).
// No Node or Worker APIs here: both runtimes import this file.
//
// KV `portal:active-host` = { host, holder, preferred, claimedAt, expiresAt, updatedAt, by }
//   host       "pc" | "cloud": the host that holds the lease, or that it was handed to
//   holder     instance id of the holder ("pc:<computer name>", "cloud:preeminent-portal"); null = handed over, not claimed yet
//   preferred  who may claim it once it has expired (always the last holder or the host it was handed to)
// KV `portal:handover` = { to, requestedAt, by }: written by the owner in the cloud portal; the holder releases on its next cycle.
//
// Only the holder of a valid lease runs write jobs (pull/delete orders, expire Zelle/Venmo, Sheet writes, KV pushes).
// Claims never overlap: a missing lease is claimed only by the PC, a handed-over lease only by its target, an expired one only
// by its preferred host, and the cloud claims nothing unless it is in active mode.

export const LEASE_KEY = "portal:active-host";
export const HANDOVER_KEY = "portal:handover";
export const LEASE_TTL_MS = 20 * 60_000;
// Both hosts check every 5 minutes; renewing only inside the last 11 minutes means one KV write per ~10 minutes,
// and one missed cycle still leaves 5 minutes of lease.
export const RENEW_WITHIN_MS = 11 * 60_000;
export const HANDOVER_MAX_AGE_MS = 60 * 60_000;
export const HOSTS = ["pc", "cloud"];

const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (v ? Date.parse(v) : NaN);
const other = (host) => (host === "pc" ? "cloud" : "pc");
const label = (host) => (host === "pc" ? "the PC portal" : "the cloud portal");

export const leaseExpired = (lease, now = Date.now()) => !lease || !(ms(lease.expiresAt) > now);

export function parseLease(value) {
  if (!value || typeof value !== "object" || !HOSTS.includes(value.host)) return null;
  return value;
}

/**
 * KV reads can lag a write by about a minute (and cache "not found"). Each host keeps the last lease it wrote and
 * trusts whichever of that and the KV read is newer, so it never acts on a stale copy of its own lease.
 */
export function newerLease(a, b) {
  a = parseLease(a);
  b = parseLease(b);
  if (!a || !b) return a || b;
  return ms(b.updatedAt) > ms(a.updatedAt) ? b : a;
}

export function claimLease(me, now = Date.now(), by = me.id) {
  return { host: me.host, holder: me.id, preferred: me.host, claimedAt: iso(now), expiresAt: iso(now + LEASE_TTL_MS), updatedAt: iso(now), by };
}

export function releaseLease(me, to, now = Date.now(), by = me.id) {
  return { host: to, holder: null, preferred: to, claimedAt: null, expiresAt: iso(now + LEASE_TTL_MS), updatedAt: iso(now), by, releasedBy: me.id };
}

function renewLease(lease, me, now) {
  return { ...lease, expiresAt: iso(now + LEASE_TTL_MS), updatedAt: iso(now), by: me.id };
}

/** A handover request counts only if it targets the other host, is under an hour old, and came after the current claim. */
export function pendingHandover(lease, handover, now = Date.now()) {
  if (!lease || !handover || !HOSTS.includes(handover.to) || handover.to === lease.host) return null;
  const at = ms(handover.requestedAt);
  if (!(at > now - HANDOVER_MAX_AGE_MS) || !(at > (ms(lease.claimedAt) || 0))) return null;
  return handover;
}

/**
 * One lease check. me = { host: "pc"|"cloud", id }. mayClaim = false keeps a host from claiming or keeping the lease
 * (the cloud in shadow mode: it hands anything it holds back to the PC).
 * Returns { holder, write (lease to store, or null), state, reason }.
 */
export function decideLease({ lease, handover = null, me, now = Date.now(), mayClaim = true }) {
  lease = parseLease(lease);
  const mine = Boolean(lease && lease.holder === me.id && !leaseExpired(lease, now));

  if (mine) {
    if (!mayClaim) return { holder: false, write: releaseLease(me, other(me.host), now), state: "released", reason: `Released to ${label(other(me.host))} (this host may not hold the lease).` };
    const h = pendingHandover(lease, handover, now);
    if (h) return { holder: false, write: releaseLease(me, h.to, now), state: "released", reason: `Handed over to ${label(h.to)} at the owner's request (${h.by || "owner"}).` };
    if (ms(lease.expiresAt) - now < RENEW_WITHIN_MS) return { holder: true, write: renewLease(lease, me, now), state: "renewed", reason: "Active host (lease renewed)." };
    return { holder: true, write: null, state: "held", reason: "Active host." };
  }

  if (!lease) {
    if (me.host === "pc" && mayClaim) return { holder: true, write: claimLease(me, now), state: "claimed", reason: "Active host (claimed the missing lease; the PC is the default host)." };
    return { holder: false, write: null, state: "passive", reason: "Passive: no lease yet. The PC portal claims it by default." };
  }

  const handedToMe = lease.host === me.host && !lease.holder;
  if (handedToMe && mayClaim) return { holder: true, write: claimLease(me, now), state: "claimed", reason: `Active host (claimed the lease handed over by ${lease.releasedBy || lease.by || "the other host"}).` };
  if (!mayClaim && lease.host === me.host && (!lease.holder || leaseExpired(lease, now))) {
    return { holder: false, write: releaseLease(me, other(me.host), now), state: "released", reason: `Released to ${label(other(me.host))} (this host may not hold the lease).` };
  }
  if (leaseExpired(lease, now)) {
    if (lease.preferred === me.host && mayClaim) return { holder: true, write: claimLease(me, now), state: "claimed", reason: "Active host (reclaimed an expired lease; this host is preferred)." };
    return { holder: false, write: null, state: "expired", reason: `Passive: the lease expired; waiting for ${label(lease.preferred)}. The owner can force-take it.` };
  }
  if (!lease.holder) return { holder: false, write: null, state: "passive", reason: `Passive: handed over to ${label(lease.host)}, waiting for it to claim.` };
  return { holder: false, write: null, state: "passive", reason: `Passive: ${lease.host === "cloud" ? "cloud" : "PC"} is in charge (${lease.holder}).` };
}

/** Owner force-take: allowed when the lease is missing, expired, or already handed to this host. Never over a live holder. */
export function forceTakeLease({ lease, me, now = Date.now(), by }) {
  lease = parseLease(lease);
  if (lease && lease.holder === me.id && !leaseExpired(lease, now)) return renewLease(lease, me, now);
  if (lease && !leaseExpired(lease, now) && !(lease.host === me.host && !lease.holder)) {
    throw new Error(`${label(lease.host)} holds a live lease until ${lease.expiresAt}. Request a handover instead, or wait for it to expire.`);
  }
  return claimLease(me, now, by || me.id);
}

/** Small, secret-free summary for status pages. */
export function leaseSummary(lease, me, now = Date.now()) {
  lease = parseLease(lease);
  if (!lease) return { present: false, mine: false, host: null, holder: null, expired: true };
  return {
    present: true,
    mine: lease.holder === me.id && !leaseExpired(lease, now),
    host: lease.host,
    holder: lease.holder,
    preferred: lease.preferred,
    expiresAt: lease.expiresAt,
    updatedAt: lease.updatedAt,
    by: lease.by,
    expired: leaseExpired(lease, now),
  };
}
