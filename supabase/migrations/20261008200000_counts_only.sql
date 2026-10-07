-- Reports are confidential (owner's decision, 8 Oct 2026). The public sees
-- counts only: per ward, per issue type, per stage. Nothing that identifies a
-- single report (reference, place, date, description) leaves the team desk.
-- This migration removes the anonymised per-report feed and adds the count
-- function the ward pages read.

drop function if exists public.public_report(text);
drop function if exists public.public_reports_recent(int);
drop view if exists public.public_reports;

-- Counts for one ward: total, by stage (index = stage 0..4), by issue type
-- (every issue type the site tracks, with its total and resolved count).
-- Service role only; the API renders it on /ward/:n.
create or replace function public.ward_counts(p_ward int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ward', p_ward,
    'total', (select count(*) from public.reports r where r.ward = p_ward),
    'site_total', (select count(*) from public.reports),
    'by_stage', (
      select jsonb_build_array(
        count(*) filter (where r.stage = 0),
        count(*) filter (where r.stage = 1),
        count(*) filter (where r.stage = 2),
        count(*) filter (where r.stage = 3),
        count(*) filter (where r.stage = 4))
        from public.reports r where r.ward = p_ward),
    'by_issue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'issue_type', x.id, 'label', x.label, 'total', x.total, 'resolved', x.resolved)
             order by x.sort)
        from (select t.id, t.label, t.sort,
                     count(r.id) as total,
                     count(r.id) filter (where r.stage = 4) as resolved
                from public.issue_types t
                left join public.reports r on r.issue_type = t.id and r.ward = p_ward
               group by t.id, t.label, t.sort) x), '[]'::jsonb),
    'computed_at', now());
$$;
revoke all on function public.ward_counts(int) from public, anon, authenticated;

-- Linter: pin the search path of the two functions that lacked it.
alter function public.gvf_set_filing(text, jsonb) set search_path = public;
alter function public.posts_before_update() set search_path = public;
