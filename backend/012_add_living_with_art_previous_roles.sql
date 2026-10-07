alter table public.salute_living_with_art_guest_briefs
  add column if not exists previous_roles text;

with previous_data as (
  select * from jsonb_to_recordset('[{"email": "raza.aima@gmail.com", "previous_roles": null}, {"email": "amna@audeliss.com", "previous_roles": "Before joining Audeliss in 2019, she worked across education, healthcare, and luxury start-ups in developed and emerging markets."}, {"email": "anjali.virmani@gmail.com", "previous_roles": "Her previous experience includes serving as Global Head of Creative Solutions at Time Out Media."}, {"email": "studio@anoushkamirchandani.com", "previous_roles": null}, {"email": "anouska.biswas@gmail.com", "previous_roles": null}, {"email": "cherylkarim1@gmail.com", "previous_roles": "Earlier roles at Gallagher included Area Senior Vice President before she became National Practice Leader and Managing Director for Fine Arts."}, {"email": "kavita.gupta2017@gmail.com", "previous_roles": "She previously served as the founding managing partner of ConsenSys Ventures and has experience connected to the World Bank."}, {"email": "kinjil.mathur@gmail.com", "previous_roles": "Before leading marketing at Squarespace, she spent a decade in fashion and retail helping established brands adapt to modern commerce."}, {"email": "madhu.g.southworth@gmail.com", "previous_roles": "Her earlier legal and business-affairs leadership includes work with AMC Networks and SundanceTV."}, {"email": "melissa@mjosephstudio.com", "previous_roles": null}, {"email": "mona@reframewithmona.com", "previous_roles": "She previously founded and led Motivate Design, a user-experience agency, and UX Hires, a recruiting firm focused on user experience."}, {"email": "monica.issar@blackstone.com", "previous_roles": "Before Blackstone, she was Managing Director and Global Head of Multi-Asset and Portfolio Solutions at J.P. Morgan Global Private Bank."}, {"email": "nehaksingh@gmail.com", "previous_roles": null}, {"email": "netashajadon@gmail.com", "previous_roles": "Her earlier experience includes work in financial intelligence and related analytical roles."}, {"email": "nikila.s.srinivasan@gmail.com", "previous_roles": "She previously served as Vice President and General Manager for Business Messaging and AI at Meta, leading products across WhatsApp, Messenger, and Instagram Direct."}, {"email": "nmphoto101@gmail.com", "previous_roles": null}, {"email": "rkshah28@gmail.com", "previous_roles": "Her earlier legal career includes work in BigLaw and service as a prosecutor."}, {"email": "rashmi.gupta@jpmorgan.com", "previous_roles": "She has more than 20 years of experience across capital markets and global investment management."}, {"email": "rebecca@the-well.com", "previous_roles": "Before founding THE WELL, she spent roughly a decade in finance, including senior experience at Deutsche Bank."}, {"email": "ispadder@gmail.com", "previous_roles": null}, {"email": "sana@theramadanedit.com", "previous_roles": null}, {"email": "bokharisanie@gmail.com", "previous_roles": null}, {"email": "sehrthadhani@gmail.com", "previous_roles": "Her prior senior executive and advisory roles include work with Google, NBC, Viacom, Silicon Foundry, and Edelman Digital."}, {"email": "shama85@gmail.com", "previous_roles": "Before founding Aray Marketing, she held marketing roles at Bloomberg and Citi."}, {"email": "sreddy9@gmail.com", "previous_roles": "Her prior experience includes roles at Donna Karan, Morgan Stanley, UBS, and Lehman Brothers."}, {"email": "zainabareejm@gmail.com", "previous_roles": "Her earlier fundraising and communications work includes roles with Sakhi for South Asian Survivors and The Citizens Foundation USA."}]'::jsonb)
    as x(email text, previous_roles text)
), event as (
  select id from public.salute_event_pages where slug='livingwithart'
)
update public.salute_living_with_art_guest_briefs profile
set previous_roles=previous_data.previous_roles, updated_at=now()
from previous_data
join public.salute_event_responses response on lower(response.email)=previous_data.email
join event on event.id=response.event_id
where profile.guest_response_id=response.id;

drop function if exists public.get_living_with_art_speaker_guests();
create function public.get_living_with_art_speaker_guests()
returns table (
  event_id uuid,
  guest_response_id uuid,
  full_name text,
  email text,
  job_title text,
  company text,
  purchase_intent text,
  brief text,
  previous_roles text,
  source_url text,
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
  select response.event_id, response.id, response.full_name,
    nullif(btrim(response.email), ''), nullif(btrim(response.job_title), ''),
    nullif(btrim(response.company), ''), response.purchase_intent,
    profile.brief, profile.previous_roles, profile.source_url,
    coalesce(selection.sit_near, false), coalesce(selection.of_interest, false)
  from public.salute_event_responses response
  join public.salute_event_pages event on event.id=response.event_id
  left join public.salute_living_with_art_guest_briefs profile on profile.guest_response_id=response.id
  left join public.salute_living_with_art_speaker_selections selection
    on selection.event_id=response.event_id and selection.guest_response_id=response.id
   and selection.speaker_user_id=auth.uid()
  where event.slug='livingwithart'
    and ((response.response_type='rsvp' and response.rsvp_status='accept')
      or (response.response_type='interest' and response.review_status='approved'))
  order by response.full_name;
end;
$$;

revoke all on function public.get_living_with_art_speaker_guests() from public, anon;
grant execute on function public.get_living_with_art_speaker_guests() to authenticated;
