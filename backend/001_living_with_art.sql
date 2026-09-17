create table if not exists public.salute_event_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null,
  series_name text,
  starts_at timestamptz,
  timezone text not null default 'America/New_York',
  venue_name text,
  status text not null default 'draft' check (status in ('draft','open','closed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salute_event_invitees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.salute_event_pages(id) on delete cascade,
  full_name text,
  email text not null,
  normalized_email text not null,
  active boolean not null default true,
  source text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, normalized_email),
  check (normalized_email = lower(btrim(normalized_email)))
);

create table if not exists public.salute_event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.salute_event_pages(id) on delete cascade,
  response_type text not null check (response_type in ('rsvp','interest')),
  full_name text not null,
  email text not null,
  normalized_email text not null,
  job_title text not null,
  company text not null,
  rsvp_status text check (rsvp_status in ('accept','decline')),
  purchase_intent text not null check (purchase_intent in ('actively_looking','beginning_to_explore','within_one_year','not_at_this_time')),
  consultation_interest text not null check (consultation_interest in ('yes','maybe','no')),
  has_dietary_restrictions boolean,
  dietary_details text,
  interest_note text,
  consent_accepted boolean not null check (consent_accepted),
  privacy_version text not null,
  terms_version text not null,
  media_release_version text not null,
  user_agent text,
  submission_count integer not null default 1 check (submission_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, response_type, normalized_email),
  check (normalized_email = lower(btrim(normalized_email))),
  check ((response_type = 'rsvp' and rsvp_status is not null) or (response_type = 'interest' and rsvp_status is null)),
  check ((has_dietary_restrictions is true and nullif(btrim(dietary_details), '') is not null) or has_dietary_restrictions is not true)
);

alter table public.salute_event_pages enable row level security;
alter table public.salute_event_invitees enable row level security;
alter table public.salute_event_responses enable row level security;

insert into public.salute_event_pages (slug, title, series_name, starts_at, timezone, venue_name, status)
values ('livingwithart', 'Living with Art', 'ON THE TABLE', '2026-10-07 22:30:00+00', 'America/New_York', 'FARZI NYC', 'draft')
on conflict (slug) do update set
  title = excluded.title,
  series_name = excluded.series_name,
  starts_at = excluded.starts_at,
  timezone = excluded.timezone,
  venue_name = excluded.venue_name,
  updated_at = now();

comment on table public.salute_event_pages is 'Public SALUTE event-page configuration; all access remains server-side.';
comment on table public.salute_event_invitees is 'Private approved invitation list for SALUTE event pages.';
comment on table public.salute_event_responses is 'Private RSVP and prospective-guest submissions received through SALUTE event pages.';
