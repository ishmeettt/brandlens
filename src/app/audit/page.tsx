"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AppShell } from "../../components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  PageHeader,
  SeverityBadge,
  StatusBadge,
  cn,
} from "../../components/ui";
import { daysUntilExpiry, exemptionStatus } from "../../lib/exemptions";
import {
  auditPackFilename,
  auditPackToJson,
  buildAuditPack,
  canSeal,
  sealAuditPack,
  type AuditPack,
} from "../../lib/audit-pack";
import { buildDemoFindings, demoBrandKit, demoSubmissions } from "../../lib/demo";
import { formatDateTime } from "../../lib/format";
import {
  isSupabaseConfigured,
  supabase,
  type BrandKit,
  type ContentSubmission,
  type Finding,
} from "../../lib/supabase";

function shortDigest(digest: string): string {
  return digest ? `${digest.slice(0, 12)}…${digest.slice(-6)}` : "unavailable";
}

function AuditRecord() {
  const params = useSearchParams();
  const id = params.get("submission");
  const demo = !isSupabaseConfigured;

  const [pack, setPack] = React.useState<AuditPack | null>(null);
  const [loading, setLoading] = React.useState(Boolean(id));
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    if (!id) {
      setPack(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setPack(null);

    (async () => {
      try {
        let submission: ContentSubmission | null = null;
        let findings: Finding[] = [];
        let kit: BrandKit | null = null;

        if (demo) {
          submission = demoSubmissions.find((item) => item.id === id) ?? null;
          findings = buildDemoFindings().filter((finding) => finding.submission_id === id);
          kit = demoBrandKit;
        } else if (supabase) {
          const { data: row, error: rowError } = await supabase
            .from("content_submissions")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (rowError) throw rowError;
          submission = (row as ContentSubmission | null) ?? null;

          if (submission) {
            const [findingRows, kitRow] = await Promise.all([
              supabase
                .from("findings")
                .select("*")
                .eq("submission_id", submission.id)
                .order("created_at", { ascending: true }),
              submission.brand_kit_id
                ? supabase
                    .from("brand_kits")
                    .select("*")
                    .eq("id", submission.brand_kit_id)
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            ]);
            if (findingRows.error) throw findingRows.error;
            findings = (findingRows.data ?? []) as Finding[];
            kit = (kitRow.data as BrandKit | null) ?? null;
          }
        }

        if (!submission) {
          if (active) {
            setError(
              "No submission matches that reference. Open the audit record from the review queue or the admin table."
            );
            setLoading(false);
          }
          return;
        }

        const unsealed = buildAuditPack({ submission, findings, kit });
        const sealed = canSeal()
          ? await sealAuditPack(unsealed)
          : { ...unsealed, digest: "" };
        if (active) {
          setPack(sealed);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not build the audit record.");
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id, demo]);

  function downloadJson() {
    if (!pack) return;
    const blob = new Blob([auditPackToJson(pack)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = auditPackFilename(pack);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${auditPackFilename(pack)}.`);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="card h-40 animate-pulse" />
        <div className="card h-64 animate-pulse" />
      </div>
    );
  }

  if (!id || error || !pack) {
    return (
      <>
        <PageHeader
          eyebrow="Audit"
          title="Audit record"
          description="A frozen record of one submission: what was found, what was decided, and whether the engine still reproduces it."
        />
        <div className="mt-6">
          {error ? (
            <Alert tone="danger" title="No audit record">
              {error}
            </Alert>
          ) : (
            <Card>
              <EmptyState
                title="Choose a submission"
                description="Audit records are opened from a submission in the review queue or the admin table."
                action={
                  <Link href="/review" className="btn-secondary btn-sm">
                    Open the review queue
                  </Link>
                }
              />
            </Card>
          )}
        </div>
      </>
    );
  }

  const reproduced = pack.reconciliation.reproduced;
  const totalFindings = pack.summary.total;
  const allReproduced = totalFindings > 0 && reproduced === totalFindings;

  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow="Audit"
          title="Audit record"
          description="Generated from workspace data in this browser. Print it, download the JSON, or keep the digest."
          actions={
            <>
              <Link href="/review" className="btn-secondary btn-sm">
                Back to review
              </Link>
              <Button variant="secondary" size="sm" onClick={downloadJson}>
                Download JSON
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        />
        {notice ? (
          <div className="mt-5">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}
      </div>

      <article className="audit-sheet mt-6 space-y-4">
        <Card className="overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50/40 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                  BrandLens · brand governance audit record
                </p>
                <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink-900">
                  {pack.subject.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={pack.subject.status} />
                  <Badge tone="neutral">{pack.subject.contentType}</Badge>
                  {pack.verdict.blocking > 0 ? (
                    <Badge tone="danger">{pack.verdict.blocking} blocking</Badge>
                  ) : (
                    <Badge tone="success">No blocking findings</Badge>
                  )}
                  <span className="font-mono text-[11px] text-ink-400">{pack.subject.id}</span>
                </div>
              </div>
              <div className="text-right text-[11px] leading-relaxed text-ink-400">
                <p>Generated {formatDateTime(pack.generatedAt)}</p>
                <p>{pack.brandKit ? pack.brandKit.name : "No brand kit attached"}</p>
                <p className="font-mono">{shortDigest(pack.digest)}</p>
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px bg-ink-100 sm:grid-cols-4">
            {[
              { label: "Findings", value: pack.summary.total },
              { label: "Accepted", value: pack.verdict.accepted },
              { label: "Dismissed", value: pack.verdict.rejected },
              { label: "Pending", value: pack.verdict.pending },
            ].map((item) => (
              <div key={item.label} className="bg-white px-5 py-4">
                <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{item.label}</dt>
                <dd className="mt-1 text-lg font-semibold text-ink-900">{item.value}</dd>
              </div>
            ))}
          </dl>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-100 px-6 py-4 text-[12px] sm:grid-cols-4">
            <div>
              <dt className="text-ink-400">Submitted</dt>
              <dd className="mt-0.5 text-ink-700">{formatDateTime(pack.subject.submittedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-400">Length</dt>
              <dd className="mt-0.5 text-ink-700">
                {pack.subject.words.toLocaleString()} words · {pack.subject.characters.toLocaleString()} characters
              </dd>
            </div>
            <div>
              <dt className="text-ink-400">Anchors</dt>
              <dd className="mt-0.5 text-ink-700">
                {pack.subject.anchorKind === "none"
                  ? "plain text"
                  : `${pack.subject.anchors} ${pack.subject.anchorKind}`}
              </dd>
            </div>
            <div>
              <dt className="text-ink-400">Cited</dt>
              <dd className="mt-0.5 text-ink-700">
                {pack.summary.cited} of {pack.summary.total}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Findings and decisions"
            description="Each row is one recorded finding, the clause it cited, where it sits in the document, and what a reviewer decided."
          />
          {pack.findings.length === 0 ? (
            <EmptyState
              title="No recorded findings"
              description="The engine raised nothing on this text, so there is nothing to reproduce or decide."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="table-head">Severity</th>
                    <th className="table-head">Family</th>
                    <th className="table-head">Finding</th>
                    <th className="table-head">Page</th>
                    <th className="table-head">Decision</th>
                    <th className="table-head">Reproduced</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.findings.map((finding) => (
                    <tr key={finding.id} className="align-top">
                      <td className="table-cell"><SeverityBadge severity={finding.severity} /></td>
                      <td className="table-cell whitespace-nowrap text-[12px] font-medium text-ink-700">
                        {finding.family}
                      </td>
                      <td className="table-cell">
                        <p className="max-w-[380px] text-[12px] leading-relaxed text-ink-700">
                          {finding.message}
                        </p>
                        {finding.citation ? (
                          <p className="mt-1 text-[11px] text-ink-400">
                            Cited · {finding.citation}
                          </p>
                        ) : null}
                      </td>
                      <td className="table-cell whitespace-nowrap text-[12px] text-ink-500">
                        {finding.locator ?? "—"}
                      </td>
                      <td className="table-cell whitespace-nowrap">
                        <span
                          className={cn(
                            "text-[12px] font-medium capitalize",
                            finding.decision === "accepted"
                              ? "text-emerald-600"
                              : finding.decision === "rejected"
                                ? "text-ink-400"
                                : "text-amber-600"
                          )}
                        >
                          {finding.decision}
                        </span>
                      </td>
                      <td className="table-cell whitespace-nowrap text-[12px]">
                        {finding.exempt ? (
                          <span className="text-amber-600" title="An in-date exemption suppresses this finding">
                            Exempt
                          </span>
                        ) : finding.reproduced ? (
                          <span className="text-emerald-600">Yes</span>
                        ) : (
                          <span className="text-ink-400">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Exemptions"
            description="Governance decisions stored with the kit: scoped, owned, and expiring."
          />
          <div className="space-y-4 p-5">
            {pack.exemptions.applied.length > 0 ? (
              <ul className="space-y-2">
                {pack.exemptions.applied.map((use) => (
                  <li
                    key={`${use.exemptionId}-${use.message}`}
                    className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2"
                  >
                    <p className="text-[12px] font-medium text-ink-700">{use.message}</p>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {use.ruleId} · {use.scope} · {use.owner} · expires{" "}
                      {new Date(use.expiresAt).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    <p className="mt-0.5 text-[11px] italic text-ink-400">“{use.reason}”</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-500">
                No exemption suppressed a finding in this record.
              </p>
            )}

            {pack.exemptions.recorded.length > 0 ? (
              <ul className="space-y-1.5 border-t border-ink-50 pt-3">
                {pack.exemptions.recorded.map((exemption) => {
                  const status = exemptionStatus(exemption);
                  return (
                    <li
                      key={`recorded-${exemption.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500"
                    >
                      <span>
                        <span className="font-mono text-[10px] text-ink-400">{exemption.ruleId}</span>
                        {" · "}
                        {exemption.target ? `“${exemption.target}”` : "all findings"}
                        {exemption.submissionId ? ` · ${exemption.submissionId}` : ""} · {exemption.owner}
                      </span>
                      <span className={status === "active" ? "text-emerald-600" : "text-ink-400"}>
                        {status === "active"
                          ? `active · ${daysUntilExpiry(exemption)}d left`
                          : "lapsed"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <p className="text-[11px] leading-relaxed text-ink-400">{pack.exemptions.note}</p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Engine reconciliation"
            description="The deterministic engine is re-run over this text when the record is generated."
          />
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={allReproduced ? "success" : "warning"}>
                {reproduced} of {totalFindings} reproduced
              </Badge>
              {pack.reconciliation.engineOnly.length > 0 ? (
                <Badge tone="warning">
                  {pack.reconciliation.engineOnly.length} new since review
                </Badge>
              ) : null}
            </div>

            <p className="text-[12px] leading-relaxed text-ink-600">{pack.reconciliation.note}</p>

            {pack.reconciliation.engineOnly.length > 0 ? (
              <ul className="space-y-2 border-t border-ink-50 pt-3">
                {pack.reconciliation.engineOnly.map((note) => (
                  <li key={`${note.ruleId}-${note.message}`} className="text-[12px] leading-relaxed text-ink-600">
                    <span className="font-mono text-[10px] text-ink-400">{note.ruleId}</span>
                    {" · "}
                    {note.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="border-t border-ink-50 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Digest · SHA-256
              </p>
              <div className="mt-1.5 flex items-start gap-2">
                <code className="break-all font-mono text-[11px] leading-relaxed text-ink-600">
                  {pack.digest || "unavailable in this browser"}
                </code>
                {pack.digest ? <CopyButton value={pack.digest} label="Copy" /> : null}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                Covers the canonical JSON of this record. Re-generating the record reproduces the
                digest; changing any recorded detail changes it.
              </p>
            </div>

            <p className="text-[10px] uppercase tracking-[0.12em] text-ink-300">
              {pack.version} · engine rule families cited above · generated in the browser
            </p>
          </div>
        </Card>
      </article>
    </>
  );
}

export default function AuditPage() {
  return (
    <AppShell>
      <React.Suspense
        fallback={<div className="card h-96 animate-pulse" />}
      >
        <AuditRecord />
      </React.Suspense>
    </AppShell>
  );
}
