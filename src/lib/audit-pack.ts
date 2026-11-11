/**
 * The audit record: one submission, frozen into a document a legal or brand
 * team can keep.
 *
 * The pack is built from workspace rows only. It records what was found, what
 * the reviewer decided, and where in the document the finding sat. It then
 * re-runs the deterministic engine over the same text and reports which stored
 * findings the engine still reproduces, so a reader can see whether the record
 * is reproducible today rather than trusting a stored summary.
 *
 * The digest is SHA-256 over the canonical JSON of the pack without the digest
 * field. Re-exporting the same submission at the same `generatedAt` reproduces
 * it; changing any recorded detail changes it.
 */

import {
  hasAnchors,
  locatorForFinding,
  parseSegments,
  stripAnchors,
  type DocSegment,
} from "./document-extract";
import { parseExemptions, type Exemption } from "./exemptions";
import { getFindingTypeLabel, runRuleSet, type RuleType } from "./rules";
import type {
  BrandKit,
  ContentSubmission,
  Finding,
  Severity,
} from "./supabase";

export const AUDIT_PACK_VERSION = "brandlens.audit/1";

export interface AuditPackFinding {
  id: string;
  family: string;
  type: string;
  severity: Severity;
  message: string;
  citation: string | null;
  sourcePassage: string | null;
  suggestion: string | null;
  decision: Finding["status"];
  recordedAt: string;
  locator: string | null;
  /** Still produced verbatim by the engine when the pack was generated. */
  reproduced: boolean;
  /** Rule that reproduced it, when the engine could attribute one. */
  ruleId: string | null;
  /** An in-date exemption suppresses this finding right now. */
  exempt: boolean;
}

export interface AuditPackEngineNote {
  ruleId: string;
  family: string;
  severity: Severity;
  message: string;
}

export interface AuditPackSubject {
  id: string;
  title: string;
  contentType: string;
  status: string;
  submittedAt: string;
  characters: number;
  words: number;
  anchors: number;
  anchorKind: "pages" | "paragraphs" | "none";
}

export interface AuditPack {
  version: string;
  generatedAt: string;
  subject: AuditPackSubject;
  brandKit: { id: string; name: string } | null;
  verdict: {
    status: string;
    blocking: number;
    accepted: number;
    rejected: number;
    pending: number;
  };
  findings: AuditPackFinding[];
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    cited: number;
    decided: number;
  };
  reconciliation: {
    reproduced: number;
    total: number;
    /** Findings the current engine would raise that were never recorded. */
    engineOnly: AuditPackEngineNote[];
    /** Recorded findings the current engine no longer reproduces. */
    unmatched: string[];
    note: string;
  };
  exemptions: {
    /** Every exemption on the kit, active or lapsed. */
    recorded: Exemption[];
    /** Exemptions that suppressed at least one finding in this record. */
    applied: AuditPackExemptionUse[];
    note: string;
  };
  digest: string;
}

export interface AuditPackExemptionUse {
  exemptionId: string;
  ruleId: string;
  owner: string;
  reason: string;
  expiresAt: string;
  scope: string;
  message: string;
}

export type UnsealedAuditPack = Omit<AuditPack, "digest">;

export interface AuditPackInput {
  submission: ContentSubmission;
  findings: Finding[];
  kit: BrandKit | null;
  generatedAt?: string;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/**
 * Whether the anchors are pages or paragraphs is a property of the file, not of
 * the first label: in a document set every label is prefixed with the document
 * name (`Autumn deck · p.4`), so testing `startsWith("p.")` would file a batch
 * of PDFs under paragraphs.
 */
function anchorKindOf(segments: DocSegment[]): "pages" | "paragraphs" | "none" {
  if (segments.length === 0) return "none";
  return segments.some((segment) => segment.label.includes("¶")) ? "paragraphs" : "pages";
}

function exemptionScope(exemption: Exemption): string {
  const target = exemption.target ? `“${exemption.target}”` : "all findings";
  return exemption.submissionId ? `${target} · ${exemption.submissionId}` : target;
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** Recursively key-sorted JSON, so the digest does not depend on insertion order. */
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sort(record[key])])
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the pack without its digest. Deterministic for a given input and
 * `generatedAt`, which is what makes the digest meaningful.
 */
export function buildAuditPack(input: AuditPackInput): UnsealedAuditPack {
  const { submission, findings, kit } = input;
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const stored = submission.text_content ?? "";
  const text = stripAnchors(stored);
  // Pasted copy arrives as one block with no page markers: it has no anchors,
  // rather than one paragraph anchor.
  const segments = hasAnchors(stored) ? parseSegments(stored) : [];

  const ruleRun =
    kit && text.trim()
      ? runRuleSet(text, kit, { submissionId: submission.id })
      : { findings: [], suppressed: [] };
  const recomputed = ruleRun.findings;
  const suppressedByMessage = new Map(
    ruleRun.suppressed.map((entry) => [entry.finding.message, entry.exemption])
  );
  const byMessage = new Map(recomputed.map((finding) => [finding.message, finding]));
  const storedMessages = new Set(findings.map((finding) => finding.message));

  const packFindings: AuditPackFinding[] = findings.map((finding) => {
    const match = byMessage.get(finding.message);
    return {
      id: finding.id,
      family: getFindingTypeLabel(finding.type as RuleType),
      type: finding.type,
      severity: finding.severity,
      message: finding.message,
      citation: finding.citation ?? null,
      sourcePassage: finding.source_passage ?? null,
      suggestion: finding.suggestion ?? null,
      decision: finding.status,
      recordedAt: finding.created_at,
      locator: segments.length > 0 ? locatorForFinding(finding, segments) : null,
      reproduced: Boolean(match),
      ruleId: match?.ruleId ?? null,
      exempt: suppressedByMessage.has(finding.message),
    };
  });

  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of packFindings) {
    if (SEVERITIES.includes(finding.severity)) bySeverity[finding.severity] += 1;
  }

  const engineOnly: AuditPackEngineNote[] = recomputed
    .filter((finding) => !storedMessages.has(finding.message))
    .slice(0, 20)
    .map((finding) => ({
      ruleId: finding.ruleId,
      family: getFindingTypeLabel(finding.type),
      severity: finding.severity,
      message: finding.message,
    }));

  const unmatched = packFindings
    .filter((finding) => !finding.reproduced && !finding.exempt)
    .map((finding) => finding.id);

  const reproduced = packFindings.length - unmatched.length;

  return {
    version: AUDIT_PACK_VERSION,
    generatedAt,
    subject: {
      id: submission.id,
      title: submission.title,
      contentType: submission.content_type,
      status: submission.status,
      submittedAt: submission.created_at,
      characters: text.length,
      words: countWords(text),
      anchors: segments.length,
      anchorKind: anchorKindOf(segments),
    },
    brandKit: kit ? { id: kit.id, name: kit.name } : null,
    verdict: {
      status: submission.status,
      blocking: packFindings.filter(
        (finding) =>
          (finding.severity === "critical" || finding.severity === "high") &&
          finding.decision !== "rejected"
      ).length,
      accepted: packFindings.filter((finding) => finding.decision === "accepted").length,
      rejected: packFindings.filter((finding) => finding.decision === "rejected").length,
      pending: packFindings.filter((finding) => finding.decision === "pending").length,
    },
    findings: packFindings,
    summary: {
      total: packFindings.length,
      bySeverity,
      cited: packFindings.filter((finding) => Boolean(finding.citation)).length,
      decided: packFindings.filter((finding) => finding.decision !== "pending").length,
    },
    reconciliation: {
      reproduced,
      total: packFindings.length,
      engineOnly,
      unmatched,
      note: describeReconciliation({
        reproduced,
        total: packFindings.length,
        engineOnly: engineOnly.length,
      }),
    },
    exemptions: {
      recorded: kit ? parseExemptions(kit.guidelines) : [],
      applied: ruleRun.suppressed.map((entry) => ({
        exemptionId: entry.exemption.id,
        ruleId: entry.exemption.ruleId,
        owner: entry.exemption.owner,
        reason: entry.exemption.reason,
        expiresAt: entry.exemption.expiresAt,
        scope: exemptionScope(entry.exemption),
        message: entry.finding.message,
      })),
      note:
        "A scoped, in-date exemption suppresses a finding but never deletes it: the finding, the " +
        "decision, its owner and its expiry all stay in this record. Lapsed exemptions have no effect.",
    },
  };
}

function describeReconciliation(counts: {
  reproduced: number;
  total: number;
  engineOnly: number;
}): string {
  const { reproduced, total, engineOnly } = counts;
  if (total === 0) {
    return "This submission has no recorded findings, so there is nothing to reproduce.";
  }
  if (engineOnly === 0 && reproduced === total) {
    return "Every recorded finding is reproduced exactly by the current rule engine.";
  }
  const parts: string[] = [];
  if (reproduced !== total) {
    parts.push(
      `${total - reproduced} recorded finding${total - reproduced === 1 ? " is" : "s are"} not reproduced by the current engine — they came from the AI judgement pass or from a rule that has since changed.`
    );
  }
  if (engineOnly > 0) {
    parts.push(
      `The engine would additionally raise ${engineOnly} finding${engineOnly === 1 ? "" : "s"} on this text if it were reviewed today.`
    );
  }
  return parts.join(" ");
}

/** Attach the digest. The digest covers the pack with an empty digest field. */
export async function sealAuditPack(pack: UnsealedAuditPack): Promise<AuditPack> {
  const digest = await sha256Hex(canonicalJson({ ...pack, digest: "" }));
  return { ...pack, digest };
}

export function canSeal(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

/** The JSON a reviewer downloads. Stable, indented, includes the digest. */
export function auditPackToJson(pack: AuditPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

/** File-safe name for a downloaded pack. */
export function auditPackFilename(pack: AuditPack): string {
  const slug = pack.subject.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `brandlens-audit-${slug || pack.subject.id.slice(0, 8)}.json`;
}
