// Pending website price-raise proposals (raise after sale + limited items). Only the owner's Approve applies one.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROPOSALS_PATH = path.join(ROOT, "data", "price-raise-proposals.json");

export function readProposals() {
  try {
    return { proposals: [], seen: {}, ...JSON.parse(fs.readFileSync(PROPOSALS_PATH, "utf8")) };
  } catch {
    return { proposals: [], seen: {} };
  }
}

export const writeProposals = (s) => fs.writeFileSync(PROPOSALS_PATH, JSON.stringify(s, null, 2));

/** Adds `proposal` to `state`, or, when the item already has a pending one, adds its sales to that one. */
export function queueProposal(state, proposal) {
  const pending = state.proposals.find((p) => p.status === "pending" && p.itemId === proposal.itemId);
  if (pending) {
    pending.sales.push(...proposal.sales);
    return { proposal: pending, merged: true };
  }
  state.proposals.push(proposal);
  return { proposal, merged: false };
}

export const proposalId = (itemId) => `${itemId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
