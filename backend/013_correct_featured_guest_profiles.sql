with event as (
  select id from public.salute_event_pages where slug='livingwithart'
)
update public.salute_event_responses response
set job_title='Artist', company='Melissa Joseph Studio', updated_at=now()
from event
where response.event_id=event.id
  and lower(response.email)='melissa@mjosephstudio.com';

with event as (
  select id from public.salute_event_pages where slug='livingwithart'
)
update public.salute_event_responses response
set job_title='Founder', company='Sarang Ventures', updated_at=now()
from event
where response.event_id=event.id
  and lower(response.email)='nikila.s.srinivasan@gmail.com';

with event as (
  select id from public.salute_event_pages where slug='livingwithart'
), profiles(email, brief, source_url) as (
  values
    ('melissa@mjosephstudio.com',
     'Melissa Joseph is a featured artist and speaker for Living with Art. A New York-based artist known for needle-felted paintings, her work examines family, history, materiality, place, and diasporic life and is held in permanent museum collections including the Brooklyn Museum, RISD Museum, and ICA Miami.',
     'https://events.salute.community/livingwithart/'),
    ('nikila.s.srinivasan@gmail.com',
     'Nikila Srinivasan is the founder of Sarang Ventures, where she works as an advisor and investor. She previously served as a Vice President and General Manager at Meta, leading business-messaging and AI products across WhatsApp, Messenger, and Instagram Direct.',
     'https://www.linkedin.com/in/nikila')
)
update public.salute_living_with_art_guest_briefs profile
set brief=profiles.brief, source_url=profiles.source_url, updated_at=now()
from profiles
join public.salute_event_responses response on lower(response.email)=profiles.email
join event on event.id=response.event_id
where profile.guest_response_id=response.id;
