create or replace function private.is_confirmed_living_with_art_guest(requested_event_id uuid, requested_response_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.salute_event_responses response
    join public.salute_event_pages event on event.id = response.event_id
    where response.id = requested_response_id
      and response.event_id = requested_event_id
      and event.slug = 'livingwithart'
      and (
        (response.response_type = 'rsvp' and response.rsvp_status = 'accept')
        or (response.response_type = 'interest' and response.review_status = 'approved')
      )
  );
$$;

revoke all on function private.is_confirmed_living_with_art_guest(uuid, uuid) from public;
grant execute on function private.is_confirmed_living_with_art_guest(uuid, uuid) to authenticated;

drop policy if exists living_with_art_speaker_insert_own on public.salute_living_with_art_speaker_selections;
create policy living_with_art_speaker_insert_own
  on public.salute_living_with_art_speaker_selections
  for insert to authenticated
  with check (
    speaker_user_id = auth.uid()
    and (select private.has_salute_event_scope('living_with_art_speaker'))
    and (select private.is_confirmed_living_with_art_guest(event_id, guest_response_id))
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
    and (select private.is_confirmed_living_with_art_guest(event_id, guest_response_id))
  );
