-- Public, anonymised view of reports for the public map and the per-report
-- page. Privacy rules (CLAUDE.md): no reporter name, phone or email, no
-- description, no spot text, no filing details (extra), no attachments and no
-- official ticket number (a ticket can identify a person on some portals).
-- Coordinates are rounded to 3 decimals (about 100 m) before they leave the
-- database. Idempotent; nothing here drops anything. Columns are listed
-- explicitly because a replaced view may only append columns.
-- Read by the API with the service role; never exposed to anon.

create or replace view public.public_reports with (security_invoker = false) as
  select r.ref,
         r.issue_type,
         t.label                                   as issue_label,
         r.area,
         r.ward,
         r.stage,
         r.created_at,
         r.updated_at,
         r.official_filed_at,
         r.resolved_at,
         r.desk,
         r.official_channel,
         round(r.lat::numeric, 3)::double precision as lat,
         round(r.lng::numeric, 3)::double precision as lng,
         r.source
    from public.reports r
    join public.issue_types t on t.id = r.issue_type
    left join public.wards w on w.ward = r.ward;
revoke all on public.public_reports from anon, authenticated;

-- One report by reference: the public_reports row plus its stage history
-- (stage and time only, no notes, no actor) and the follower count when the
-- followers table exists (created by the notify migration). Null when the
-- reference is unknown.
create or replace function public.public_report(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rid uuid;
  rec jsonb;
  ev jsonb;
  n_followers int := 0;
begin
  select r.id into rid from public.reports r where r.ref = upper(trim(p_ref)) limit 1;
  if not found then return null; end if;
  select to_jsonb(p) into rec from public.public_reports p where p.ref = upper(trim(p_ref));
  select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'created_at', e.created_at) order by e.created_at), '[]'::jsonb)
    into ev from public.report_events e where e.report_id = rid;
  if to_regclass('public.followers') is not null then
    execute 'select count(*)::int from public.followers where report_id = $1' into n_followers using rid;
  end if;
  return rec || jsonb_build_object('events', ev, 'followers', coalesce(n_followers, 0));
end $$;
revoke all on function public.public_report(text) from public, anon, authenticated;

-- Recent pins for the public map: reports with coordinates, newest first.
-- Returns {reports: [...], counts: {total, with_location}, computed_at}.
create or replace function public.public_reports_recent(p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  lim int := least(greatest(coalesce(p_limit, 500), 1), 1000);
  pins jsonb;
  n_total bigint;
  n_located bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', p.ref, 'issue_type', p.issue_type, 'stage', p.stage, 'ward', p.ward,
           'lat', p.lat, 'lng', p.lng, 'created_at', p.created_at) order by p.created_at desc), '[]'::jsonb)
    into pins
    from (select * from public.public_reports
           where lat is not null and lng is not null
           order by created_at desc
           limit lim) p;
  select count(*), count(*) filter (where lat is not null and lng is not null)
    into n_total, n_located from public.reports;
  return jsonb_build_object(
    'reports', pins,
    'counts', jsonb_build_object('total', n_total, 'with_location', n_located),
    'computed_at', now());
end $$;
revoke all on function public.public_reports_recent(int) from public, anon, authenticated;
