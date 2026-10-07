-- Triage desk for volunteers (7 Oct 2026).
-- 1. Stage events record who made the change: the API sets gvf.actor for the
--    transaction and the trigger reads it.
-- 2. triage_update_report applies a patch and an optional note in one
--    transaction, so the automatic stage event is attributed correctly.
-- 3. triage_reports is the list view the desk reads (service role only).
-- 4. staff gets an email column for display.

alter table public.staff add column if not exists email text;

create or replace function public.reports_log_event() returns trigger
language plpgsql set search_path = public as $$
declare
  who text := coalesce(nullif(current_setting('gvf.actor', true), ''), 'system');
begin
  if tg_op = 'INSERT' then
    insert into public.report_events (report_id, stage, note, actor) values (new.id, new.stage, 'Report received', who);
  elsif new.stage is distinct from old.stage then
    insert into public.report_events (report_id, stage, note, actor)
      values (new.id, new.stage,
        case new.stage
          when 1 then coalesce('Mapped to ' || new.desk, 'Mapped to the responsible desk')
          when 2 then coalesce('Filed officially, ticket ' || new.official_ticket, 'Filed officially')
          when 3 then coalesce('Escalated to ' || new.escalated_to, 'Escalated')
          when 4 then coalesce(new.resolution_note, 'Resolved')
          else 'Stage changed'
        end, who);
  end if;
  return new;
end $$;

create or replace function public.triage_update_report(p_ref text, p_patch jsonb, p_actor text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
begin
  perform set_config('gvf.actor', coalesce(nullif(p_actor, ''), 'staff'), true);
  update public.reports set
    issue_type       = case when p_patch ? 'issue_type'       then coalesce(nullif(p_patch->>'issue_type', ''), issue_type) else issue_type end,
    ward             = case when p_patch ? 'ward'             then nullif(p_patch->>'ward', '')::smallint else ward end,
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
revoke all on function public.triage_update_report(text, jsonb, text, text) from public, anon, authenticated;

create or replace view public.triage_reports with (security_invoker = false) as
  select r.*, t.label as issue_label, w.councillor,
         (r.stage = 0 and public.working_days_between(r.created_at, now()) > 3) as unmapped_overdue,
         (r.stage = 2 and r.official_filed_at < now() - interval '21 days')      as filed_overdue,
         (select count(*) from public.report_events e where e.report_id = r.id)        as events_count,
         (select max(e.created_at) from public.report_events e where e.report_id = r.id) as last_event_at
    from public.reports r
    join public.issue_types t on t.id = r.issue_type
    left join public.wards w on w.ward = r.ward;
revoke all on public.triage_reports from anon, authenticated;
