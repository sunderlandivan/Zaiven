// node --test server/portalLease.test.js   (fake KV only; never touches Cloudflare)
import assert from "node:assert/strict";
import test from "node:test";
import { createPcLease } from "./portalLease.js";
import { HANDOVER_KEY, LEASE_KEY, LEASE_TTL_MS, claimLease, decideLease, forceTakeLease, newerLease, releaseLease } from "./portalLeaseCore.js";

const PC = { host: "pc", id: "pc:TEST" };
const CLOUD = { host: "cloud", id: "cloud:preeminent-portal" };
const MIN = 60_000;
const T0 = Date.parse("2026-10-08T12:00:00Z");

test("missing lease: the PC claims it, the cloud never does", () => {
  const pc = decideLease({ lease: null, me: PC, now: T0 });
  assert.equal(pc.state, "claimed");
  assert.equal(pc.write.holder, PC.id);
  assert.equal(pc.write.preferred, "pc");
  assert.equal(Date.parse(pc.write.expiresAt), T0 + LEASE_TTL_MS);
  for (const mayClaim of [true, false]) {
    const c = decideLease({ lease: null, me: CLOUD, now: T0, mayClaim });
    assert.equal(c.holder, false);
    assert.equal(c.write, null);
  }
});

test("renews only inside the last 11 minutes", () => {
  const lease = claimLease(PC, T0);
  assert.deepEqual([decideLease({ lease, me: PC, now: T0 + 5 * MIN }).state, decideLease({ lease, me: PC, now: T0 + 5 * MIN }).write], ["held", null]);
  const d = decideLease({ lease, me: PC, now: T0 + 10 * MIN });
  assert.equal(d.state, "renewed");
  assert.equal(Date.parse(d.write.expiresAt), T0 + 10 * MIN + LEASE_TTL_MS);
  assert.equal(d.write.claimedAt, lease.claimedAt);
});

test("a live lease keeps the other host passive", () => {
  const lease = claimLease(PC, T0);
  const c = decideLease({ lease, me: CLOUD, now: T0 + MIN });
  assert.equal(c.holder, false);
  assert.match(c.reason, /PC is in charge/);
  const p = decideLease({ lease: claimLease(CLOUD, T0), me: PC, now: T0 + MIN });
  assert.equal(p.holder, false);
  assert.match(p.reason, /cloud is in charge/);
});

test("expired lease: only the preferred host reclaims it", () => {
  const pcLease = claimLease(PC, T0);
  const later = T0 + LEASE_TTL_MS + MIN;
  assert.equal(decideLease({ lease: pcLease, me: PC, now: later }).state, "claimed");
  assert.equal(decideLease({ lease: pcLease, me: CLOUD, now: later }).state, "expired");
  const cloudLease = claimLease(CLOUD, T0);
  assert.equal(decideLease({ lease: cloudLease, me: PC, now: later }).state, "expired");
  assert.equal(decideLease({ lease: cloudLease, me: CLOUD, now: later }).state, "claimed");
});

test("handover: the PC releases on a fresh request; stale or old requests are ignored", () => {
  const lease = claimLease(PC, T0);
  const fresh = { to: "cloud", requestedAt: new Date(T0 + 2 * MIN).toISOString(), by: "owner@example.com" };
  const d = decideLease({ lease, handover: fresh, me: PC, now: T0 + 3 * MIN });
  assert.equal(d.state, "released");
  assert.equal(d.holder, false);
  assert.deepEqual([d.write.host, d.write.holder, d.write.preferred], ["cloud", null, "cloud"]);
  const beforeClaim = { ...fresh, requestedAt: new Date(T0 - MIN).toISOString() };
  assert.equal(decideLease({ lease, handover: beforeClaim, me: PC, now: T0 + 3 * MIN }).holder, true);
  const old = { ...fresh, requestedAt: new Date(T0 + MIN).toISOString() };
  const renewed = { ...lease, expiresAt: new Date(T0 + 80 * MIN).toISOString() };
  assert.equal(decideLease({ lease: renewed, handover: old, me: PC, now: T0 + 62 * MIN }).holder, true, "request over an hour old is ignored");
});

test("a lease handed to the cloud: the cloud claims it in active mode, the PC never takes it back on its own", () => {
  const handed = releaseLease(PC, "cloud", T0);
  assert.equal(decideLease({ lease: handed, me: CLOUD, now: T0 + MIN, mayClaim: true }).state, "claimed");
  assert.equal(decideLease({ lease: handed, me: PC, now: T0 + MIN }).holder, false);
  assert.equal(decideLease({ lease: handed, me: PC, now: T0 + LEASE_TTL_MS + MIN }).state, "expired");
});

test("cloud in shadow mode hands back anything it holds or was handed", () => {
  for (const lease of [claimLease(CLOUD, T0), releaseLease(PC, "cloud", T0), { ...claimLease(CLOUD, T0 - LEASE_TTL_MS - MIN) }]) {
    const d = decideLease({ lease, me: CLOUD, now: T0 + MIN, mayClaim: false });
    assert.equal(d.holder, false);
    assert.deepEqual([d.write?.host, d.write?.holder], ["pc", null]);
  }
  assert.equal(decideLease({ lease: releaseLease(CLOUD, "pc", T0), me: PC, now: T0 + MIN }).state, "claimed");
});

test("force take never overrides a live holder", () => {
  assert.throws(() => forceTakeLease({ lease: claimLease(PC, T0), me: CLOUD, now: T0 + MIN }), /holds a live lease/);
  assert.equal(forceTakeLease({ lease: claimLease(PC, T0), me: CLOUD, now: T0 + LEASE_TTL_MS + 1 }).holder, CLOUD.id);
  assert.equal(forceTakeLease({ lease: null, me: CLOUD, now: T0, by: "owner" }).by, "owner");
  assert.equal(forceTakeLease({ lease: releaseLease(CLOUD, "pc", T0), me: PC, now: T0 + MIN }).holder, PC.id);
});

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    put: async (k, v) => void store.set(k, structuredClone(v)),
  };
}

test("PC lease module: claim, hand over, refuse owner writes, take back after expiry", async () => {
  let now = T0;
  const kv = fakeKv();
  const audits = [];
  const notes = [];
  const lease = createPcLease({ me: PC, get: kv.get, put: kv.put, clock: () => now, audit: (e) => audits.push(e), notify: (t) => notes.push(t), log: () => {} });

  assert.equal(lease.holdsLease(), false);
  assert.equal((await lease.checkLease()).holder, true);
  assert.equal(kv.store.get(LEASE_KEY).holder, PC.id);
  await lease.requireLease();

  now += 5 * MIN;
  kv.store.set(HANDOVER_KEY, { to: "cloud", requestedAt: new Date(now - MIN).toISOString(), by: "owner@example.com" });
  const s = await lease.checkLease();
  assert.equal(s.holder, false);
  assert.equal(s.state, "released");
  assert.equal(kv.store.get(LEASE_KEY).host, "cloud");
  assert.ok(audits.some((a) => a.action === "lease released") && notes.length === 1);
  await assert.rejects(lease.requireLease(), /Passive — cloud is in charge/);
  assert.equal(lease.holdsLease(), false);

  await assert.rejects(lease.takeLease(), /holds a live lease|cloud portal/);
  now += LEASE_TTL_MS + MIN;
  assert.equal((await lease.checkLease()).state, "expired");
  assert.equal((await lease.takeLease("owner")).holder, true);
  assert.equal(kv.store.get(LEASE_KEY).holder, PC.id);
  assert.ok(audits.some((a) => a.action === "lease force-taken"));
});

test("PC lease module: a stale 'not found' right after its own claim doesn't cause a second claim", async () => {
  let now = T0;
  let puts = 0;
  const lease = createPcLease({ me: PC, get: async () => null, put: async () => void puts++, clock: () => now, audit: () => {}, notify: () => {}, log: () => {} });
  assert.equal((await lease.checkLease()).state, "claimed");
  now += MIN;
  assert.equal((await lease.checkLease()).state, "held");
  assert.equal(puts, 1);
});

test("newerLease prefers the later write, whichever side it is on", () => {
  const a = claimLease(PC, T0);
  const b = releaseLease(PC, "cloud", T0 + MIN);
  assert.equal(newerLease(a, b), b);
  assert.equal(newerLease(b, a), b);
  assert.equal(newerLease(null, a), a);
  assert.equal(newerLease(a, null), a);
});

test("PC lease module: a KV failure means passive for that cycle", async () => {
  const lease = createPcLease({ me: PC, get: async () => { throw new Error("network down"); }, put: async () => {}, audit: () => {}, notify: () => {}, log: () => {} });
  const s = await lease.checkLease();
  assert.deepEqual([s.holder, s.state, s.error], [false, "error", "network down"]);
});

test("simulation: PC and cloud never hold the lease at the same time", () => {
  const kv = new Map();
  let handover = null;
  let cloudActive = false;
  const holders = { pc: false, cloud: false };
  let pcOn = true;
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const now = T0 + minute * MIN;
    if (minute === 120) cloudActive = true;
    if (minute === 180) handover = { to: "cloud", requestedAt: new Date(now).toISOString(), by: "owner" };
    if (minute === 400) {
      cloudActive = false;
      handover = null;
    }
    if (minute === 600) pcOn = false;
    if (minute === 700) cloudActive = true;
    if (minute === 1000) pcOn = true;
    const step = (me, mayClaim) => {
      const d = decideLease({ lease: kv.get(LEASE_KEY) || null, handover, me, now, mayClaim });
      if (d.write) kv.set(LEASE_KEY, d.write);
      if (me.host === "cloud" && d.state === "claimed") handover = null;
      holders[me.host] = d.holder;
    };
    if (pcOn && minute % 5 === 1) step(PC, true);
    if (!pcOn) holders.pc = false;
    if (minute % 5 === 0) step(CLOUD, cloudActive);
    const lease = kv.get(LEASE_KEY);
    const live = (h) => holders[h] && lease?.holder === (h === "pc" ? PC.id : CLOUD.id) && Date.parse(lease.expiresAt) > now;
    assert.ok(!(live("pc") && live("cloud")), `both hold at minute ${minute}`);
    if (minute === 170) assert.equal(lease.holder, PC.id, "cloud active but passive before the handover");
    if (minute === 195) assert.equal(lease.holder, CLOUD.id, "cloud holds after the handover");
    if (minute === 410) assert.equal(lease.holder, PC.id, "shadow hands back to the PC");
    if (minute === 900) assert.notEqual(lease.holder, CLOUD.id, "PC preferred: the cloud doesn't grab an expired PC lease");
  }
});
