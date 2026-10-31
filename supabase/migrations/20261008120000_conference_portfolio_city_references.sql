begin;

-- Actual event location and reference targeting deliberately remain separate.
-- No city assignment is required for publishing a portfolio or conference page.
alter table public.portfolio_projects
  add column if not exists event_city_slug text,
  add column if not exists reference_city_slugs text[] not null default '{}',
  add column if not exists conference_reference_enabled boolean;

comment on column public.portfolio_projects.event_city_slug is
  'Actual city of the event. Does not represent the service area.';
comment on column public.portfolio_projects.reference_city_slugs is
  'Prioritize this reference on these conference city pages. Does not imply it took place there. Empty uses general selection.';
comment on column public.portfolio_projects.conference_reference_enabled is
  'NULL inherits the konferencje tag; TRUE includes the reference; FALSE excludes it from conference pages.';

-- Confirmed in the existing description: Hotel Przystań, Olsztyn.
update public.portfolio_projects set event_city_slug = 'olsztyn'
where id = '3b3bb671-c81f-4033-a71e-8012c1f9f88c' and event_city_slug is null;

-- Keep this event in the portfolio, but out of conference reference selection.
update public.portfolio_projects set conference_reference_enabled = false
where id = 'dafd2556-a094-4eff-a934-37cfa51272e9' and conference_reference_enabled is null;

notify pgrst, 'reload schema';
commit;
