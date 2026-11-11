/**
 * Governance operations: the clock and the scoreboard.
 *
 * Both are computed from rows the workspace already has. Nothing here is
 * stored, so a missing column can never break a page and a policy change
 * re-reads history instead of rewriting it.
 *
 * - The SLA clock is a published policy: a submission's target is derived from
 *   the worst finding severity it carries. The derivation is shown in the UI,
 *   so "overdue" is always explainable.
 * - Precision is the share of *decided* findings a reviewer accepted. A
 *   dismissal is treated as a false positive. With few decisions the number is
 *   labelled as thin rather than presented as a measurement.
 */

import { stripAnchors } from "./document-extract";
import type { BrandKit, Severity } from "./supabase";
import {
  RULE_CATALOGUE,
  RULE_LABELS,
  getFindingTypeLabel,
  runDeterministicRules,
  type RuleType,
} from "./rules";

/* ------------------------------------------------------------------ */
/* Policy clock                                                        */
/* ------------------------------------------------------------------ */

/** Target review time, in days, measured from submission. */
export const SLA_POLICY_DAYS: Record<Severity, number> = {
  critical: 1,
  high: 3,
  medium: 5,
  low: 7,
};

export const SLA_POLICY_SUMMARY = "critical 1d · high 3d · medium 5d · low 7d";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export type SlaState = "overdue" | "due_soon" | "on_track" | "closed" | "undated";

export interface SlaSubmissionRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  /** Set when someone committed to a date (migration 0004); wins over policy. */
  due_at?: string | null;
  /** Reviewer who owns the submission (migration 0004). */
  owner_id?: string | null;
}

export interface SlaFindingRow {
  submission_id: string;
  severity: Severity;
}

export interface SlaRow {
  submissionId: string;
  title: string;
  status: string;
  worstSeverity: Severity | null;
  policyDays: number;
  dueAt: string;
  /** Where the deadline came from: a stored commitment or the SLA policy. */
  dueSource: "stored" | "policy";
  ownerId: string | null;
  /** Negative when the submission is late. Null when the date is unreadable. */
  hoursRemaining: number | null;
  state: SlaState;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const CLOSED_STATUSES = ["approved", "rejected"];

/**
 * Derive the clock for every submission. Late and nearly-late rows come first.
 */
export function getSlaRows(
  submissions: SlaSubmissionRow[],
  findings: SlaFindingRow[],
  now: number = Date.now()
): SlaRow[] {
  const worst = new Map<string, Severity>();
  for (const finding of findings) {
    if (!(finding.severity in SEVERITY_RANK)) continue;
    const current = worst.get(finding.submission_id);
    if (!current || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current]) {
      worst.set(finding.submission_id, finding.severity);
    }
  }

  const rows = submissions.map((submission): SlaRow => {
    const created = new Date(submission.created_at).getTime();
    const worstSeverity = worst.get(submission.id) ?? null;
    const policyDays = worstSeverity
      ? SLA_POLICY_DAYS[worstSeverity]
      : SLA_POLICY_DAYS.medium;

    const storedDue = submission.due_at ? Date.parse(submission.due_at) : Number.NaN;

    if (Number.isNaN(created) && Number.isNaN(storedDue)) {
      return {
        submissionId: submission.id,
        title: submission.title,
        status: submission.status,
        worstSeverity,
        policyDays,
        dueAt: "",
        dueSource: "policy",
        ownerId: submission.owner_id ?? null,
        hoursRemaining: null,
        state: "undated",
      };
    }

    const due = Number.isNaN(storedDue) ? created + policyDays * DAY : storedDue;
    const hoursRemaining = round((due - now) / HOUR);
    const closed = CLOSED_STATUSES.includes(submission.status);

    const state: SlaState = closed
      ? "closed"
      : hoursRemaining <= 0
        ? "overdue"
        : hoursRemaining <= 24
          ? "due_soon"
          : "on_track";

    return {
      submissionId: submission.id,
      title: submission.title,
      status: submission.status,
      worstSeverity,
      policyDays,
      dueAt: new Date(due).toISOString(),
      dueSource: Number.isNaN(storedDue) ? "policy" : "stored",
      ownerId: submission.owner_id ?? null,
      hoursRemaining,
      state,
    };
  });

  return rows.sort((a, b) => {
    const rank = (row: SlaRow) =>
      row.state === "overdue" ? 0 : row.state === "due_soon" ? 1 : row.state === "on_track" ? 2 : 3;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.hoursRemaining ?? Number.POSITIVE_INFINITY) - (b.hoursRemaining ?? Number.POSITIVE_INFINITY);
  });
}

export interface SlaSummary {
  open: number;
  overdue: number;
  dueSoon: number;
  onTrack: number;
  closed: number;
  /** The most late open row, if anything is late. */
  worst: SlaRow | null;
}

export function summariseSla(rows: SlaRow[]): SlaSummary {
  const overdue = rows.filter((row) => row.state === "overdue");
  return {
    open: rows.filter((row) => row.state !== "closed").length,
    overdue: overdue.length,
    dueSoon: rows.filter((row) => row.state === "due_soon").length,
    onTrack: rows.filter((row) => row.state === "on_track").length,
    closed: rows.filter((row) => row.state === "closed").length,
    worst: overdue[0] ?? null,
  };
}

/** "18h late", "in 2.4 days". */
export function describeLatency(hoursRemaining: number | null): string {
  if (hoursRemaining === null) return "no date";
  const magnitude = Math.abs(hoursRemaining);
  const amount = magnitude < 48 ? `${Math.round(magnitude)}h` : `${round(magnitude / 24)}d`;
  return hoursRemaining < 0 ? `${amount} late` : `in ${amount}`;
}

/* ------------------------------------------------------------------ */
/* Per-rule attribution                                               */
/* ------------------------------------------------------------------ */

/**
 * Findings are stored with their family, not the rule that raised them. The
 * engine is deterministic, so re-running it over the submission text and
 * matching by message recovers the exact rule id — which turns family
 * precision into per-rule precision without a schema change.
 */
export function attributeRuleIds(
  findings: Array<{ submission_id?: string | null; message: string; rule_id?: string | null }>,
  submissions: Array<{ id: string; text_content?: string | null }>,
  kit?: BrandKit | null
): Map<string, string> {
  const attributed = new Map<string, string>();
  if (!kit) return attributed;

  const textById = new Map(
    submissions.map((submission) => [submission.id, stripAnchors(submission.text_content ?? "")])
  );
  const bySubmission = new Map<string, Map<string, string>>();

  for (const finding of findings) {
    const submissionId = finding.submission_id;
    if (!submissionId) continue;

    // After migration 0004 the exact rule is stored; skip the re-run.
    if (finding.rule_id) {
      attributed.set(`${submissionId}|${finding.message}`, finding.rule_id);
      continue;
    }

    let lookup = bySubmission.get(submissionId);
    if (!lookup) {
      lookup = new Map();
      const text = textById.get(submissionId);
      if (text) {
        // No submission scope here: attribution asks which rule produced this
        // wording, and a finding recorded before an exemption existed must
        // still map back to the rule that raised it.
        for (const rule of runDeterministicRules(text, kit)) {
          // First rule wins: the engine emits each message once per submission.
          if (!lookup.has(rule.message)) lookup.set(rule.message, rule.ruleId);
        }
      }
      bySubmission.set(submissionId, lookup);
    }

    const ruleId = lookup.get(finding.message);
    if (ruleId) attributed.set(`${submissionId}|${finding.message}`, ruleId);
  }

  return attributed;
}

/* ------------------------------------------------------------------ */
/* Precision from decisions                                            */
/* ------------------------------------------------------------------ */

export type PrecisionSample = "none" | "thin" | "trusted";

/** Below this many decisions, a precision figure is not shown as a rate. */
export const PRECISION_SAMPLE_FLOOR = 5;

export interface PrecisionDecisionRow {
  type: string;
  status: "pending" | "accepted" | "rejected" | string;
}

export interface RulePrecisionRow {
  type: string;
  label: string;
  accepted: number;
  rejected: number;
  pending: number;
  decided: number;
  /** accepted / decided, or null with no decisions. */
  precision: number | null;
  sample: PrecisionSample;
}

/**
 * Per rule family, how often a reviewer agreed with the engine.
 *
 * Findings are stored with their family (`type`) but not the individual rule
 * id, so this is family precision; the label says so rather than implying a
 * per-rule figure the data cannot support.
 */
export function getRulePrecision(findings: PrecisionDecisionRow[]): RulePrecisionRow[] {
  const counts = new Map<string, { accepted: number; rejected: number; pending: number }>();

  const ensure = (type: string) => {
    const existing = counts.get(type);
    if (existing) return existing;
    const fresh = { accepted: 0, rejected: 0, pending: 0 };
    counts.set(type, fresh);
    return fresh;
  };

  for (const rule of RULE_CATALOGUE) ensure(rule.type);
  for (const finding of findings) {
    const bucket = ensure(finding.type);
    if (finding.status === "accepted") bucket.accepted += 1;
    else if (finding.status === "rejected") bucket.rejected += 1;
    else bucket.pending += 1;
  }

  return [...counts.entries()]
    .map(([type, bucket]): RulePrecisionRow => {
      const decided = bucket.accepted + bucket.rejected;
      return {
        type,
        label: getFindingTypeLabel(type as RuleType),
        ...bucket,
        decided,
        precision: decided === 0 ? null : Math.round((bucket.accepted / decided) * 100),
        sample:
          decided === 0 ? "none" : decided < PRECISION_SAMPLE_FLOOR ? "thin" : "trusted",
      };
    })
    .sort((a, b) => {
      if (b.decided !== a.decided) return b.decided - a.decided;
      const aIndex = RULE_CATALOGUE.findIndex((rule) => rule.type === a.type);
      const bIndex = RULE_CATALOGUE.findIndex((rule) => rule.type === b.type);
      return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
    });
}

export interface PrecisionSummary {
  decided: number;
  accepted: number;
  rejected: number;
  /** Workspace-wide precision, or null before any decision. */
  precision: number | null;
  sample: PrecisionSample;
  /** Rule families that have produced a finding in this workspace. */
  observedFamilies: number;
  totalFamilies: number;
  /** Families declared by the engine that have produced no finding here. */
  quietFamilies: string[];
}

export function summarisePrecision(rows: RulePrecisionRow[]): PrecisionSummary {
  const decided = rows.reduce((sum, row) => sum + row.decided, 0);
  const accepted = rows.reduce((sum, row) => sum + row.accepted, 0);
  const rejected = rows.reduce((sum, row) => sum + row.rejected, 0);

  return {
    decided,
    accepted,
    rejected,
    precision: decided === 0 ? null : Math.round((accepted / decided) * 100),
    sample: decided === 0 ? "none" : decided < PRECISION_SAMPLE_FLOOR ? "thin" : "trusted",
    observedFamilies: rows.filter((row) => row.decided + row.pending > 0).length,
    totalFamilies: rows.length,
    quietFamilies: rows
      .filter((row) => row.decided + row.pending === 0)
      .map((row) => row.label),
  };
}

export interface PerRulePrecisionRow {
  ruleId: string;
  label: string;
  type: string;
  accepted: number;
  rejected: number;
  pending: number;
  decided: number;
  /** accepted / decided, or null with no decisions. */
  precision: number | null;
  /** rejected / decided, or null with no decisions. */
  falsePositiveRate: number | null;
  sample: PrecisionSample;
  /** Message matching could not tie this finding back to a single rule. */
  unattributed: boolean;
}

const UNATTRIBUTED = "unattributed";

export function getPrecisionByRule(
  findings: Array<PrecisionDecisionRow & { submission_id?: string | null; message: string }>,
  attribution: Map<string, string>
): PerRulePrecisionRow[] {
  const counts = new Map<string, { accepted: number; rejected: number; pending: number; type: string }>();

  const ensure = (ruleId: string, type: string) => {
    const existing = counts.get(ruleId);
    if (existing) return existing;
    const fresh = { accepted: 0, rejected: 0, pending: 0, type };
    counts.set(ruleId, fresh);
    return fresh;
  };

  for (const ruleId of Object.keys(RULE_LABELS)) {
    const family = ruleId.split(".")[0];
    ensure(ruleId, family === "asset" ? "alt_text" : family);
  }

  for (const finding of findings) {
    const ruleId =
      (finding.submission_id && attribution.get(`${finding.submission_id}|${finding.message}`)) ||
      UNATTRIBUTED;
    const bucket = ensure(ruleId, finding.type);
    if (finding.status === "accepted") bucket.accepted += 1;
    else if (finding.status === "rejected") bucket.rejected += 1;
    else bucket.pending += 1;
  }

  return [...counts.entries()]
    .map(([ruleId, bucket]): PerRulePrecisionRow => {
      const decided = bucket.accepted + bucket.rejected;
      return {
        ruleId,
        label: ruleId === UNATTRIBUTED ? "Unattributed (legacy finding)" : RULE_LABELS[ruleId] ?? ruleId,
        ...bucket,
        decided,
        precision: decided === 0 ? null : Math.round((bucket.accepted / decided) * 100),
        falsePositiveRate: decided === 0 ? null : Math.round((bucket.rejected / decided) * 100),
        sample: decided === 0 ? "none" : decided < PRECISION_SAMPLE_FLOOR ? "thin" : "trusted",
        unattributed: ruleId === UNATTRIBUTED,
      };
    })
    .sort((a, b) => {
      if (a.unattributed !== b.unattributed) return a.unattributed ? 1 : -1;
      if (b.decided !== a.decided) return b.decided - a.decided;
      return a.label.localeCompare(b.label);
    });
}

export interface RulePrecisionSummary {
  decided: number;
  accepted: number;
  rejected: number;
  precision: number | null;
  sample: PrecisionSample;
  rulesWithEvidence: number;
  totalRules: number;
  quietRules: string[];
  unattributed: number;
}

export function summariseRulePrecision(rows: PerRulePrecisionRow[]): RulePrecisionSummary {
  const decided = rows.reduce((sum, row) => sum + row.decided, 0);
  const accepted = rows.reduce((sum, row) => sum + row.accepted, 0);
  const rejected = rows.reduce((sum, row) => sum + row.rejected, 0);
  const rules = rows.filter((row) => !row.unattributed);

  return {
    decided,
    accepted,
    rejected,
    precision: decided === 0 ? null : Math.round((accepted / decided) * 100),
    sample: decided === 0 ? "none" : decided < PRECISION_SAMPLE_FLOOR ? "thin" : "trusted",
    rulesWithEvidence: rules.filter((row) => row.decided + row.pending > 0).length,
    totalRules: rules.length,
    quietRules: rules
      .filter((row) => row.decided + row.pending === 0)
      .map((row) => row.label),
    unattributed: rows.filter((row) => row.unattributed).reduce((sum, row) => sum + row.decided + row.pending, 0),
  };
}
