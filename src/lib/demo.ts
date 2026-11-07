import type {
  BrandKit,
  ContentSubmission,
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
