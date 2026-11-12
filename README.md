# BrandLens

Brand governance with receipts. Content is checked against a brand kit by a
deterministic rule engine, every finding cites the clause behind it, and a
reviewer accepts or dismisses each one before the submission is approved.

## Live demo

<https://site-4dde5f48239247f79cb0cf1b59ab161c.freebuff.page>

Open the link and choose **Enter demo workspace** on the sign-in page. The
seeded judge account is public by design and holds only sample data:

```
judge@brandlens.demo
BrandLens-Judges-2026
```

`npm run seed:demo` recreates the demo users and their Lumen Analytics
workspace (4 submissions, 11 findings, 1 brand kit). Its findings come from the
rule engine itself, so every seeded audit record reproduces its own findings.
Run `npm run seed:demo -- --dry-run` to print the plan — findings, decisions and
the reconciliation check — without writing anything.

The app runs without credentials in read-only demo mode. To use the real
workspace, connect Supabase:

1. Create a project at <https://supabase.com/dashboard>.
2. Copy the Project URL and the **publishable** key (or the legacy **anon** key)
   from **Settings → API Keys**.
3. Apply the schema: open the **SQL Editor** and run each file in
   `supabase/migrations/` in filename order (0001, 0002, 0003).
4. Create `.env.local` in the project root:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
   # optional, local script only — never shipped to the browser
   SUPABASE_SERVICE_ROLE_KEY=<secret-or-service-role-key>
   ```

5. For automated testing either turn off **Authentication → Email → Confirm
   email**, or set the service-role key so the script can create confirmed
   accounts.
6. Verify the whole flow against the real policies:

   ```bash
   npm run verify:supabase
   ```

The AI judgement pass is optional. Without `AI_API_KEY` (or `GROQ_API_KEY`) the
review runs deterministic rules only and the UI says so.

## Documents

PDF and DOCX submissions are parsed on the server (`POST /api/extract`) with a
browser fallback, and stored with a page marker for every page (`[[p.4]]`) or
paragraph (`[[¶ 12 · Pricing]]`), so a finding can point at the page it came
from. Several files can be submitted as one set: markers become
`[[Autumn deck · p.4]]` and the queue reviews the set as one submission with a
combined verdict.

## Governance

- **Policy clock** — every open submission has a target derived from its worst
  finding (critical 1d, high 3d, medium 5d, low 7d). A stored `due_at` wins.
- **Exemptions** — scoped, owned and expiring, stored in
  `brand_kits.guidelines.exemptions`, edited on the brand-kit page. The engine
  suppresses matching findings, the review names what it excused, and the audit
  record keeps the decision after it lapses.
- **Audit record** — `/audit?submission=…` is a printable record (Print → PDF)
  plus JSON with a SHA-256 digest, engine reconciliation, anchors and exemptions.
- **Decision log** — `/audit/log` chains every decision with the hash of the one
  before it and verifies the chain in the browser.
- **Per-rule precision** — the Admin dashboard maps decisions back to exact
  rules and reports precision and false-positive rate, with a thin-sample
  marker and a separate "unattributed" bucket.

Migration `supabase/migrations/20240101000004_governance_ops.sql` adds owner and
due-date columns, rule/reviewer attribution on findings, and an append-only
`audit_events` table. Apply it in the Supabase SQL editor; the app works without
it and uses the new columns as soon as they exist.

## Verification

```bash
npm run eval:rules        # replay the rule engine against the labelled corpus
npm run test:governance   # clock, per-rule precision, exemptions, audit pack, chain
npm run verify:supabase   # schema and policy checks (no DDL)
```

Add a labelled document to `evals/corpus.json` before changing a rule's
behaviour — it exits non-zero on any miss or unexpected finding.

## Development

```bash
npm install
npm run dev               # http://localhost:3000
npm run verify:supabase   # 16 checks against the real RLS policies
npm run eval:rules        # replay the rule engine against the labelled corpus
npm run test:governance   # 43 governance checks
npm run seed:demo         # (re)build the judge demo workspace
npm run seed:demo -- --dry-run   # print what seeding would write
```

Built with Next.js 16 (App Router), React 19, Tailwind CSS and Supabase
(Postgres with row-level security). The public preview runs as a Cloudflare
Worker.
