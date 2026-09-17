create table if not exists public.salute_event_admin_allowlist (
  email text primary key check (email = lower(btrim(email))),
  role text not null default 'event_manager' check (role in ('admin','event_manager','read_only')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.salute_event_admin_allowlist enable row level security;

insert into public.salute_event_admin_allowlist (email, role, active)
values ('neha@salute.community', 'admin', true)
on conflict (email) do update set role = excluded.role, active = true;

create or replace function public.provision_salute_event_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed_role text;
begin
  select role into allowed_role
  from public.salute_event_admin_allowlist
  where email = lower(btrim(new.email)) and active = true;

  if allowed_role is not null then
    insert into public.staff_members (user_id, role, active, updated_at)
    values (new.id, allowed_role, true, now())
    on conflict (user_id) do update set
      role = excluded.role,
      active = true,
      updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.provision_salute_event_admin() from public;

drop trigger if exists salute_event_admin_user_created on auth.users;
create trigger salute_event_admin_user_created
  after insert or update of email on auth.users
  for each row execute function public.provision_salute_event_admin();

insert into public.staff_members (user_id, role, active, updated_at)
select u.id, a.role, true, now()
from auth.users u
join public.salute_event_admin_allowlist a on a.email = lower(btrim(u.email)) and a.active = true
on conflict (user_id) do update set role = excluded.role, active = true, updated_at = now();
