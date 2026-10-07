create table if not exists public.salute_living_with_art_guest_briefs (
  guest_response_id uuid primary key references public.salute_event_responses(id) on delete cascade,
  brief text not null,
  source_url text,
  updated_at timestamptz not null default now()
);

alter table public.salute_living_with_art_guest_briefs enable row level security;
revoke all on public.salute_living_with_art_guest_briefs from public, anon, authenticated;
grant all on public.salute_living_with_art_guest_briefs to service_role;

with profile_data as (
  select * from jsonb_to_recordset('[{"email": "raza.aima@gmail.com", "brief": "Aima Raza is affiliated with Peace Project.", "source_url": null}, {"email": "amna@audeliss.com", "brief": "Amna Khilji is Vice President for North America at Audeliss, an executive search and leadership consultancy.", "source_url": null}, {"email": "anjali.virmani@gmail.com", "brief": "Anjali Virmani is Senior Vice President of Business Development at BeautyMatter, a platform focused on the global beauty industry.", "source_url": null}, {"email": "studio@anoushkamirchandani.com", "brief": "Anoushka Mirchandani is a visual artist working through her independent studio.", "source_url": "https://www.anoushkamirchandani.com/"}, {"email": "anouska.biswas@gmail.com", "brief": "Anouska Biswas is Director of Finance at the James Beard Foundation.", "source_url": null}, {"email": "cherylkarim1@gmail.com", "brief": "Cheryl Karim is Managing Director of Fine Arts at Gallagher.", "source_url": null}, {"email": "kavita.gupta2017@gmail.com", "brief": "Kavita Gupta is the founder of Delta Blockchain Fund.", "source_url": null}, {"email": "kinjil.mathur@gmail.com", "brief": "Kinjil Mathur is an advisor and board member whose career spans culture and technology. A former Squarespace CMO, she is an active arts participant and collector who brings creative thinking and business leadership to cultural and community work.", "source_url": "https://events.salute.community/livingwithart/"}, {"email": "madhu.g.southworth@gmail.com", "brief": "Madhu Goel Southworth is Senior Vice President of Business & Technology, Legal & Business Affairs at Major League Baseball.", "source_url": null}, {"email": "melissa@mjosephstudio.com", "brief": "Melissa Joseph is a New York-based artist known for needle-felted paintings about family, history, materiality, place, and diasporic life. Her work is held by museums including the Brooklyn Museum, RISD Museum, and ICA Miami.", "source_url": "https://events.salute.community/livingwithart/"}, {"email": "mona@reframewithmona.com", "brief": "Mona Patel is an executive coach and the founder of Reframe with Mona.", "source_url": null}, {"email": "monica.issar@blackstone.com", "brief": "Monica Issar is a Senior Managing Director at Blackstone.", "source_url": null}, {"email": "nehaksingh@gmail.com", "brief": "Neha Singh is a Vice President at J.P. Morgan and a co-founder of SALUTE, where she helps build community and leadership programming for South Asian women and allies.", "source_url": null}, {"email": "netashajadon@gmail.com", "brief": "Netasha Jadon is a Director at JHP.", "source_url": null}, {"email": "nikila.s.srinivasan@gmail.com", "brief": "Nikila Srinivasan is an advisor and investor and a former Meta Vice President and General Manager for business messaging and AI.", "source_url": "https://www.linkedin.com/in/nikila"}, {"email": "nmphoto101@gmail.com", "brief": "Nivedha Meyyappan is a Partnerships Analyst with the United Nations Spotlight Initiative and has contributed photography to work centered on women, identity, and social impact.", "source_url": "https://www.linkedin.com/in/nivedha-meyyappan"}, {"email": "rkshah28@gmail.com", "brief": "Rachna Shah is the founder and General Counsel of External General Counsel LLC.", "source_url": null}, {"email": "rashmi.gupta@jpmorgan.com", "brief": "Rashmi Gupta is a Portfolio Manager at J.P. Morgan.", "source_url": null}, {"email": "rebecca@the-well.com", "brief": "Rebecca Parekh is Co-Founder and CEO of THE WELL, an integrated wellness company.", "source_url": null}, {"email": "ispadder@gmail.com", "brief": "Sadaf Padder is a Brooklyn-based independent curator and art advisor whose practice explores migration, ecology, material histories, and cultural memory. She supports artists through curatorial work, collection-building, writing, teaching, and institutional service.", "source_url": "https://events.salute.community/livingwithart/"}, {"email": "sana@theramadanedit.com", "brief": "Sana Raheem is CEO of Mubarak & Co.", "source_url": null}, {"email": "bokharisanie@gmail.com", "brief": "Sanie Bokhari is a visual artist working through Wedding Dress Studios.", "source_url": null}, {"email": "sehrthadhani@gmail.com", "brief": "Sehr Thadhani is Chief Digital Officer at Nasdaq, where she develops strategic initiatives spanning consumer engagement, client experience, market expansion, and brand strategy.", "source_url": "https://goldhouse.org/people/sehr-thadhani/"}, {"email": "shama85@gmail.com", "brief": "Shama Amin is the founder of Aray Marketing.", "source_url": null}, {"email": "sreddy9@gmail.com", "brief": "Sri Murthy is Head of ESG Reporting at Estée Lauder.", "source_url": null}, {"email": "zainabareejm@gmail.com", "brief": "Zainab Muzaffar is the founder of Impact Play Philanthropy.", "source_url": null}]'::jsonb)
    as x(email text, brief text, source_url text)
), event as (
  select id from public.salute_event_pages where slug='livingwithart'
)
insert into public.salute_living_with_art_guest_briefs (guest_response_id, brief, source_url, updated_at)
select response.id, profile_data.brief, profile_data.source_url, now()
from profile_data
join public.salute_event_responses response on lower(response.email)=profile_data.email
join event on event.id=response.event_id
on conflict (guest_response_id) do update
set brief=excluded.brief, source_url=excluded.source_url, updated_at=excluded.updated_at;

insert into public.salute_event_viewer_access (email, scope, active, updated_at)
values ('hello@salute.community','living_with_art_speaker',true,now())
on conflict (email, scope) do update set active=true, updated_at=now();

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
  select
    response.event_id,
    response.id,
    response.full_name,
    nullif(btrim(response.email), ''),
    nullif(btrim(response.job_title), ''),
    nullif(btrim(response.company), ''),
    response.purchase_intent,
    profile.brief,
    profile.source_url,
    coalesce(selection.sit_near, false),
    coalesce(selection.of_interest, false)
  from public.salute_event_responses response
  join public.salute_event_pages event on event.id = response.event_id
  left join public.salute_living_with_art_guest_briefs profile
    on profile.guest_response_id = response.id
  left join public.salute_living_with_art_speaker_selections selection
    on selection.event_id = response.event_id
   and selection.guest_response_id = response.id
   and selection.speaker_user_id = auth.uid()
  where event.slug = 'livingwithart'
    and (
      (response.response_type = 'rsvp' and response.rsvp_status = 'accept')
      or (response.response_type = 'interest' and response.review_status = 'approved')
    )
  order by response.full_name;
end;
$$;

revoke all on function public.get_living_with_art_speaker_guests() from public, anon;
grant execute on function public.get_living_with_art_speaker_guests() to authenticated;
