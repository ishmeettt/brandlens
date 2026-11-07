-- BrandLens — complete schema (migrations 0001, 0002, 0003 in order).
-- Source of truth stays supabase/migrations/; this file mirrors them.


-- ============================================================
-- supabase/migrations/20240101000001_foundational_tables.sql
-- ============================================================

-- BrandLens foundational schema: roles, brand kits, submissions, findings.
--
-- Order matters here. PostgreSQL validates the body of a `language sql`
-- function when it is created, so the helper functions must come after the
-- tables they read. Policies are created last, once both exist.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null default 'creator' check (role in ('creator', 'manager', 'reviewer', 'admin')),
  organization text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ---------------------------------------------------------------- brand kits
-- organization_id stores the profile id that owns this brand kit.
create table if not exists public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_id uuid references public.profiles(id) on delete cascade,
  guidelines jsonb, -- structured brand guidelines
  facts jsonb, -- approved facts/claims
  glossary jsonb, -- preferred/banned terms
  palette jsonb, -- color palette
  logo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ------------------------------------------------------- content submissions
-- Content going through the review workflow.
create table if not exists public.content_submissions (
  id uuid primary key default gen_random_uuid(),
  brand_kit_id uuid references public.brand_kits on delete cascade,
  title text not null,
  content_type text not null check (content_type in ('text', 'image', 'pdf', 'docx')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected')),
  text_content text, -- for text content
  image_url text, -- for image content
  pdf_url text, -- for PDF/DOCX content
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ---------------------------------------------------------------- findings
-- Automated review findings; each one should carry a citation.
create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.content_submissions on delete cascade,
  type text not null check (type in ('terminology', 'claim', 'colour', 'contrast', 'alt_text', 'logo', 'custom')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  message text not null,
  citation text, -- reference to guideline clause or fact
  source_passage text, -- the brand kit passage that triggered this finding
  intent_summary text, -- what the creator intended to convey
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ---------------------------------------------------------------- helpers
-- Security definer so policy checks on profiles do not recurse into the
-- profiles policies themselves.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.get_user_organization()
returns text
language sql
security definer
set search_path = public
as $$
  select organization from public.profiles where id = auth.uid();
$$;

grant execute on function public.is_admin to authenticated;
grant execute on function public.get_user_organization to authenticated;
grant usage on schema public to authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.brand_kits enable row level security;
alter table public.content_submissions enable row level security;
alter table public.findings enable row level security;

-- profiles
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Admins can manage all profiles" on public.profiles
  for all using (is_admin());

create policy "Creators can insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- brand kits
create policy "Users can view own brand kit" on public.brand_kits
  for select using (organization_id = auth.uid());

create policy "Admins can manage brand kits" on public.brand_kits
  for all using (is_admin());

-- content submissions
create policy "Users can manage own submissions" on public.content_submissions
  for all using (
    exists (
      select 1 from public.profiles where id = auth.uid()
    )
  );

create policy "Managers/Reviewers can view org submissions" on public.content_submissions
  for select using (
    exists (
      select 1 from public.profiles where id = auth.uid() and role in ('manager', 'reviewer')
    )
  );

-- findings
create policy "Creators can view findings for own submissions" on public.findings
  for select using (
    exists (
      select 1
      from public.content_submissions s
      join public.brand_kits k on k.id = s.brand_kit_id
      where s.id = findings.submission_id
        and k.organization_id = auth.uid()
    )
  );

create policy "Managers/Reviewers can view all findings" on public.findings
  for select using (
    exists (
      select 1 from public.profiles where id = auth.uid() and role in ('manager', 'reviewer')
    )
  );

create policy "Admins can manage all findings" on public.findings
  for all using (is_admin());

create policy "Reviewers can update findings" on public.findings
  for update using (
    exists (
      select 1 from public.profiles where id = auth.uid() and role = 'reviewer'
    )
  );


-- ============================================================
-- supabase/migrations/20240101000002_ui_support.sql
-- ============================================================

-- Support for the BrandLens workspace UI
-- Adds: profile email + signup trigger, finding fix suggestions,
-- corrected policies, and the storage buckets the forms upload to.

-- ---------------------------------------------------------------- columns
alter table public.profiles add column if not exists email text;
alter table public.findings add column if not exists suggestion text;

-- ---------------------------------------------------------------- helpers
-- Use auth.uid() so the policies actually evaluate for the signed-in user.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.is_admin to authenticated;
grant execute on function public.current_user_role to authenticated;

-- ---------------------------------------------------------------- profiles
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Reviewers can view org profiles" on public.profiles;
create policy "Reviewers can view org profiles" on public.profiles
  for select using (public.current_user_role() in ('reviewer', 'admin', 'manager'));

-- Create the profile row automatically on signup, keeping the role chosen in
-- the sign-up form (passed as auth metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, organization)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'creator'),
    new.raw_user_meta_data->>'organization'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- brand kits
drop policy if exists "Users can view own brand kit" on public.brand_kits;
create policy "Users can view own brand kit" on public.brand_kits
  for select using (organization_id = auth.uid() or public.is_admin());

drop policy if exists "Users can manage own brand kit" on public.brand_kits;
create policy "Users can manage own brand kit" on public.brand_kits
  for all using (organization_id = auth.uid() or public.is_admin())
  with check (organization_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- findings
drop policy if exists "Reviewers can insert findings" on public.findings;
create policy "Reviewers can insert findings" on public.findings
  for insert with check (public.current_user_role() in ('reviewer', 'admin'));

drop policy if exists "Reviewers can update findings" on public.findings;
create policy "Reviewers can update findings" on public.findings
  for update using (public.current_user_role() in ('reviewer', 'admin'));

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values
  ('brand-kit-logos', 'brand-kit-logos', true),
  ('content-submissions', 'content-submissions', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated can upload brand assets" on storage.objects;
create policy "Authenticated can upload brand assets" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('brand-kit-logos', 'content-submissions'));

drop policy if exists "Public can read brand assets" on storage.objects;
create policy "Public can read brand assets" on storage.objects
  for select using (bucket_id in ('brand-kit-logos', 'content-submissions'));


-- ============================================================
-- supabase/migrations/20240101000003_rls_hardening.sql
-- ============================================================

-- BrandLens: make the creator → reviewer → decision flow work across accounts,
-- and replace the placeholder policies from the first migration with checks
-- that use auth.uid().

-- ---------------------------------------------------------------- helpers
create or replace function public.get_user_organization()
returns text
language sql
security definer
set search_path = public
as $$
  select organization from public.profiles where id = auth.uid();
$$;

grant execute on function public.get_user_organization to authenticated;

-- Clamp signup metadata to a known role so a bad value cannot break signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, organization)
  values (
    new.id,
    new.email,
    case
      when new.raw_user_meta_data->>'role' in ('creator', 'manager', 'reviewer', 'admin')
        then new.raw_user_meta_data->>'role'
      else 'creator'
    end,
    new.raw_user_meta_data->>'organization'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- ---------------------------------------------------------------- brand kits
-- A reviewer works across the workspace, so they must be able to read the kit
-- that a submission was written against. Without this no citation can resolve.
drop policy if exists "Users can view own brand kit" on public.brand_kits;
create policy "Owners and reviewers can view brand kits" on public.brand_kits
  for select using (
    organization_id = auth.uid()
    or public.current_user_role() in ('reviewer', 'manager', 'admin')
  );

-- ------------------------------------------------------ content submissions
-- The first migration let any profile manage every submission. Replace it with
-- ownership scoping plus explicit reviewer/admin access.
drop policy if exists "Users can manage own submissions" on public.content_submissions;
drop policy if exists "Managers/Reviewers can view org submissions" on public.content_submissions;

drop policy if exists "Creators manage own submissions" on public.content_submissions;
create policy "Creators manage own submissions" on public.content_submissions
  for all
  using (
    brand_kit_id in (select id from public.brand_kits where organization_id = auth.uid())
  )
  with check (
    brand_kit_id in (select id from public.brand_kits where organization_id = auth.uid())
  );

drop policy if exists "Review team can view submissions" on public.content_submissions;
create policy "Review team can view submissions" on public.content_submissions
  for select using (public.current_user_role() in ('reviewer', 'manager', 'admin'));

drop policy if exists "Reviewers can update submissions" on public.content_submissions;
create policy "Reviewers can update submissions" on public.content_submissions
  for update
  using (public.current_user_role() in ('reviewer', 'admin'))
  with check (public.current_user_role() in ('reviewer', 'admin'));

-- ---------------------------------------------------------------- findings
-- The original creator policy joined through profiles.organization (text) as a
-- uuid, which errors. Scope it to the submission's brand-kit owner instead.
drop policy if exists "Creators can view findings for own submissions" on public.findings;
create policy "Creators can view findings for own submissions" on public.findings
  for select using (
    exists (
      select 1
      from public.content_submissions s
      join public.brand_kits k on k.id = s.brand_kit_id
      where s.id = findings.submission_id
        and k.organization_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------- storage
-- Uploads are only allowed inside the user's own folder.
drop policy if exists "Authenticated can upload brand assets" on storage.objects;
create policy "Authenticated can upload brand assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('brand-kit-logos', 'content-submissions')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public can read brand assets" on storage.objects;
create policy "Public can read brand assets" on storage.objects
  for select using (bucket_id in ('brand-kit-logos', 'content-submissions'));

