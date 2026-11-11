/**
 * BrandLens deterministic rule engine.
 *
 * Every rule can only fire when the brand kit contains a clause it can cite.
 * That is the evidence-or-silence principle in code: no approved source, no flag.
 */

import { EXEMPTIONS_KEY, coversFinding, parseExemptions, type Exemption } from "./exemptions";
import type { BrandKit, FindingType, Severity } from "./supabase";

export type RuleType = FindingType;

export interface BrandPassage {
  id: string;
  source: "Guidelines" | "Glossary" | "Approved facts" | "Palette" | "Logo";
  label: string;
  text: string;
}

export interface RuleFinding {
  ruleId: string;
  type: RuleType;
  severity: Severity;
  message: string;
  citation: string;
  sourcePassage: string;
  suggestion?: string;
  confidence: number;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TYPE_LABELS: Record<RuleType, string> = {
  terminology: "Terminology",
  claim: "Unsupported claim",
  colour: "Colour",
  contrast: "Contrast",
  alt_text: "Alt text",
  logo: "Logo usage",
  custom: "Brand rule",
};

export function getFindingTypeLabel(type: RuleType | string): string {
  return TYPE_LABELS[type as RuleType] ?? "Brand rule";
}

/* ------------------------------------------------------------------ */
/* Brand kit normalisation                                             */
/* ------------------------------------------------------------------ */

function textLines(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return [entry.trim()].filter(Boolean);
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const text = record.text ?? record.rule ?? record.guideline ?? record.value;
        if (typeof text === "string") return [text.trim()].filter(Boolean);
      }
      return [];
    });
  }
  return [];
}

export interface NormalisedGlossary {
  banned: Array<{ term: string; replacement?: string }>;
  preferred: Array<{ term: string; replacement: string }>;
}

export function normaliseGlossary(value: unknown): NormalisedGlossary {
  const result: NormalisedGlossary = { banned: [], preferred: [] };
  if (!value) return result;

  const pushPreferred = (term: string, replacement: string) => {
    if (term && replacement && term.toLowerCase() !== replacement.toLowerCase()) {
      result.preferred.push({ term, replacement });
    }
  };
  const pushBanned = (term: string, replacement?: string) => {
    if (term) result.banned.push({ term, replacement });
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        pushBanned(entry);
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const term = typeof record.term === "string" ? record.term : "";
        const replacement =
          typeof record.replacement === "string" ? record.replacement : undefined;
        const banned = record.banned !== false;
        if (banned) pushBanned(term, replacement);
        else if (replacement) pushPreferred(term, replacement);
      }
    }
    return result;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.banned)) {
      for (const entry of record.banned) {
        if (typeof entry === "string") pushBanned(entry);
        else if (entry && typeof entry === "object") {
          const item = entry as Record<string, unknown>;
          pushBanned(
            typeof item.term === "string" ? item.term : "",
            typeof item.replacement === "string" ? item.replacement : undefined
          );
        }
      }
    }

    if (Array.isArray(record.preferred)) {
      for (const entry of record.preferred) {
        if (entry && typeof entry === "object") {
          const item = entry as Record<string, unknown>;
          const term = typeof item.term === "string" ? item.term : "";
          const replacement =
            typeof item.replacement === "string"
              ? item.replacement
              : typeof item.use === "string"
                ? item.use
                : "";
          pushPreferred(term, replacement);
        }
      }
    } else if (record.preferred && typeof record.preferred === "object") {
      for (const [term, replacement] of Object.entries(
        record.preferred as Record<string, unknown>
      )) {
        if (typeof replacement === "string") pushPreferred(term, replacement);
      }
    }

    // Flat map form: { "AI-generated": "banned", "AI": "artificial intelligence" }
    for (const [term, raw] of Object.entries(record)) {
      if (term === "banned" || term === "preferred" || term === "terms") continue;
      if (typeof raw !== "string") continue;
      const normalised = raw.trim().toLowerCase();
      if (["banned", "avoid", "do not use", "deprecated", "never"].includes(normalised)) {
        pushBanned(term);
      } else if (normalised) {
        pushPreferred(term, raw);
      }
    }

    if (Array.isArray(record.terms)) {
      for (const entry of record.terms) {
        if (entry && typeof entry === "object") {
          const item = entry as Record<string, unknown>;
          const term = typeof item.term === "string" ? item.term : "";
          const replacement =
            typeof item.replacement === "string" ? item.replacement : "";
          if (item.banned === true) pushBanned(term, replacement || undefined);
          else if (replacement) pushPreferred(term, replacement);
        }
      }
    }
  }

  return result;
}

export interface NormalisedFact {
  label: string;
  value: string;
}

export function normaliseFacts(value: unknown): NormalisedFact[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label : "";
      const val = item.value;
      if (!label || val === undefined || val === null) return [];
      return [{ label, value: String(val) }];
    });
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && typeof val !== "object")
      .map(([label, val]) => ({ label, value: String(val) }));
  }
  return [];
}

export interface NormalisedColour {
  name: string;
  hex: string;
}

export function normalisePalette(value: unknown): NormalisedColour[] {
  if (!value) return [];
  const toHex = (input: string): string | null => {
    const trimmed = input.trim();
    if (/^#?[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.replace("#", "").toUpperCase()}`;
    if (/^#?[0-9a-f]{3}$/i.test(trimmed)) {
      const short = trimmed.replace("#", "");
      return `#${short
        .split("")
        .map((c) => c + c)
        .join("")
        .toUpperCase()}`;
    }
    return null;
  };

  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const hex = typeof item.hex === "string" ? toHex(item.hex) : null;
      if (!hex) return [];
      return [{ name: typeof item.name === "string" ? item.name : hex, hex }];
    });
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([name, val]) => {
      if (typeof val !== "string") return [];
      const hex = toHex(val);
      return hex ? [{ name, hex }] : [];
    });
  }

  return [];
}

function normaliseGuidelines(value: unknown): Array<{ label: string; text: string }> {
  if (!value) return [];
  if (typeof value === "string" || Array.isArray(value)) {
    return textLines(value).map((text, index) => ({ label: `Guideline ${index + 1}`, text }));
  }
  if (typeof value === "object") {
    const out: Array<{ label: string; text: string }> = [];
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      // Exemptions are governance decisions, not clauses the engine may cite.
      if (key === EXEMPTIONS_KEY) continue;
      const label = key.replace(/[_-]/g, " ");
      const lines = textLines(raw);
      for (const line of lines) {
        out.push({ label: `${label}: ${line.slice(0, 42)}`, text: line });
      }
    }
    return out;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Passages — the only citable sources                                 */
/* ------------------------------------------------------------------ */

export function brandKitPassages(kit?: BrandKit | null): BrandPassage[] {
  if (!kit) return [];
  const passages: BrandPassage[] = [];

  for (const { label, text } of normaliseGuidelines(kit.guidelines)) {
    passages.push({ id: `guide-${passages.length}`, source: "Guidelines", label, text });
  }

  const glossary = normaliseGlossary(kit.glossary);
  for (const entry of glossary.banned) {
    passages.push({
      id: `glossary-banned-${entry.term}`,
      source: "Glossary",
      label: `"${entry.term}" is banned`,
      text: entry.replacement
        ? `Do not use "${entry.term}". Use "${entry.replacement}" instead.`
        : `The term "${entry.term}" is not approved for brand copy.`,
    });
  }
  for (const entry of glossary.preferred) {
    passages.push({
      id: `glossary-preferred-${entry.term}`,
      source: "Glossary",
      label: `Use "${entry.replacement}"`,
      text: `Write "${entry.replacement}" rather than "${entry.term}".`,
    });
  }

  for (const fact of normaliseFacts(kit.facts)) {
    passages.push({
      id: `fact-${fact.label}`,
      source: "Approved facts",
      label: fact.label,
      text: `${fact.label}: ${fact.value}`,
    });
  }

  for (const colour of normalisePalette(kit.palette)) {
    passages.push({
      id: `colour-${colour.name}`,
      source: "Palette",
      label: colour.name,
      text: `Approved palette colour "${colour.name}" is ${colour.hex}.`,
    });
  }

  if (kit.logo_url) {
    passages.push({
      id: "logo-approved",
      source: "Logo",
      label: "Approved logo asset",
      text: `The approved logo asset is ${kit.logo_url}.`,
    });
  }

  return passages;
}

/** Does `citation` resolve to a real passage in the brand kit? */
export function validateCitation(
  citation: string | null | undefined,
  passages: BrandPassage[]
): boolean {
  if (!citation) return false;
  const needle = citation.trim().toLowerCase();
  if (!needle) return false;

  return passages.some((passage) => {
    const label = passage.label.toLowerCase();
    const text = passage.text.toLowerCase();
    return (
      label === needle ||
      text.includes(needle) ||
      needle.includes(label) ||
      (needle.length > 12 && text.includes(needle.slice(0, 12)))
    );
  });
}

/* ------------------------------------------------------------------ */
/* Colour maths                                                        */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.replace("#", "").trim();
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function validateColour(
  hex: string,
  brandPrimary: string
): { valid: boolean; ratio: number } {
  const ratio = contrastRatio(hex, brandPrimary);
  return { valid: ratio >= 4.5, ratio: Math.round(ratio * 100) / 100 };
}

/* ------------------------------------------------------------------ */
/* Rule implementation                                                 */
/* ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrences(haystack: string, needle: string): number {
  if (!needle.trim()) return 0;
  const matches = haystack.match(new RegExp(escapeRegExp(needle), "gi"));
  return matches?.length ?? 0;
}

function nearestColour(hex: string, palette: NormalisedColour[]): NormalisedColour | null {
  const rgb = hexToRgb(hex);
  if (!rgb || palette.length === 0) return null;
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const colour of palette) {
    const target = hexToRgb(colour.hex);
    if (!target) continue;
    const distance =
      (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = colour;
    }
  }
  return best;
}

export interface DeterministicOptions {
  /** Skip contrast/colour checks for copy that carries no markup. */
  includeAssets?: boolean;
}

export interface RuleRunOptions {
  /** Exemptions only apply inside the submission they were scoped to. */
  submissionId?: string | null;
  /** Injectable clock so the expiry boundary can be tested. */
  at?: Date;
}

export interface SuppressedFinding {
  finding: RuleFinding;
  exemption: Exemption;
}

export interface RuleRun {
  findings: RuleFinding[];
  suppressed: SuppressedFinding[];
}

function computeRules(content: string, kit?: BrandKit | null): RuleFinding[] {
  const text = content ?? "";
  if (!kit || !text.trim()) return [];

  const passages = brandKitPassages(kit);
  if (passages.length === 0) return [];

  const findings: RuleFinding[] = [];
  const glossary = normaliseGlossary(kit.glossary);
  const facts = normaliseFacts(kit.facts);
  const palette = normalisePalette(kit.palette);
  const guidelines = normaliseGuidelines(kit.guidelines);
  const guidelineText = guidelines.map((g) => g.text.toLowerCase()).join(" ");

  const guidelinePassage = (matcher: RegExp) =>
    passages.find((p) => p.source === "Guidelines" && matcher.test(p.text.toLowerCase()));

  /* --- Terminology ------------------------------------------------- */
  for (const entry of glossary.banned) {
    const hits = occurrences(text, entry.term);
    if (hits === 0) continue;
    const passage = passages.find((p) => p.id === `glossary-banned-${entry.term}`);
    if (!passage) continue;
    findings.push({
      ruleId: "glossary.banned",
      type: "terminology",
      severity: "high",
      message: `Banned term "${entry.term}" appears ${hits}× in this content.`,
      citation: passage.label,
      sourcePassage: passage.text,
      suggestion: entry.replacement
        ? `Replace "${entry.term}" with "${entry.replacement}".`
        : `Remove "${entry.term}" or use approved language from the glossary.`,
      confidence: 1,
    });
  }

  for (const entry of glossary.preferred) {
    if (glossary.banned.some((b) => b.term.toLowerCase() === entry.term.toLowerCase())) continue;
    const hits = occurrences(text, entry.term);
    if (hits === 0) continue;
    const passage = passages.find((p) => p.id === `glossary-preferred-${entry.term}`);
    if (!passage) continue;
    findings.push({
      ruleId: "glossary.preferred",
      type: "terminology",
      severity: "medium",
      message: `Use the approved wording "${entry.replacement}" instead of "${entry.term}".`,
      citation: passage.label,
      sourcePassage: passage.text,
      suggestion: `Replace "${entry.term}" with "${entry.replacement}".`,
      confidence: 1,
    });
  }

  /* --- Claims ------------------------------------------------------ */
  if (facts.length > 0) {
    const approvedValues = facts.map((f) => f.value.toLowerCase()).join(" ");
    const factPassage = passages.find((p) => p.source === "Approved facts");
    // Prefer the claims clause as the evidence for claim findings; fall back to
    // the approved-facts list when the kit has no explicit claims policy.
    const claimPassage =
      guidelinePassage(/claim|superlative|number|approved fact/) ?? factPassage;
    const claimCitation = claimPassage
      ? `${claimPassage.source} · ${claimPassage.label}`
      : null;
    const claimSource =
      claimPassage?.text ?? facts.map((fact) => `${fact.label}: ${fact.value}`).join(" · ");

    // No trailing \b: "%" and "×" are non-word characters, so a boundary
    // after them never matches before a space — "63% faster" used to be read
    // as "63" and skipped as too short.
    const numeric = text.match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|percent|×|x))?/gi) ?? [];
    const suspicious = new Set<string>();
    for (const raw of numeric) {
      const value = raw.trim().toLowerCase();
      // Years belong to the founding-date rule below; counting them as
      // unapproved statistics reported the same problem twice.
      if (/^(19|20)\d{2}$/.test(value)) continue;
      if (!/(%|percent|x|×)/.test(value) && value.replace(/\D/g, "").length < 3) continue;
      if (approvedValues.includes(value.replace(/\s/g, ""))) continue;
      if (approvedValues.includes(value)) continue;
      suspicious.add(value);
    }

    for (const value of suspicious) {
      if (!claimCitation) break;
      findings.push({
        ruleId: "claim.unsupported_stat",
        type: "claim",
        severity: "high",
        message: `The figure "${value}" is not in the approved facts, so it cannot be verified.`,
        citation: claimCitation,
        sourcePassage: claimSource,
        suggestion: `Remove "${value}" or add the supporting fact to the brand kit before publishing.`,
        confidence: 1,
      });
    }

    const superlatives = ["best", "world-class", "guaranteed", "#1", "number one", "fastest", "cheapest", "market-leading"];
    for (const word of superlatives) {
      if (!new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text)) continue;
      if (approvedValues.includes(word)) continue;
      if (!claimCitation) break;
      findings.push({
        ruleId: "claim.superlative",
        type: "claim",
        severity: "medium",
        message: `Unprovable superlative "${word}" is not backed by an approved fact.`,
        citation: claimCitation,
        sourcePassage: claimSource,
        suggestion: `Replace "${word}" with a concrete, verifiable statement.`,
        confidence: 1,
      });
      break;
    }

    const foundedFact = facts.find((f) => /found|establish|launch|since/i.test(f.label));
    if (foundedFact) {
      const years = text.match(/\b(?:19|20)\d{2}\b/g) ?? [];
      const approvedYear = (foundedFact.value.match(/\b(?:19|20)\d{2}\b/) ?? [])[0];
      if (approvedYear) {
        for (const year of years) {
          if (year === approvedYear) continue;
          const passage = passages.find((p) => p.id === `fact-${foundedFact.label}`);
          if (!passage) continue;
          findings.push({
            ruleId: "claim.fact_conflict",
            type: "claim",
            severity: "critical",
            message: `The year ${year} conflicts with the approved fact "${foundedFact.label}: ${foundedFact.value}".`,
            citation: `Approved facts · ${foundedFact.label}`,
            sourcePassage: passage.text,
            suggestion: `Use ${approvedYear} to match the approved fact.`,
            confidence: 1,
          });
        }
      }
    }
  }

  /* --- Alt text ---------------------------------------------------- */
  const accessibilityPassage = guidelinePassage(/alt text|accessib|screen reader/);
  if (accessibilityPassage) {
    const markdownImages = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    const htmlImages = [...text.matchAll(/<img\b[^>]*>/gi)];

    for (const match of markdownImages) {
      if ((match[1] ?? "").trim()) continue;
      findings.push({
        ruleId: "asset.missing_alt",
        type: "alt_text",
        severity: "high",
        message: `Image ${match[2]} has no alt text.`,
        citation: accessibilityPassage.label,
        sourcePassage: accessibilityPassage.text,
        suggestion: "Describe the image in one sentence inside the alt attribute.",
        confidence: 1,
      });
    }

    for (const match of htmlImages) {
      if (/\balt\s*=\s*["'][^"']+["']/i.test(match[0])) continue;
      findings.push({
        ruleId: "asset.missing_alt",
        type: "alt_text",
        severity: "high",
        message: "An <img> element is missing a descriptive alt attribute.",
        citation: accessibilityPassage.label,
        sourcePassage: accessibilityPassage.text,
        suggestion: 'Add alt="…" describing what the image communicates.',
        confidence: 1,
      });
    }
  }

  /* --- Colour & contrast ------------------------------------------- */
  const hexes = [...new Set((text.match(/#[0-9a-f]{3,6}\b/gi) ?? []).map((h) => h.toUpperCase()))];
  if (hexes.length > 0 && palette.length > 0) {
    const palettePassage = passages.find((p) => p.source === "Palette");
    const allowed = new Set(palette.map((c) => c.hex.toUpperCase()));
    for (const hex of hexes) {
      const normalisedHex = hex.length === 4
        ? `#${hex.slice(1).split("").map((c) => c + c).join("")}`.toUpperCase()
        : hex;
      if (!palettePassage) break;
      if (!allowed.has(normalisedHex)) {
        const nearest = nearestColour(normalisedHex, palette);
        findings.push({
          ruleId: "colour.off_palette",
          type: "colour",
          severity: "medium",
          message: `${normalisedHex} is not part of the approved palette.`,
          citation: `Palette · ${nearest?.name ?? palettePassage.label}`,
          sourcePassage: palettePassage.text,
          suggestion: nearest
            ? `Use ${nearest.hex} (${nearest.name}) instead of ${normalisedHex}.`
            : undefined,
          confidence: 1,
        });
      }

      // Contrast needs a surface to be measured against. We use the brand's
      // own paper — the lightest approved colour — and name it in the finding,
      // because the assumption has to be visible for the finding to be
      // arguable. Taking the best of white and near-black made this rule
      // unreachable: for any colour, one of those two is at least 4.35:1, so
      // the old `best < 3` test could never fire.
      const paper = palette.reduce((lightest, entry) =>
        relativeLuminance(entry.hex) > relativeLuminance(lightest.hex) ? entry : lightest
      );
      if (
        relativeLuminance(paper.hex) > 0.5 &&
        normalisedHex !== paper.hex.toUpperCase()
      ) {
        const ratio = contrastRatio(normalisedHex, paper.hex);
        if (ratio < 4.5) {
          findings.push({
            ruleId: "colour.low_contrast",
            type: "contrast",
            severity: ratio < 3 ? "high" : "medium",
            message: `${normalisedHex} reaches only ${ratio.toFixed(2)}:1 against ${paper.name} (${paper.hex}), below the 4.5:1 floor.`,
            citation: `Palette · ${paper.name}`,
            sourcePassage: palettePassage.text,
            suggestion: "Darken the colour, or set it on a darker approved surface instead of the paper.",
            confidence: 1,
          });
        }
      }
    }
  }

  /* --- Logo -------------------------------------------------------- */
  if (kit.logo_url) {
    const logoPassage = passages.find((p) => p.id === "logo-approved");
    const logoGuideline = guidelinePassage(/logo/);
    // Only an image that presents itself as a logo is judged as one. Treating
    // every <img> as a logo candidate flagged ordinary photography as an
    // unapproved brand asset, which is the kind of finding that teaches a
    // reviewer to ignore the queue.
    const sources = [...text.matchAll(/<img\b[^>]*>/gi)]
      .filter((m) => /logo/i.test(m[0]))
      .map((m) => /src\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1])
      .filter((src): src is string => Boolean(src));
    if (logoPassage && sources.length > 0) {
      for (const src of sources) {
        if (src === kit.logo_url) continue;
        findings.push({
          ruleId: "logo.unapproved_asset",
          type: "logo",
          severity: "medium",
          message: `Image "${src.slice(0, 56)}" is not the approved logo asset.`,
          citation: logoGuideline
            ? `Guidelines · ${logoGuideline.label}`
            : "Logo · Approved logo asset",
          sourcePassage: logoGuideline?.text ?? logoPassage.text,
          suggestion: "Use the approved logo file from the brand kit.",
          confidence: 1,
        });
      }
    }
  }

  const deduped = new Map<string, RuleFinding>();
  for (const finding of findings) {
    const key = `${finding.ruleId}|${finding.message}`;
    if (!deduped.has(key)) deduped.set(key, finding);
  }

  return [...deduped.values()]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 60);
}

/**
 * Run every rule, then apply the kit's active exemptions. Suppressed findings
 * are returned rather than dropped, so the review and the audit record can say
 * what was excused, by whom, and until when.
 */
export function runRuleSet(
  content: string,
  kit?: BrandKit | null,
  options: RuleRunOptions = {}
): RuleRun {
  const all = computeRules(content, kit);
  const exemptions = kit ? parseExemptions(kit.guidelines) : [];
  if (exemptions.length === 0) return { findings: all, suppressed: [] };

  const at = options.at ?? new Date();
  const findings: RuleFinding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of all) {
    const exemption = exemptions.find((candidate) =>
      coversFinding(candidate, finding, { submissionId: options.submissionId, at })
    );
    if (exemption) suppressed.push({ finding, exemption });
    else findings.push(finding);
  }

  return { findings, suppressed };
}

/** Findings only — the engine with exemptions already honoured. */
export function runDeterministicRules(
  content: string,
  kit?: BrandKit | null,
  options: RuleRunOptions = {}
): RuleFinding[] {
  return runRuleSet(content, kit, options).findings;
}

/** Human labels for the precise rule ids the engine emits. */
export const RULE_LABELS: Record<string, string> = {
  "glossary.banned": "Banned term",
  "glossary.preferred": "Preferred wording",
  "claim.unsupported_stat": "Unapproved statistic",
  "claim.superlative": "Unprovable superlative",
  "claim.fact_conflict": "Conflicts with an approved fact",
  "asset.missing_alt": "Missing alt text",
  "colour.off_palette": "Off-palette colour",
  "colour.low_contrast": "Low contrast",
  "logo.unapproved_asset": "Unapproved logo",
};

export const RULE_CATALOGUE: Array<{
  type: RuleType;
  label: string;
  description: string;
}> = [
  {
    type: "terminology",
    label: "Terminology",
    description: "Banned and preferred wording from the glossary.",
  },
  {
    type: "claim",
    label: "Claims",
    description: "Statistics, superlatives and facts that must be approved.",
  },
  {
    type: "alt_text",
    label: "Alt text",
    description: "Every image needs a description when the guideline requires one.",
  },
  {
    type: "colour",
    label: "Colour",
    description: "Hex values must belong to the approved palette.",
  },
  {
    type: "contrast",
    label: "Contrast",
    description: "WCAG 2.1 contrast against the brand's own paper, floor of 4.5:1.",
  },
  {
    type: "logo",
    label: "Logo",
    description: "An image declared as a logo must be the approved asset.",
  },
];
