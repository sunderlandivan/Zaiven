import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const LOAN_DB_PATH = path.join(DATA_DIR, "loan-db.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOAN_DB_PATH)) {
    fs.writeFileSync(
      LOAN_DB_PATH,
      JSON.stringify(
        {
          totalLoanAmount: 0,
          currentInBank: null,
          pendingPayment: null,
          notes: "",
          updatedAt: new Date().toISOString(),
          payments: [],
        },
        null,
        2
      )
    );
  }
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(LOAN_DB_PATH, "utf8"));
}

function writeDb(db) {
  ensureDb();
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(LOAN_DB_PATH, JSON.stringify(db, null, 2));
}

function normalizePayment(input = {}, fallbackId) {
  const amount = roundMoney(input.amount);
  const date = String(input.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Payment date must be YYYY-MM-DD");
  }
  if (!Number.isFinite(Number(input.amount))) {
    throw new Error("Payment amount is required");
  }
  return {
    id: String(input.id || fallbackId || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    date,
    amount,
    note: String(input.note || "").trim(),
  };
}

function sortPayments(payments) {
  return [...payments].sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildReport(db) {
  const totalLoanAmount = roundMoney(db.totalLoanAmount || 0);
  const payments = sortPayments(Array.isArray(db.payments) ? db.payments : []);
  const totalPaid = roundMoney(payments.reduce((acc, p) => acc + Number(p.amount || 0), 0));
  const totalPaidAbs = roundMoney(Math.abs(totalPaid));
  const remaining = roundMoney(totalLoanAmount + totalPaid);
  const payoffPct = totalLoanAmount > 0 ? roundMoney((totalPaidAbs / totalLoanAmount) * 100) : 0;

  const currentInBank = db.currentInBank == null || db.currentInBank === "" ? null : roundMoney(db.currentInBank);
  const pendingPayment =
    db.pendingPayment == null || db.pendingPayment === "" ? null : roundMoney(db.pendingPayment);
  const totalIncomingBanked = roundMoney((currentInBank || 0) + (pendingPayment || 0));

  let cumulativePaid = 0;
  const history = payments.map((p) => {
    cumulativePaid = roundMoney(cumulativePaid + Number(p.amount || 0));
    const balanceAfter = roundMoney(totalLoanAmount + cumulativePaid);
    return {
      ...p,
      amountAbs: roundMoney(Math.abs(Number(p.amount || 0))),
      cumulativePaid: roundMoney(Math.abs(cumulativePaid)),
      balanceAfter,
    };
  });

  const byMonthMap = new Map();
  for (const p of payments) {
    const key = String(p.date).slice(0, 7);
    byMonthMap.set(key, roundMoney((byMonthMap.get(key) || 0) + Math.abs(Number(p.amount || 0))));
  }
  const byMonth = [...byMonthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, paid]) => ({ month, paid }));

  return {
    totalLoanAmount,
    totalPaid,
    totalPaidAbs,
    remaining,
    payoffPct,
    currentInBank,
    pendingPayment,
    totalIncomingBanked,
    notes: String(db.notes || ""),
    updatedAt: db.updatedAt || null,
    paymentCount: payments.length,
    payments: history,
    charts: {
      payoffSplit: [
        { label: "Paid", value: totalPaidAbs },
        { label: "Remaining", value: Math.max(0, remaining) },
      ],
      cumulative: history.map((h) => ({
        date: h.date,
        cumulativePaid: h.cumulativePaid,
        remaining: h.balanceAfter,
      })),
      byMonth,
    },
  };
}

export function getLoanReport() {
  return buildReport(readDb());
}

export function updateLoanMeta(input = {}) {
  const db = readDb();
  if (input.totalLoanAmount != null && input.totalLoanAmount !== "") {
    db.totalLoanAmount = roundMoney(input.totalLoanAmount);
  }
  if ("currentInBank" in input) {
    db.currentInBank =
      input.currentInBank == null || input.currentInBank === "" ? null : roundMoney(input.currentInBank);
  }
  if ("pendingPayment" in input) {
    db.pendingPayment =
      input.pendingPayment == null || input.pendingPayment === "" ? null : roundMoney(input.pendingPayment);
  }
  if ("notes" in input) {
    db.notes = String(input.notes || "").trim();
  }
  writeDb(db);
  return buildReport(db);
}

export function addLoanPayment(input = {}) {
  const db = readDb();
  if (!Array.isArray(db.payments)) db.payments = [];
  let amount = Number(input.amount);
  if (!Number.isFinite(amount)) throw new Error("Payment amount is required");
  // Spreadsheet stores repayments as negative; accept positive UI amounts as repayments.
  if (amount > 0) amount = -amount;
  const payment = normalizePayment({ ...input, amount });
  db.payments.push(payment);
  writeDb(db);
  return buildReport(db);
}

export function deleteLoanPayment(paymentId) {
  const db = readDb();
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("paymentId is required");
  const before = Array.isArray(db.payments) ? db.payments.length : 0;
  db.payments = (db.payments || []).filter((p) => String(p.id) !== id);
  if (db.payments.length === before) throw new Error("Payment not found");
  writeDb(db);
  return buildReport(db);
}
