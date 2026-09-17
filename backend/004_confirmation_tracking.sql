alter table public.salute_event_responses
  add column if not exists confirmation_status text not null default 'not_triggered'
    check (confirmation_status in ('not_triggered','trigger_accepted','trigger_failed')),
  add column if not exists confirmation_triggered_at timestamptz;
