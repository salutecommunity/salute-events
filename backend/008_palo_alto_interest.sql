alter table public.salute_on_the_table_interests
  add column if not exists linkedin_url text,
  add column if not exists availability text,
  add column if not exists source_event text;

alter table public.salute_on_the_table_interests
  drop constraint if exists salute_on_the_table_interests_city_check;

alter table public.salute_on_the_table_interests
  add constraint salute_on_the_table_interests_city_check
  check (city in ('San Francisco','Palo Alto','Washington, D.C.','Boston','New York','Chicago','Atlanta','Dallas','Los Angeles'));

alter table public.salute_on_the_table_interests
  add constraint salute_on_the_table_interests_linkedin_url_check
  check (linkedin_url is null or char_length(linkedin_url) <= 500);

alter table public.salute_on_the_table_interests
  add constraint salute_on_the_table_interests_availability_check
  check (availability is null or availability in ('can_attend_october_14','future_interest'));

alter table public.salute_on_the_table_interests
  add constraint salute_on_the_table_interests_source_event_check
  check (source_event is null or char_length(source_event) <= 100);
