create table if not exists public.salute_living_with_art_speaker_selections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.salute_event_pages(id) on delete cascade,
  guest_response_id uuid not null references public.salute_event_responses(id) on delete cascade,
  speaker_user_id uuid not null references auth.users(id) on delete cascade,
  sit_near boolean not null default false,
  of_interest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (speaker_user_id, event_id, guest_response_id)
);

alter table public.salute_living_with_art_speaker_selections enable row level security;

revoke all on public.salute_living_with_art_speaker_selections from anon;
grant select, insert, update on public.salute_living_with_art_speaker_selections to authenticated;
grant all on public.salute_living_with_art_speaker_selections to service_role;

insert into public.salute_event_viewer_access (email, scope, active, updated_at)
values
  ('kinjil.mathur@gmail.com', 'living_with_art_speaker', true, now()),
  ('melissa@mjosephstudio.com', 'living_with_art_speaker', true, now()),
  ('ispadder@gmail.com', 'living_with_art_speaker', true, now())
on conflict (email, scope) do update set active = true, updated_at = now();

drop policy if exists living_with_art_speaker_select_own on public.salute_living_with_art_speaker_selections;
create policy living_with_art_speaker_select_own
  on public.salute_living_with_art_speaker_selections
  for select to authenticated
  using (
    speaker_user_id = auth.uid()
    and (select private.has_salute_event_scope('living_with_art_speaker'))
  );

drop policy if exists living_with_art_speaker_insert_own on public.salute_living_with_art_speaker_selections;
create policy living_with_art_speaker_insert_own
  on public.salute_living_with_art_speaker_selections
  for insert to authenticated
  with check (
    speaker_user_id = auth.uid()
    and (select private.has_salute_event_scope('living_with_art_speaker'))
    and exists (
      select 1 from public.salute_event_pages event
      where event.id = event_id and event.slug = 'livingwithart'
    )
    and exists (
      select 1 from public.salute_event_responses response
      where response.id = guest_response_id
        and response.event_id = event_id
        and (
          (response.response_type = 'rsvp' and response.rsvp_status = 'accept')
          or (response.response_type = 'interest' and response.review_status = 'approved')
        )
    )
  );

drop policy if exists living_with_art_speaker_update_own on public.salute_living_with_art_speaker_selections;
create policy living_with_art_speaker_update_own
  on public.salute_living_with_art_speaker_selections
  for update to authenticated
  using (
    speaker_user_id = auth.uid()
    and (select private.has_salute_event_scope('living_with_art_speaker'))
  )
  with check (
    speaker_user_id = auth.uid()
    and (select private.has_salute_event_scope('living_with_art_speaker'))
  );

create or replace function public.get_living_with_art_speaker_guests()
returns table (
  event_id uuid,
  guest_response_id uuid,
  full_name text,
  email text,
  job_title text,
  company text,
  purchase_intent text,
  sit_near boolean,
  of_interest boolean
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_salute_event_scope('living_with_art_speaker') then
    raise insufficient_privilege using message = 'Not authorized for this dashboard';
  end if;

  return query
  select
    response.event_id,
    response.id,
    response.full_name,
    nullif(btrim(response.email), ''),
    nullif(btrim(response.job_title), ''),
    nullif(btrim(response.company), ''),
    response.purchase_intent,
    coalesce(selection.sit_near, false),
    coalesce(selection.of_interest, false)
  from public.salute_event_responses response
  join public.salute_event_pages event on event.id = response.event_id
  left join public.salute_living_with_art_speaker_selections selection
    on selection.event_id = response.event_id
   and selection.guest_response_id = response.id
   and selection.speaker_user_id = auth.uid()
  where event.slug = 'livingwithart'
    and (
      (response.response_type = 'rsvp' and response.rsvp_status = 'accept')
      or (response.response_type = 'interest' and response.review_status = 'approved')
    )
  order by response.full_name;
end;
$$;

revoke all on function public.get_living_with_art_speaker_guests() from public, anon;
grant execute on function public.get_living_with_art_speaker_guests() to authenticated;

update public.salute_event_responses
set email = 'sehrthadhani@gmail.com', normalized_email = 'sehrthadhani@gmail.com', updated_at = now()
where event_id = (select id from public.salute_event_pages where slug = 'livingwithart')
  and lower(full_name) = 'sehr thadhani'
  and coalesce(btrim(email), '') = '';
