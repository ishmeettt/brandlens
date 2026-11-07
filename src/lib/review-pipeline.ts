/**
 * BrandLens hybrid review pipeline.
 *
 * 1. Deterministic rules run first (exact, reproducible, citation-backed).
 * 2. The AI pass only adds judgement calls (tone, claim support).
 * 3. Evidence-or-silence: any finding that cannot cite a real brand-kit
 *    passage is discarded and reported separately — never shown as advice.
 */

import type {
  BrandKit,
  ContentSubmission,
  FindingType,
  Severity,
} from "./supabase";
import {
  brandKitPassages,
  contrastRatio,
  getFindingTypeLabel,
  runDeterministicRules,
  validateCitation as validateCitationAgainstPassages,
  type BrandPassage,
  type RuleFinding,
} from "./rules";

export type AiStatus = "not_configured" | "ok" | "error";

export interface PipelineFinding {
  id: string;
  submissionId: string;
  ruleId: string;
  type: FindingType;
  severity: Severity;
  message: string;
  citation: string | null;
  sourcePassage: string | null;
  suggestion?: string;
  intentSummary?: string;
  confidence: number;
  origin: "deterministic" | "ai";
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface ReviewSummary {
  total: number;
  deterministic: number;
  ai: number;
  bySeverity: Record<Severity, number>;
  withCitation: number;
  withoutCitation: number;
}

export interface ReviewResult {
  contentText: string;
  deterministicFindings: PipelineFinding[];
  aiFindings: PipelineFinding[];
  allFindings: PipelineFinding[];
  rejectedFindings: PipelineFinding[];
  summary: ReviewSummary;
  aiStatus: AiStatus;
  aiMessage?: string;
  analysedAt: string;
}

export interface ReviewOptions {
  intentSummary?: string;
  creatorId?: string;
  /** Set to false to skip the AI pass entirely. */
  useAi?: boolean;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `f_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Text extraction                                                     */
/* ------------------------------------------------------------------ */

export function extractTextContent(submission: ContentSubmission): string {
  const text = (submission.text_content ?? "").trim();
  if (text) return text;

  if (submission.content_type === "image") {
    return "";
  }
  if (submission.content_type === "pdf" || submission.content_type === "docx") {
    return "";
  }
  return "";
}

/** Local OCR — runs in the browser, nothing is uploaded. */
export async function extractTextFromImage(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return (data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}

/* ------------------------------------------------------------------ */
/* Citation validation                                                 */
/* ------------------------------------------------------------------ */

export function validateCitation(
  citation: string | null | undefined,
  brandKit: BrandKit | null
): boolean {
  return validateCitationAgainstPassages(citation, brandKitPassages(brandKit));
}

export { contrastRatio, getFindingTypeLabel };

/* ------------------------------------------------------------------ */
/* AI pass                                                             */
/* ------------------------------------------------------------------ */

interface RawAiFinding {
  type?: string;
  severity?: string;
  message?: string;
  citation?: string;
  sourcePassage?: string;
  suggestion?: string;
  confidence?: number;
}

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const TYPES: FindingType[] = [
  "terminology",
  "claim",
  "colour",
  "contrast",
  "alt_text",
  "logo",
  "custom",
];

function coerceSeverity(value: unknown): Severity {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : "medium";
}

function coerceType(value: unknown): FindingType {
  return TYPES.includes(value as FindingType) ? (value as FindingType) : "custom";
}

async function runAiPass(
  content: string,
  kit: BrandKit,
  passages: BrandPassage[],
  options: ReviewOptions
): Promise<{ status: AiStatus; message?: string; findings: RawAiFinding[] }> {
  try {
    const response = await fetch("/api/ai-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        brandKitName: kit.name,
        passages: passages.map((p) => ({
          source: p.source,
          label: p.label,
          text: p.text,
        })),
        intentSummary: options.intentSummary,
      }),
    });

    if (response.status === 501) {
      return { status: "not_configured", findings: [] };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        status: "error",
        message: detail.slice(0, 240) || `AI service returned ${response.status}.`,
        findings: [],
      };
    }

    const payload = (await response.json()) as {
      configured?: boolean;
      findings?: RawAiFinding[];
      hint?: string;
    };
    if (payload.configured === false) {
      return { status: "not_configured", message: payload.hint, findings: [] };
    }
    return { status: "ok", findings: payload.findings ?? [] };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "AI service unreachable.",
      findings: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

function toPipelineFinding(
  submissionId: string,
  finding: RuleFinding,
  origin: "deterministic" | "ai",
  intentSummary?: string
): PipelineFinding {
  return {
    id: newId(),
    submissionId,
    ruleId: finding.ruleId,
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    citation: finding.citation ?? null,
    sourcePassage: finding.sourcePassage ?? null,
    suggestion: finding.suggestion,
    intentSummary,
    confidence: finding.confidence ?? 1,
    origin,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

export async function runFullReview(
  submission: ContentSubmission,
  kit: BrandKit | null,
  options: ReviewOptions = {}
): Promise<ReviewResult> {
  const contentText = extractTextContent(submission);
  const passages = brandKitPassages(kit);
  const intentSummary =
    options.intentSummary ??
    (submission.title ? `Publish "${submission.title}" for the brand.` : undefined);

  const analysedAt = new Date().toISOString();

  if (!kit || !contentText) {
    return {
      contentText,
      deterministicFindings: [],
      aiFindings: [],
      allFindings: [],
      rejectedFindings: [],
      summary: {
        total: 0,
        deterministic: 0,
        ai: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        withCitation: 0,
        withoutCitation: 0,
      },
      aiStatus: "not_configured",
      aiMessage: !kit
        ? "No brand kit is attached to this submission."
        : "No readable text was found, so nothing can be reviewed against the brand kit.",
      analysedAt,
    };
  }

  const deterministicRaw = runDeterministicRules(contentText, kit);
  const deterministicFindings: PipelineFinding[] = [];
  const rejectedFindings: PipelineFinding[] = [];

  for (const raw of deterministicRaw) {
    if (!validateCitationAgainstPassages(raw.citation, passages)) continue;
    deterministicFindings.push(
      toPipelineFinding(submission.id, raw, "deterministic", intentSummary)
    );
  }

  let aiStatus: AiStatus = "not_configured";
  let aiMessage: string | undefined;
  const aiFindings: PipelineFinding[] = [];

  if (options.useAi !== false) {
    const ai = await runAiPass(contentText, kit, passages, options);
    aiStatus = ai.status;
    aiMessage = ai.message;

    for (const raw of ai.findings) {
      if (!raw.message || !raw.citation) continue;
      const candidate = toPipelineFinding(
        submission.id,
        {
          ruleId: "ai.judgement",
          type: coerceType(raw.type),
          severity: coerceSeverity(raw.severity),
          message: raw.message,
          citation: raw.citation,
          sourcePassage: raw.sourcePassage ?? "",
          suggestion: raw.suggestion,
          confidence:
            typeof raw.confidence === "number"
              ? Math.max(0, Math.min(1, raw.confidence))
              : 0.7,
        },
        "ai",
        intentSummary
      );

      if (validateCitationAgainstPassages(candidate.citation, passages)) {
        aiFindings.push(candidate);
      } else {
        rejectedFindings.push(candidate);
      }
    }
  }

  const allFindings = [...deterministicFindings, ...aiFindings].sort(
    (a, b) =>
      SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity)
  );

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of allFindings) bySeverity[finding.severity] += 1;

  return {
    contentText,
    deterministicFindings,
    aiFindings,
    allFindings,
    rejectedFindings,
    summary: {
      total: allFindings.length,
      deterministic: deterministicFindings.length,
      ai: aiFindings.length,
      bySeverity,
      withCitation: allFindings.filter((f) => Boolean(f.citation)).length,
      withoutCitation: rejectedFindings.length,
    },
    aiStatus,
    aiMessage,
    analysedAt,
  };
}

export type { BrandPassage };
