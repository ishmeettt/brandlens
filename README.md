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
workspace (4 submissions, 11 findings, 1 brand kit).

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

## Development

```bash
npm install
npm run dev               # http://localhost:3000
npm run verify:supabase   # 16 checks against the real RLS policies
npm run seed:demo         # (re)build the judge demo workspace
```

Built with Next.js 16 (App Router), React 19, Tailwind CSS and Supabase
(Postgres with row-level security). The public preview runs as a Cloudflare
Worker.
