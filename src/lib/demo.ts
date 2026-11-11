import { runDeterministicRules } from "./rules";
import type {
  BrandKit,
  ContentSubmission,
  Finding,
  UserProfile,
} from "./supabase";

// Fixed base date so server render and client hydration agree.
const base = Date.UTC(2026, 10, 6, 9, 0, 0);
const daysAgo = (days: number, hours = 0) =>
  new Date(base - days * 86_400_000 - hours * 3_600_000).toISOString();

export const demoBrandKit: BrandKit = {
  id: "demo-brand-kit",
  name: "Lumen Analytics",
  organization_id: "demo-org",
  guidelines: {
    voice: [
      "Write in plain, confident English. Short sentences, no hype.",
      "Always address the reader as \"you\"; never use \"we\" to mean the customer.",
    ],
    accessibility: [
      "Every image must carry descriptive alt text of at least five words.",
      "Text must reach a 4.5:1 contrast ratio against its background.",
    ],
    logo: [
      "Use only the approved primary logo from the brand kit. Never recolour it.",
    ],
    claims: [
      "Numbers and superlatives must appear in the approved facts before publishing.",
    ],
    // Governance decisions, not clauses: the engine honours these and reports
    // every finding it suppressed. Past expiry, an exemption simply stops.
    exemptions: [
      {
        id: "ex-2201",
        ruleId: "glossary.preferred",
        target: "utilize",
        submissionId: "sub-1041",
        reason:
          "Recruiter microsite is co-branded with the search partner, whose house style requires \"utilize\".",
        owner: "Priya Raman · Brand Ops",
        grantedAt: daysAgo(6),
        expiresAt: new Date(base + 12 * 86_400_000).toISOString(),
      },
      {
        id: "ex-2188",
        ruleId: "claim.superlative",
        target: "best",
        submissionId: "sub-1042",
        reason: "Analyst quote cleared for the launch post while the citation is re-verified.",
        owner: "Marco Diaz · Product Marketing",
        grantedAt: daysAgo(40),
        expiresAt: daysAgo(2),
      },
    ],
  },
  glossary: {
    banned: [
      { term: "AI-generated", replacement: "AI-assisted" },
      { term: "revolutionary", replacement: "meaningfully different" },
    ],
    preferred: [
      { term: "utilize", replacement: "use" },
      { term: "leverage", replacement: "build on" },
    ],
  },
  facts: [
    { label: "Founded", value: "2019" },
    { label: "Customers", value: "4,200 teams" },
    { label: "Uptime", value: "99.98%" },
  ],
  palette: [
    { name: "Ink", hex: "#0E1120" },
    { name: "Iris", hex: "#5B5BD6" },
    { name: "Mint", hex: "#10B981" },
    { name: "Canvas", hex: "#F6F7FB" },
  ],
  logo_url: "https://cdn.lumen.example/brand/lumen-logo-primary.svg",
  created_at: daysAgo(74),
  updated_at: daysAgo(3),
};

export const demoSubmissions: ContentSubmission[] = [
  {
    id: "sub-1042",
    brand_kit_id: demoBrandKit.id,
    title: "Q3 launch: Signal Studio",
    content_type: "text",
    status: "submitted",
    text_content: `Introducing Signal Studio — our AI-generated insights workspace.

Signal Studio is the best-in-class way to turn raw events into decisions. Teams move 63% faster than with spreadsheets, and every dashboard is guaranteed to be accurate.

![dashboard screenshot](https://cdn.lumen.example/media/signal-studio.png)

Accent colour for the launch banner: #FF6B00.`,
    created_at: daysAgo(0, 3),
  },
  {
    id: "sub-1041",
    brand_kit_id: demoBrandKit.id,
    title: "Careers page hero",
    content_type: "text",
    status: "under_review",
    text_content: `Build the next decade of analytics with us.

Founded in 2018, Lumen helps teams utilize their data without a data team. We leverage small, senior squads and ship every week.

<img src="https://cdn.lumen.example/media/team-offsite.jpg">`,
    created_at: daysAgo(1, 5),
  },
  {
    id: "sub-1040",
    brand_kit_id: demoBrandKit.id,
    title: "Meridian Bank customer story",
    content_type: "text",
    status: "approved",
    text_content: `Meridian Bank cut weekly reporting from six hours to forty minutes.

Before Lumen, the risk team rebuilt the same spreadsheet every Monday. Now the numbers are ready before the stand-up, and the team spends that time with customers.

"Lumen gave us back our Mondays." — Priya Raman, Head of Risk.`,
    created_at: daysAgo(5),
  },
  {
    id: "sub-1038",
    brand_kit_id: demoBrandKit.id,
    title: "Autumn launch: deck + brochure",
    content_type: "pdf",
    status: "submitted",
    text_content: [
      "[[Autumn deck · p.1]]",
      "Lumen autumn release — AI-generated forecasting for every team.",
      "[[Autumn deck · p.2]]",
      "Forecasts land 71% sooner, and every number is guaranteed correct.",
      "[[Launch brochure · p.1]]",
      "Built for teams who utilize messy data. Accent colour: #FF6B00.",
    ].join("\n\n"),
    created_at: daysAgo(3, 2),
  },
  {
    id: "sub-1039",
    brand_kit_id: demoBrandKit.id,
    title: "Homepage banner (OCR)",
    content_type: "image",
    status: "submitted",
    text_content: `Lumen — AI-generated answers, guaranteed accurate.
Trusted by 9 out of 10 analysts.`,
    image_url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80",
    created_at: daysAgo(2, 8),
  },
];

export const demoProfiles: UserProfile[] = [
  {
    id: "user-1",
    email: "ava@lumen.example",
    role: "admin",
    organization: "Lumen Analytics",
    created_at: daysAgo(300),
    updated_at: daysAgo(12),
  },
  {
    id: "user-2",
    email: "noah@lumen.example",
    role: "reviewer",
    organization: "Lumen Analytics",
    created_at: daysAgo(240),
    updated_at: daysAgo(8),
  },
  {
    id: "user-3",
    email: "mia@lumen.example",
    role: "creator",
    organization: "Lumen Analytics",
    created_at: daysAgo(180),
    updated_at: daysAgo(2),
  },
  {
    id: "user-4",
    email: "leo@lumen.example",
    role: "manager",
    organization: "Lumen Analytics",
    created_at: daysAgo(150),
    updated_at: daysAgo(21),
  },
];

export const demoOrgName = "Lumen Analytics";

/**
 * Findings the demo workspace shows for its seeded submissions.
 *
 * The findings themselves are real: they come from running the deterministic
 * engine over the sample copy. The decisions are sample data, so the precision
 * and audit views have something to render without a live reviewer.
 */
export function buildDemoFindings(): Finding[] {
  return demoSubmissions.flatMap((submission) => {
    const findings = runDeterministicRules(submission.text_content ?? "", demoBrandKit);
    return findings.map((finding, index) => {
      const status: Finding["status"] =
        submission.status === "approved"
          ? "accepted"
          : submission.status === "under_review" && index % 3 === 1
            ? "rejected"
            : "pending";

      const createdAt = new Date(
        new Date(submission.created_at).getTime() + index * 60_000
      ).toISOString();
      const reviewer = ["Priya Raman", "Marco Diaz", "Sam Okafor"][index % 3];

      return {
        id: `demo-${submission.id}-${index}`,
        submission_id: submission.id,
        type: finding.type,
        severity: finding.severity,
        message: finding.message,
        citation: finding.citation,
        source_passage: finding.sourcePassage,
        suggestion: finding.suggestion ?? null,
        intent_summary: null,
        status,
        created_at: createdAt,
        reviewed_by: status === "pending" ? null : reviewer,
        reviewed_at:
          status === "pending"
            ? null
            : new Date(new Date(createdAt).getTime() + 5 * 3_600_000).toISOString(),
      };
    });
  });
}
