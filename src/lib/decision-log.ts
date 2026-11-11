/**
 * The decision log.
 *
 * Every recorded finding becomes one entry — reviewer, timestamp, finding,
 * clause, decision — and each entry carries the hash of the entry before it.
 * Change any entry, reorder two, or drop one, and every later hash stops
 * matching, so the feed cannot be quietly edited.
 *
 * The chain is derived from the rows the workspace stores, ordered by the time
 * the decision was recorded. Append-only *storage* (a write-once table) is what
 * migration 0004 adds; until it is applied this is a verifiable ledger over the
 * same data, which is what the audit pack and this page render.
 */

import { canonicalJson, sha256Hex } from "./audit-pack";
import type { ContentSubmission, Finding } from "./supabase";

export const GENESIS_HASH = "0".repeat(64);

export interface DecisionLogEntry {
  index: number;
  at: string;
  submissionId: string | null;
  submissionTitle: string;
  findingId: string;
  finding: string;
  clause: string | null;
  decision: Finding["status"];
  reviewer: string | null;
  prevHash: string;
  hash: string;
}

type EntryBody = Omit<DecisionLogEntry, "hash">;

function entryTime(finding: Finding): number {
  const decided = Date.parse(finding.reviewed_at ?? "");
  if (!Number.isNaN(decided)) return decided;
  const created = Date.parse(finding.created_at ?? "");
  return Number.isNaN(created) ? 0 : created;
}

export async function buildDecisionLog(input: {
  submissions: ContentSubmission[];
  findings: Finding[];
}): Promise<DecisionLogEntry[]> {
  const titles = new Map(input.submissions.map((submission) => [submission.id, submission.title]));
  const ordered = [...input.findings].sort((a, b) => {
    const delta = entryTime(a) - entryTime(b);
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });

  const entries: DecisionLogEntry[] = [];
  let prevHash = GENESIS_HASH;

  for (const [index, finding] of ordered.entries()) {
    const body: EntryBody = {
      index,
      at: new Date(entryTime(finding) || Date.parse(finding.created_at) || 0).toISOString(),
      submissionId: finding.submission_id ?? null,
      submissionTitle: titles.get(finding.submission_id) ?? "Unknown submission",
      findingId: finding.id,
      finding: finding.message,
      clause: finding.citation ?? null,
      decision: finding.status,
      reviewer: finding.reviewed_by ?? null,
      prevHash,
    };
    const hash = await sha256Hex(canonicalJson(body));
    entries.push({ ...body, hash });
    prevHash = hash;
  }

  return entries;
}

export interface DecisionLogVerification {
  valid: boolean;
  checked: number;
  /** Index of the first entry whose hash or link does not hold. */
  brokenAt: number | null;
  head: string;
}

export async function verifyDecisionLog(
  entries: DecisionLogEntry[]
): Promise<DecisionLogVerification> {
  let prevHash = GENESIS_HASH;

  for (const [index, entry] of entries.entries()) {
    const { hash, ...body } = entry;
    const expected = await sha256Hex(canonicalJson(body));
    if (entry.prevHash !== prevHash || hash !== expected || entry.index !== index) {
      return {
        valid: false,
        checked: index,
        brokenAt: index,
        head: entries[entries.length - 1]?.hash ?? GENESIS_HASH,
      };
    }
    prevHash = hash;
  }

  return {
    valid: true,
    checked: entries.length,
    brokenAt: null,
    head: prevHash,
  };
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-4)}`;
}
