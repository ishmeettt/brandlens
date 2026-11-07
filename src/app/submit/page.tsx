"use client";

import Link from "next/link";
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
  Spinner,
  cn,
  inputClass,
} from "../../components/ui";
import { demoBrandKit } from "../../lib/demo";
import { extractTextFromImage } from "../../lib/review-pipeline";
import {
  brandKitPassages,
  normaliseFacts,
  normaliseGlossary,
  normalisePalette,
} from "../../lib/rules";
import { isSupabaseConfigured, supabase, type BrandKit, type ContentType } from "../../lib/supabase";

const TYPES: Array<{ value: ContentType; label: string; hint: string }> = [
  { value: "text", label: "Copy", hint: "Paste copy" },
  { value: "image", label: "Image", hint: "OCR reads it" },
  { value: "pdf", label: "PDF", hint: "Extract text" },
  { value: "docx", label: "DOCX", hint: "Extract text" },
];

type OcrState = "idle" | "reading" | "ready" | "error";

export default function SubmitPage() {
  const demo = !isSupabaseConfigured;

  const [title, setTitle] = React.useState("");
  const [contentType, setContentType] = React.useState<ContentType>("text");
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [ocrState, setOcrState] = React.useState<OcrState>("idle");
  const [ocrError, setOcrError] = React.useState<string | null>(null);
  const [brandKit, setBrandKit] = React.useState<BrandKit | null>(demo ? demoBrandKit : null);
  const [kitLoading, setKitLoading] = React.useState(!demo);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ id: string } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!supabase) return;
    let active = true;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;
        const { data: kit } = await supabase
          .from("brand_kits")
          .select("*")
          .eq("organization_id", auth.user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (active) setBrandKit((kit as BrandKit) ?? null);
      } finally {
        if (active) setKitLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!file || contentType !== "image") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, contentType]);

  async function runOcr(nextFile: File) {
    setOcrState("reading");
    setOcrError(null);
    try {
      const extracted = await extractTextFromImage(nextFile);
      if (extracted.trim()) {
        setText(extracted.trim());
        setOcrState("ready");
      } else {
        setOcrState("error");
        setOcrError("No readable text was found in this image.");
      }
    } catch (err) {
      setOcrState("error");
      setOcrError(err instanceof Error ? err.message : "OCR failed for this image.");
    }
  }

  async function handleFile(nextFile: File) {
    setFile(nextFile);
    setText("");
    setOcrState("idle");
    setError(null);
    if (contentType === "image") await runOcr(nextFile);
  }

  function resetForType(next: ContentType) {
    setContentType(next);
    setFile(null);
    setText("");
    setOcrState("idle");
    setOcrError(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Give this submission a title so reviewers can find it.");
      return;
    }
    if (!text.trim() && contentType !== "image") {
      setError("Add the content that should be reviewed.");
      return;
    }
    if (contentType === "image" && !file) {
      setError("Upload the image that should be reviewed.");
      return;
    }

    if (!supabase) {
      setCreated({ id: "demo-submission" });
      return;
    }

    setSubmitting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");

      let imageUrl: string | null = null;
      let pdfUrl: string | null = null;

      if (file) {
        const bucket = "content-submissions";
        const path = `${auth.user.id}/${Date.now()}_${file.name.replace(/\s+/g, "-")}`;
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        if (contentType === "image") imageUrl = data.publicUrl;
        else pdfUrl = data.publicUrl;
      }

      const { data, error: insertError } = await supabase
        .from("content_submissions")
        .insert({
          brand_kit_id: brandKit?.id ?? null,
          title: trimmedTitle,
          content_type: contentType,
          status: "submitted",
          text_content: text.trim() || null,
          image_url: imageUrl,
          pdf_url: pdfUrl,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      setCreated({ id: data.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother() {
    setCreated(null);
    setTitle("");
    setText("");
    setFile(null);
    setOcrState("idle");
    setOcrError(null);
    setError(null);
  }

  const glossary = normaliseGlossary(brandKit?.glossary);
  const facts = normaliseFacts(brandKit?.facts);
  const palette = normalisePalette(brandKit?.palette);
  const passages = brandKitPassages(brandKit);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  if (created) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl pt-6">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-50 via-white to-brand-50 px-8 pb-8 pt-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-ink-900">Submitted for review</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
                {demo
                  ? "This is the demo workspace, so nothing was persisted. Connect Supabase to store real submissions."
                  : "The review engine will check this against the brand kit and hold findings for a reviewer."}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ink-100 bg-white px-3 py-1.5 font-mono text-[11px] text-ink-500">
                id · {created.id.slice(0, 18)}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-ink-100 p-5 sm:flex-row">
              <Link href="/review" className="btn-primary flex-1">
                Open review queue
              </Link>
              <Button type="button" variant="secondary" className="flex-1" onClick={startAnother}>
                Submit another
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="New review"
        title="Submit content"
        description="Paste copy or upload an asset. Everything is measured against the brand kit — nothing is published from here."
        actions={<Badge tone="brand">{contentType.toUpperCase()}</Badge>}
      />

      {error ? (
        <div className="mt-5">
          <Alert tone="danger" title="Cannot submit">{error}</Alert>
        </div>
      ) : null}

      {!kitLoading && !brandKit ? (
        <div className="mt-5">
          <Alert
            tone="warning"
            title="No brand kit found"
            action={
              <Link href="/brand-kit" className="btn-secondary btn-sm shrink-0">
                Create kit
              </Link>
            }
          >
            A review needs citable clauses. Create a brand kit first, then submit content.
          </Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader title="What are you submitting?" description="Choose the format; images are read locally with OCR." />
            <div className="p-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TYPES.map((type) => {
                  const active = contentType === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => resetForType(type.value)}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left transition",
                        active
                          ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/15"
                          : "border-ink-200 bg-white hover:border-ink-300"
                      )}
                    >
                      <span className={cn("block text-[13px] font-semibold", active ? "text-brand-700" : "text-ink-700")}>
                        {type.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-400">{type.hint}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 space-y-4">
                <Field label="Title" htmlFor="title" hint="Reviewers see this in the queue.">
                  <input
                    id="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Q3 launch: Signal Studio"
                    className={inputClass()}
                  />
                </Field>

                {contentType !== "image" ? (
                  <Field
                    label={contentType === "text" ? "Content" : "Document text"}
                    htmlFor="content"
                    hint={
                      contentType === "text"
                        ? `${words} words · checked for terminology, claims, alt text and colour`
                        : "Paste the document text — the review engine reads text, not the file itself."
                    }
                  >
                    <textarea
                      id="content"
                      rows={12}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder={
                        contentType === "text"
                          ? "Paste the copy that should go through brand review…"
                          : "Paste the text of the PDF or DOCX so it can be reviewed…"
                      }
                      className={cn(inputClass(), "resize-y font-normal leading-relaxed")}
                    />
                  </Field>
                ) : null}

                {contentType !== "text" ? (
                  <div>
                    <p className="field-label">
                      {contentType === "image" ? "Image file" : `${contentType.toUpperCase()} file`}
                    </p>
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={async (event) => {
                        event.preventDefault();
                        setDragging(false);
                        const dropped = event.dataTransfer.files?.[0];
                        if (dropped) await handleFile(dropped);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                      }}
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition",
                        dragging
                          ? "border-brand-400 bg-brand-50/60"
                          : "border-ink-200 bg-ink-50/40 hover:border-ink-300 hover:bg-ink-50"
                      )}
                    >
                      <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M12 16V5m0 0L8 9m4-4l4 4" strokeLinecap="round" />
                        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
                      </svg>
                      <p className="text-[13px] font-medium text-ink-700">
                        {file ? file.name : "Drop a file or click to browse"}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {contentType === "image" ? "PNG, JPG or WebP" : "PDF or DOCX"}
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        accept={contentType === "image" ? "image/*" : ".pdf,.docx"}
                        onChange={async (event) => {
                          const selected = event.target.files?.[0];
                          if (selected) await handleFile(selected);
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                {contentType === "image" && previewUrl ? (
                  <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                    <div className="overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Selected submission" className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-medium text-ink-700">Text read from image</p>
                        {ocrState === "reading" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-600">
                            <Spinner className="h-3 w-3" /> Reading
                          </span>
                        ) : ocrState === "ready" ? (
                          <Badge tone="success">OCR ready</Badge>
                        ) : ocrState === "error" ? (
                          <Badge tone="danger">No text</Badge>
                        ) : null}
                      </div>
                      <textarea
                        rows={7}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="OCR text appears here. You can correct it before submitting."
                        className={cn(inputClass(Boolean(ocrError)), "mt-2 resize-y font-normal leading-relaxed")}
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-[11px] text-ink-400">{words} words · edited text is what gets reviewed</p>
                        {file ? (
                          <button
                            type="button"
                            onClick={() => runOcr(file)}
                            className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                          >
                            Run OCR again
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {ocrError ? (
                  <Alert tone="warning" title="OCR could not read this image">
                    {ocrError} You can type the visible copy into the text box instead.
                  </Alert>
                ) : null}
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" className="sm:w-auto" loading={submitting} disabled={!brandKit}>
              Submit for review
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M5 12h14m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
            <Link href="/review" className="btn-secondary sm:w-auto">
              View review queue
            </Link>
          </div>
        </form>

        {/* Rail */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Reviewing against" description="Only these clauses can produce a finding." />
            <div className="p-5">
              {kitLoading ? (
                <div className="space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100" />
                </div>
              ) : brandKit ? (
                <>
                  <p className="text-sm font-semibold text-ink-900">{brandKit.name}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    {[
                      { label: "Clauses", value: passages.length },
                      { label: "Glossary", value: glossary.banned.length + glossary.preferred.length },
                      { label: "Facts", value: facts.length },
                      { label: "Colours", value: palette.length },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-lg bg-ink-50 px-2 py-2">
                        <p className="text-base font-semibold text-ink-800">{stat.value}</p>
                        <p className="text-[10px] uppercase tracking-wide text-ink-400">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                  <Link href="/brand-kit" className="mt-3 inline-block text-[12px] font-medium text-brand-600 hover:text-brand-700">
                    Edit brand kit →
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-ink-400">No brand kit attached.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="What happens next" />
            <ol className="space-y-3 p-5">
              {[
                "Deterministic rules run first — terminology, claims, alt text, palette, contrast.",
                "An AI pass adds tone and claim-support notes, each quoting a clause.",
                "Uncited notes are discarded and counted, never shown as advice.",
                "A reviewer accepts or dismisses findings, then approves or rejects.",
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                    {index + 1}
                  </span>
                  <p className="text-[12px] leading-relaxed text-ink-500">{step}</p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
