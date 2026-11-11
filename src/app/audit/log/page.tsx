"use client";

import Link from "next/link";
import * as React from "react";
import { AppShell } from "../../../components/AppShell";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "../../../components/ui";
import { buildDemoFindings, demoSubmissions } from "../../../lib/demo";
import {
  buildDecisionLog,
  shortHash,
  verifyDecisionLog,
  type DecisionLogEntry,
  type DecisionLogVerification,
} from "../../../lib/decision-log";
import { formatDateTime } from "../../../lib/format";
import {
  isSupabaseConfigured,
  supabase,
  type ContentSubmission,
  type Finding,
} from "../../../lib/supabase";

const PAGE_SIZE = 25;

export default function DecisionLogPage() {
  const demo = !isSupabaseConfigured;
  const [entries, setEntries] = React.useState<DecisionLogEntry[]>([]);
  const [verification, setVerification] = React.useState<DecisionLogVerification | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState(PAGE_SIZE);

  React.useEffect(() => {
    let active = true;

    (async () => {
      try {
        let submissions: ContentSubmission[] = demo ? demoSubmissions : [];
        let findings: Finding[] = demo ? buildDemoFindings() : [];

        if (!demo && supabase) {
          const [subs, finds] = await Promise.all([
            supabase
              .from("content_submissions")
              .select("id,title,status,created_at,brand_kit_id,content_type,text_content")
              .order("created_at", { ascending: false })
              .limit(200),
            supabase
              .from("findings")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(500),
          ]);
          if (subs.error) throw subs.error;
          if (finds.error) throw finds.error;
          submissions = (subs.data ?? []) as ContentSubmission[];
          findings = (finds.data ?? []) as Finding[];
        }

        const log = await buildDecisionLog({ submissions, findings });
        const check = await verifyDecisionLog(log);
        if (active) {
          setEntries(log);
          setVerification(check);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not build the decision log.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [demo]);

  // The chain is built oldest-first; the feed reads newest-first.
  const visible = [...entries].reverse().slice(0, shown);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Audit"
        title="Decision log"
        description="Every recorded decision in one ordered feed: reviewer, timestamp, finding and the clause it cites. Each entry is hashed with the entry before it, so the feed can be verified but not quietly edited."
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger" title="Decision log unavailable">
            {error}
          </Alert>
        </div>
      ) : null}

      {verification ? (
        <Card className="mb-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink-900">
                Chain {verification.valid ? "verified" : "broken"}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">
                {verification.checked} entr{verification.checked === 1 ? "y" : "ies"} recomputed, each
                hash including the one before it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={verification.valid ? "success" : "danger"}>
                {verification.valid ? "Intact" : `Broken at #${verification.brokenAt}`}
              </Badge>
              <span className="font-mono text-[11px] text-ink-400">
                head {shortHash(verification.head)}
              </span>
            </div>
          </div>
          <p className="mt-3 border-t border-ink-50 pt-3 text-[11px] leading-relaxed text-ink-400">
            The chain is derived from stored findings ordered by decision time; append-only storage is
            what migration 0004 adds. Rewriting a message, swapping two decisions or deleting an entry
            changes every later hash.
          </p>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title="Feed"
          description="Newest first. Pending findings are recorded too, so silence is visible."
        />

        {loading ? (
          <div className="space-y-3 p-5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-ink-100" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="Once a reviewer accepts or dismisses a finding, it appears here with its clause and hash."
          />
        ) : (
          <ul className="divide-y divide-ink-50">
            {visible.map((entry) => (
              <li key={entry.findingId} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-300">#{entry.index}</span>
                  <Badge
                    tone={
                      entry.decision === "accepted"
                        ? "success"
                        : entry.decision === "rejected"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {entry.decision}
                  </Badge>
                  <span className="text-[11px] text-ink-400">{formatDateTime(entry.at)}</span>
                  <span className="text-[11px] text-ink-400">·</span>
                  <span className="text-[11px] text-ink-500">
                    {entry.reviewer ?? "Unattributed"}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-ink-300" title={entry.hash}>
                    {shortHash(entry.hash)}
                  </span>
                </div>

                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-700">{entry.finding}</p>
                <p className="mt-1 text-[11px] text-ink-400">
                  {entry.submissionId ? (
                    <Link
                      href={`/audit?submission=${entry.submissionId}`}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      {entry.submissionTitle}
                    </Link>
                  ) : (
                    entry.submissionTitle
                  )}
                  {entry.clause ? ` · cited: ${entry.clause}` : " · no clause"}
                </p>
              </li>
            ))}
          </ul>
        )}

        {shown < entries.length ? (
          <div className="border-t border-ink-50 p-4 text-center">
            <button
              type="button"
              onClick={() => setShown((value) => value + PAGE_SIZE)}
              className="text-[12px] font-medium text-brand-600 hover:text-brand-700"
            >
              Show {Math.min(PAGE_SIZE, entries.length - shown)} older
            </button>
          </div>
        ) : null}
      </Card>
    </AppShell>
  );
}
