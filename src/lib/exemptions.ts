/**
 * Scoped, expiring exemptions.
 *
 * An exemption is a governance decision — "this campaign may say X until the
 * 30th, because legal approved it" — so it lives with the brand kit's rules
 * (in the `exemptions` key of `brand_kits.guidelines`), carries the person who
 * granted it, and stops applying the moment its expiry date passes. The engine
 * honours active ones and reports every finding it suppressed, so the review
 * shows what was excused and why.
 */

import type { FindingType } from "./supabase";

export interface Exemption {
  id: string;
  /** Rule id (`glossary.banned`), or a family prefix (`claim`, `glossary`). */
  ruleId: string;
  /** Optional: only suppress findings whose message contains this text. */
  target?: string;
  /** Optional: limit the exemption to a single submission. */
  submissionId?: string;
  reason: string;
  owner: string;
  grantedAt: string;
  expiresAt: string;
}

export const EXEMPTIONS_KEY = "exemptions";

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Read exemptions out of whatever shape `brand_kits.guidelines` is stored in. */
export function parseExemptions(guidelines: unknown): Exemption[] {
  if (!guidelines || typeof guidelines !== "object" || Array.isArray(guidelines)) return [];
  const raw = (guidelines as Record<string, unknown>)[EXEMPTIONS_KEY];
  if (!Array.isArray(raw)) return [];

  const out: Exemption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const ruleId = asText(record.ruleId);
    const reason = asText(record.reason);
    const expiresAt = asIsoDate(record.expiresAt);
    if (!ruleId || !reason || !expiresAt) continue;

    out.push({
      id: asText(record.id) || `exemption-${out.length + 1}`,
      ruleId,
      target: asText(record.target) || undefined,
      submissionId: asText(record.submissionId) || undefined,
      reason,
      owner: asText(record.owner) || "Unrecorded owner",
      grantedAt: asIsoDate(record.grantedAt) ?? new Date(0).toISOString(),
      expiresAt,
    });
  }
  return out;
}

export type ExemptionStatus = "active" | "expired";

export function exemptionStatus(exemption: Exemption, at: Date = new Date()): ExemptionStatus {
  const expiry = Date.parse(exemption.expiresAt);
  if (Number.isNaN(expiry)) return "expired";
  return at.getTime() <= expiry ? "active" : "expired";
}

/** Days until this exemption lapses (negative once it has). */
export function daysUntilExpiry(exemption: Exemption, at: Date = new Date()): number {
  const expiry = Date.parse(exemption.expiresAt);
  if (Number.isNaN(expiry)) return 0;
  return Math.ceil((expiry - at.getTime()) / 86_400_000);
}

export function describeExemption(exemption: Exemption): string {
  const scope = exemption.target ? `“${exemption.target}”` : "all findings";
  const limit = exemption.submissionId ? ` on ${exemption.submissionId}` : "";
  return `${exemption.ruleId} · ${scope}${limit}`;
}

interface ExemptionCandidate {
  ruleId: string;
  type: FindingType | string;
  message: string;
}

/**
 * Does this exemption cover this finding? Rules match exactly, by family
 * prefix (`claim` covers `claim.superlative`), and — when a target is given —
 * only findings whose message mentions that target.
 */
export function coversFinding(
  exemption: Exemption,
  finding: ExemptionCandidate,
  context: { submissionId?: string | null; at?: Date } = {}
): boolean {
  if (exemptionStatus(exemption, context.at) !== "active") return false;
  if (exemption.submissionId && exemption.submissionId !== context.submissionId) return false;

  const rule = exemption.ruleId.toLowerCase();
  const findingRule = finding.ruleId.toLowerCase();
  const ruleMatches =
    findingRule === rule || findingRule.startsWith(`${rule}.`) || rule.startsWith(`${findingRule}.`);
  const familyMatches = finding.type.toLowerCase() === rule;
  if (!ruleMatches && !familyMatches) return false;

  if (exemption.target) {
    const target = exemption.target.toLowerCase();
    if (!finding.message.toLowerCase().includes(target)) return false;
  }

  return true;
}

export function activeExemptions(
  guidelines: unknown,
  at: Date = new Date()
): Exemption[] {
  return parseExemptions(guidelines).filter(
    (exemption) => exemptionStatus(exemption, at) === "active"
  );
}
