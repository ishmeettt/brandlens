/**
 * BrandLens governance insights.
 *
 * Pure aggregation over submissions and findings — no simulated numbers.
 */

import type { Severity } from "./supabase";
import { getFindingTypeLabel, type RuleType } from "./rules";

export interface InsightFinding {
  id: string;
  submission_id: string;
  type: string;
  severity: Severity;
  created_at: string;
}

export interface InsightSubmission {
  id: string;
  status: string;
  created_at: string;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export function getSeverityBreakdown(
  findings: InsightFinding[]
): Record<Severity, number> {
  const breakdown: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    if (SEVERITIES.includes(finding.severity)) breakdown[finding.severity] += 1;
  }
  return breakdown;
}

export function getMostCommonFindingTypes(
  findings: InsightFinding[]
): Array<{ type: string; label: string; count: number; percentage: number }> {
  if (findings.length === 0) return [];
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => ({
      type,
      label: getFindingTypeLabel(type as RuleType),
      count,
      percentage: Math.round((count / findings.length) * 100),
    }));
}

/** Share of submissions whose content produced no critical or high finding. */
export function calculateCompliance(
  submissions: InsightSubmission[],
  findings: InsightFinding[]
): { compliance: number; passing: number; failing: number; total: number } {
  const total = submissions.length;
  if (total === 0) return { compliance: 100, passing: 0, failing: 0, total: 0 };

  const blocking = new Set(
    findings
      .filter((finding) => finding.severity === "critical" || finding.severity === "high")
      .map((finding) => finding.submission_id)
  );

  const failing = submissions.filter((submission) => blocking.has(submission.id)).length;
  const passing = total - failing;

  return {
    compliance: Math.round((passing / total) * 100),
    passing,
    failing,
    total,
  };
}

/** Compare the last 14 days against the 14 days before that. */
export function getTrendingIssues(
  findings: InsightFinding[]
): Array<{ type: string; label: string; trend: "up" | "down" | "stable"; recent: number; previous: number }> {
  const now = Date.now();
  const day = 86_400_000;
  const recentStart = now - 14 * day;
  const previousStart = now - 28 * day;

  const buckets = new Map<
    string,
    { recent: number; previous: number }
  >();

  for (const finding of findings) {
    const time = new Date(finding.created_at).getTime();
    if (Number.isNaN(time) || time < previousStart) continue;
    const bucket = buckets.get(finding.type) ?? { recent: 0, previous: 0 };
    if (time >= recentStart) bucket.recent += 1;
    else bucket.previous += 1;
    buckets.set(finding.type, bucket);
  }

  return [...buckets.entries()]
    .map(([type, bucket]) => {
      const delta = bucket.recent - bucket.previous;
      return {
        type,
        label: getFindingTypeLabel(type as RuleType),
        trend: (delta > 0 ? "up" : delta < 0 ? "down" : "stable") as "up" | "down" | "stable",
        recent: bucket.recent,
        previous: bucket.previous,
      };
    })
    .sort((a, b) => b.recent - a.recent)
    .slice(0, 6);
}

export function generateGovernanceReport(
  submissions: InsightSubmission[],
  findings: InsightFinding[]
) {
  const compliance = calculateCompliance(submissions, findings);
  const severity = getSeverityBreakdown(findings);

  return {
    totalSubmissions: submissions.length,
    totalFindings: findings.length,
    complianceRate: compliance.compliance,
    severity,
    commonViolations: getMostCommonFindingTypes(findings),
    trendingIssues: getTrendingIssues(findings),
    generatedAt: new Date().toISOString(),
  };
}
