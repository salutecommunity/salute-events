create table if not exists public.salute_art_interests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  normalized_email text not null unique check (normalized_email = lower(btrim(normalized_email))),
  city text,
  job_title text not null,
  company text not null,
  relationship_to_art text not null check (relationship_to_art in ('actively_collecting','ready_to_purchase','beginning_to_explore','learning_and_curious')),
  interests text[] not null check (
    cardinality(interests) between 1 and 6
    and interests <@ array['gallery_tours','artist_meet_greets','collector_dinners','collecting_conversations','art_fairs','advisor_sessions']::text[]
  ),
  notes text,
  consent_accepted boolean not null check (consent_accepted),
  privacy_version text not null default 'salute-privacy-2026-09-02',
  user_agent text,
  submission_count integer not null default 1 check (submission_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salute_art_interests enable row level security;
revoke all on public.salute_art_interests from anon, authenticated;
grant select on public.salute_art_interests to authenticated;

drop policy if exists salute_art_interests_staff_read on public.salute_art_interests;
create policy salute_art_interests_staff_read
  on public.salute_art_interests for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

create index if not exists salute_art_interests_updated_at_idx on public.salute_art_interests (updated_at desc);
