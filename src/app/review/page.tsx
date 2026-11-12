"use client";

import Link from "next/link";
import * as React from "react";
import { AccessDenied, AppShell } from "../../components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  PageHeader,
  SeverityBadge,
  Spinner,
  StatusBadge,
  cn,
} from "../../components/ui";
import { appendAuditEvent, type AuditAction } from "../../lib/audit-events";
import { buildDemoFindings, demoBrandKit, demoSubmissions } from "../../lib/demo";
import {
  documentNameFromLabel,
  locatorForFinding,
  parseSegments,
  stripAnchors,
} from "../../lib/document-extract";
import { daysUntilExpiry, describeExemption } from "../../lib/exemptions";
import { formatDate, formatDateTime } from "../../lib/format";
import { getSlaRows, type SlaFindingRow } from "../../lib/governance-ops";
import { runRuleSet } from "../../lib/rules";
import {
  getFindingTypeLabel,
  runFullReview,
  type PipelineFinding,
  type ReviewResult,
} from "../../lib/review-pipeline";
import {
  currentReviewer,
  isMissingColumnError,
  isSupabaseConfigured,
  supabase,
  type BrandKit,
  type ContentSubmission,
  type Finding,
  type UserRole,
} from "../../lib/supabase";

type Filter = "open" | "mine" | "overdue" | "approved" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "Needs review" },
  { value: "mine", label: "Mine" },
  { value: "overdue", label: "Overdue" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

function storedFindingToPipeline(finding: Finding): PipelineFinding {
  return {
    id: finding.id,
    submissionId: finding.submission_id,
    ruleId: finding.rule_id ?? "stored",
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    citation: finding.citation ?? null,
    sourcePassage: finding.source_passage ?? null,
    suggestion: finding.suggestion ?? undefined,
    intentSummary: finding.intent_summary ?? undefined,
    confidence: 1,
    origin: "deterministic",
    status: finding.status,
    createdAt: finding.created_at,
  };
}

export default function ReviewDashboard() {
  const demo = !isSupabaseConfigured;

  const [role, setRole] = React.useState<UserRole | null>(demo ? "admin" : null);
  const [submissions, setSubmissions] = React.useState<ContentSubmission[]>(
    demo ? demoSubmissions : []
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(
    demo ? demoSubmissions[0]?.id ?? null : null
  );
  // Cache resolved kits in a ref: keeping this in state would change the
  // loader's identity and re-trigger the analysis (and its inserts) each time a
  // kit arrives.
  const kitsRef = React.useRef<Record<string, BrandKit>>(
    demo ? { [demoBrandKit.id]: demoBrandKit } : {}
  );
  const [result, setResult] = React.useState<ReviewResult | null>(null);
  const [findings, setFindings] = React.useState<PipelineFinding[]>([]);
  const [rejected, setRejected] = React.useState<PipelineFinding[]>([]);
  const [loading, setLoading] = React.useState(!demo);
  const [analysing, setAnalysing] = React.useState(false);
  const [savingDecision, setSavingDecision] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("open");
  const [query, setQuery] = React.useState("");
  const [userId, setUserId] = React.useState<string | null>(null);
  // Worst severity per submission, so the queue can show whose review is late.
  const [queueFindings, setQueueFindings] = React.useState<SlaFindingRow[]>(
    demo
      ? buildDemoFindings().map((finding) => ({
          submission_id: finding.submission_id,
          severity: finding.severity,
        }))
      : []
  );
  const [auditNotice, setAuditNotice] = React.useState<string | null>(null);

  const selected = submissions.find((item) => item.id === selectedId) ?? null;

  /* -------- Load queue ------------------------------------------- */
  React.useEffect(() => {
    if (!supabase) return;
    let active = true;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", auth.user.id)
          .maybeSingle();

        const resolvedRole = (profile?.role as UserRole | undefined) ?? "creator";
        if (!active) return;
        setUserId(auth.user.id);
        setRole(resolvedRole);
        if (resolvedRole !== "reviewer" && resolvedRole !== "admin") {
          setLoading(false);
          return;
        }

        const { data, error: listError } = await supabase
          .from("content_submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(80);
        if (listError) throw listError;
        if (!active) return;

        const rows = (data ?? []) as ContentSubmission[];
        setSubmissions(rows);

        // Severity per submission drives the queue's overdue filter. A failure
        // here must not block the queue: the filter then just finds nothing.
        const { data: severityRows } = await supabase
          .from("findings")
          .select("submission_id,severity")
          .limit(2000);
        if (active && severityRows) setQueueFindings(severityRows as SlaFindingRow[]);
        setSelectedId(rows.find((row) => row.status === "submitted" || row.status === "under_review")?.id ?? rows[0]?.id ?? null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load the review queue.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /* -------- Resolve the brand kit for a submission ---------------- */
  const loadKit = React.useCallback(
    async (submission: ContentSubmission): Promise<BrandKit | null> => {
      const cached = submission.brand_kit_id ? kitsRef.current[submission.brand_kit_id] : undefined;
      if (cached) return cached;
      if (demo) return demoBrandKit;
      if (!supabase || !submission.brand_kit_id) return null;

      const { data } = await supabase
        .from("brand_kits")
        .select("*")
        .eq("id", submission.brand_kit_id)
        .maybeSingle();
      if (!data) return null;
      kitsRef.current[submission.brand_kit_id] = data as BrandKit;
      return data as BrandKit;
    },
    [demo]
  );

  /* -------- Analyse the selected submission ----------------------- */
  // Recording a decision replaces the submission object, so the analysis is
  // keyed on the submission it ran for: the same submission never re-analyses
  // (which would wipe the findings the reviewer is looking at), while switching
  // away and back does.
  const analysedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!selected) return;

    let active = true;

    (async () => {
      // A recorded decision replaces the submission object, which re-runs this
      // effect. Re-analysing would throw away the findings the reviewer just
      // decided on, so a submission that already finished analysing is left
      // alone — and the spinner is cleared here so a skip is never a hang.
      if (analysedRef.current === selected.id) {
        setAnalysing(false);
        return;
      }

      // The analysis is reset where it is loaded, so selecting a submission
      // starts one render rather than several synchronous ones.
      setAnalysing(true);
      setResult(null);
      setFindings([]);
      setRejected([]);
      setError(null);
      try {
        const kit = await loadKit(selected);
        if (!active) return;

        if (kit && supabase) {
          const { data: existing } = await supabase
            .from("findings")
            .select("*")
            .eq("submission_id", selected.id)
            .order("created_at", { ascending: true });

          if (existing && existing.length > 0) {
            const rows = existing as Finding[];
            // Stored findings do not carry their anchor, so it is resolved from
            // the stored text: page anchors survive a reload.
            const segments = parseSegments(selected.text_content);

            // A stored finding is a snapshot of the review, but an exemption is
            // a decision that outranks it: granting one must change what the
            // queue shows immediately. Stored rows carry no rule id before
            // migration 0004, so the engine — which is deterministic — is asked
            // which findings the kit's in-date exemptions now excuse.
            const suppressedNow = runRuleSet(stripAnchors(selected.text_content), kit, {
              submissionId: selected.id,
            }).suppressed;

            const quotedTerms = (text: string) =>
              [...text.matchAll(/[“\"']([^”\"']{2,80})[”\"']/g)].map((match) =>
                match[1].toLowerCase()
              );

            // A stored message can predate a wording change in the rule that
            // raised it, so an exact message match is preferred and the quoted
            // term is the fallback. Both sides quote the offending wording.
            const exemptionFor = (row: Finding) => {
              const exact = suppressedNow.find((entry) => entry.finding.message === row.message);
              if (exact) return exact.exemption;

              const storedTerms = quotedTerms(row.message);
              return suppressedNow.find((entry) => {
                if (entry.finding.type !== row.type) return false;
                const exemption = entry.exemption;
                if (exemption.submissionId && exemption.submissionId !== selected.id) return false;
                const sharesTerm = quotedTerms(entry.finding.message).some((term) =>
                  storedTerms.includes(term)
                );
                return (
                  sharesTerm ||
                  (exemption.target
                    ? row.message.toLowerCase().includes(exemption.target.toLowerCase())
                    : false)
                );
              })?.exemption;
            };

            const kept: PipelineFinding[] = [];
            const excused: ReviewResult["suppressed"] = [];
            for (const row of rows) {
              const finding: PipelineFinding = {
                ...storedFindingToPipeline(row),
                locator: locatorForFinding({ message: row.message }, segments),
              };
              const exemption = exemptionFor(row);
              if (exemption) excused.push({ finding, exemption });
              else kept.push(finding);
            }

            setFindings(kept);
            setResult({
              contentText: selected.text_content ?? "",
              segments,
              deterministicFindings: [],
              aiFindings: [],
              allFindings: [],
              rejectedFindings: [],
              suppressed: excused,
              summary: {
                total: kept.length,
                deterministic: kept.length,
                ai: 0,
                bySeverity: {
                  critical: kept.filter((r) => r.severity === "critical").length,
                  high: kept.filter((r) => r.severity === "high").length,
                  medium: kept.filter((r) => r.severity === "medium").length,
                  low: kept.filter((r) => r.severity === "low").length,
                },
                withCitation: kept.filter((r) => Boolean(r.citation)).length,
                withoutCitation: 0,
              },
              aiStatus: "ok",
              analysedAt: new Date().toISOString(),
            });
            analysedRef.current = selected.id;
            setAnalysing(false);
            return;
          }
        }

        const review = await runFullReview(selected, kit, {
          intentSummary: `Publish "${selected.title}" for the brand.`,
        });
        if (!active) return;

        setResult(review);
        setFindings(review.allFindings);
        setRejected(review.rejectedFindings);
        analysedRef.current = selected.id;

        if (supabase && kit && review.allFindings.length > 0) {
          const rows = review.allFindings.map((finding) => ({
            submission_id: selected.id,
            type: finding.type,
            severity: finding.severity,
            message: finding.message,
            citation: finding.citation,
            source_passage: finding.sourcePassage,
            intent_summary: finding.intentSummary ?? null,
            suggestion: finding.suggestion ?? null,
            status: "pending" as const,
            rule_id: finding.ruleId,
          }));

          let { data: inserted, error: insertError } = await supabase
            .from("findings")
            .insert(rows)
            .select("*");

          // Before migration 0004 there is no rule_id column: save the finding
          // anyway, and let per-rule precision attribute it by message.
          if (insertError && isMissingColumnError(insertError)) {
            const fallback = await supabase
              .from("findings")
              .insert(
                rows.map((row) => {
                  const withoutRuleId = { ...row } as Record<string, unknown>;
                  delete withoutRuleId.rule_id;
                  return withoutRuleId;
                })
              )
              .select("*");
            inserted = fallback.data;
            insertError = fallback.error;
          }

          if (insertError) {
            setNotice("Findings were generated but could not be saved. Check the findings table policy.");
          } else if (inserted) {
            // Keep the anchor: the stored row has no locator column, so resolve
            // it from the segments this review was built from.
            setFindings(
              (inserted as Finding[]).map((row) => ({
                ...storedFindingToPipeline(row),
                locator: locatorForFinding(row, review.segments),
              }))
            );
          }
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "The review pipeline failed.");
      } finally {
        if (active) setAnalysing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selected, loadKit]);

  /* -------- Decisions -------------------------------------------- */
  /**
   * Append to the write-once feed. Best effort: before migration 0004 the
   * table is absent, the decision still lives in `findings`, and the page says
   * so once rather than failing the decision itself.
   */
  async function logDecision(input: {
    action: AuditAction;
    findingId?: string | null;
    detail: Record<string, unknown>;
  }) {
    if (!supabase || !selected) return;
    const kit = selected.brand_kit_id ? kitsRef.current[selected.brand_kit_id] : null;
    const organizationId = kit?.organization_id ?? null;
    // Without an owning organization the row could never be read back.
    if (!organizationId) return;

    const result = await appendAuditEvent({
      organizationId,
      submissionId: selected.id,
      findingId: input.findingId ?? null,
      actor: await currentReviewer(),
      action: input.action,
      detail: { submissionTitle: selected.title, ...input.detail },
    });

    if (result.status === "not_migrated") {
      setAuditNotice(
        "The decision is recorded, but the write-once audit feed needs migration 20240101000004 applied to this workspace."
      );
    }
  }

  async function setFindingStatus(findingId: string, status: "accepted" | "rejected") {
    setFindings((rows) => rows.map((row) => (row.id === findingId ? { ...row, status } : row)));
    if (!supabase) return;
    const reviewer = await currentReviewer();
    const payload = {
      status,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
    };

    let { error: updateError } = await supabase
      .from("findings")
      .update(payload)
      .eq("id", findingId);

    if (updateError && isMissingColumnError(updateError)) {
      // No reviewer columns yet: record the decision itself.
      const retry = await supabase.from("findings").update({ status }).eq("id", findingId);
      updateError = retry.error;
    }

    if (updateError) {
      setError("Could not save that decision.");
      return;
    }

    const decidedFinding = findings.find((row) => row.id === findingId);
    void logDecision({
      action: status === "accepted" ? "finding.accepted" : "finding.rejected",
      findingId,
      detail: {
        finding: decidedFinding?.message ?? null,
        clause: decidedFinding?.citation ?? null,
        decision: status,
      },
    });
  }

  async function decide(status: "approved" | "changes_requested") {
    if (!selected) return;
    setSavingDecision(true);
    setError(null);

    // Only pending findings follow the submission decision; an explicit accept
    // or dismiss already recorded by the reviewer must survive it.
    const decided = status === "approved" ? "accepted" : "rejected";

    try {
      if (supabase) {
        const { error: updateError } = await supabase
          .from("content_submissions")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", selected.id);
        if (updateError) throw updateError;

        const pending = findings.filter((f) => f.status === "pending");
        if (pending.length > 0) {
          const reviewer = await currentReviewer();
          const { error: bulkError } = await supabase
            .from("findings")
            .update({
              status: decided,
              reviewed_by: reviewer,
              reviewed_at: new Date().toISOString(),
            })
            .eq("submission_id", selected.id)
            .eq("status", "pending");
          if (bulkError && isMissingColumnError(bulkError)) {
            await supabase
              .from("findings")
              .update({ status: decided })
              .eq("submission_id", selected.id)
              .eq("status", "pending");
          }
        }
      }

      // Demo mode persists nothing, but the decision still has to be visible:
      // the notice below says the pending findings were resolved, so they are.
      setSubmissions((rows) =>
        rows.map((row) => (row.id === selected.id ? { ...row, status } : row))
      );
      setFindings((rows) =>
        rows.map((row) => (row.status === "pending" ? { ...row, status: decided } : row))
      );

      setNotice(
        status === "approved"
          ? `“${selected.title}” approved. The decision is recorded against ${findings.length} finding${findings.length === 1 ? "" : "s"}.`
          : `Changes requested on “${selected.title}”. Pending findings were marked rejected.`
      );

      void logDecision({
        action: status === "approved" ? "submission.approved" : "submission.changes_requested",
        detail: {
          decision: status,
          resolvedFindings: findings.filter((row) => row.status === "pending").length,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the decision.");
    } finally {
      setSavingDecision(false);
    }
  }

  // The same policy clock the admin page uses, so "overdue" means one thing.
  const slaById = React.useMemo(() => {
    const rows = getSlaRows(submissions, queueFindings);
    return new Map(rows.map((row) => [row.submissionId, row]));
  }, [submissions, queueFindings]);

  const visible = submissions.filter((item) => {
    if (filter === "open" && !["submitted", "under_review", "changes_requested"].includes(item.status)) return false;
    if (filter === "mine" && item.owner_id !== userId) return false;
    if (filter === "overdue" && slaById.get(item.id)?.state !== "overdue") return false;
    if (filter === "approved" && item.status !== "approved") return false;
    if (query.trim() && !item.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  const segments = React.useMemo(() => {
    if (result?.segments?.length) return result.segments;
    return parseSegments(selected?.text_content);
  }, [result, selected?.text_content]);

  const documentGroups = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const segment of segments) {
      const name = documentNameFromLabel(segment.label);
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, pages]) => ({ name, pages }));
  }, [segments]);

  // Matches the "Needs review" filter below: a submission with changes
  // requested is still open, so counting only two statuses made the header
  // disagree with the list it points at.
  const openCount = submissions.filter((item) =>
    ["submitted", "under_review", "changes_requested"].includes(item.status)
  ).length;
  const pendingFindings = findings.filter((finding) => finding.status === "pending").length;
  const highSeverity = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;

  if (loading) {
    return (
      <AppShell>
        <div className="grid gap-6 lg:grid-cols-[330px_minmax(0,1fr)]">
          <div className="card h-96 animate-pulse" />
          <div className="card h-96 animate-pulse" />
        </div>
      </AppShell>
    );
  }

  if (role && role !== "reviewer" && role !== "admin") {
    return (
      <AppShell>
        <AccessDenied role={role} requirement="reviewer" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Human in the loop"
        title="Review queue"
        description="Each finding cites the clause behind it. Accept what is right, dismiss what is not, then decide on the submission."
        actions={
          <>
            <Badge tone={openCount > 0 ? "warning" : "success"}>{openCount} open</Badge>
            <Link href="/submit" className="btn-secondary btn-sm">
              New submission
            </Link>
          </>
        }
      />

      {error ? (
        <div className="mt-5">
          <Alert tone="danger" title="Something went wrong">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-5">
          <Alert tone="success" action={<button onClick={() => setNotice(null)} className="btn-ghost btn-sm">Dismiss</button>}>
            {notice}
          </Alert>
        </div>
      ) : null}
      {auditNotice ? (
        <div className="mt-5">
          <Alert
            tone="warning"
            title="Audit feed not writable"
            action={<button onClick={() => setAuditNotice(null)} className="btn-ghost btn-sm">Dismiss</button>}
          >
            {auditNotice}
          </Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* Queue */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <div className="border-b border-ink-100 p-3">
              <div className="relative">
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4 4" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search submissions"
                  className="field pl-9 py-2 text-[13px]"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1 rounded-lg bg-ink-50 p-1">
                {/* "Mine" needs a signed-in reviewer; the demo has no owners. */}
                {FILTERS.filter((item) => item.value !== "mine" || userId).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    className={cn(
                      "flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-medium transition",
                      filter === item.value ? "bg-white text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-700"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-slim">
              {visible.length === 0 ? (
                <EmptyState
                  title="Nothing in this view"
                  description={
                    filter === "mine"
                      ? "No submission is assigned to you. An admin can set the owner from the workspace tab."
                      : filter === "overdue"
                        ? "Every open review is inside its target time."
                        : "Try another filter or submit new content for review."
                  }
                  action={<Link href="/submit" className="btn-secondary btn-sm">Submit content</Link>}
                />
              ) : (
                <ul className="divide-y divide-ink-50">
                  {visible.map((item) => {
                    const active = item.id === selectedId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          className={cn(
                            "w-full px-4 py-3.5 text-left transition",
                            active ? "bg-brand-50/60" : "hover:bg-ink-50/60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", active ? "text-brand-800" : "text-ink-800")}>
                              {item.title}
                            </p>
                            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-brand-500" : "bg-transparent")} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={item.status} />
                            <span className="text-[11px] uppercase tracking-wide text-ink-300">
                              {item.content_type}
                            </span>
                            <span className="text-[11px] text-ink-300">· {formatDate(item.created_at)}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </aside>

        {/* Detail */}
        <div className="min-w-0 space-y-4">
          {!selected ? (
            <Card>
              <EmptyState
                title="Select a submission"
                description="Pick something from the queue to run the review engine and inspect its findings."
              />
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={selected.status} />
                      <Badge tone="neutral">{selected.content_type}</Badge>
                      <span className="text-[11px] text-ink-300">
                        {formatDateTime(selected.created_at)}
                      </span>
                    </div>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink-900">{selected.title}</h2>
                  </div>
                  {analysing ? (
                    <span className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[12px] font-medium text-brand-700">
                      <Spinner className="h-3.5 w-3.5" /> Running rules
                    </span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-ink-300">
                        {findings.length} finding{findings.length === 1 ? "" : "s"} · {pendingFindings} pending
                      </span>
                      <Link
                        href={`/audit?submission=${selected.id}`}
                        className="btn-secondary btn-sm"
                        title="Open the frozen audit record for this submission"
                      >
                        Audit record
                      </Link>
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                      Submitted content
                    </p>
                    {documentGroups.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">
                          {documentGroups.length} document{documentGroups.length === 1 ? "" : "s"} · one verdict
                        </Badge>
                        {documentGroups.map((group) => (
                          <span
                            key={group.name}
                            className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500"
                            title={`${group.pages} page${group.pages === 1 ? "" : "s"} read`}
                          >
                            {group.name} · {group.pages}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selected.content_type === "image" && selected.image_url ? (
                    <div className="mt-2 overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selected.image_url} alt={selected.title} className="max-h-64 w-full object-cover" />
                    </div>
                  ) : null}

                  {result?.contentText || selected.text_content ? (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-ink-100 bg-ink-50/50 px-4 py-3 font-sans text-[13px] leading-relaxed text-ink-700 scrollbar-slim">
                      {stripAnchors(result?.contentText || selected.text_content)}
                    </pre>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-[13px] text-ink-400">
                      No readable text was stored for this submission, so nothing can be
                      checked against the brand kit. Re-submit it with its text.
                    </div>
                  )}
                </div>
              </Card>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Findings", value: findings.length, tone: "text-ink-900" },
                  { label: "Critical + high", value: highSeverity, tone: "text-red-600" },
                  { label: "Cited", value: findings.filter((f) => Boolean(f.citation)).length, tone: "text-emerald-600" },
                  { label: "Discarded", value: rejected.length, tone: "text-ink-400" },
                ].map((stat) => (
                  <div key={stat.label} className="card px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-ink-400">{stat.label}</p>
                    <p className={cn("mt-1 text-xl font-semibold", stat.tone)}>{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Findings */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink-900">
                    Findings{" "}
                    {findings.length > 0 ? (
                      <span className="font-normal text-ink-400">
                        {findings.filter((f) => f.status === "accepted").length} accepted ·{" "}
                        {findings.filter((f) => f.status === "rejected").length} dismissed
                      </span>
                    ) : null}
                  </h3>
                  {result?.aiStatus === "not_configured" ? (
                    <span className="text-[11px] text-ink-400">AI pass skipped · rules only</span>
                  ) : null}
                </div>

                {analysing ? (
                  <Card className="p-5">
                    <div className="space-y-3">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-ink-100" />
                      <div className="h-3 w-3/4 animate-pulse rounded bg-ink-100" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100" />
                    </div>
                  </Card>
                ) : findings.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      }
                      title="No findings"
                      description="Nothing in this content contradicts the brand kit. Silence here means the evidence did not support a flag."
                    />
                  </Card>
                ) : (
                  <ul className="space-y-3">
                    {findings.map((finding) => {
                      const decided = finding.status !== "pending";
                      return (
                        <li
                          key={finding.id}
                          className={cn(
                            "card p-5 transition",
                            decided && finding.status === "rejected" && "opacity-60",
                            decided && finding.status === "accepted" && "border-emerald-200"
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <SeverityBadge severity={finding.severity} />
                              <span className="text-[13px] font-semibold text-ink-900">
                                {getFindingTypeLabel(finding.type)}
                              </span>
                              <Badge tone={finding.origin === "ai" ? "brand" : "neutral"}>
                                {finding.origin === "ai" ? "AI judgement" : "Rule engine"}
                              </Badge>
                              {finding.locator ? (
                                <span
                                  className="max-w-[11rem] truncate rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500"
                                  title="Where this finding sits in the submitted document"
                                >
                                  {finding.locator}
                                </span>
                              ) : null}
                            </div>
                            {finding.status !== "pending" ? (
                              <Badge tone={finding.status === "accepted" ? "success" : "neutral"}>
                                {finding.status === "accepted" ? "Accepted" : "Dismissed"}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-ink-300">
                                confidence {finding.confidence.toFixed(2)}
                              </span>
                            )}
                          </div>

                          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-700">{finding.message}</p>

                          {finding.citation ? (
                            <div className="mt-3 rounded-lg border-l-2 border-brand-400 bg-brand-50/50 px-3.5 py-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-700">
                                  Cited · {finding.citation}
                                </p>
                                {finding.sourcePassage ? <CopyButton value={finding.sourcePassage} label="Copy" /> : null}
                              </div>
                              {finding.sourcePassage ? (
                                <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                                  {finding.sourcePassage}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-3 text-[12px] text-red-600">No citation — this finding should not be shown.</p>
                          )}

                          {finding.suggestion ? (
                            <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-50/60 px-3.5 py-2.5">
                              <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                                <circle cx="12" cy="12" r="9" />
                              </svg>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                                  Suggested fix
                                </p>
                                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-700">{finding.suggestion}</p>
                              </div>
                              <CopyButton value={finding.suggestion} label="Copy" />
                            </div>
                          ) : null}

                          <div className="mt-3.5 flex items-center gap-2 border-t border-ink-50 pt-3">
                            <Button
                              size="sm"
                              variant={finding.status === "accepted" ? "primary" : "secondary"}
                              onClick={() => setFindingStatus(finding.id, "accepted")}
                              disabled={finding.status === "accepted"}
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setFindingStatus(finding.id, "rejected")}
                              disabled={finding.status === "rejected"}
                            >
                              Dismiss
                            </Button>
                            <span className="ml-auto text-[11px] text-ink-300">{finding.submissionId.slice(0, 10)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {result && result.suppressed.length > 0 ? (
                <Card className="border-amber-200 bg-amber-50/40 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-ink-900">
                      Excused by an active exemption
                    </p>
                    <Badge tone="warning">
                      {result.suppressed.length} suppressed
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    The engine raised these findings, then an in-date exemption scoped to this work
                    suppressed them. They are recorded, not deleted — the audit pack carries the
                    decision, its owner and its expiry.
                  </p>
                  <ul className="mt-3 space-y-2 border-t border-amber-200/60 pt-3">
                    {result.suppressed.map(({ finding, exemption }) => (
                      <li key={`exempt-${finding.id}`}>
                        <p className="text-[12px] font-medium text-ink-700">{finding.message}</p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {describeExemption(exemption)} · {exemption.owner} · expires{" "}
                          {new Date(exemption.expiresAt).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          ({daysUntilExpiry(exemption)} day{daysUntilExpiry(exemption) === 1 ? "" : "s"})
                        </p>
                        <p className="mt-0.5 text-[11px] italic text-ink-400">“{exemption.reason}”</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {rejected.length > 0 ? (
                <details className="card group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-ink-900">
                        Discarded by the evidence-or-silence rule
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {rejected.length} AI note{rejected.length === 1 ? "" : "s"} could not cite a brand-kit passage.
                      </p>
                    </div>
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <ul className="mt-3 space-y-2 border-t border-ink-50 pt-3">
                    {rejected.map((finding) => (
                      <li key={finding.id} className="text-[12px] leading-relaxed text-ink-400">
                        <span className="line-through decoration-ink-300">{finding.message}</span>
                        <span className="ml-2 text-[11px] text-ink-300">no matching clause</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {/* Decision */}
              <Card className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">Submission decision</p>
                    <p className="mt-0.5 text-[12px] text-ink-400">
                      {pendingFindings > 0
                        ? `${pendingFindings} finding${pendingFindings === 1 ? "" : "s"} still pending — you can decide anyway.`
                        : "All findings have been reviewed."}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => decide("changes_requested")}
                      loading={savingDecision}
                      disabled={selected.status === "changes_requested"}
                    >
                      Request changes
                    </Button>
                    <Button
                      onClick={() => decide("approved")}
                      loading={savingDecision}
                      disabled={selected.status === "approved"}
                    >
                      Approve submission
                    </Button>
                  </div>
                </div>
              </Card>

              {demo ? (
                <p className="pb-2 text-center text-[11px] text-ink-300">
                  Demo workspace · decisions are not persisted
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
