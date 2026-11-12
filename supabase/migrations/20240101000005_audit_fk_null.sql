-- 0005 — let the submission foreign key clear itself without breaking the feed.
--
-- `audit_events.submission_id` is `on delete set null`, but deleting a
-- submission performs an UPDATE on the event row, and the append-only trigger
-- from 0004 rejects every update. The result was that a reviewed submission
-- could never be deleted, and `npm run seed:demo` (which resets the workspace
-- by deleting its brand kit) failed once any event existed.
--
-- This narrows the rule to the one update the database itself performs: the
-- submission link may clear when the submission is gone, and nothing else may
-- change. Edits, retimestamps and deletes are still refused.

create or replace function public.audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'audit_events is append-only';
  end if;

  -- Only the submission link may clear, and only because that submission no
  -- longer exists: every other column must be identical.
  if NEW.submission_id is null
     and OLD.submission_id is not null
     and (to_jsonb(NEW) - 'submission_id') = (to_jsonb(OLD) - 'submission_id') then
    return NEW;
  end if;

  raise exception 'audit_events is append-only';
end;
$$;
