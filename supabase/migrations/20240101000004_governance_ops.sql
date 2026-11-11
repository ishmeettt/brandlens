-- 0004 — ownership, due dates, per-rule attribution and an append-only audit feed.
--
-- Everything here is additive: `if not exists` on every column and table, and
-- the app reads these columns only when the workspace returns them. Apply it in
-- the Supabase SQL editor (the service key used by `npm run verify:supabase`
-- cannot run DDL).

-- ---------------------------------------------------------------- ownership
alter table public.content_submissions
  add column if not exists owner_id uuid references public.profiles (id) on delete set null;

-- A stored target beats the SLA policy derivation: the reviewer committed to it.
alter table public.content_submissions
  add column if not exists due_at timestamptz;

create index if not exists content_submissions_owner_idx
  on public.content_submissions (owner_id);

create index if not exists content_submissions_due_idx
  on public.content_submissions (due_at)
  where due_at is not null;

-- ---------------------------------------------------------------- findings
-- The rule that raised a finding, and who decided it. Without these, per-rule
-- precision and reviewer attribution are recovered by re-running the engine
-- and shown as unattributed.
alter table public.findings
  add column if not exists rule_id text;

alter table public.findings
  add column if not exists reviewed_by text;

alter table public.findings
  add column if not exists reviewed_at timestamptz;

create index if not exists findings_rule_idx
  on public.findings (rule_id)
  where rule_id is not null;

-- ---------------------------------------------------------------- audit feed
-- Append-only by trigger: the hash chain makes edits detectable, the trigger
-- makes them impossible through the API.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  submission_id uuid references public.content_submissions (id) on delete set null,
  finding_id uuid,
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists audit_events_org_created_idx
  on public.audit_events (organization_id, created_at);

create or replace function public.audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

drop trigger if exists audit_events_no_change on public.audit_events;
create trigger audit_events_no_change
  before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();

alter table public.audit_events enable row level security;

-- organization_id mirrors brand_kits.organization_id, which is the owning
-- auth user; a submission's kit is the second route in for reviewers.
drop policy if exists "Organizations can read their audit events" on public.audit_events;
create policy "Organizations can read their audit events"
  on public.audit_events
  for select
  using (
    public.is_admin()
    or organization_id = auth.uid()
    or exists (
      select 1
      from public.content_submissions s
      join public.brand_kits k on k.id = s.brand_kit_id
      where s.id = audit_events.submission_id
        and k.organization_id = auth.uid()
    )
  );

drop policy if exists "Members can append audit events" on public.audit_events;
create policy "Members can append audit events"
  on public.audit_events
  for insert
  with check (public.is_admin() or organization_id = auth.uid());
