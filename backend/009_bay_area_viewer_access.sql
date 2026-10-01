create table if not exists public.salute_event_viewer_access (
  email text not null check (email = lower(btrim(email))),
  scope text not null check (char_length(scope) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, scope)
);

alter table public.salute_event_viewer_access enable row level security;
revoke all on public.salute_event_viewer_access from anon, authenticated;
grant select, insert, update, delete on public.salute_event_viewer_access to service_role;

insert into public.salute_event_viewer_access (email, scope, active, updated_at)
values ('skrothapalli@gmail.com', 'ott_bay_area', true, now())
on conflict (email, scope) do update set active = true, updated_at = now();

create or replace function private.has_salute_event_scope(requested_scope text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.salute_event_viewer_access access
    where access.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and access.scope = requested_scope
      and access.active = true
  );
$$;

revoke all on function private.has_salute_event_scope(text) from public;
grant execute on function private.has_salute_event_scope(text) to authenticated;

drop policy if exists salute_on_the_table_interests_bay_area_viewer_read on public.salute_on_the_table_interests;
create policy salute_on_the_table_interests_bay_area_viewer_read
  on public.salute_on_the_table_interests
  for select
  to authenticated
  using (
    source_event = 'palo_alto_2026_10_14'
    and (select private.has_salute_event_scope('ott_bay_area'))
  );
