"use client";

import * as React from "react";

/** Tiny class-name joiner (no external deps). */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Brand mark                                                          */
/* ------------------------------------------------------------------ */

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bl-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C7CF8" />
          <stop offset="100%" stopColor="#4A46C4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#bl-mark)" />
      <circle cx="16" cy="16" r="8.25" stroke="white" strokeOpacity="0.9" strokeWidth="1.75" fill="none" />
      <circle cx="16" cy="16" r="3.1" fill="white" />
      <path d="M16 4.6v3.1M16 24.3v3.1M4.6 16h3.1M24.3 16h3.1" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-ink-900">
        Brand<span className="text-brand-600">Lens</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons / links                                                     */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  brand: "btn-brand",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(variants[variant], size === "sm" && "btn-sm", className)}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4", className)}>
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-ink-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass = (error?: boolean) => cn("field", error && "field-error");

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
  className?: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-50 text-ink-500 ring-1 ring-inset ring-ink-100",
    brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
    success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100",
    danger: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-100",
    info: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100",
  };
  return <span className={cn("chip normal-case tracking-normal", tones[tone], className)}>{children}</span>;
}

const severityTone = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
} as const;

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severityTone[severity as keyof typeof severityTone] ?? "neutral";
  return (
    <Badge tone={tone}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          severity === "critical" && "bg-red-500",
          severity === "high" && "bg-amber-500",
          severity === "medium" && "bg-sky-500",
          severity === "low" && "bg-ink-300"
        )}
      />
      {severity}
    </Badge>
  );
}

const statusTone: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  submitted: "info",
  under_review: "brand",
  changes_requested: "warning",
  approved: "success",
  rejected: "danger",
  pending: "warning",
  accepted: "success",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50/70 text-sky-900",
    success: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    warning: "border-amber-200 bg-amber-50/70 text-amber-900",
    danger: "border-red-200 bg-red-50/70 text-red-900",
  };
  const icons = {
    info: "M12 8h.01M11 12h1v4h1M12 21a9 9 0 100-18 9 9 0 000 18z",
    success: "M9 12.5l2 2 4-4.5M12 21a9 9 0 100-18 9 9 0 000 18z",
    warning: "M12 8v4.5M12 16h.01M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
    danger: "M12 9v4M12 17h.01M12 21a9 9 0 100-18 9 9 0 000 18z",
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d={icons[tone]} />
      </svg>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("leading-relaxed", title && "mt-0.5 opacity-90")}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-50 text-ink-400 ring-1 ring-inset ring-ink-100">
        {icon ?? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-400">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink-100", className)} />;
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
}) {
  const valueTone = {
    neutral: "text-ink-900",
    brand: "text-brand-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  }[tone];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink-400">{label}</p>
        {icon ? <span className="text-ink-300">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight", valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-300">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className,
}: {
  value: number;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    brand: "bg-brand-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div
        className={cn("h-full rounded-full transition-all", tones[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 012-2h8" />
      </svg>
      {copied ? "Copied" : label}
    </button>
  );
}
