import Link from "next/link";
import { Badge, SeverityBadge, Wordmark } from "../components/ui";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#workflow", label: "Workflow" },
  { href: "#principle", label: "Principle" },
];

const FEATURES = [
  {
    title: "Deterministic first",
    body: "Banned terms, palette drift, contrast ratios and missing alt text are checked exactly — the same input always produces the same finding.",
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h9" />
        <circle cx="18" cy="18" r="2.5" />
      </>
    ),
  },
  {
    title: "Evidence or silence",
    body: "A finding is only surfaced when it cites a specific guideline clause, approved fact or asset. No citation, no flag.",
    icon: (
      <>
        <path d="M12 3l7 3.5v5c0 4.2-2.9 7.7-7 9.5-4.1-1.8-7-5.3-7-9.5v-5z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    title: "AI for judgement, not guesswork",
    body: "The model only handles tone and claim support, and it must quote a brand passage. Anything unsupported is discarded and counted.",
    icon: (
      <>
        <path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    title: "Brand kit as source of truth",
    body: "Glossary, approved facts, palette, logo and voice guidelines live in one place and every review is measured against them.",
    icon: (
      <>
        <path d="M4 5.5A1.5 1.5 0 015.5 4H11l2 2.5h5.5A1.5 1.5 0 0120 8v9.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
        <path d="M8 12h8M8 15h5" />
      </>
    ),
  },
  {
    title: "Human in the loop",
    body: "Reviewers accept or dismiss each finding, then approve or reject the submission. Nothing publishes on autopilot.",
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-1.5A3.5 3.5 0 017 15h4a3.5 3.5 0 013.5 3.5V20" />
        <path d="M16 11l2 2 3.5-3.5" />
      </>
    ),
  },
  {
    title: "Audit trail by default",
    body: "Every decision is timestamped with the rule, the cited passage and who accepted it — ready for compliance review.",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
];

const STEPS = [
  {
    step: "01",
    title: "Load the brand kit",
    body: "Import voice guidelines, glossary terms, approved facts, palette and logo into one governed workspace.",
  },
  {
    step: "02",
    title: "Submit any format",
    body: "Paste copy, upload an image or a PDF. Images are read with OCR in the browser before review starts.",
  },
  {
    step: "03",
    title: "Review with receipts",
    body: "Deterministic rules and a citation-bound AI pass produce findings; a reviewer accepts, dismisses and decides.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="BrandLens home">
            <Wordmark />
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-ink-500 transition hover:text-ink-900"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/auth/sign-in" className="btn-ghost btn-sm hidden sm:inline-flex">
              Sign in
            </Link>
            <Link href="/review" className="btn-primary btn-sm">
              Open workspace
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M5 12h14m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 surface-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />
        <div className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full bg-brand-200/35 blur-3xl" />
        <div className="pointer-events-none absolute -left-40 top-24 h-[380px] w-[380px] rounded-full bg-emerald-200/25 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="animate-fade-up">
            <Badge tone="brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Brand governance for teams that ship daily
            </Badge>

            <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[54px]">
              Ship on-brand content.
              <br />
              <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-emerald-500 bg-clip-text text-transparent">
                With receipts.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-500 sm:text-base">
              BrandLens checks every submission against your approved brand kit — glossary,
              facts, palette, logo and voice — then shows a reviewer exactly which clause
              each finding cites. No citation, no flag.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/submit" className="btn-primary">
                Start a review
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M5 12h14m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link href="/brand-kit" className="btn-secondary">
                Explore the brand kit
              </Link>
            </div>

            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-ink-100 pt-6">
              {[
                { k: "6", v: "deterministic checks" },
                { k: "100%", v: "findings cited" },
                { k: "0", v: "silent flags" },
              ].map((stat) => (
                <div key={stat.v}>
                  <dt className="text-xl font-semibold tracking-tight text-ink-900">{stat.k}</dt>
                  <dd className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-400">{stat.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Product mock */}
          <div className="relative animate-fade-up [animation-delay:120ms]">
            <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-br from-brand-100 via-white to-emerald-50 opacity-70 blur-2xl" />
            <div className="relative rounded-2xl border border-ink-100 bg-white p-4 shadow-lift">
              <div className="flex items-center justify-between border-b border-ink-50 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
                <p className="text-[11px] font-medium text-ink-300">review · Q3 launch</p>
              </div>

              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-ink-900">Signal Studio launch</p>
                  <Badge tone="info">3 findings</Badge>
                </div>

                <div className="rounded-xl border border-ink-100 p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity="high" />
                      <span className="text-[12px] font-medium text-ink-700">Terminology</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-ink-300">rule · glossary</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
                    Banned term <span className="rounded bg-red-50 px-1 font-medium text-red-700">AI-generated</span>{" "}
                    appears 1× in this content.
                  </p>
                  <div className="mt-2.5 rounded-lg border-l-2 border-brand-300 bg-brand-50/60 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                      Cited from glossary
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-600">
                      Do not use “AI-generated”. Use “AI-assisted” instead.
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                      ✓ Accept fix
                    </span>
                    <span className="rounded-md bg-ink-50 px-2 py-1 text-[11px] font-medium text-ink-500">
                      Dismiss
                    </span>
                    <span className="ml-auto text-[10px] text-ink-300">confidence 1.00</span>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/40 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      Discarded · no citation
                    </p>
                    <span className="text-[10px] text-ink-300">1</span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400 line-through decoration-ink-300">
                    “Tone feels a little too corporate.”
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="product" className="border-t border-ink-100 bg-canvas/60">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">
              The engine
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
              Exact checks where exactness is possible
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
              A hybrid engine: deterministic rules for anything measurable, AI only for
              judgement calls — and both must show their source.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {feature.icon}
                  </svg>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="border-t border-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">
                Workflow
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
                Three steps from draft to decision
              </h2>
            </div>
            <Link href="/submit" className="btn-secondary w-fit">
              Try the flow
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.step} className="relative overflow-hidden rounded-xl2 border border-ink-100 bg-white p-6 shadow-card">
                <span className="absolute right-4 top-3 font-mono text-4xl font-semibold text-ink-50">
                  {step.step}
                </span>
                <p className="relative text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">
                  Step {index + 1}
                </p>
                <h3 className="relative mt-2 text-base font-semibold text-ink-900">{step.title}</h3>
                <p className="relative mt-2 text-[13px] leading-relaxed text-ink-400">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Principle */}
      <section id="principle" className="border-t border-ink-100 bg-ink-900">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">
              The principle
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              No citation, no flag.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-300">
              Creative tools love to guess. Governance tools cannot afford to. Every
              BrandLens finding carries the clause it came from, so a reviewer can verify
              the rule in seconds instead of arguing with a black box.
            </p>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-400">
              Findings the engine cannot substantiate are discarded and counted — visible
              proof that the tool stayed quiet rather than inventing a problem.
            </p>
            <Link href="/review" className="btn-brand mt-8">
              See a live review
            </Link>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl2 border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  Shown
                </p>
                <span className="text-[11px] text-ink-400">citation verified</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white">
                “63%” is not in the approved facts.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-300">
                Approved facts · Founded 2019, 4,200 teams, 99.98% uptime
              </p>
            </div>

            <div className="rounded-xl2 border border-white/10 bg-white/[0.02] p-5 opacity-70">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Discarded
                </p>
                <span className="text-[11px] text-ink-500">no matching clause</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-400 line-through decoration-ink-600">
                “The headline could be more energetic.”
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-6 py-12 text-center sm:px-12">
            <div className="pointer-events-none absolute inset-0 surface-grid opacity-60" />
            <div className="relative">
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
                Give every review a paper trail
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-500">
                Set up your brand kit once, then let creators submit and reviewers decide
                with evidence in front of them.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link href="/brand-kit" className="btn-primary">
                  Set up a brand kit
                </Link>
                <Link href="/auth/sign-in" className="btn-secondary">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
          <Wordmark />
          <p className="text-[12px] text-ink-400">
            Explainable brand governance · evidence-or-silence by design
          </p>
        </div>
      </footer>
    </div>
  );
}
