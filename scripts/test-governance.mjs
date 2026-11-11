/**
 * Verification for the governance layer: the policy clock, precision from
 * reviewer decisions, and the audit record's reconciliation and digest.
 *
 * Runs the real modules through esbuild, so a change to the maths is checked
 * here rather than re-implemented in the test.
 */
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = new URL("..", import.meta.url);
const bundlePath = fileURLToPath(new URL(".build/governance.mjs", root));

await esbuild.build({
  stdin: {
    contents: [
      'export * from "./src/lib/governance-ops.ts";',
      'export * from "./src/lib/audit-pack.ts";',
      'export * from "./src/lib/demo.ts";',
      'export * from "./src/lib/exemptions.ts";',
      'export * from "./src/lib/decision-log.ts";',
      'export * from "./src/lib/document-extract.ts";',
      'export { runRuleSet, brandKitPassages } from "./src/lib/rules.ts";',
    ].join("\n"),
    resolveDir: fileURLToPath(root),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  logLevel: "warning",
});

const {
  getSlaRows,
  summariseSla,
  describeLatency,
  getRulePrecision,
  summarisePrecision,
  buildAuditPack,
  sealAuditPack,
  canonicalJson,
  demoBrandKit,
  demoSubmissions,
  buildDemoFindings,
  parseExemptions,
  runRuleSet,
  brandKitPassages,
  attributeRuleIds,
  getPrecisionByRule,
  buildDecisionLog,
  verifyDecisionLog,
  stripAnchors,
  serialiseDocuments,
  parseSegments,
  hasAnchors,
} = await import(new URL(".build/governance.mjs", root).href);

let failed = 0;
function check(name, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failed += 1;
  console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const now = Date.UTC(2026, 10, 9, 12, 0, 0);
const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();

/* ------------------------------------------------------------------ */
/* Policy clock                                                        */
/* ------------------------------------------------------------------ */

const clockSubmissions = [
  { id: "s-critical", title: "Late critical", status: "submitted", created_at: daysAgo(2) },
  { id: "s-high", title: "High, inside target", status: "under_review", created_at: daysAgo(1) },
  { id: "s-low", title: "Low, fresh", status: "submitted", created_at: daysAgo(0) },
  { id: "s-approved", title: "Already approved", status: "approved", created_at: daysAgo(30) },
];

const clockFindings = [
  { submission_id: "s-critical", severity: "critical" },
  { submission_id: "s-high", severity: "high" },
  { submission_id: "s-low", severity: "low" },
  { submission_id: "s-approved", severity: "critical" },
];

const rows = getSlaRows(clockSubmissions, clockFindings, now);
const byId = Object.fromEntries(rows.map((row) => [row.submissionId, row]));

check(
  "critical submission is overdue against the 1-day target",
  byId["s-critical"].state === "overdue" && byId["s-critical"].hoursRemaining < 0,
  `${byId["s-critical"].state}, ${describeLatency(byId["s-critical"].hoursRemaining)}`
);
check(
  "high submission is still on track inside 3 days",
  byId["s-high"].state === "on_track",
  byId["s-high"].state
);
check(
  "low submission is on track inside 7 days",
  byId["s-low"].state === "on_track",
  byId["s-low"].state
);
check(
  "approved submission is closed, not overdue",
  byId["s-approved"].state === "closed",
  byId["s-approved"].state
);
check(
  "clock is derived from the worst severity present",
  byId["s-critical"].policyDays === 1 && byId["s-low"].policyDays === 7
);

const sla = summariseSla(rows);
check(
  "SLA summary counts match the rows",
  sla.overdue === 1 && sla.onTrack === 2 && sla.closed === 1,
  `${sla.overdue} overdue · ${sla.dueSoon} due soon · ${sla.onTrack} on track`
);
check(
  "late rows sort first",
  rows[0].submissionId === "s-critical",
  rows[0].submissionId
);
check(
  "latency reads as human text",
  describeLatency(-6) === "6h late" && describeLatency(48) === "in 2d",
  `${describeLatency(-6)} / ${describeLatency(48)}`
);

/* ------------------------------------------------------------------ */
/* Precision from decisions                                            */
/* ------------------------------------------------------------------ */

const decisionRows = [
  ...Array.from({ length: 4 }, () => ({ type: "terminology", status: "accepted" })),
  ...Array.from({ length: 1 }, () => ({ type: "terminology", status: "rejected" })),
  { type: "claim", status: "accepted" },
  { type: "claim", status: "pending" },
  { type: "logo", status: "pending" },
];

const precisionRows = getRulePrecision(decisionRows);
const terminology = precisionRows.find((row) => row.type === "terminology");
const claim = precisionRows.find((row) => row.type === "claim");
const logo = precisionRows.find((row) => row.type === "logo");

check(
  "terminology precision is accepted over decided",
  terminology.precision === 80 && terminology.decided === 5,
  `${terminology.precision}% of ${terminology.decided}`
);
check("five decisions count as a trusted sample", terminology.sample === "trusted");
check("one decision is labelled thin", claim.sample === "thin" && claim.precision === 100);
check("no decision yields no rate", logo.precision === null && logo.sample === "none");

const precision = summarisePrecision(precisionRows);
check(
  "workspace precision aggregates every decision",
  precision.decided === 6 && precision.precision === 83,
  `${precision.precision}% of ${precision.decided}`
);
check(
  "quiet families are reported, not hidden",
  precision.quietFamilies.includes("Colour") && precision.observedFamilies < precision.totalFamilies,
  `${precision.observedFamilies}/${precision.totalFamilies} observed`
);

/* ------------------------------------------------------------------ */
/* Audit record                                                        */
/* ------------------------------------------------------------------ */

const demoFindings = buildDemoFindings();
const blockingSubmission = demoSubmissions.find((row) => row.id === "sub-1042");
const approvedSubmission = demoSubmissions.find((row) => row.id === "sub-1040");

const blockingPack = buildAuditPack({
  submission: blockingSubmission,
  findings: demoFindings.filter((row) => row.submission_id === blockingSubmission.id),
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
});

check(
  "audit pack records the submission's findings",
  blockingPack.summary.total > 0,
  `${blockingPack.summary.total} findings`
);
check(
  "audit pack counts blocking findings that were not dismissed",
  blockingPack.verdict.blocking > 0,
  `${blockingPack.verdict.blocking} blocking`
);
check(
  "every recorded finding is reproduced by the current engine",
  blockingPack.reconciliation.reproduced === blockingPack.summary.total &&
    blockingPack.reconciliation.engineOnly.length === 0,
  `${blockingPack.reconciliation.reproduced}/${blockingPack.summary.total}`
);
check(
  "plain-text submissions report no anchors",
  blockingPack.subject.anchorKind === "none" && blockingPack.subject.anchors === 0
);
check(
  "the record names its version",
  blockingPack.version === "brandlens.audit/1",
  blockingPack.version
);

const anchored = buildAuditPack({
  submission: {
    ...blockingSubmission,
    id: "sub-anchored",
    text_content: [
      "[[p.1]]",
      "Introducing Signal Studio — our AI-generated insights workspace.",
      "[[p.2]]",
      "Teams move 63% faster than with spreadsheets.",
      "[[p.3]]",
      'Accent colour for the launch banner: #FF6B00.',
    ].join("\n"),
  },
  findings: demoFindings.filter((row) => row.submission_id === blockingSubmission.id),
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
});

check(
  "document submissions report page anchors",
  anchored.subject.anchorKind === "pages" && anchored.subject.anchors === 3,
  `${anchored.subject.anchors} pages`
);
check(
  "findings carry the page they sit on",
  anchored.findings.some((finding) => finding.locator === "p.2"),
  anchored.findings.map((finding) => finding.locator ?? "—").join(", ")
);

const approvedPack = buildAuditPack({
  submission: approvedSubmission,
  findings: demoFindings.filter((row) => row.submission_id === approvedSubmission.id),
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
});
check(
  "approved submissions show their recorded decisions",
  approvedPack.verdict.accepted === approvedPack.summary.total && approvedPack.verdict.pending === 0,
  `${approvedPack.verdict.accepted} accepted`
);

/* Tamper detection: change one recorded message. */
const tamperedFindings = demoFindings
  .filter((row) => row.submission_id === blockingSubmission.id)
  .map((row, index) => (index === 0 ? { ...row, message: `${row.message} (edited)` } : row));
const tampered = buildAuditPack({
  submission: blockingSubmission,
  findings: tamperedFindings,
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
});
check(
  "an edited finding is reported as not reproduced",
  tampered.reconciliation.reproduced === tampered.summary.total - 1 &&
    tampered.reconciliation.unmatched.length === 1,
  `${tampered.reconciliation.reproduced}/${tampered.summary.total}`
);

/* Digest stability */
const sealA = await sealAuditPack(blockingPack);
const sealB = await sealAuditPack(
  buildAuditPack({
    submission: blockingSubmission,
    findings: demoFindings.filter((row) => row.submission_id === blockingSubmission.id),
    kit: demoBrandKit,
    generatedAt: "2026-11-09T12:00:00.000Z",
  })
);
check(
  "identical records produce the same digest",
  sealA.digest === sealB.digest && /^[0-9a-f]{64}$/.test(sealA.digest),
  sealA.digest.slice(0, 16)
);

const sealC = await sealAuditPack(buildAuditPack({
  submission: blockingSubmission,
  findings: tamperedFindings,
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
}));
check("an edited record changes the digest", sealC.digest !== sealA.digest);

check(
  "canonical JSON ignores key order",
  canonicalJson({ b: 1, a: { d: 2, c: 3 } }) === canonicalJson({ a: { c: 3, d: 2 }, b: 1 })
);

/* ------------------------------------------------------------------ */
/* Exemptions                                                          */
/* ------------------------------------------------------------------ */

const runFor = (id) => {
  const submission = demoSubmissions.find((row) => row.id === id);
  return runRuleSet(stripAnchors(submission.text_content), demoBrandKit, { submissionId: id });
};

const exemptions = parseExemptions(demoBrandKit.guidelines);
check("the kit stores exemptions beside its clauses", exemptions.length === 2, `${exemptions.length} recorded`);

const run1041 = runFor("sub-1041");
check(
  "an in-date exemption suppresses its finding",
  run1041.suppressed.some((entry) => entry.exemption.id === "ex-2201") &&
    !run1041.findings.some((finding) => /utilize/i.test(finding.message)),
  run1041.suppressed.map((entry) => entry.exemption.id).join(", ") || "nothing suppressed"
);

const run1042 = runFor("sub-1042");
check(
  "a lapsed exemption no longer applies",
  run1042.findings.some((finding) => /superlative "best"/i.test(finding.message)) &&
    !run1042.suppressed.some((entry) => entry.exemption.id === "ex-2188")
);

const run1038 = runFor("sub-1038");
check(
  "an exemption scoped to one submission does not leak into another",
  run1038.findings.some((finding) => /utilize/i.test(finding.message)) &&
    !run1038.suppressed.some((entry) => entry.exemption.id === "ex-2201")
);

check(
  "exemptions are not citable clauses",
  !brandKitPassages(demoBrandKit).some((passage) => /co-branded/i.test(passage.text))
);

const pack1041 = buildAuditPack({
  submission: demoSubmissions.find((row) => row.id === "sub-1041"),
  findings: buildDemoFindings().filter((row) => row.submission_id === "sub-1041"),
  kit: demoBrandKit,
  generatedAt: "2026-11-09T12:00:00.000Z",
});
check(
  "the audit record names the exemption it applied, with owner and expiry",
  pack1041.exemptions.applied.length > 0 &&
    pack1041.exemptions.applied.every((use) => use.owner && use.reason && use.expiresAt),
  `${pack1041.exemptions.applied.length} applied · ${pack1041.exemptions.recorded.length} recorded`
);

/* ------------------------------------------------------------------ */
/* Per-rule precision                                                  */
/* ------------------------------------------------------------------ */

const attribution = attributeRuleIds(demoFindings, demoSubmissions, demoBrandKit);
const perRule = getPrecisionByRule(demoFindings, attribution);
const unattributed = perRule.find((row) => row.unattributed);
check(
  "every stored decision maps back to an exact rule",
  !unattributed,
  `${attribution.size} of ${demoFindings.length} attributed`
);
check(
  "per-rule precision reports a false-positive rate",
  perRule.some((row) => row.decided > 0 && typeof row.falsePositiveRate === "number"),
  perRule
    .filter((row) => row.decided > 0)
    .map((row) => `${row.ruleId} ${row.precision}%/FP ${row.falsePositiveRate}%`)
    .join(" · ")
);

/* ------------------------------------------------------------------ */
/* Hash-chained decision log                                           */
/* ------------------------------------------------------------------ */

const log = await buildDecisionLog({ submissions: demoSubmissions, findings: demoFindings });
const chain = await verifyDecisionLog(log);
check(
  "the decision log chains every decision",
  chain.valid && chain.checked === log.length && /^[0-9a-f]{64}$/.test(chain.head),
  `${log.length} entries · head ${chain.head.slice(0, 12)}`
);
check(
  "every entry names a reviewer, a time, a finding and a clause",
  log.every((entry) => entry.at && entry.finding && entry.clause && entry.submissionTitle) &&
    log.some((entry) => entry.decision !== "pending")
);

const edited = log.map((entry, index) =>
  index === 2 ? { ...entry, decision: entry.decision === "rejected" ? "accepted" : "rejected" } : entry
);
const editedCheck = await verifyDecisionLog(edited);
check(
  "editing an entry breaks the chain at that entry",
  !editedCheck.valid && editedCheck.brokenAt === 2,
  `broken at #${editedCheck.brokenAt}`
);

const dropped = log.filter((_, index) => index !== 1);
const droppedCheck = await verifyDecisionLog(dropped);
check("deleting an entry breaks the chain", !droppedCheck.valid && droppedCheck.brokenAt === 1);

/* ------------------------------------------------------------------ */
/* Anchors in a document set                                           */
/* ------------------------------------------------------------------ */

const pdf = (text) => ({
  kind: "pdf",
  segments: [{ label: "p.1", text }],
  pageCount: 1,
  charCount: text.length,
  truncated: false,
});
// 50 characters: long enough that the set anchor passes the old 60-character
// marker cap and would have leaked `[[...]]` into the reviewed text.
const longHeading = "Pricing, packaging and the approved discount ladder";
const setText = serialiseDocuments([
  { name: "Autumn deck.pdf", document: pdf("Lumen autumn release") },
  {
    name: "Launch brief.docx",
    document: {
      kind: "docx",
      segments: [
        { label: `¶ 12 · ${longHeading}`, text: "Every claim needs a source." },
      ],
      pageCount: 1,
      charCount: 27,
      truncated: false,
    },
  },
]);
const setSegments = parseSegments(setText);
check(
  "a document set keeps one marker per segment",
  setSegments.length === 2,
  setSegments.map((segment) => segment.label).join(" · ")
);
check(
  "a long set anchor is still recognised as a marker",
  hasAnchors(setText) && !stripAnchors(setText).includes("[["),
  `${setSegments[1]?.label.length ?? 0}-character label`
);
check(
  "every set anchor names the document it came from",
  setSegments[0]?.label.startsWith("Autumn deck · p.1") &&
    setSegments[1]?.label.startsWith("Launch brief · ¶ 12")
);

const duplicates = serialiseDocuments([
  { name: "Brief.pdf", document: pdf("First brief") },
  { name: "Brief.docx", document: pdf("Second brief") },
]);
check(
  "two files with the same short name stay distinguishable",
  parseSegments(duplicates).some((segment) => segment.label.startsWith("Brief (2) · p.1"))
);

const pdfSet = serialiseDocuments([
  { name: "Deck.pdf", document: pdf("Deck copy") },
  { name: "Brief.pdf", document: pdf("Brief copy") },
]);
const setPack = buildAuditPack({
  submission: {
    id: "sub-set",
    title: "Two PDFs",
    status: "pending",
    created_at: "2026-11-09T12:00:00.000Z",
    content_type: "pdf",
    text_content: pdfSet,
  },
  findings: [],
  kit: null,
  generatedAt: "2026-11-09T12:00:00.000Z",
});
check(
  "a batch of PDFs is recorded with page anchors, not paragraph anchors",
  setPack.subject.anchorKind === "pages",
  `${setPack.subject.anchorKind} · ${setPack.subject.anchors} anchors`
);

console.log(
  failed === 0
    ? "\nGovernance layer verified: clock, per-rule precision, exemptions and a hash-chained decision log."
    : `\n${failed} check${failed === 1 ? "" : "s"} failed.`
);
process.exit(failed === 0 ? 0 : 1);
