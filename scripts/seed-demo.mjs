#!/usr/bin/env node
/**
 * Seeds a judge-ready demo workspace into the configured Supabase project.
 *
 * - Creates (or reuses) confirmed accounts, so nobody has to sign up.
 * - Resets the demo brand kit, submissions and findings to a fixed, realistic
 *   set so every re-run gives the same walkthrough.
 *
 *   node scripts/seed-demo.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Secrets are read from that file and never printed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(join(root, file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const [, key, raw] = match;
        if (env[key]) continue;
        env[key] = raw.replace(/^["']|["']$/g, "");
      }
    } catch {
      /* optional */
    }
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
  process.exit(2);
}

const ORG = "Lumen Analytics";
const DEMO_ACCOUNT = {
  email: "judge@brandlens.demo",
  password: "BrandLens-Judges-2026",
  role: "admin",
  name: "Demo Judge",
};
const TEAM = [
  { email: "noah@brandlens.demo", role: "reviewer", name: "Noah Adeyemi" },
  { email: "mia@brandlens.demo", role: "creator", name: "Mia Chen" },
  { email: "leo@brandlens.demo", role: "manager", name: "Leo Fontaine" },
];

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function call(path, init = {}) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return body;
}

async function findUserIdByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const data = await call(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

async function ensureUser({ email, password, name, role }, org) {
  let id;
  try {
    const created = await call("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      }),
    });
    id = created.id;
    console.log(`created ${email}`);
  } catch (error) {
    id = await findUserIdByEmail(email);
    if (!id) throw error;
    console.log(`reused ${email}`);
  }

  await call("/rest/v1/profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, role, organization: org }),
  });
  return id;
}

const day = 86_400_000;
const ago = (days, hours = 0) =>
  new Date(Date.now() - days * day - hours * 3_600_000).toISOString();

const guidelines = {
  voice: [
    "Write in plain, confident English. Short sentences, no hype.",
    'Always address the reader as "you"; never use "we" to mean the customer.',
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
};

const glossary = {
  banned: [
    { term: "AI-generated", replacement: "AI-assisted" },
    { term: "revolutionary", replacement: "meaningfully different" },
  ],
  preferred: [
    { term: "utilize", replacement: "use" },
    { term: "leverage", replacement: "build on" },
  ],
};

const facts = [
  { label: "Founded", value: "2019" },
  { label: "Customers", value: "4,200 teams" },
  { label: "Uptime", value: "99.98%" },
];

const palette = [
  { name: "Ink", hex: "#0E1120" },
  { name: "Iris", hex: "#5B5BD6" },
  { name: "Mint", hex: "#10B981" },
  { name: "Canvas", hex: "#F6F7FB" },
];

const submissions = [
  {
    key: "q3",
    title: "Q3 launch: Signal Studio",
    status: "submitted",
    created_at: ago(0, 3),
    text_content: `Introducing Signal Studio — our AI-generated insights workspace.

Signal Studio is the best-in-class way to turn raw events into decisions. Teams move 63% faster than with spreadsheets, and every dashboard is guaranteed to be accurate.

![dashboard screenshot](https://cdn.lumen.example/media/signal-studio.png)

Accent colour for the launch banner: #FF6B00.`,
    findings: [
      {
        type: "terminology",
        severity: "high",
        message:
          '"AI-generated" is on the banned-terms list and appears 1× in this content.',
        citation: "Glossary · banned terms",
        source_passage:
          'Do not use "AI-generated". Use "AI-assisted" instead.',
        intent_summary:
          "The creator wanted to explain that the product uses AI to generate reports.",
        status: "pending",
      },
      {
        type: "claim",
        severity: "high",
        message:
          'The figure "63% faster" is not in the approved facts for Lumen Analytics.',
        citation: "Guidelines · claims · approved facts only",
        source_passage:
          "Numbers and superlatives must appear in the approved facts before publishing.",
        intent_summary:
          "The creator wanted to show a measurable productivity gain.",
        status: "pending",
      },
      {
        type: "colour",
        severity: "medium",
        message:
          "#FF6B00 is not in the approved palette; nearest approved colour is Iris #5B5BD6.",
        citation: "Brand palette · 4 approved colours",
        source_passage:
          "Approved palette: Ink #0E1120, Iris #5B5BD6, Mint #10B981, Canvas #F6F7FB.",
        intent_summary:
          "The creator wanted a warmer accent to separate the launch banner.",
        status: "pending",
      },
    ],
  },
  {
    key: "careers",
    title: "Careers page hero",
    status: "under_review",
    created_at: ago(1, 5),
    text_content: `Build the next decade of analytics with us.

Founded in 2018, Lumen helps teams utilize their data without a data team. We leverage small, senior squads and ship every week.

<img src="https://cdn.lumen.example/media/team-offsite.jpg">`,
    findings: [
      {
        type: "claim",
        severity: "high",
        message:
          '"Founded in 2018" conflicts with the approved fact (Founded: 2019).',
        citation: "Approved facts · Founded 2019",
        source_passage: "Founded — 2019",
        intent_summary: "The creator wanted to establish how long the company has run.",
        status: "pending",
      },
      {
        type: "terminology",
        severity: "medium",
        message:
          '"utilize" is a preferred-term violation; use "use" instead.',
        citation: "Glossary · preferred terms",
        source_passage: 'Prefer "use" over "utilize".',
        intent_summary: "The creator wanted a more formal register.",
        status: "pending",
      },
      {
        type: "alt_text",
        severity: "medium",
        message:
          "The team photo has no alt text; guidelines require at least five descriptive words.",
        citation: "Guidelines · accessibility",
        source_passage:
          "Every image must carry descriptive alt text of at least five words.",
        intent_summary: "The creator wanted a candid team photo above the fold.",
        status: "pending",
      },
    ],
  },
  {
    key: "meridian",
    title: "Meridian Bank customer story",
    status: "approved",
    created_at: ago(5),
    text_content: `Meridian Bank cut weekly reporting from six hours to forty minutes.

Before Lumen, the risk team rebuilt the same spreadsheet every Monday. Now the numbers are ready before the stand-up, and the team spends that time with customers.

"Lumen gave us back our Mondays." — Priya Raman, Head of Risk.`,
    findings: [
      {
        type: "terminology",
        severity: "low",
        message: '"leverage" was replaced with "build on" in paragraph two.',
        citation: "Glossary · preferred terms",
        source_passage: 'Prefer "build on" over "leverage".',
        intent_summary: "The creator wanted to describe how the team works.",
        status: "accepted",
      },
      {
        type: "claim",
        severity: "low",
        message:
          'Customer quote is attributed and was confirmed with the Meridian comms team.',
        citation: "Guidelines · claims · attribution",
        source_passage:
          "Quotes must be attributed to a named person with a title.",
        intent_summary: "The creator wanted third-party proof of the time saved.",
        status: "rejected",
      },
    ],
  },
  {
    key: "banner",
    title: "Homepage banner (OCR)",
    status: "submitted",
    created_at: ago(2, 8),
    content_type: "image",
    image_url:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80",
    text_content: `Lumen — AI-generated answers, guaranteed accurate.
Trusted by 9 out of 10 analysts.`,
    findings: [
      {
        type: "terminology",
        severity: "high",
        message:
          '"AI-generated" is on the banned-terms list (found in OCR text).',
        citation: "Glossary · banned terms",
        source_passage:
          'Do not use "AI-generated". Use "AI-assisted" instead.',
        intent_summary: "The banner copy wanted to lead with the AI capability.",
        status: "pending",
      },
      {
        type: "claim",
        severity: "critical",
        message:
          '"9 out of 10 analysts" is an unsupported statistic and not in the approved facts.',
        citation: "Guidelines · claims · approved facts only",
        source_passage:
          "Numbers and superlatives must appear in the approved facts before publishing.",
        intent_summary: "The creator wanted social proof on the homepage.",
        status: "pending",
      },
      {
        type: "alt_text",
        severity: "medium",
        message: "Banner image is missing alt text.",
        citation: "Guidelines · accessibility",
        source_passage:
          "Every image must carry descriptive alt text of at least five words.",
        intent_summary: "The creator uploaded a dashboard render without alt text.",
        status: "pending",
      },
    ],
  },
];

async function seed() {
  console.log(`Seeding ${ORG} demo workspace → ${url}`);

  const judgeId = await ensureUser(DEMO_ACCOUNT, ORG);
  for (const member of TEAM) await ensureUser(member, ORG);

  // Reset the demo workspace: deleting the kit cascades to submissions and findings.
  await call(`/rest/v1/brand_kits?organization_id=eq.${judgeId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  const [kit] = await call("/rest/v1/brand_kits?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: ORG,
      organization_id: judgeId,
      guidelines,
      glossary,
      facts,
      palette,
      logo_url: "https://cdn.lumen.example/brand/lumen-logo-primary.svg",
      created_at: ago(74),
      updated_at: ago(3),
    }),
  });

  let findingCount = 0;
  for (const submission of submissions) {
    const [row] = await call("/rest/v1/content_submissions?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        brand_kit_id: kit.id,
        title: submission.title,
        content_type: submission.content_type ?? "text",
        status: submission.status,
        text_content: submission.text_content,
        image_url: submission.image_url ?? null,
        created_at: submission.created_at,
        updated_at: submission.created_at,
      }),
    });

    const findings = submission.findings.map((finding) => ({
      ...finding,
      submission_id: row.id,
      created_at: submission.created_at,
      updated_at: submission.created_at,
    }));

    await call("/rest/v1/findings", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(findings),
    });
    findingCount += findings.length;
    console.log(`  ${submission.status.padEnd(12)} ${submission.title}`);
  }

  console.log(
    `\nDone. ${submissions.length} submissions, ${findingCount} findings, 1 brand kit.`
  );
  console.log(`Demo sign-in: ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`);
}

seed().catch((error) => {
  console.error("\nSeed failed:", error.message);
  process.exit(1);
});
