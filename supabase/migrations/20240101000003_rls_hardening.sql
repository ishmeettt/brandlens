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
