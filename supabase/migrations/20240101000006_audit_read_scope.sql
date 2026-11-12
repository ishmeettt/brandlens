-- 0006 — let reviewers read the feed they are allowed to append to.
--
-- 0004 let reviewers insert audit events but only let the workspace owner read
-- them. The app reads the newest hash before appending (that is how the chain
-- links), so a reviewer's insert saw an empty table and started a second chain
-- at the genesis hash: the feed then reported itself broken.
--
-- Reviewers and managers can already read every submission, so they can read
-- every event too. The client-supplied hash is not a security boundary — the
-- append-only trigger and the chain verify what was written — but a reviewer
-- must be able to see the head to extend it.

drop policy if exists "Organizations can read their audit events" on public.audit_events;
drop policy if exists "Workspace can read audit events" on public.audit_events;
create policy "Workspace can read audit events"
  on public.audit_events
  for select
  using (
    public.is_admin()
    or organization_id = auth.uid()
    or public.current_user_role() in ('reviewer', 'manager')
    or exists (
      select 1
      from public.content_submissions s
      join public.brand_kits k on k.id = s.brand_kit_id
      where s.id = audit_events.submission_id
        and k.organization_id = auth.uid()
    )
  );
