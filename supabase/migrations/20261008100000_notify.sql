-- Notifications, followers, SLA digest and retention. Everything here is
-- service-role only: the website reaches it through /api/follow and the
-- daily cron through /api/cron/daily. Idempotent and free of drop statements
-- (the Supabase connector hangs on them); the trigger is guarded by a
-- pg_trigger lookup instead.
--
-- Objects: tables outbox, followers; functions reports_notify_stage(),
-- sla_digest(), retention_sweep(); trigger reports_au_notify on reports.

-- ---------------------------------------------------------------------------
-- Outbox: every email the system wants to send. The cron handler delivers
-- pending rows through Resend and marks them sent or failed.
-- ---------------------------------------------------------------------------
create table if not exists public.outbox (
  id          bigserial primary key,
  to_email    text not null,
  subject     text not null,
  body_text   text not null,
  body_html   text,
  kind        text not null,                     -- 'stage', 'sla', ...
  report_id   uuid references public.reports(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists outbox_pending_idx on public.outbox (created_at) where status = 'pending';
create index if not exists outbox_report_idx  on public.outbox (report_id);
alter table public.outbox enable row level security;
revoke all on public.outbox from anon, authenticated;
revoke all on sequence public.outbox_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Followers: residents who asked for updates on a report. The token is the
-- unsubscribe key (GET /api/follow?unsubscribe=<token>).
-- ---------------------------------------------------------------------------
create table if not exists public.followers (
  id          bigserial primary key,
  report_id   uuid not null references public.reports(id) on delete cascade,
  email       text not null,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  unique (report_id, email)
);
create index if not exists followers_report_idx on public.followers (report_id);
alter table public.followers enable row level security;
revoke all on public.followers from anon, authenticated;
revoke all on sequence public.followers_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stage change -> one outbox row for the reporter (when they gave an email)
-- and one per follower. Bodies carry the reference, the stage, the desk and
-- official ticket when set, and the tracking link. Never the reporter's name
-- or phone.
-- ---------------------------------------------------------------------------
create or replace function public.reports_notify_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  stage_en text;
  stage_hi text;
  track    text;
  subj     text;
  common   text;
  hindi    text;
  f        record;
begin
  if new.stage is not distinct from old.stage then return new; end if;

  stage_en := case new.stage
    when 0 then 'Received' when 1 then 'Mapped' when 2 then 'Filed officially'
    when 3 then 'Escalated' when 4 then 'Resolved' else 'Updated' end;
  stage_hi := case new.stage
    when 0 then 'प्राप्त' when 1 then 'मैप किया गया' when 2 then 'आधिकारिक रूप से दर्ज'
    when 3 then 'आगे बढ़ाया गया' when 4 then 'हल हो गया' else 'अपडेट' end;
  track := 'https://gurugramvisionforum.org/#/track/' || new.ref;
  subj  := 'Report ' || new.ref || ': ' || stage_en;

  common := 'Report ' || new.ref || ' is now: ' || stage_en || '.' || E'\n';
  if coalesce(new.desk, '') <> '' then
    common := common || 'Desk: ' || new.desk || E'\n';
  end if;
  if coalesce(new.official_ticket, '') <> '' then
    common := common || 'Official ticket: ' || new.official_ticket
      || case when coalesce(new.official_channel, '') <> '' then ' (' || new.official_channel || ')' else '' end || E'\n';
  end if;
  common := common || 'Track it: ' || track || E'\n';
  hindi := 'रिपोर्ट ' || new.ref || ' अब इस चरण में है: ' || stage_hi || '। ट्रैक करें: ' || track;

  if coalesce(new.reporter_email, '') <> '' then
    insert into public.outbox (to_email, subject, body_text, kind, report_id)
    values (new.reporter_email, subj,
      common || E'\n' || hindi || E'\n\n' || 'Gurugram Vision Forum' || E'\n',
      'stage', new.id);
  end if;

  for f in select email, token from public.followers
            where report_id = new.id and email is distinct from new.reporter_email loop
    insert into public.outbox (to_email, subject, body_text, kind, report_id)
    values (f.email, subj,
      common || E'\n' || hindi || E'\n\n' || 'Gurugram Vision Forum' || E'\n'
      || 'Stop these updates: https://gurugramvisionforum.org/api/follow?unsubscribe=' || f.token || E'\n',
      'stage', new.id);
  end loop;
  return new;
end $$;
revoke all on function public.reports_notify_stage() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'reports_au_notify') then
    create trigger reports_au_notify after update on public.reports
      for each row execute function public.reports_notify_stage();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SLA digest for the coordinator: the same rules as dashboard_summary and the
-- desk's overdue flags. No reporter details.
-- ---------------------------------------------------------------------------
create or replace function public.sla_digest() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unmapped', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', r.ref, 'issue_type', r.issue_type, 'area', r.area, 'ward', r.ward,
               'created_at', r.created_at, 'days', public.working_days_between(r.created_at, now()))
             order by r.created_at)
        from public.reports r
       where r.stage = 0 and public.working_days_between(r.created_at, now()) > 3), '[]'::jsonb),
    'filed_overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', r.ref, 'issue_type', r.issue_type, 'area', r.area, 'ward', r.ward,
               'official_ticket', r.official_ticket, 'official_filed_at', r.official_filed_at,
               'days', floor(extract(epoch from (now() - r.official_filed_at)) / 86400)::int)
             order by r.official_filed_at)
        from public.reports r
       where r.stage = 2 and r.official_filed_at < now() - interval '21 days'), '[]'::jsonb));
$$;
revoke all on function public.sla_digest() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention: resolved reports are deleted 24 months after closure. Events,
-- followers and outbox rows cascade; the cron handler removes the storage
-- objects under <ref>/ for each returned reference.
-- ---------------------------------------------------------------------------
create or replace function public.retention_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  refs text[];
begin
  with gone as (
    delete from public.reports
     where stage = 4 and resolved_at < now() - interval '24 months'
    returning ref)
  select coalesce(array_agg(ref order by ref), '{}'::text[]) into refs from gone;
  return jsonb_build_object('deleted', coalesce(array_length(refs, 1), 0), 'refs', to_jsonb(refs));
end $$;
revoke all on function public.retention_sweep() from public, anon, authenticated;
