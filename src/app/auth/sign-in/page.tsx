"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { LogoMark, Wordmark, Alert, Badge, Button, Field, cn, inputClass } from "../../../components/ui";
import { isSupabaseConfigured, supabase, type UserRole } from "../../../lib/supabase";

// Shared judge account, seeded by scripts/seed-demo.mjs. It is intentionally
// public: the demo workspace holds only seeded sample data.
const DEMO_EMAIL = "judge@brandlens.demo";
const DEMO_PASSWORD = "BrandLens-Judges-2026";

const ROLES: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "creator", label: "Creator", hint: "Submit content" },
  { value: "manager", label: "Manager", hint: "Oversee the brand" },
  { value: "reviewer", label: "Reviewer", hint: "Decide on findings" },
  { value: "admin", label: "Admin", hint: "Manage people" },
];

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("creator");
  const [organization, setOrganization] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [demoLoading, setDemoLoading] = React.useState(false);

  const configured = isSupabaseConfigured;

  async function enterDemo() {
    setError(null);
    setNotice(null);

    if (!supabase) {
      router.push("/review");
      return;
    }

    setDemoLoading(true);
    try {
      const { error: demoError } = await supabase.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      if (demoError) throw demoError;
      router.push("/review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open the demo workspace."
      );
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!supabase) {
      setError("Supabase credentials are missing, so sign-in is disabled. Open the demo workspace instead.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { role, organization } },
        });
        if (signUpError) throw signUpError;

        if (data.session && data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            email,
            role,
            organization: organization || null,
          });
          router.push(role === "admin" ? "/admin" : role === "reviewer" ? "/review" : "/submit");
          return;
        }

        setNotice("Account created. Check your inbox to confirm the email, then sign in.");
        setMode("signin");
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const userId = data.user?.id;
      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", userId)
          .maybeSingle();

        if (!profile) {
          await supabase.from("profiles").insert({
            id: userId,
            email,
            role: "creator",
            organization: organization || null,
          });
        }

        const resolvedRole = (profile?.role as UserRole | undefined) ?? "creator";
        router.push(
          resolvedRole === "admin" ? "/admin" : resolvedRole === "reviewer" ? "/review" : "/submit"
        );
        return;
      }

      router.push("/submit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      {/* Form */}
      <div className="flex flex-col bg-white">
        <div className="flex items-center justify-between px-6 py-6 sm:px-10">
          <Link href="/" aria-label="BrandLens home">
            <Wordmark />
          </Link>
          <Link href="/" className="text-[13px] font-medium text-ink-400 transition hover:text-ink-800">
            Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-14 sm:px-10">
          <div className="w-full max-w-[420px]">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
              {mode === "signin" ? "Welcome back" : "Create your workspace"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-400">
              {mode === "signin"
                ? "Sign in to review submissions against your brand kit."
                : "Set up an account and choose how you work with the brand."}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-ink-50 p-1">
              {(["signin", "signup"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value);
                    setError(null);
                    setNotice(null);
                  }}
                  className={cn(
                    "rounded-md px-3 py-2 text-[13px] font-medium transition",
                    mode === value
                      ? "bg-white text-ink-900 shadow-sm"
                      : "text-ink-400 hover:text-ink-700"
                  )}
                >
                  {value === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            {configured ? (
              <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
                  Evaluating BrandLens
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                  Open the shared demo workspace: a full brand kit, four submissions and
                  eleven cited findings. No account needed.
                </p>
                <Button
                  type="button"
                  onClick={enterDemo}
                  loading={demoLoading}
                  className="mt-3 w-full"
                >
                  Enter demo workspace
                </Button>
                <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-400">
                  Or sign in manually as{" "}
                  <span className="font-mono text-ink-600">{DEMO_EMAIL}</span> ·{" "}
                  <span className="font-mono text-ink-600">{DEMO_PASSWORD}</span>
                </p>
              </div>
            ) : null}

            {!configured ? (
              <div className="mt-5">
                <Alert tone="warning" title="Supabase is not configured">
                  Add the two public Supabase keys to enable sign-in, or explore the seeded
                  demo workspace instead.
                </Alert>
                <div className="mt-3 flex gap-2">
                  <Link href="/review" className="btn-primary flex-1">
                    Open demo workspace
                  </Link>
                  <Link href="/brand-kit" className="btn-secondary flex-1">
                    Brand kit
                  </Link>
                </div>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error ? (
                <Alert tone="danger" title="Could not continue">
                  {error}
                </Alert>
              ) : null}
              {notice ? <Alert tone="success">{notice}</Alert> : null}

              <Field label="Work email" htmlFor="email">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className={inputClass()}
                  disabled={!configured}
                />
              </Field>

              <Field
                label="Password"
                htmlFor="password"
                hint={mode === "signup" ? "At least 8 characters." : undefined}
              >
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className={inputClass()}
                  disabled={!configured}
                />
              </Field>

              {mode === "signup" ? (
                <>
                  <Field label="Organisation" htmlFor="organization">
                    <input
                      id="organization"
                      type="text"
                      value={organization}
                      onChange={(event) => setOrganization(event.target.value)}
                      placeholder="Lumen Analytics"
                      className={inputClass()}
                      disabled={!configured}
                    />
                  </Field>

                  <div>
                    <p className="field-label">Your role</p>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLES.map((option) => {
                        const active = role === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setRole(option.value)}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-left transition",
                              active
                                ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/15"
                                : "border-ink-200 hover:border-ink-300"
                            )}
                            disabled={!configured}
                          >
                            <span className={cn("block text-[13px] font-medium", active ? "text-brand-700" : "text-ink-700")}>
                              {option.label}
                            </span>
                            <span className="block text-[11px] text-ink-400">{option.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!configured}>
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>

              {mode === "signin" ? (
                <p className="text-center text-[12px] text-ink-400">
                  No account yet?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    Create one
                  </button>
                </p>
              ) : null}
            </form>
          </div>
        </div>
      </div>

      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-ink-900 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.16] surface-grid" />
        <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative p-12">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="text-[17px] font-semibold tracking-tight text-white">
              Brand<span className="text-brand-300">Lens</span>
            </span>
          </div>
          <p className="mt-8 max-w-sm text-2xl font-semibold leading-snug tracking-tight text-white">
            “Every finding points at the clause it came from. Reviews went from opinion to
            evidence.”
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white">
              PR
            </span>
            <div>
              <p className="text-[13px] font-medium text-white">Priya Raman</p>
              <p className="text-[11px] text-ink-400">Head of Brand, Meridian</p>
            </div>
          </div>
        </div>

        <div className="relative border-t border-white/10 p-12">
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">Deterministic rules</Badge>
            <Badge tone="success">Cited findings</Badge>
            <Badge tone="neutral">Human decisions</Badge>
          </div>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-ink-400">
            Brand kits hold the glossary, approved facts, palette and voice guidelines that
            every review is measured against.
          </p>
        </div>
      </div>
    </div>
  );
}
