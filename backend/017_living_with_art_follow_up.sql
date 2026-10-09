create table if not exists public.living_with_art_follow_up_interests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default '4e4b6dbb-5ab3-4432-b000-eaf62f6be07f'::uuid,
  first_name text not null,
  last_name text not null,
  email text not null,
  normalized_email text not null unique,
  interests text[] not null,
  notes text,
  consent_accepted boolean not null default false,
  privacy_version text not null,
  user_agent text,
  submission_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint living_with_art_follow_up_interests_nonempty check (cardinality(interests) > 0)
);

alter table public.living_with_art_follow_up_interests enable row level security;

revoke all on public.living_with_art_follow_up_interests from anon, authenticated;
grant select, insert, update, delete on public.living_with_art_follow_up_interests to service_role;

create index if not exists living_with_art_follow_up_interests_updated_idx
  on public.living_with_art_follow_up_interests (updated_at desc);
