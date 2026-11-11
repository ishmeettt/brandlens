import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase now issues publishable keys; the legacy anon key works identically.
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * `null` when the project has no Supabase credentials configured. Every page
 * checks for this and falls back to the read-only demo dataset, so the UI is
 * always renderable.
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;

/* ------------------------------------------------------------------ */
/* Domain types                                                        */
/* ------------------------------------------------------------------ */

export type UserRole = "creator" | "manager" | "reviewer" | "admin";

export type ContentType = "text" | "image" | "pdf" | "docx";

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected";

export interface Profile {
  id: string;
  role: UserRole;
  organization?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string | null;
  role: UserRole;
  organization?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GlossaryEntry {
  term: string;
  replacement?: string;
  banned?: boolean;
}

export interface PaletteEntry {
  name: string;
  hex: string;
}

export interface FactEntry {
  label: string;
  value: string;
}

export interface BrandKit {
  id: string;
  name: string;
  organization_id?: string | null;
  guidelines?: unknown;
  facts?: unknown;
  glossary?: unknown;
  palette?: unknown;
  logo_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentSubmission {
  id: string;
  brand_kit_id: string;
  title: string;
  content_type: ContentType;
  status: SubmissionStatus;
  text_content?: string | null;
  image_url?: string | null;
  pdf_url?: string | null;
  created_at: string;
  updated_at?: string;
  /** Reviewer who owns the review. Added by migration 0004. */
  owner_id?: string | null;
  /** Committed deadline; overrides the SLA policy derivation. Migration 0004. */
  due_at?: string | null;
}

export type FindingType =
  | "terminology"
  | "claim"
  | "colour"
  | "contrast"
  | "alt_text"
  | "logo"
  | "custom";

export type Severity = "low" | "medium" | "high" | "critical";

export interface Finding {
  id: string;
  submission_id: string;
  type: FindingType;
  severity: Severity;
  message: string;
  citation?: string | null;
  source_passage?: string | null;
  intent_summary?: string | null;
  suggestion?: string | null;
  /** Exact engine rule that raised this finding. Added by migration 0004. */
  rule_id?: string | null;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at?: string;
  /** Who decided, and when. Added by migration 0004; null until then. */
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

/**
 * True when a write failed because the workspace has not applied a migration
 * yet. Callers retry without the new columns, so the app keeps working before
 * and after migration 0004.
 */
export function isMissingColumnError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string; details?: string } | null)?.message ?? "") +
        " " +
        ((error as { details?: string } | null)?.details ?? "");
  return /42703|PGRST204|column .* does not exist|could not find the '.*' column/i.test(message);
}

/** The signed-in reviewer, used to attribute decisions in the log. */
export async function currentReviewer(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}
