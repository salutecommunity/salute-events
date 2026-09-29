create table if not exists public.salute_on_the_table_interests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 320),
  normalized_email text not null unique check (normalized_email = lower(btrim(normalized_email))),
  city text not null check (city in ('San Francisco','Washington, D.C.','Boston','New York','Chicago','Atlanta','Dallas','Los Angeles')),
  job_title text not null check (char_length(job_title) between 1 and 200),
  company text not null check (char_length(company) between 1 and 200),
  involvement text[] not null default '{}' check (
    cardinality(involvement) between 0 and 3
    and involvement <@ array['attend','host_or_cohost','partner_or_sponsor']::text[]
  ),
  themes text check (themes is null or char_length(themes) <= 1500),
  consent_accepted boolean not null check (consent_accepted),
  privacy_version text not null default 'salute-privacy-2026-09-02',
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  submission_count integer not null default 1 check (submission_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salute_on_the_table_interests enable row level security;
revoke all on public.salute_on_the_table_interests from anon, authenticated;
grant select on public.salute_on_the_table_interests to authenticated;
grant select, insert, update on public.salute_on_the_table_interests to service_role;

drop policy if exists salute_on_the_table_interests_staff_read on public.salute_on_the_table_interests;
create policy salute_on_the_table_interests_staff_read
  on public.salute_on_the_table_interests for select to authenticated
  using ((select private.has_staff_role(array['admin','event_manager','read_only'])));

create index if not exists salute_on_the_table_interests_updated_at_idx on public.salute_on_the_table_interests (updated_at desc);
