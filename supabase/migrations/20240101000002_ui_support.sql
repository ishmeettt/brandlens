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
