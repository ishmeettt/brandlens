"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import {
  isSupabaseConfigured,
  supabase,
  type UserRole,
} from "../lib/supabase";
import { demoOrgName } from "../lib/demo";
import { Badge, Skeleton, Wordmark, cn } from "./ui";

interface NavItem {
  href: string;
  label: string;
  caption: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const icon = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const NAV: NavItem[] = [
  {
    href: "/brand-kit",
    label: "Brand kit",
    caption: "Approved sources",
    icon: icon(
      <>
        <path d="M4 5.5A1.5 1.5 0 015.5 4H11l2 2.5h5.5A1.5 1.5 0 0120 8v9.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
        <path d="M8 12h8M8 15h5" />
      </>
    ),
  },
  {
    href: "/submit",
    label: "Submit content",
    caption: "Start a review",
    icon: icon(
      <>
        <path d="M12 16V5m0 0L8 9m4-4l4 4" />
        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
      </>
    ),
  },
  {
    href: "/review",
    label: "Review queue",
    caption: "Findings & decisions",
    icon: icon(
      <>
        <path d="M12 3l7 3.5v5c0 4.2-2.9 7.7-7 9.5-4.1-1.8-7-5.3-7-9.5v-5z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    roles: ["reviewer", "admin"],
  },
  {
    href: "/admin",
    label: "Admin",
    caption: "People & audit",
    icon: icon(
      <>
        <path d="M4 20v-1.5A3.5 3.5 0 017.5 15h9a3.5 3.5 0 013.5 3.5V20" />
        <circle cx="12" cy="8" r="3.2" />
      </>
    ),
    roles: ["admin"],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/brand-kit": "Brand kit",
  "/submit": "Submit content",
  "/review": "Review queue",
  "/admin": "Admin",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDemo = !isSupabaseConfigured;
  // The drawer belongs to the page it was opened on, so navigating closes it:
  // a different pathname means the stored one no longer matches.
  const [mobileOpenAt, setMobileOpenAt] = React.useState<string | null>(null);
  const mobileOpen = mobileOpenAt === pathname;
  const [loading, setLoading] = React.useState(!isDemo);
  const [email, setEmail] = React.useState<string | null>(
    isDemo ? "ava@lumen.example" : null
  );
  const [role, setRole] = React.useState<UserRole>(isDemo ? "admin" : "creator");
  const [organization, setOrganization] = React.useState<string | null>(
    isDemo ? demoOrgName : null
  );

  React.useEffect(() => {
    if (!supabase) return;

    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        router.replace("/auth/sign-in");
        return;
      }
      setEmail(data.user.email ?? null);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, organization")
        .eq("id", data.user.id)
        .single();
      if (!active) return;
      setRole((profile?.role as UserRole) ?? "creator");
      setOrganization(profile?.organization ?? null);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const visibleNav = NAV.filter((item) => !item.roles || item.roles.includes(role));
  const title = PAGE_TITLES[pathname] ?? "BrandLens";
  const initials = (email ?? "AV").slice(0, 2).toUpperCase();

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    router.push("/auth/sign-in");
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Link href="/" aria-label="BrandLens home">
          <Wordmark />
        </Link>
      </div>

      <div className="mx-3 mb-4 flex items-center justify-between rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink-800">
            {loading ? <Skeleton className="h-3 w-24" /> : organization ?? "Personal workspace"}
          </div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">{role}</p>
        </div>
        {isDemo ? <Badge tone="warning">Demo</Badge> : null}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("nav-link", active && "nav-link-active")}
              aria-current={active ? "page" : undefined}
            >
              <span className={cn("text-ink-300", active && "text-brand-600")}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {active ? <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <div className="rounded-xl bg-ink-900 p-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-300">
            Evidence or silence
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-200">
            A finding is only shown when it cites a clause from the brand kit.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-ink-100 bg-white lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm"
            onClick={() => setMobileOpenAt(null)}
          />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-white shadow-lift animate-fade-in">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileOpenAt(pathname)}
              className="btn-ghost -ml-2 px-2 lg:hidden"
              aria-label="Open navigation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
              <p className="hidden text-[11px] text-ink-400 sm:block">
                {isDemo
                  ? "Preview data — Supabase is not configured"
                  : organization ?? "Brand governance workspace"}
              </p>
            </div>

            <Link href="/submit" className="btn-secondary btn-sm hidden sm:inline-flex">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New submission
            </Link>

            <div className="flex items-center gap-2.5 border-l border-ink-100 pl-3">
              <div className="hidden text-right sm:block">
                <div className="max-w-[180px] truncate text-[13px] font-medium text-ink-800">
                  {loading ? <Skeleton className="ml-auto h-3 w-28" /> : email}
                </div>
                <p className="text-[11px] capitalize text-ink-400">{role}</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                {initials}
              </span>
              {isDemo ? (
                <Link href="/auth/sign-in" className="btn-ghost btn-sm hidden md:inline-flex">
                  Sign in
                </Link>
              ) : (
                <button type="button" onClick={signOut} className="btn-ghost btn-sm" title="Sign out">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M15 16l4-4-4-4M19 12H9M12 4H6a2 2 0 00-2 2v12a2 2 0 002 2h6" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {isDemo ? (
            <div className="border-t border-amber-200/70 bg-amber-50/80 px-4 py-2 text-[12px] text-amber-900 sm:px-6 lg:px-8">
              <span className="font-semibold">Demo workspace.</span>{" "}
              Add <code className="rounded bg-amber-100/70 px-1 py-0.5 font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
              and <code className="rounded bg-amber-100/70 px-1 py-0.5 font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
              to persist real reviews.
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function AccessDenied({
  role,
  requirement,
}: {
  role: string;
  requirement: string;
}) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 118 0v3" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-ink-900">You need {requirement} access</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        You are signed in as <span className="font-medium text-ink-700">{role}</span>. Ask an
        administrator to change your role in the brand workspace.
      </p>
      <Link href="/submit" className="btn-secondary mt-6">
        Back to submissions
      </Link>
    </div>
  );
}
