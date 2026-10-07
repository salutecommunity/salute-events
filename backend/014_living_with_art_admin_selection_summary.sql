create or replace function public.get_living_with_art_admin_selection_summary()
returns table (
  reviewer_email text,
  guest_name text,
  sit_near boolean,
  of_interest boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, auth, pg_temp
as $$
begin
  if auth.uid() is null
     or lower(coalesce(auth.jwt() ->> 'email','')) <> 'hello@salute.community'
     or not private.has_salute_event_scope('living_with_art_speaker') then
    raise insufficient_privilege using message = 'Not authorized for the SALUTE admin view';
  end if;

  return query
  select
    lower(reviewer.email)::text,
    guest.full_name,
    selection.sit_near,
    selection.of_interest,
    selection.updated_at
  from public.salute_living_with_art_speaker_selections selection
  join auth.users reviewer on reviewer.id=selection.speaker_user_id
  join public.salute_event_responses guest on guest.id=selection.guest_response_id
  join public.salute_event_pages event on event.id=selection.event_id
  where event.slug='livingwithart'
    and lower(reviewer.email) in (
      'kinjil.mathur@gmail.com',
      'melissa@mjosephstudio.com',
      'ispadder@gmail.com'
    )
    and (selection.sit_near or selection.of_interest)
  order by lower(reviewer.email), guest.full_name;
end;
$$;

revoke all on function public.get_living_with_art_admin_selection_summary() from public, anon, authenticated;
grant execute on function public.get_living_with_art_admin_selection_summary() to authenticated;
