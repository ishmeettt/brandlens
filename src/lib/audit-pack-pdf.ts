/**
 * The audit record as a document.
 *
 * The JSON is the machine-readable artefact; this is the one a lawyer reads.
 * Both are generated from the same pack, so the PDF cannot say something the
 * JSON does not.
 */

import { auditPackFilename, type AuditPack } from "./audit-pack";
import { formatDateTime } from "./format";
import { renderPdf, type PdfBlock } from "./pdf";

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function auditPackToPdf(pack: AuditPack): Uint8Array {
  const blocks: PdfBlock[] = [];

  blocks.push({ kind: "title", text: "Audit record" });
  blocks.push({
    kind: "subtitle",
    text: `${pack.subject.title} · ${pack.version} · generated ${formatDateTime(pack.generatedAt)}`,
  });

  /* ---------------------------------------------------------------- subject */
  blocks.push({ kind: "heading", text: "Subject" });
  blocks.push({ kind: "kv", label: "Submission", value: pack.subject.title });
  blocks.push({ kind: "kv", label: "Status", value: titleCase(pack.subject.status) });
  blocks.push({ kind: "kv", label: "Content type", value: pack.subject.contentType.toUpperCase() });
  blocks.push({ kind: "kv", label: "Submitted", value: formatDateTime(pack.subject.submittedAt) });
  blocks.push({
    kind: "kv",
    label: "Size",
    value: `${pack.subject.words.toLocaleString()} words · ${pack.subject.characters.toLocaleString()} characters`,
  });
  blocks.push({
    kind: "kv",
    label: "Anchors",
    value:
      pack.subject.anchorKind === "none"
        ? "none (unanchored text)"
        : `${pack.subject.anchors} ${pack.subject.anchorKind}`,
  });
  blocks.push({
    kind: "kv",
    label: "Brand kit",
    value: pack.brandKit ? pack.brandKit.name : "not resolved",
  });

  /* ---------------------------------------------------------------- verdict */
  blocks.push({ kind: "heading", text: "Verdict" });
  blocks.push({ kind: "kv", label: "Decision", value: titleCase(pack.verdict.status) });
  blocks.push({
    kind: "kv",
    label: "Blocking findings",
    value: String(pack.verdict.blocking),
  });
  blocks.push({
    kind: "kv",
    label: "Reviewer decisions",
    value: `${pack.verdict.accepted} accepted · ${pack.verdict.rejected} dismissed · ${pack.verdict.pending} pending`,
  });
  blocks.push({
    kind: "small",
    text:
      `${pack.summary.total} findings recorded, ${pack.summary.cited} with a citation. ` +
      `Severity: ${pack.summary.bySeverity.critical} critical, ${pack.summary.bySeverity.high} high, ` +
      `${pack.summary.bySeverity.medium} medium, ${pack.summary.bySeverity.low} low.`,
  });

  /* --------------------------------------------------------------- findings */
  blocks.push({ kind: "heading", text: "Findings" });
  if (pack.findings.length === 0) {
    blocks.push({ kind: "text", text: "No findings were recorded against this submission." });
  }
  for (const finding of pack.findings) {
    blocks.push({
      kind: "bullet",
      text: `${finding.severity.toUpperCase()} · ${titleCase(finding.type)} — ${finding.message}`,
    });
    const details: string[] = [];
    if (finding.locator) details.push(`at ${finding.locator}`);
    details.push(finding.citation ? `cited: ${finding.citation}` : "no clause cited");
    details.push(`${titleCase(finding.decision)} on ${formatDateTime(finding.recordedAt)}`);
    if (finding.ruleId) details.push(`rule ${finding.ruleId}`);
    if (finding.exempt) details.push("exempt under an active exemption");
    blocks.push({ kind: "small", text: details.join(" · ") });
  }

  /* --------------------------------------------------------- reconciliation */
  blocks.push({ kind: "heading", text: "Reproduction" });
  blocks.push({
    kind: "text",
    text: `${pack.reconciliation.reproduced} of ${pack.reconciliation.total} recorded findings were reproduced by the current engine.`,
  });
  if (pack.reconciliation.engineOnly.length > 0) {
    blocks.push({ kind: "text", text: "The engine would also raise, but no finding was recorded for:" });
    for (const note of pack.reconciliation.engineOnly) {
      blocks.push({ kind: "bullet", text: `${note.ruleId} — ${note.message}` });
    }
  }
  if (pack.reconciliation.unmatched.length > 0) {
    blocks.push({ kind: "text", text: "Recorded findings the current engine no longer reproduces:" });
    for (const message of pack.reconciliation.unmatched) {
      blocks.push({ kind: "bullet", text: message });
    }
  }
  blocks.push({ kind: "small", text: pack.reconciliation.note });

  /* ------------------------------------------------------------- exemptions */
  blocks.push({ kind: "heading", text: "Exemptions" });
  if (pack.exemptions.applied.length === 0) {
    blocks.push({ kind: "small", text: pack.exemptions.note });
  } else {
    for (const applied of pack.exemptions.applied) {
      blocks.push({
        kind: "bullet",
        text: `${applied.owner} allowed “${applied.message}” until ${formatDateTime(applied.expiresAt)} — ${applied.reason}`,
      });
    }
  }

  /* ----------------------------------------------------------------- digest */
  blocks.push({ kind: "rule" });
  blocks.push({ kind: "kv", label: "Digest", value: pack.digest });
  blocks.push({
    kind: "small",
    text:
      "The digest is computed over the whole record as canonical JSON: re-generate the record and " +
      "any change to a finding, decision or exemption changes it.",
  });

  return renderPdf({
    title: `Audit record · ${pack.subject.title}`,
    footer: "BrandLens · evidence-or-silence · every finding cites a brand-kit clause",
    blocks,
  });
}

export function auditPackPdfFilename(pack: AuditPack): string {
  return auditPackFilename(pack).replace(/\.json$/, "") + ".pdf";
}
