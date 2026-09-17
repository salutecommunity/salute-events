alter table public.salute_event_responses
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'declined')),
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

create table if not exists public.salute_event_review_log (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.salute_event_responses(id) on delete cascade,
  event_id uuid not null references public.salute_event_pages(id) on delete cascade,
  prior_status text,
  new_status text not null,
  review_note text,
  reviewed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.salute_event_review_log enable row level security;

drop policy if exists salute_event_pages_staff_read on public.salute_event_pages;
create policy salute_event_pages_staff_read
  on public.salute_event_pages for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

drop policy if exists salute_event_invitees_staff_read on public.salute_event_invitees;
create policy salute_event_invitees_staff_read
  on public.salute_event_invitees for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

drop policy if exists salute_event_invitees_staff_manage on public.salute_event_invitees;
create policy salute_event_invitees_staff_manage
  on public.salute_event_invitees for all to authenticated
  using ((select private.has_staff_role(array['admin','event_manager'])))
  with check ((select private.has_staff_role(array['admin','event_manager'])));

drop policy if exists salute_event_responses_staff_read on public.salute_event_responses;
create policy salute_event_responses_staff_read
  on public.salute_event_responses for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

drop policy if exists salute_event_responses_staff_update on public.salute_event_responses;
create policy salute_event_responses_staff_update
  on public.salute_event_responses for update to authenticated
  using ((select private.has_staff_role(array['admin','event_manager'])))
  with check ((select private.has_staff_role(array['admin','event_manager'])));

drop policy if exists salute_event_review_log_staff_read on public.salute_event_review_log;
create policy salute_event_review_log_staff_read
  on public.salute_event_review_log for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

create or replace function public.review_salute_event_interest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.review_status is distinct from new.review_status then
    if new.response_type <> 'interest' then
      raise exception 'Only interest registrations can be approved or declined';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();

    insert into public.salute_event_review_log
      (response_id, event_id, prior_status, new_status, review_note, reviewed_by)
    values
      (new.id, new.event_id, old.review_status, new.review_status, new.review_note, auth.uid());

    if new.review_status = 'approved' then
      insert into public.salute_event_invitees
        (event_id, full_name, email, normalized_email, active, source, note, updated_at)
      values
        (new.event_id, new.full_name, new.email, new.normalized_email, true, 'approved_interest', new.review_note, now())
      on conflict (event_id, normalized_email) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        active = true,
        source = 'approved_interest',
        note = excluded.note,
        updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.review_salute_event_interest() from public;

drop trigger if exists salute_event_interest_reviewed on public.salute_event_responses;
create trigger salute_event_interest_reviewed
  before update of review_status on public.salute_event_responses
  for each row execute function public.review_salute_event_interest();

create index if not exists salute_event_responses_event_updated_idx
  on public.salute_event_responses (event_id, updated_at desc);
create index if not exists salute_event_responses_review_idx
  on public.salute_event_responses (event_id, response_type, review_status);
