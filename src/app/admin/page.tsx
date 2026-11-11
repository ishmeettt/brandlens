"use client";

import Link from "next/link";
import * as React from "react";
import { AccessDenied, AppShell } from "../../components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
  SeverityBadge,
  StatCard,
  StatusBadge,
  cn,
} from "../../components/ui";
import { buildDemoFindings, demoBrandKit, demoProfiles, demoSubmissions } from "../../lib/demo";
import { formatDate } from "../../lib/format";
import {
  attributeRuleIds,
  describeLatency,
  getPrecisionByRule,
  getSlaRows,
  summariseRulePrecision,
  summariseSla,
  SLA_POLICY_SUMMARY,
  type SlaState,
} from "../../lib/governance-ops";
import {
  calculateCompliance,
  getMostCommonFindingTypes,
  getSeverityBreakdown,
  getTrendingIssues,
} from "../../lib/governance-insights";
import { getFindingTypeLabel } from "../../lib/rules";
import {
  isMissingColumnError,
  isSupabaseConfigured,
  supabase,
  type BrandKit,
  type ContentSubmission,
  type Finding,
  type UserProfile,
  type UserRole,
} from "../../lib/supabase";

type Tab = "submissions" | "findings" | "people";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "submissions", label: "Submissions" },
  { value: "findings", label: "Findings" },
  { value: "people", label: "People" },
];

export default function AdminDashboard() {
  const demo = !isSupabaseConfigured;

  const [role, setRole] = React.useState<UserRole | null>(demo ? "admin" : null);
  const [loading, setLoading] = React.useState(!demo);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [users, setUsers] = React.useState<UserProfile[]>(demo ? demoProfiles : []);
  const [submissions, setSubmissions] = React.useState<ContentSubmission[]>(
    demo ? demoSubmissions : []
  );
  const [findings, setFindings] = React.useState<Finding[]>(demo ? buildDemoFindings() : []);
  const [kit, setKit] = React.useState<BrandKit | null>(demo ? demoBrandKit : null);
  const [tab, setTab] = React.useState<Tab>("submissions");

  const loadData = React.useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .maybeSingle();

      const resolvedRole = (profile?.role as UserRole | undefined) ?? "creator";
      setRole(resolvedRole);
      if (resolvedRole !== "admin") {
        setLoading(false);
        return;
      }

      const [people, subs, finds, kits] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase
          .from("content_submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("findings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("brand_kits")
          .select("*")
          .eq("organization_id", auth.user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (people.error) throw people.error;
      if (subs.error) throw subs.error;
      if (finds.error) throw finds.error;

      setUsers((people.data ?? []) as UserProfile[]);
      setSubmissions((subs.data ?? []) as ContentSubmission[]);
      setFindings((finds.data ?? []) as Finding[]);
      setKit((kits.data as BrandKit | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the admin dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  /**
   * Assign an owner or a due date. Needs migration 0004; without it the write
   * is refused and the UI says so instead of pretending it saved.
   */
  async function updateOwnership(
    id: string,
    patch: { owner_id?: string | null; due_at?: string | null }
  ) {
    if (!supabase) return;
    const previous = submissions.find((row) => row.id === id);
    if (!previous) return;

    setSubmissions((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

    const { error: updateError } = await supabase
      .from("content_submissions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      setSubmissions((rows) => rows.map((row) => (row.id === id ? previous : row)));
      setError(
        isMissingColumnError(updateError)
          ? "Owners and due dates need migration 0004. Apply it in Supabase, then try again."
          : "Could not save the owner or due date."
      );
    }
  }

  async function removeSubmission(id: string, title: string) {
    if (!supabase) return;
    if (!window.confirm(`Delete “${title}” and all of its findings? This cannot be undone.`)) return;
    try {
      await supabase.from("findings").delete().eq("submission_id", id);
      const { error: deleteError } = await supabase.from("content_submissions").delete().eq("id", id);
      if (deleteError) throw deleteError;
      setSubmissions((rows) => rows.filter((row) => row.id !== id));
      setFindings((rows) => rows.filter((row) => row.submission_id !== id));
      setNotice("Submission deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the submission.");
    }
  }

  async function removeFinding(id: string) {
    if (!supabase) return;
    if (!window.confirm("Delete this finding?")) return;
    try {
      const { error: deleteError } = await supabase.from("findings").delete().eq("id", id);
      if (deleteError) throw deleteError;
      setFindings((rows) => rows.filter((row) => row.id !== id));
      setNotice("Finding deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the finding.");
    }
  }

  const openCount = submissions.filter((item) =>
    ["submitted", "under_review", "changes_requested"].includes(item.status)
  ).length;
  const approvedCount = submissions.filter((item) => item.status === "approved").length;
  const blockedCount = findings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high"
  ).length;

  const severity = getSeverityBreakdown(findings);
  const compliance = calculateCompliance(submissions, findings);
  const commonTypes = getMostCommonFindingTypes(findings);
  const trending = getTrendingIssues(findings);
  const maxTypeCount = commonTypes[0]?.count ?? 1;

  const slaRows = getSlaRows(submissions, findings);
  const sla = summariseSla(slaRows);
  const openClock = slaRows.filter((row) => row.state !== "closed").slice(0, 5);
  const attribution = attributeRuleIds(findings, submissions, kit);
  const precisionRows = getPrecisionByRule(findings, attribution).filter(
    (row) => !row.unattributed || row.decided + row.pending > 0
  );
  const precision = summariseRulePrecision(precisionRows);
  const precisionTone = (value: number | null) =>
    value === null ? "neutral" : value >= 80 ? "success" : value >= 60 ? "brand" : "warning";

  const submissionTitle = (id: string) =>
    submissions.find((submission) => submission.id === id)?.title ?? id.slice(0, 8);

  const severityTotal = Object.values(severity).reduce((sum, value) => sum + value, 0) || 1;

  if (!loading && role && role !== "admin") {
    return (
      <AppShell>
        <AccessDenied role={role} requirement="admin" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance"
        title="Admin"
        description="People, submissions and the finding record across this workspace."
        actions={
          <>
            <Badge tone="neutral">{users.length} people</Badge>
            <Button variant="secondary" size="sm" onClick={() => void loadData()} disabled={demo}>
              Refresh
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mt-5">
          <Alert tone="danger" title="Dashboard error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-5">
          <Alert tone="success" action={<button onClick={() => setNotice(null)} className="btn-ghost btn-sm">Dismiss</button>}>
            {notice}
          </Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Submissions" value={submissions.length} hint={`${openCount} awaiting a decision`} />
        <StatCard label="Findings" value={findings.length} tone="brand" hint={`${findings.filter((f) => f.status === "pending").length} still pending`} />
        <StatCard label="Compliance" value={`${compliance.compliance}%`} tone={compliance.compliance >= 80 ? "success" : "warning"} hint={`${compliance.passing} of ${compliance.total} submissions clear of high severity`} />
        <StatCard label="Blocking" value={blockedCount} tone={blockedCount > 0 ? "danger" : "success"} hint="critical + high findings" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Common findings */}
        <Card className="lg:col-span-2">
          <CardHeader title="Most common findings" description="Where creator output most often departs from the kit." />
          <div className="p-5">
            {commonTypes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-400">No findings recorded yet.</p>
            ) : (
              <ul className="space-y-3.5">
                {commonTypes.map((type) => (
                  <li key={type.type}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-medium text-ink-700">{type.label}</span>
                      <span className="text-ink-400">
                        {type.count} <span className="text-ink-300">· {type.percentage}%</span>
                      </span>
                    </div>
                    <ProgressBar
                      value={(type.count / maxTypeCount) * 100}
                      tone={type.type === "claim" ? "danger" : type.type === "terminology" ? "warning" : "brand"}
                      className="mt-1.5"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Severity + queue */}
        <Card>
          <CardHeader title="Severity mix" description="All recorded findings." />
          <div className="space-y-4 p-5">
            {(["critical", "high", "medium", "low"] as const).map((level) => {
              const value = severity[level];
              const tones = {
                critical: "danger",
                high: "warning",
                medium: "brand",
                low: "success",
              } as const;
              return (
                <div key={level}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="capitalize text-ink-600">{level}</span>
                    <span className="text-ink-400">{value}</span>
                  </div>
                  <ProgressBar value={(value / severityTotal) * 100} tone={tones[level]} className="mt-1.5" />
                </div>
              );
            })}

            <div className="border-t border-ink-50 pt-4 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Approved</span>
                <span className="font-medium text-emerald-600">{approvedCount}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-ink-500">Open queue</span>
                <span className="font-medium text-amber-600">{openCount}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {trending.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="14-day movement" description="Recent finding volume compared with the previous fortnight." />
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {trending.map((item) => (
              <div key={item.type} className="flex items-center justify-between rounded-lg border border-ink-100 px-3.5 py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-ink-700">{item.label}</p>
                  <p className="text-[11px] text-ink-400">
                    {item.recent} recent · {item.previous} before
                  </p>
                </div>
                <Badge tone={item.trend === "up" ? "danger" : item.trend === "down" ? "success" : "neutral"}>
                  {item.trend === "up" ? "↑" : item.trend === "down" ? "↓" : "→"} {item.trend}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Governance operations */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Policy clock"
            description={`Review targets from severity · ${SLA_POLICY_SUMMARY}.`}
          />
          <div className="p-5">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Overdue", value: sla.overdue, tone: "text-red-600" },
                { label: "Due in 24h", value: sla.dueSoon, tone: "text-amber-600" },
                { label: "On track", value: sla.onTrack, tone: "text-emerald-600" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-ink-100 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-ink-400">{item.label}</p>
                  <p className={cn("mt-0.5 text-lg font-semibold", item.tone)}>{item.value}</p>
                </div>
              ))}
            </div>

            {openClock.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-ink-400">
                Nothing is open, so no clock is running.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {openClock.map((row) => {
                  const tone: Record<SlaState, "danger" | "warning" | "success" | "neutral"> = {
                    overdue: "danger",
                    due_soon: "warning",
                    on_track: "success",
                    closed: "neutral",
                    undated: "neutral",
                  };
                  return (
                    <li
                      key={row.submissionId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/audit?submission=${row.submissionId}`}
                          className="block truncate text-[13px] font-medium text-ink-800 hover:text-brand-700"
                        >
                          {row.title}
                        </Link>
                        <p className="text-[11px] text-ink-400">
                          {row.worstSeverity ? `worst finding: ${row.worstSeverity}` : "no findings yet"} · target {row.policyDays}d
                        </p>
                      </div>
                      <Badge tone={tone[row.state]}>{describeLatency(row.hoursRemaining)}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 border-t border-ink-50 pt-3 text-[11px] leading-relaxed text-ink-400">
              Derived from the worst finding on each submission, not from a stored due date, so
              changing the policy re-reads history instead of rewriting it.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Rule precision"
            description="Per rule: share of decided findings a reviewer accepted, and the resulting false-positive rate."
          />
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={precisionTone(precision.precision)}>
                {precision.precision === null ? "No decisions yet" : `${precision.precision}% accepted`}
              </Badge>
              <span className="text-[12px] text-ink-500">
                {precision.decided} decision{precision.decided === 1 ? "" : "s"} · {precision.accepted} accepted, {precision.rejected} dismissed
              </span>
            </div>

            <ul className="mt-4 space-y-3">
              {precisionRows.map((row) => (
                <li key={row.ruleId}>
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-medium text-ink-700" title={row.ruleId}>
                      {row.label}
                    </span>
                    <span className="text-ink-400">
                      {row.precision === null ? (
                        row.pending > 0 ? `${row.pending} pending` : "no evidence yet"
                      ) : (
                        <>
                          {row.precision}% <span className="text-ink-300">· {row.decided} decided · FP {row.falsePositiveRate}%</span>
                          {row.sample === "thin" ? (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-600">thin</span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </div>
                  <ProgressBar
                    value={row.precision ?? 0}
                    tone={row.precision === null ? "brand" : row.precision >= 80 ? "success" : row.precision >= 60 ? "brand" : "warning"}
                    className="mt-1.5"
                  />
                </li>
              ))}
            </ul>

            <Link
              href="/audit/log"
              className="mt-3 inline-block text-[11px] font-medium text-brand-600 hover:text-brand-700"
            >
              Open the hash-chained decision log →
            </Link>

            <p className="mt-2 border-t border-ink-50 pt-3 text-[11px] leading-relaxed text-ink-400">
              {precision.rulesWithEvidence} of {precision.totalRules} rules produced evidence in this
              workspace
              {precision.quietRules.length > 0
                ? `; ${precision.quietRules.join(", ")} stayed silent`
                : ""}
              . Findings store their family, so each decision is mapped back to the exact rule by
              re-running the engine over the submission text.
              {precision.unattributed > 0
                ? ` ${precision.unattributed} finding${precision.unattributed === 1 ? "" : "s"} could not be attributed and ${precision.unattributed === 1 ? "is" : "are"} listed separately.`
                : ""}
            </p>
          </div>
        </Card>
      </div>

      {/* Tables */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div className="flex gap-1 rounded-lg bg-ink-50 p-1">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                  tab === item.value ? "bg-white text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-700"
                )}
              >
                {item.label}
                <span className="ml-1.5 text-ink-300">
                  {item.value === "submissions"
                    ? submissions.length
                    : item.value === "findings"
                      ? findings.length
                      : users.length}
                </span>
              </button>
            ))}
          </div>
          {demo ? <span className="text-[11px] text-ink-300">Demo data · read only</span> : null}
        </div>

        {tab === "submissions" ? (
          submissions.length === 0 ? (
            <EmptyState title="No submissions yet" description="Content submitted for review will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr>
                    <th className="table-head">Submission</th>
                    <th className="table-head">Status</th>
                    <th className="table-head">Format</th>
                    <th className="table-head">Findings</th>
                    <th className="table-head">Owner</th>
                    <th className="table-head">Created</th>
                    <th className="table-head" />
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => {
                    const count = findings.filter((finding) => finding.submission_id === submission.id).length;
                    return (
                      <tr key={submission.id} className="hover:bg-ink-50/40">
                        <td className="table-cell">
                          <span className="block max-w-[280px] truncate font-medium text-ink-800">
                            {submission.title}
                          </span>
                          <span className="font-mono text-[11px] text-ink-300">{submission.id.slice(0, 8)}</span>
                        </td>
                        <td className="table-cell"><StatusBadge status={submission.status} /></td>
                        <td className="table-cell text-[12px] uppercase tracking-wide text-ink-400">
                          {submission.content_type}
                        </td>
                        <td className="table-cell">{count}</td>
                        <td className="table-cell text-[12px] text-ink-500">
                          {demo ? (
                            submission.owner_id
                              ? users.find((person) => person.id === submission.owner_id)?.email ??
                                submission.owner_id.slice(0, 8)
                              : "—"
                          ) : (
                            <div className="space-y-1">
                              <select
                                value={submission.owner_id ?? ""}
                                onChange={(event) =>
                                  void updateOwnership(submission.id, {
                                    owner_id: event.target.value || null,
                                  })
                                }
                                aria-label={`Owner of ${submission.title}`}
                                className="w-full max-w-[150px] rounded-md border border-ink-100 bg-white px-1.5 py-1 text-[11px] text-ink-600"
                              >
                                <option value="">Unassigned</option>
                                {users.map((person) => (
                                  <option key={person.id} value={person.id}>
                                    {person.email}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={submission.due_at ? submission.due_at.slice(0, 10) : ""}
                                onChange={(event) =>
                                  void updateOwnership(submission.id, {
                                    due_at: event.target.value
                                      ? `${event.target.value}T17:00:00.000Z`
                                      : null,
                                  })
                                }
                                aria-label={`Due date for ${submission.title}`}
                                className="w-full max-w-[150px] rounded-md border border-ink-100 bg-white px-1.5 py-1 text-[11px] text-ink-600"
                              />
                            </div>
                          )}
                        </td>
                        <td className="table-cell text-[12px] text-ink-400">
                          {formatDate(submission.created_at)}
                          {submission.due_at ? (
                            <span className="mt-0.5 block text-[11px] text-ink-400">
                              due {formatDate(submission.due_at)}
                            </span>
                          ) : null}
                        </td>
                        <td className="table-cell text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/audit?submission=${submission.id}`}
                              className="text-[12px] font-medium text-brand-600 transition hover:text-brand-800"
                            >
                              Audit
                            </Link>
                            {!demo ? (
                              <button
                                type="button"
                                onClick={() => void removeSubmission(submission.id, submission.title)}
                                className="text-[12px] font-medium text-ink-400 transition hover:text-red-600"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "findings" ? (
          findings.length === 0 ? (
            <EmptyState title="No findings recorded" description="Run a review to generate citation-backed findings." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className="table-head">Type</th>
                    <th className="table-head">Severity</th>
                    <th className="table-head">Finding</th>
                    <th className="table-head">Citation</th>
                    <th className="table-head">Status</th>
                    <th className="table-head" />
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding) => (
                    <tr key={finding.id} className="hover:bg-ink-50/40">
                      <td className="table-cell whitespace-nowrap text-[12px] font-medium text-ink-700">
                        {getFindingTypeLabel(finding.type)}
                      </td>
                      <td className="table-cell"><SeverityBadge severity={finding.severity} /></td>
                      <td className="table-cell">
                        <span className="block max-w-[300px] truncate">{finding.message}</span>
                        <span className="text-[11px] text-ink-300">{submissionTitle(finding.submission_id)}</span>
                      </td>
                      <td className="table-cell max-w-[200px] truncate text-[12px] text-ink-400">
                        {finding.citation ?? "—"}
                      </td>
                      <td className="table-cell"><StatusBadge status={finding.status} /></td>
                      <td className="table-cell text-right">
                        {!demo ? (
                          <button
                            type="button"
                            onClick={() => void removeFinding(finding.id)}
                            className="text-[12px] font-medium text-ink-400 transition hover:text-red-600"
                          >
                            Delete
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "people" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr>
                  <th className="table-head">Person</th>
                  <th className="table-head">Role</th>
                  <th className="table-head">Organisation</th>
                  <th className="table-head">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-ink-50/40">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                          {(user.email ?? user.id).slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink-800">
                            {user.email ?? `${user.id.slice(0, 8)}…`}
                          </p>
                          <p className="font-mono text-[10px] text-ink-300">{user.id.slice(0, 12)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <Badge tone={user.role === "admin" ? "brand" : user.role === "reviewer" ? "info" : "neutral"}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="table-cell text-[13px] text-ink-500">{user.organization ?? "—"}</td>
                    <td className="table-cell text-[12px] text-ink-400">
                      {user.created_at ? formatDate(user.created_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <p className="mt-4 text-center text-[12px] text-ink-300">Loading workspace data…</p>
      ) : null}
    </AppShell>
  );
}
