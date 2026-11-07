#!/usr/bin/env node
/**
 * End-to-end check of the BrandLens data flow against a real Supabase project.
 *
 * It signs in as two independent users (creator + reviewer) using the anon key,
 * so every read/write below is subject to row-level security exactly as the
 * browser is. The service-role key is optional and only used to create the test
 * users and to clean up afterwards; it never reaches the app.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-flow.mjs
 *
 * Prints PASS/FAIL per step and exits non-zero if anything fails. It never
 * prints a key or the full env.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

const stamp = Date.now().toString(36);
const password = `Verify-${stamp}-Aa1!`;
// Reserved domains (example.com, *.test) are rejected by GoTrue with
// email_address_invalid, so these use a normal-looking domain.
const creatorEmail = `brandlens.verify.creator.${stamp}@brandlens-verify.dev`;
const reviewerEmail = `brandlens.verify.reviewer.${stamp}@brandlens-verify.dev`;

const results = [];
let failed = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

class ExitSignal extends Error {}

// Thrown so the flow stops, but the process exits on its own: process.exit()
// while the HTTP sockets are still closing aborts libuv on Windows.
function fail(message) {
  console.error(`\n${message}\n`);
  process.exitCode = 2;
  throw new ExitSignal();
}

if (!url || !anonKey) {
  console.error(
    "\nMissing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Create .env.local in the project root with the project URL and publishable (or anon) key.\n"
  );
  // Safe here: no client has connected yet.
  process.exit(2);
}

const creator = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const reviewer = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const state = { creatorId: null, reviewerId: null, kitId: null, submissionId: null, findingIds: [] };

async function schemaCheck() {
  const tables = [
    ["profiles", "email"],
    ["findings", "suggestion"],
    ["brand_kits", "guidelines"],
    ["content_submissions", "status"],
  ];
  for (const [table, column] of tables) {
    const { error } = await anon.from(table).select(column).limit(1);
    if (error) {
      record(`schema: ${table}.${column}`, false, `${error.code ?? ""} ${error.message}`);
      return false;
    }
  }
  record("schema: tables and columns from migrations 1–2", true);
  return true;
}

async function makeUsers() {
  if (admin) {
    for (const [email, role] of [
      [creatorEmail, "creator"],
      [reviewerEmail, "reviewer"],
    ]) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, organization: "Verification workspace" },
      });
      if (error) {
        record(`create ${role} user`, false, error.message);
        return false;
      }
      if (role === "creator") state.creatorId = data.user.id;
      else state.reviewerId = data.user.id;
    }
    record("created confirmed test users via service role", true);
    return true;
  }

  // No service key: fall back to public signup. Works only when the project has
  // email confirmation turned off.
  for (const [email, role] of [
    [creatorEmail, "creator"],
    [reviewerEmail, "reviewer"],
  ]) {
    const { data, error } = await creator.auth.signUp({
      email,
      password,
      options: { data: { role, organization: "Verification workspace" } },
    });
    if (error) {
      record(`sign up ${role}`, false, error.message);
      return false;
    }
    if (!data.session) {
      record(
        `sign up ${role}`,
        false,
        "Supabase requires email confirmation. Add SUPABASE_SERVICE_ROLE_KEY or turn off email confirmations for testing."
      );
      return false;
    }
    if (role === "creator") state.creatorId = data.user.id;
    else state.reviewerId = data.user.id;
  }
  record("signed up two test users (email confirmation disabled)", true);
  return true;
}

async function signIn(client, email, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    record(`sign in ${label}`, false, error.message);
    return false;
  }
  record(`sign in ${label}`, true, data.user?.email === email ? "" : "unexpected user");
  return true;
}

async function creatorFlow() {
  const { data: kit, error: kitError } = await creator
    .from("brand_kits")
    .insert({
      name: "Verification Kit",
      organization_id: state.creatorId,
      guidelines: [
        "Do not use the term AI-generated. Say AI-assisted.",
        "Every statistic in customer copy must appear in the approved facts list.",
      ],
      glossary: [{ term: "AI-generated", replacement: "AI-assisted", banned: true }],
      facts: [{ label: "Founded", value: "2019" }],
      palette: [{ name: "Ink", hex: "#0E1120" }],
    })
    .select("id")
    .single();
  if (kitError) {
    record("creator creates a brand kit", false, `${kitError.code ?? ""} ${kitError.message}`);
    return false;
  }
  state.kitId = kit.id;
  record("creator creates a brand kit", true);

  const { data: submission, error: subError } = await creator
    .from("content_submissions")
    .insert({
      brand_kit_id: state.kitId,
      title: "Verification launch copy",
      content_type: "text",
      status: "submitted",
      text_content:
        "Our AI-generated reports help teams move 62% faster. Signal Studio is the best-in-class workspace.",
    })
    .select("id, status")
    .single();
  if (subError) {
    record("creator submits content", false, `${subError.code ?? ""} ${subError.message}`);
    return false;
  }
  state.submissionId = submission.id;
  record("creator submits content", submission.status === "submitted");
  return true;
}

async function reviewerFlow() {
  const { data: queue, error: queueError } = await reviewer
    .from("content_submissions")
    .select("id, status, brand_kit_id")
    .eq("id", state.submissionId);
  if (queueError) {
    record("reviewer sees the submission", false, `${queueError.code ?? ""} ${queueError.message}`);
    return false;
  }
  record("reviewer sees the submission", queue?.length === 1);

  const { data: kit, error: kitError } = await reviewer
    .from("brand_kits")
    .select("id, name, guidelines")
    .eq("id", state.kitId)
    .maybeSingle();
  record(
    "reviewer can read the creator's brand kit (citations resolve)",
    !kitError && Boolean(kit),
    kitError?.message ?? ""
  );

  const { data: inserted, error: insertError } = await reviewer
    .from("findings")
    .insert([
      {
        submission_id: state.submissionId,
        type: "terminology",
        severity: "high",
        message: 'Banned term "AI-generated" appears once.',
        citation: "Glossary · AI-generated is banned",
        source_passage: "Do not use the term AI-generated. Say AI-assisted.",
        suggestion: 'Replace "AI-generated" with "AI-assisted".',
        status: "pending",
      },
      {
        submission_id: state.submissionId,
        type: "claim",
        severity: "medium",
        message: 'Unprovable superlative "best" is not backed by an approved fact.',
        citation: "Approved facts · Founded",
        source_passage: "Founded: 2019",
        suggestion: 'Replace "best" with a verifiable statement.',
        status: "pending",
      },
    ])
    .select("id");
  if (insertError) {
    record("reviewer records findings", false, `${insertError.code ?? ""} ${insertError.message}`);
    return false;
  }
  state.findingIds = (inserted ?? []).map((row) => row.id);
  record("reviewer records findings", state.findingIds.length === 2);

  const { error: acceptError } = await reviewer
    .from("findings")
    .update({ status: "accepted" })
    .eq("id", state.findingIds[0]);
  record("reviewer accepts a finding", !acceptError, acceptError?.message ?? "");

  const { error: decisionError } = await reviewer
    .from("content_submissions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", state.submissionId);
  if (decisionError) {
    record("reviewer approves the submission", false, decisionError.message);
    return false;
  }

  const { data: after, error: afterError } = await reviewer
    .from("content_submissions")
    .select("status")
    .eq("id", state.submissionId)
    .single();
  record("reviewer approves the submission", !afterError && after?.status === "approved");

  const { data: findingAfter } = await reviewer
    .from("findings")
    .select("status")
    .eq("id", state.findingIds[0])
    .single();
  record("accepted finding is persisted", findingAfter?.status === "accepted");
  return true;
}

async function isolationChecks() {
  const { data: anonRows, error: anonError } = await anon
    .from("content_submissions")
    .select("id")
    .eq("id", state.submissionId);
  record("anonymous visitors cannot read submissions", !anonError && (anonRows?.length ?? 0) === 0);

  const { error: creatorFindingError } = await creator.from("findings").insert({
    submission_id: state.submissionId,
    type: "terminology",
    severity: "low",
    message: "creator should not be able to write findings",
  });
  record("creator cannot insert findings", Boolean(creatorFindingError));

  const { data: creatorKit, error: creatorKitError } = await creator
    .from("brand_kits")
    .select("id")
    .eq("id", state.kitId);
  record("creator still sees their own kit", !creatorKitError && (creatorKit?.length ?? 0) === 1);
}

async function cleanup() {
  if (!admin) {
    console.log(
      "\nNo service-role key: test users and data were left in the project. " +
        "Sign in as the creator to delete the verification kit, or remove the users in the dashboard."
    );
    return;
  }
  if (state.findingIds.length) {
    await admin.from("findings").delete().in("id", state.findingIds);
  }
  if (state.submissionId) {
    await admin.from("content_submissions").delete().eq("id", state.submissionId);
  }
  if (state.kitId) {
    await admin.from("brand_kits").delete().eq("id", state.kitId);
  }
  for (const id of [state.creatorId, state.reviewerId].filter(Boolean)) {
    await admin.auth.admin.deleteUser(id);
  }
  record("cleaned up test users and data", true);
}

try {
  console.log("BrandLens · Supabase flow verification");
  console.log(`project: ${new URL(url).host}`);
  if (!serviceKey) console.log("service key: absent (signup path + no automatic cleanup)");

  if (!(await schemaCheck())) {
    fail(
      "The schema is incomplete. Run the SQL files in supabase/migrations in order " +
        "(SQL Editor → paste → Run): 20240101000001, then 20240101000002, then 20240101000003."
    );
  }
  if (!(await makeUsers())) {
    await cleanup();
    fail("Could not create the test accounts; see the failure above.");
  }
  if (!(await signIn(creator, creatorEmail, "creator"))) fail("Sign-in failed.");
  if (!(await signIn(reviewer, reviewerEmail, "reviewer"))) fail("Sign-in failed.");

  if (await creatorFlow()) {
    await reviewerFlow();
    await isolationChecks();
  }
  await cleanup();

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  if (failed > 0) {
    console.error(`${failed} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("Flow verified: creator submits → reviewer cites, decides → state persisted.");
  }
} catch (error) {
  if (!(error instanceof ExitSignal)) {
    console.error(error);
    process.exitCode = 1;
  }
}
