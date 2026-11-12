# Round 3 build plan

Three improvements, each with a definition of done we can check. The work is
local and uncommitted until the owner says otherwise.

| # | Improvement | State |
| - | ------------- | ----- |
| 1 | Ingest the content teams actually ship | Built |
| 2 | Governance operations | Built except assignment UI; stored audit events need migration 0004 |
| 3 | Trust and measurement | Built except SSO/SAML (blocked on provider plan) |

---

## 1. Ingest the content teams actually ship

**Goal:** a PDF or DOCX is reviewed as a real document. Every finding points at
the page or paragraph it came from, and a set of documents is reviewed as one
set with a combined verdict.

### Design: anchors live in the text

Extraction produces anchored segments and the result is stored in
`content_submissions.text_content` with one marker line per anchor:

```
[[p.4]]
The approved clauses, in one place ...

[[Autumn deck · p.1]]
Lumen autumn release ...
```

Consequences, all deliberate:

- No schema migration is needed for the feature to work, so the deployed demo
  cannot break because a column is missing.
- Anything that reads `text_content` still gets readable prose; `stripAnchors()`
  removes marker lines before the rule engine or AI pass sees the text.
- Anchors travel with the text into exports and the audit pack, so a decision
  recorded today can still cite "Autumn deck · p.4" a year from now.
- PDFs anchor on `p.N`. DOCX has no fixed pagination, so it anchors on `¶ N`,
  carrying the nearest heading: `¶ 12 · Pricing`. In a multi-document set the
  anchor is prefixed with the document's short name.

### Extraction order

`/api/extract` (Node runtime, pdf.js legacy build) parses first; the submit form
falls back to the in-browser parser when the route is unavailable or the host
cannot run it. Both paths return the same `ExtractedDocument`, so the review,
the anchors and the locators are identical either way.

### Milestones

| # | Work | Done when | State |
| - | ---- | --------- | ----- |
| 1.1 | PDF text extraction, page by page | A 7-page PDF produces 7 anchored segments with no glued words | Built |
| 1.2 | DOCX extraction with paragraph anchors and heading context | A Word file produces `¶ N` segments, headings promoted into the label | Built, untested against a real .docx |
| 1.3 | Submit form reads the file instead of asking for pasted text | Choosing PDF/DOCX extracts, shows pages/words/characters and a preview | Built |
| 1.4 | Findings carry their anchor | Review shows `p.4` on each finding whose token can be located | Built |
| 1.5 | Batch review: many documents, one verdict | A submission can hold several documents and the queue reviews them as one set | Built |
| 1.6 | Scanned PDFs fall back to OCR | A PDF with no text layer routes to OCR instead of failing | Built — pages are rasterised and read locally |
| 1.7 | Server-side extraction for exports | The parser runs on the server, not only in the browser | Built — `/api/extract`, browser fallback |

### Verification

- `node .build/test-document.mjs` runs the real extraction module through
  esbuild with pdf.js's Node legacy build against `BrandLens-Submission-Pack.pdf`:
  19 checks covering page count, prose quality, hyphenation, marker round-trip,
  `stripAnchors`, and locator resolution.
- `POST /api/extract` with the same PDF returned `parsed: server`, 7 pages,
  12,371 characters, labels `p.1`…`p.7`.
- Browser batch upload of two 7-page PDFs: the form listed both documents
  (7 pages / 12,371 characters each), showed `2 documents · 14 pages · 4,486
  words · 24,768 characters`, and the saved review rendered per-document chips
  (`Autumn deck · 7`, `Launch brief · 7`) and locators (`Autumn deck · p.4`).

Not yet verified: a real `.docx`, and a scanned PDF (no text layer).

### Risks

- **Extraction is per-page and stateless.** A term split across a page break can
  escape a glossary match that would have caught it in one continuous string.
  Mitigation: rules run over the concatenated text, then locators map the
  matched token back to a page — they do not run per page.
- **Duplicate documents.** If two files contain the same sentence, the locator
  names the first document that matches; the set still carries both chips.
- **Anchor drift.** If a reviewer edits extracted text, offsets may not match
  the original file. Mitigation: extracted text is read-only for documents;
  corrections go through a Copy submission.

---

## 2. Governance operations

**Goal:** the queue becomes a process legal accepts. Every submission can have
an owner and a deadline, exceptions have an expiry date, and the whole history
exports.

| # | Work | Done when | State |
| - | ---- | --------- | ----- |
| 2.1 | Ownership and due dates | A submission shows an assignee and a due date | Built — inline owner and due-date controls on Admin; saving needs migration 0004, and the UI says so instead of pretending |
| 2.2 | SLA view | Admin shows what is late, with a count that matches the queue | Built — policy clock on Admin, target derived from worst severity, `due_at` wins when present |
| 2.3 | Exemptions with scope and expiry | A reviewer grants "this wording is allowed until 31 March on this campaign"; the engine honours it, and it stops applying on its own | Built |
| 2.4 | Decision history per submission | Every decision is one readable feed with a person and a timestamp | Built as a hash-chained feed; stored append-only events need migration 0004 |
| 2.5 | Audit pack export | One action produces a PDF and a JSON of findings, citations, decisions and exemptions | Built — PDF and JSON rendered from the same sealed pack |

### Exemptions

An exemption is a governance decision, so it is stored with the brand kit in
`brand_kits.guidelines.exemptions` (no DDL required):

```json
{
  "ruleId": "glossary.preferred",
  "target": "utilize",
  "submissionId": "sub-1041",
  "reason": "Co-branded recruiter microsite must keep the partner's wording.",
  "owner": "Priya Raman · Brand Ops",
  "grantedAt": "2026-11-03T09:00:00.000Z",
  "expiresAt": "2026-11-21T23:59:59.000Z"
}
```

- Scope is a rule id (or family prefix) plus optional target text and optional
  submission, so "this wording, on this campaign" is expressible.
- `runRuleSet()` suppresses matching findings and returns them separately; the
  review shows "Excused by an active exemption" with the owner, reason and days
  left, and the audit record lists every exemption applied.
- Lapsed exemptions stop applying automatically. The demo kit carries one
  active and one lapsed exemption so both states are visible.
- Exemptions are never treated as citable clauses: `normaliseGuidelines()`
  skips the key, so the engine cannot cite a decision as policy.
- The brand-kit page has an editor for them (rule, target, submission, owner,
  reason, expiry).

### Schema (migration 0004, additive only)

`supabase/migrations/20240101000004_governance_ops.sql` adds:

- `content_submissions.owner_id uuid`, `content_submissions.due_at timestamptz`
- `findings.rule_id text` — exact rule, so precision needs no re-run
- `findings.reviewed_by text`, `findings.reviewed_at timestamptz` — attribution
- `audit_events` — `organization_id`, `submission_id`, `finding_id`, `actor`,
  `action`, `detail jsonb`, `prev_hash`, `hash`, `created_at`, with a trigger
  that rejects update/delete so the table is append-only

The app probes for these columns: writes that need them retry without them
(`isMissingColumnError`), and reads simply show "—" until the migration is
applied. The agent cannot run DDL with the project's service key; apply the file
in the Supabase SQL editor.

---

## 3. Trust and measurement

**Goal:** we can say how often each rule is right, and the history cannot be
edited without a trace.

| # | Work | Done when | State |
| - | ---- | --------- | ----- |
| 3.1 | Labelled evaluation corpus | A fixed set of documents per rule family with expected findings, checked in and versioned | Built — `evals/corpus.json`, 10 documents, 9 rules, 2 false-positive guards |
| 3.2 | Replay harness | `npm run eval:rules` scores the engine and prints precision and recall per rule | Built — exits non-zero on any miss or unexpected finding |
| 3.3 | Precision on Admin | Per-rule precision and false-positive rate from reviewer decisions | Built — decisions mapped to exact rules by replay; unattributable findings listed separately |
| 3.4 | Hash-chained audit log | Each entry stores the hash of the previous one; a verifier detects a rewritten row | Built — derived chain + verifier; append-only storage needs migration 0004 |
| 3.5 | SSO/SAML | Workspaces sign in through an identity provider | Blocked — requires a Supabase plan and IdP configuration the owner must provide |

### How precision is attributed

Findings store their family (`type`), not the rule. `attributeRuleIds()`
re-runs the deterministic engine over each submission's text and matches stored
messages to rule ids; once migration 0004 adds `findings.rule_id`, stored ids
are used directly. Anything that cannot be matched — a human- or AI-written
finding, or one recorded under an older rule set — is reported as
"Unattributed" instead of being folded into a rule's score.

### Decision log

`/audit/log` renders every recorded finding as one entry — reviewer, timestamp,
finding, cited clause, decision — chained with SHA-256: each entry's hash covers
its own fields plus `prevHash`. The page recomputes the chain on load and shows
`Intact` or the first index that no longer matches. `verifyDecisionLog()` fails
on an edited entry, a reordering, or a deletion (tested).

Until migration 0004 is applied the reviewer column is empty, so real
workspaces show "Unattributed"; the demo dataset names reviewers so the feed is
demonstrable.

---

## Verification commands

```
npm run eval:rules        # corpus replay: precision/recall per rule
npm run test:governance   # 43 checks: clock, precision, exemptions, anchors, chain
npx tsc --noEmit          # types
npm run build             # production build
npm run verify:supabase   # 16 schema/policy checks (no DDL)
```

## Remaining, and why

- **Ownership assignment (2.1).** Owner and due-date controls are built on
  Admin and save through `content_submissions.owner_id` / `due_at`. They report
  "needs migration 0004" until it is applied, and the queue's "Mine" filter is
  empty for the same reason.
- **Stored append-only events (2.4/3.4).** Decisions are written to
  `audit_events`, and the decision log reads that table when it has rows. Until
  migration 0004 is applied the table is absent, so the page falls back to the
  derived chain and a decision shows a one-time "needs 0004" notice. The stored
  path is therefore unverified against a migrated database.
- **SSO/SAML (3.5).** Supabase's SAML support is a paid-plan feature and needs
  an identity provider; nothing can be implemented or verified from here.
