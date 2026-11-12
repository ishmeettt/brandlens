/**
 * The append-only audit feed.
 *
 * Migration 0004 creates `audit_events` and makes it write-once: a trigger
 * rejects updates and deletes, so a decision cannot be edited or removed after
 * the fact. Each row also carries the hash of the row before it in the same
 * organization, so a missing or swapped row is detectable even by someone
 * reading the table directly.
 *
 * Writes are best effort by design. Before the migration exists a decision is
 * still recorded in `findings`, and the decision log derives its feed from
 * there; the page says which of the two it is showing.
 */

import { canonicalJson, sha256Hex } from "./audit-pack";
import {
  GENESIS_HASH,
  type DecisionLogEntry,
  type DecisionLogVerification,
} from "./decision-log";
import { supabase, type Finding } from "./supabase";

export type AuditAction =
  | "finding.accepted"
  | "finding.rejected"
  | "submission.approved"
  | "submission.changes_requested";

export interface AuditEventInput {
  /** The owning auth user of the submission's brand kit. */
  organizationId: string;
  submissionId: string;
  findingId?: string | null;
  actor: string | null;
  action: AuditAction;
  /** Copied into the row so the feed renders without joining. */
  detail: Record<string, unknown>;
}

export type AuditWriteStatus = "stored" | "not_configured" | "not_migrated" | "failed";

export interface AuditWriteResult {
  status: AuditWriteStatus;
  hash?: string;
}

/**
 * The one timestamp spelling used in hashes.
 *
 * PostgreSQL returns `timestamptz` as `…+00:00`, while the row was hashed from
 * a JavaScript `…Z` string. Both name the same instant, so hash and verify the
 * normalised form or every chain reads as broken.
 */
function normaliseTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

export interface StoredAuditEvent {
  id: string;
  organization_id: string;
  submission_id: string | null;
  finding_id: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  created_at: string;
}

/** The table (or its columns) is not there yet, so the feed falls back. */
function isMissingTableError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string; details?: string; code?: string } | null)?.message ?? "") +
        " " +
        ((error as { details?: string } | null)?.details ?? "") +
        " " +
        ((error as { code?: string } | null)?.code ?? "");
  return /42P01|PGRST205|relation .* does not exist|could not find the table/i.test(message);
}

/** Newest row in the organization — the head this event links to. */
async function loadHead(organizationId: string) {
  return supabase!
    .from("audit_events")
    .select("hash")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function appendAuditEvent(input: AuditEventInput): Promise<AuditWriteResult> {
  if (!supabase) return { status: "not_configured" };

  const head = await loadHead(input.organizationId);
  if (head.error) {
    return { status: isMissingTableError(head.error) ? "not_migrated" : "failed" };
  }

  // The hash covers the stored columns, so anyone with table access can
  // recompute it; `created_at` is written explicitly because it is hashed.
  const createdAt = normaliseTimestamp(new Date().toISOString());
  const body = {
    organization_id: input.organizationId,
    submission_id: input.submissionId,
    finding_id: input.findingId ?? null,
    actor: input.actor ?? "reviewer",
    action: input.action,
    detail: input.detail,
    prev_hash: (head.data as { hash?: string } | null)?.hash ?? GENESIS_HASH,
    created_at: createdAt,
  };
  const hash = await sha256Hex(canonicalJson(body));

  const { error } = await supabase.from("audit_events").insert({ ...body, hash });
  if (error) {
    return { status: isMissingTableError(error) ? "not_migrated" : "failed" };
  }
  return { status: "stored", hash };
}

/** Rows from the write-once feed, or null before the migration is applied. */
export async function loadAuditEvents(
  limit = 500
): Promise<{ events: StoredAuditEvent[] | null; status: AuditWriteStatus }> {
  if (!supabase) return { events: null, status: "not_configured" };

  const { data, error } = await supabase
    .from("audit_events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return { events: null, status: isMissingTableError(error) ? "not_migrated" : "failed" };
  }
  return { events: (data ?? []) as StoredAuditEvent[], status: "stored" };
}

/** Stored rows in the shape the decision-log page renders. */
export function buildAuditLogFromEvents(events: StoredAuditEvent[]): DecisionLogEntry[] {
  const ordered = [...events].sort((a, b) => {
    const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  return ordered.map((event, index) => ({
    index,
    at: event.created_at,
    submissionId: event.submission_id,
    submissionTitle: String(event.detail?.submissionTitle ?? "Unknown submission"),
    // A submission decision has no finding; the row id keeps the list keyed.
    findingId: event.finding_id ?? event.id,
    finding: String(event.detail?.finding ?? event.action),
    clause: (event.detail?.clause as string | null | undefined) ?? null,
    decision: ((event.detail?.decision as Finding["status"] | undefined) ?? "pending") as Finding["status"],
    reviewer: event.actor ?? null,
    prevHash: event.prev_hash,
    hash: event.hash,
  }));
}

/** Recomputes the stored chain: every hash and every link, row by row. */
export async function verifyStoredChain(
  events: StoredAuditEvent[]
): Promise<DecisionLogVerification> {
  const ordered = [...events].sort((a, b) => {
    const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  let prevHash = GENESIS_HASH;
  for (const [index, event] of ordered.entries()) {
    const expected = await sha256Hex(
      canonicalJson({
        organization_id: event.organization_id,
        submission_id: event.submission_id,
        finding_id: event.finding_id,
        actor: event.actor,
        action: event.action,
        detail: event.detail,
        prev_hash: event.prev_hash,
        created_at: normaliseTimestamp(event.created_at),
      })
    );
    if (event.prev_hash !== prevHash || event.hash !== expected) {
      return {
        valid: false,
        checked: index,
        brokenAt: index,
        head: ordered[ordered.length - 1]?.hash ?? GENESIS_HASH,
      };
    }
    prevHash = event.hash;
  }

  return {
    valid: true,
    checked: ordered.length,
    brokenAt: null,
    head: prevHash,
  };
}
