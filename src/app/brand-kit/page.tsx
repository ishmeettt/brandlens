"use client";

import * as React from "react";
import { AppShell } from "../../components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  PageHeader,
  ProgressBar,
  Skeleton,
  cn,
  inputClass,
} from "../../components/ui";
import { demoBrandKit } from "../../lib/demo";
import { RULE_CATALOGUE } from "../../lib/rules";
import { isSupabaseConfigured, supabase, type BrandKit } from "../../lib/supabase";

interface GlossaryRow {
  term: string;
  replacement: string;
  banned: boolean;
}
interface FactRow {
  label: string;
  value: string;
}
interface ColourRow {
  name: string;
  hex: string;
}
interface GuidelineFields {
  voice: string;
  accessibility: string;
  logo: string;
  claims: string;
}

const GUIDELINE_META: Array<{
  key: keyof GuidelineFields;
  title: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: "voice",
    title: "Voice & tone",
    hint: "One rule per line. These become citable passages.",
    placeholder: "Write in plain, confident English.\nAddress the reader as “you”.",
  },
  {
    key: "accessibility",
    title: "Accessibility",
    hint: "Alt-text and contrast requirements unlock those checks.",
    placeholder: "Every image must carry descriptive alt text of at least five words.\nText must reach a 4.5:1 contrast ratio.",
  },
  {
    key: "logo",
    title: "Logo usage",
    hint: "Describe allowed treatments and placements.",
    placeholder: "Use only the approved primary logo. Never recolour it.",
  },
  {
    key: "claims",
    title: "Claims policy",
    hint: "Explain which numbers and superlatives need approval.",
    placeholder: "Numbers and superlatives must appear in the approved facts.",
  },
];

function linesToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : (entry && typeof entry === "object" && (entry as { text?: string }).text) || ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function hydrate(kit: BrandKit) {
  const guidelines = (kit.guidelines ?? {}) as Record<string, unknown>;
  const fields: GuidelineFields = {
    voice: linesToText(guidelines.voice),
    accessibility: linesToText(guidelines.accessibility),
    logo: linesToText(guidelines.logo),
    claims: linesToText(guidelines.claims),
  };

  const glossaryRaw = kit.glossary as
    | { banned?: Array<{ term: string; replacement?: string } | string>; preferred?: Array<{ term: string; replacement?: string }> }
    | undefined;

  const glossary: GlossaryRow[] = [
    ...(glossaryRaw?.banned ?? []).map((entry) =>
      typeof entry === "string"
        ? { term: entry, replacement: "", banned: true }
        : { term: entry.term, replacement: entry.replacement ?? "", banned: true }
    ),
    ...(glossaryRaw?.preferred ?? []).map((entry) => ({
      term: entry.term,
      replacement: entry.replacement ?? "",
      banned: false,
    })),
  ];

  const facts: FactRow[] = Array.isArray(kit.facts)
    ? (kit.facts as FactRow[])
    : Object.entries((kit.facts ?? {}) as Record<string, string>).map(([label, value]) => ({
        label,
        value: String(value),
      }));

  const palette: ColourRow[] = Array.isArray(kit.palette)
    ? (kit.palette as ColourRow[])
    : Object.entries((kit.palette ?? {}) as Record<string, string>).map(([name, hex]) => ({
        name,
        hex,
      }));

  return { fields, glossary, facts, palette };
}

export default function BrandKitPage() {
  const demo = !isSupabaseConfigured;

  const [loading, setLoading] = React.useState(!demo);
  const [name, setName] = React.useState(demo ? demoBrandKit.name : "");
  const [guidelines, setGuidelines] = React.useState<GuidelineFields>(
    demo
      ? hydrate(demoBrandKit).fields
      : { voice: "", accessibility: "", logo: "", claims: "" }
  );
  const [glossary, setGlossary] = React.useState<GlossaryRow[]>(
    demo ? hydrate(demoBrandKit).glossary : [{ term: "", replacement: "", banned: true }]
  );
  const [facts, setFacts] = React.useState<FactRow[]>(
    demo ? hydrate(demoBrandKit).facts : [{ label: "", value: "" }]
  );
  const [palette, setPalette] = React.useState<ColourRow[]>(
    demo ? hydrate(demoBrandKit).palette : [{ name: "Primary", hex: "#5B5BD6" }]
  );
  const [logoUrl, setLogoUrl] = React.useState<string | null>(demo ? demoBrandKit.logo_url ?? null : null);
  const [kitId, setKitId] = React.useState<string | null>(demo ? demoBrandKit.id : null);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!supabase) return;
    let active = true;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;

        const { data: kit, error: kitError } = await supabase
          .from("brand_kits")
          .select("*")
          .eq("organization_id", auth.user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (kitError) throw kitError;
        if (!active || !kit) return;

        const hydrated = hydrate(kit as BrandKit);
        setKitId((kit as BrandKit).id);
        setName((kit as BrandKit).name);
        setGuidelines(hydrated.fields);
        setGlossary(hydrated.glossary.length ? hydrated.glossary : [{ term: "", replacement: "", banned: true }]);
        setFacts(hydrated.facts.length ? hydrated.facts : [{ label: "", value: "" }]);
        setPalette(hydrated.palette.length ? hydrated.palette : [{ name: "Primary", hex: "#5B5BD6" }]);
        setLogoUrl((kit as BrandKit).logo_url ?? null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load the brand kit.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const guidelineCount = Object.values(guidelines).filter((value) => value.trim()).length;
  const validGlossary = glossary.filter((row) => row.term.trim()).length;
  const validFacts = facts.filter((row) => row.label.trim() && row.value.trim()).length;
  const validPalette = palette.filter((row) => /^#?[0-9a-f]{3,6}$/i.test(row.hex.trim())).length;

  const checklist = [
    { label: "Kit name", done: name.trim().length > 0 },
    { label: "Voice guidelines", done: guidelines.voice.trim().length > 0 },
    { label: "Accessibility clause", done: guidelines.accessibility.trim().length > 0 },
    { label: "Glossary terms", done: validGlossary > 0 },
    { label: "Approved facts", done: validFacts > 0 },
    { label: "Palette colours", done: validPalette > 0 },
    { label: "Logo asset", done: Boolean(logoUrl) },
  ];
  const completeness = Math.round(
    (checklist.filter((item) => item.done).length / checklist.length) * 100
  );

  async function uploadLogo(file: File) {
    if (!supabase) {
      setLogoUrl(URL.createObjectURL(file));
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Sign in again to upload a logo.");

    const path = `${auth.user.id}/${Date.now()}_${file.name.replace(/\s+/g, "-")}`;
    const { error: uploadError } = await supabase.storage
      .from("brand-kit-logos")
      .upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("brand-kit-logos").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    if (!name.trim()) {
      setError("Give the brand kit a name before saving.");
      return;
    }

    const guidelinePayload: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(guidelines)) {
      const lines = value
        .split("\n")
        .map((line: string) => line.trim())
        .filter(Boolean);
      if (lines.length > 0) guidelinePayload[key] = lines;
    }

    const payload = {
      name: name.trim(),
      guidelines: guidelinePayload,
      glossary: {
        banned: glossary.filter((row) => row.banned && row.term.trim()),
        preferred: glossary.filter((row) => !row.banned && row.term.trim() && row.replacement.trim()),
      },
      facts: facts.filter((row) => row.label.trim() && row.value.trim()),
      palette: palette.filter((row) => row.name.trim() && row.hex.trim()),
      logo_url: logoUrl,
    };

    if (!supabase) {
      setSaved("Preview only — connect Supabase to persist this brand kit.");
      return;
    }

    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");

      if (kitId) {
        const { error: updateError } = await supabase
          .from("brand_kits")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", kitId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase
          .from("brand_kits")
          .insert({ ...payload, organization_id: auth.user.id })
          .select("id")
          .single();
        if (insertError) throw insertError;
        setKitId(data.id);
      }

      setSaved("Brand kit saved. Every new review will cite these passages.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the brand kit.");
    } finally {
      setSaving(false);
    }
  }

  function updateRow<T>(rows: T[], index: number, patch: Partial<T>): T[] {
    return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Approved sources"
        title="Brand kit"
        description="This is the only source of truth a review may cite. Clauses you leave empty simply cannot produce findings."
        actions={
          <>
            <Badge tone={completeness === 100 ? "success" : "warning"}>{completeness}% complete</Badge>
            <Button type="submit" form="brand-kit-form" loading={saving}>
              Save brand kit
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mt-5">
          <Alert tone="danger" title="Brand kit not saved">{error}</Alert>
        </div>
      ) : null}
      {saved ? (
        <div className="mt-5">
          <Alert tone="success">{saved}</Alert>
        </div>
      ) : null}
      {demo ? (
        <div className="mt-5">
          <Alert tone="info" title="Demo brand kit">
            These values are seeded so the review engine has something to cite. Connect
            Supabase to store your own kit.
          </Alert>
        </div>
      ) : null}

      <form id="brand-kit-form" onSubmit={handleSave} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Identity */}
          <Card>
            <CardHeader title="Identity" description="Name the kit and add the approved logo asset." />
            <div className="grid gap-5 p-5 sm:grid-cols-[1fr_200px]">
              <div className="space-y-4">
                <Field label="Brand kit name" htmlFor="kit-name" hint="Usually the brand or business unit.">
                  <input
                    id="kit-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={inputClass()}
                    placeholder="Lumen Analytics"
                  />
                </Field>
                <div>
                  <p className="field-label">Logo</p>
                  <label
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={async (event) => {
                      event.preventDefault();
                      setDragging(false);
                      const file = event.dataTransfer.files?.[0];
                      if (!file) return;
                      try {
                        await uploadLogo(file);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Logo upload failed.");
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-[13px] transition",
                      dragging ? "border-brand-400 bg-brand-50/60" : "border-ink-200 hover:border-ink-300"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-700">
                        {logoUrl ? "Replace logo" : "Drop an SVG or PNG"}
                      </span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {logoUrl ? logoUrl.split("/").pop() : "or click to browse"}
                      </span>
                    </span>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M12 16V5m0 0L8 9m4-4l4 4" strokeLinecap="round" />
                      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
                    </svg>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          await uploadLogo(file);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Logo upload failed.");
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center rounded-xl border border-ink-100 bg-ink-50/50 p-4">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Brand logo" className="max-h-16 w-auto object-contain" />
                ) : (
                  <div className="text-center text-[12px] text-ink-400">
                    <svg viewBox="0 0 24 24" className="mx-auto mb-2 h-6 w-6 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                      <circle cx="9" cy="10" r="1.6" />
                      <path d="M4 17l5-4 4 3 3-2 4 3" />
                    </svg>
                    No logo yet
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Guidelines */}
          <Card>
            <CardHeader
              title="Guidelines"
              description="Each line becomes a citable clause. Accessibility and claims clauses unlock those rule families."
            />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {GUIDELINE_META.map((meta) => (
                <Field key={meta.key} label={meta.title} hint={meta.hint} htmlFor={`guide-${meta.key}`}>
                  <textarea
                    id={`guide-${meta.key}`}
                    rows={4}
                    value={guidelines[meta.key]}
                    onChange={(event) =>
                      setGuidelines((prev) => ({ ...prev, [meta.key]: event.target.value }))
                    }
                    placeholder={meta.placeholder}
                    className={cn(inputClass(), "resize-y font-normal leading-relaxed")}
                  />
                </Field>
              ))}
            </div>
          </Card>

          {/* Glossary */}
          <Card>
            <CardHeader
              title="Glossary"
              description="Banned terms are high severity; discouraged wording suggests the approved replacement."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setGlossary((rows) => [...rows, { term: "", replacement: "", banned: true }])}
                >
                  Add term
                </Button>
              }
            />
            <div className="space-y-2.5 p-5">
              {glossary.map((row, index) => (
                <div key={index} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <input
                    value={row.term}
                    onChange={(event) => setGlossary(updateRow(glossary, index, { term: event.target.value }))}
                    placeholder="Term, e.g. AI-generated"
                    className={inputClass()}
                  />
                  <input
                    value={row.replacement}
                    onChange={(event) =>
                      setGlossary(updateRow(glossary, index, { replacement: event.target.value }))
                    }
                    placeholder="Preferred wording"
                    className={inputClass()}
                  />
                  <button
                    type="button"
                    onClick={() => setGlossary(updateRow(glossary, index, { banned: !row.banned }))}
                    className={cn(
                      "rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition",
                      row.banned
                        ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-100"
                        : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100"
                    )}
                    title="Toggle banned / discouraged"
                  >
                    {row.banned ? "Banned" : "Discouraged"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGlossary(glossary.filter((_, i) => i !== index))}
                    className="btn-ghost px-2 py-2"
                    aria-label="Remove term"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
              {glossary.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-200 px-4 py-6 text-center text-[13px] text-ink-400">
                  No terms yet — terminology checks stay silent until you add one.
                </p>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Facts */}
            <Card>
              <CardHeader
                title="Approved facts"
                description="Figures a review is allowed to treat as true."
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setFacts((rows) => [...rows, { label: "", value: "" }])}
                  >
                    Add
                  </Button>
                }
              />
              <div className="space-y-2.5 p-5">
                {facts.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <input
                      value={row.label}
                      onChange={(event) => setFacts(updateRow(facts, index, { label: event.target.value }))}
                      placeholder="Founded"
                      className={inputClass()}
                    />
                    <input
                      value={row.value}
                      onChange={(event) => setFacts(updateRow(facts, index, { value: event.target.value }))}
                      placeholder="2019"
                      className={inputClass()}
                    />
                    <button
                      type="button"
                      onClick={() => setFacts(facts.filter((_, i) => i !== index))}
                      className="btn-ghost px-2 py-2"
                      aria-label="Remove fact"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            {/* Palette */}
            <Card>
              <CardHeader
                title="Palette"
                description="Any other hex value in content becomes a colour finding."
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPalette((rows) => [...rows, { name: "", hex: "#5B5BD6" }])}
                  >
                    Add
                  </Button>
                }
              />
              <div className="space-y-2.5 p-5">
                {palette.map((row, index) => (
                  <div key={index} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                    <label
                      className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-lg border border-ink-200 shadow-sm"
                      style={{ backgroundColor: row.hex }}
                      title="Pick colour"
                    >
                      <input
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(row.hex) ? row.hex : "#5B5BD6"}
                        onChange={(event) => setPalette(updateRow(palette, index, { hex: event.target.value.toUpperCase() }))}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={row.name}
                        onChange={(event) => setPalette(updateRow(palette, index, { name: event.target.value }))}
                        placeholder="Iris"
                        className={inputClass()}
                      />
                      <input
                        value={row.hex}
                        onChange={(event) => setPalette(updateRow(palette, index, { hex: event.target.value }))}
                        placeholder="#5B5BD6"
                        className={cn(inputClass(), "font-mono text-[13px] uppercase")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPalette(palette.filter((_, i) => i !== index))}
                      className="btn-ghost px-2 py-2"
                      aria-label="Remove colour"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Rail */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-900">Kit completeness</p>
              <span className="text-sm font-semibold text-brand-600">{completeness}%</span>
            </div>
            <ProgressBar value={completeness} className="mt-3" tone={completeness === 100 ? "success" : "brand"} />
            <ul className="mt-4 space-y-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-[13px]">
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full text-white",
                      item.done ? "bg-emerald-500" : "bg-ink-100 text-ink-300"
                    )}
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className={item.done ? "text-ink-600" : "text-ink-400"}>{item.label}</span>
                </li>
              ))}
            </ul>
            {loading ? <Skeleton className="mt-4 h-3 w-full" /> : null}
          </Card>

          <Card>
            <CardHeader title="What this kit can check" description="Rules activate only when a citable clause exists." />
            <ul className="divide-y divide-ink-50">
              {RULE_CATALOGUE.map((rule) => {
                const active =
                  (rule.type === "terminology" && validGlossary > 0) ||
                  (rule.type === "claim" && (validFacts > 0 || guidelines.claims.trim().length > 0)) ||
                  (rule.type === "alt_text" && guidelines.accessibility.trim().length > 0) ||
                  (rule.type === "colour" && validPalette > 0) ||
                  (rule.type === "contrast" && validPalette > 0) ||
                  (rule.type === "logo" && Boolean(logoUrl));
                return (
                  <li key={rule.type} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        active ? "bg-emerald-500" : "bg-ink-200"
                      )}
                    />
                    <div>
                      <p className={cn("text-[13px] font-medium", active ? "text-ink-800" : "text-ink-400")}>
                        {rule.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{rule.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-[12px] leading-relaxed text-ink-500">
            <span className="font-semibold text-ink-700">Tip:</span> keep clauses short and
            specific. A clause that names a term or a number produces precise findings; a
            vague "be on brand" clause produces none.
          </div>
        </aside>
      </form>
    </AppShell>
  );
}
