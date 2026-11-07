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
