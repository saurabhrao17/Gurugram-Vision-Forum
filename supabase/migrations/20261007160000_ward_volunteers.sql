-- Ward volunteers (7 Oct 2026): one lead and one support volunteer per ward.
-- Staff with role 'triage' are ward volunteers and see only their assigned
-- wards; owners and coordinators see everything and manage assignments.
-- Reports record where their ward came from and what the map or the
-- sector table detected, so triage can spot mismatches.

alter table public.reports add column if not exists ward_detected smallint references public.wards(ward);
alter table public.reports add column if not exists ward_source text check (ward_source in ('manual','table','map','desk'));

create table if not exists public.ward_volunteers (
  ward        smallint not null references public.wards(ward),
  role        text not null check (role in ('lead','support')),
  user_id     uuid not null references public.staff(user_id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  primary key (ward, role)
);
create index if not exists ward_volunteers_user_idx on public.ward_volunteers (user_id);
alter table public.ward_volunteers enable row level security;
create policy "ward_volunteers staff read" on public.ward_volunteers for select using (public.is_staff());
revoke all on public.ward_volunteers from anon;

create or replace view public.ward_assignments with (security_invoker = false) as
  select w.ward, w.councillor,
         l.user_id as lead_user_id,    sl.name as lead_name,    sl.email as lead_email,
         s.user_id as support_user_id, ss.name as support_name, ss.email as support_email
    from public.wards w
    left join public.ward_volunteers l on l.ward = w.ward and l.role = 'lead'
    left join public.staff sl on sl.user_id = l.user_id
    left join public.ward_volunteers s on s.ward = w.ward and s.role = 'support'
    left join public.staff ss on ss.user_id = s.user_id
   order by w.ward;
revoke all on public.ward_assignments from anon, authenticated;

-- Wards a volunteer may work on
create or replace function public.staff_wards(p_user uuid) returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ward order by ward), '{}'::smallint[]) from public.ward_volunteers where user_id = p_user;
$$;
revoke all on function public.staff_wards(uuid) from public, anon, authenticated;

-- Desk list view, now with the ward's volunteers and the ward check
create or replace view public.triage_reports with (security_invoker = false) as
  -- explicit columns: a replaced view may only append columns, never reorder them
  select r.id, r.ref, r.issue_type, r.affects, r.area, r.ward, r.spot, r.lat, r.lng, r.description,
         r.reporter_name, r.reporter_phone, r.reporter_email, r.consent_at, r.stage, r.desk,
         r.official_channel, r.official_ticket, r.official_filed_at, r.escalated_to, r.resolution_note,
         r.resolved_at, r.photo_paths, r.source, r.ip_hash, r.user_agent, r.created_at, r.updated_at,
         t.label as issue_label, w.councillor,
         (r.stage = 0 and public.working_days_between(r.created_at, now()) > 3) as unmapped_overdue,
         (r.stage = 2 and r.official_filed_at < now() - interval '21 days')      as filed_overdue,
         (select count(*) from public.report_events e where e.report_id = r.id)        as events_count,
         (select max(e.created_at) from public.report_events e where e.report_id = r.id) as last_event_at,
         r.ward_detected, r.ward_source, a.lead_name, a.support_name,
         (r.ward_detected is not null and r.ward is not null and r.ward_detected <> r.ward) as ward_mismatch
    from public.reports r
    join public.issue_types t on t.id = r.issue_type
    left join public.wards w on w.ward = r.ward
    left join public.ward_assignments a on a.ward = r.ward;
revoke all on public.triage_reports from anon, authenticated;

-- Desk edits of the ward are recorded as such
create or replace function public.triage_update_report(p_ref text, p_patch jsonb, p_actor text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
begin
  perform set_config('gvf.actor', coalesce(nullif(p_actor, ''), 'staff'), true);
  update public.reports set
    issue_type       = case when p_patch ? 'issue_type'       then coalesce(nullif(p_patch->>'issue_type', ''), issue_type) else issue_type end,
    ward             = case when p_patch ? 'ward'             then nullif(p_patch->>'ward', '')::smallint else ward end,
    ward_source      = case when p_patch ? 'ward'             then 'desk' else ward_source end,
    desk             = case when p_patch ? 'desk'             then nullif(p_patch->>'desk', '') else desk end,
    stage            = case when p_patch ? 'stage'            then coalesce((p_patch->>'stage')::smallint, stage) else stage end,
    official_channel = case when p_patch ? 'official_channel' then nullif(p_patch->>'official_channel', '') else official_channel end,
    official_ticket  = case when p_patch ? 'official_ticket'  then nullif(p_patch->>'official_ticket', '') else official_ticket end,
    escalated_to     = case when p_patch ? 'escalated_to'     then nullif(p_patch->>'escalated_to', '') else escalated_to end,
    resolution_note  = case when p_patch ? 'resolution_note'  then nullif(p_patch->>'resolution_note', '') else resolution_note end
  where ref = upper(trim(p_ref))
  returning * into r;
  if not found then return null; end if;
  if p_note is not null and btrim(p_note) <> '' then
    insert into public.report_events (report_id, stage, note, actor)
      values (r.id, r.stage, btrim(p_note), coalesce(nullif(p_actor, ''), 'staff'));
  end if;
  return to_jsonb(r);
end $$;
