-- Gurugram Vision Forum: case store, master data, status lookup, dashboard.
-- Applied with the Supabase MCP tool or `supabase db push`.
-- Privacy rules (HANDOFF.md section 1): reporter phone numbers never leave the
-- server; the anon key can read master data and nothing about individual reports.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Master data (seeded from site/data.js by scripts/export-seed.mjs)
-- ---------------------------------------------------------------------------
create table if not exists public.issue_types (
  id          text primary key,
  label       text not null,
  label_hi    text,
  agency      text,
  owns        text,
  channels    jsonb not null default '[]'::jsonb,
  ladder      jsonb not null default '[]'::jsonb,
  role_ids    text[] not null default '{}',
  sort        int  not null default 0,
  active      boolean not null default true
);

create table if not exists public.wards (
  ward                  smallint primary key check (ward between 1 and 36),
  councillor            text,
  party_as_elected      text,
  zone                  text,
  office_phone          text,
  office_email          text,
  junior_engineer       text,
  sanitation_supervisor text,
  verified_at           date,
  notes                 text
);

-- Sector / colony to ward lookup, filled by volunteers (launch guide phase 4).
create table if not exists public.area_wards (
  area  text primary key,
  ward  smallint not null references public.wards(ward),
  note  text
);

-- ---------------------------------------------------------------------------
-- Reports
-- Stages match site/app.js STAGES: 0 Received, 1 Mapped, 2 Filed officially,
-- 3 Escalated, 4 Resolved.
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique not null,
  issue_type        text not null references public.issue_types(id),
  affects           text,
  area              text not null,
  ward              smallint references public.wards(ward),
  spot              text,
  lat               double precision,
  lng               double precision,
  description       text not null,
  reporter_name     text not null,
  reporter_phone    text not null,          -- E.164, +91XXXXXXXXXX
  reporter_email    text,
  consent_at        timestamptz not null,
  stage             smallint not null default 0 check (stage between 0 and 4),
  desk              text,                   -- responsible desk as mapped by triage
  official_channel  text,
  official_ticket   text,
  official_filed_at timestamptz,
  escalated_to      text,
  resolution_note   text,
  resolved_at       timestamptz,
  photo_paths       text[] not null default '{}',
  source            text not null default 'web' check (source in ('web','whatsapp','phone','volunteer')),
  ip_hash           text,
  user_agent        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_stage_idx   on public.reports (stage);
create index if not exists reports_ward_idx    on public.reports (ward);
create index if not exists reports_issue_idx   on public.reports (issue_type);
create index if not exists reports_ip_idx      on public.reports (ip_hash, created_at desc);

create table if not exists public.report_events (
  id          bigserial primary key,
  report_id   uuid not null references public.reports(id) on delete cascade,
  stage       smallint not null check (stage between 0 and 4),
  note        text,
  actor       text not null default 'system',
  created_at  timestamptz not null default now()
);
create index if not exists report_events_report_idx on public.report_events (report_id, created_at);

-- Join form submissions (volunteers, chapter leads, youth fellows)
create table if not exists public.joins (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,
  email       text not null,
  role        text not null,
  area        text,
  note        text,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

-- Volunteers and coordinators who may see reporter details (Supabase Auth users)
create table if not exists public.staff (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text,
  role        text not null default 'triage' check (role in ('owner','coordinator','triage')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reference numbers: GVF-YYYY-XXXXX from an unambiguous alphabet
-- ---------------------------------------------------------------------------
create or replace function public.gvf_make_ref() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  body text;
  i int;
begin
  loop
    body := '';
    for i in 1..5 loop
      body := body || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    candidate := 'GVF-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || body;
    exit when not exists (select 1 from public.reports where ref = candidate);
  end loop;
  return candidate;
end $$;

create or replace function public.reports_before_insert() returns trigger
language plpgsql as $$
begin
  if new.ref is null or new.ref = '' then new.ref := public.gvf_make_ref(); end if;
  new.ref := upper(new.ref);
  return new;
end $$;

create or replace function public.reports_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if coalesce(new.official_ticket, '') <> '' and new.stage < 2 then
    new.stage := 2;
  end if;
  if coalesce(new.official_ticket, '') <> '' and new.official_filed_at is null then
    new.official_filed_at := now();
  end if;
  if new.stage = 4 and new.resolved_at is null then new.resolved_at := now(); end if;
  return new;
end $$;

create or replace function public.reports_log_event() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_events (report_id, stage, note) values (new.id, new.stage, 'Report received');
  elsif new.stage is distinct from old.stage then
    insert into public.report_events (report_id, stage, note)
      values (new.id, new.stage,
        case new.stage
          when 1 then coalesce('Mapped to ' || new.desk, 'Mapped to the responsible desk')
          when 2 then coalesce('Filed officially, ticket ' || new.official_ticket, 'Filed officially')
          when 3 then coalesce('Escalated to ' || new.escalated_to, 'Escalated')
          when 4 then coalesce(new.resolution_note, 'Resolved')
          else 'Stage changed'
        end);
  end if;
  return new;
end $$;

drop trigger if exists reports_bi on public.reports;
create trigger reports_bi before insert on public.reports for each row execute function public.reports_before_insert();
drop trigger if exists reports_bu on public.reports;
create trigger reports_bu before update on public.reports for each row execute function public.reports_before_update();
drop trigger if exists reports_ai on public.reports;
create trigger reports_ai after insert on public.reports for each row execute function public.reports_log_event();
drop trigger if exists reports_au on public.reports;
create trigger reports_au after update on public.reports for each row execute function public.reports_log_event();

-- ---------------------------------------------------------------------------
-- Status lookup: reference + last four digits of the mobile. Returns stage and
-- dates only (launch guide appendix B, deliverable 3). Called by the API with
-- the service role; not exposed to anon.
-- ---------------------------------------------------------------------------
create or replace function public.report_status(p_ref text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
  ev jsonb;
begin
  select * into r from public.reports
   where ref = upper(trim(p_ref))
     and right(regexp_replace(reporter_phone, '\D', '', 'g'), 4) = regexp_replace(p_last4, '\D', '', 'g')
   limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.created_at, 'note', e.note) order by e.created_at), '[]'::jsonb)
    into ev from public.report_events e where e.report_id = r.id;
  return jsonb_build_object(
    'ref', r.ref, 'issue_type', r.issue_type, 'area', r.area, 'ward', r.ward,
    'stage', r.stage, 'desk', r.desk, 'official_channel', r.official_channel,
    'official_ticket', r.official_ticket, 'created_at', r.created_at,
    'updated_at', r.updated_at, 'events', ev);
end $$;
revoke all on function public.report_status(text, text) from public, anon, authenticated;

-- Reports from one address in the last hour (rate limit for the API)
create or replace function public.reports_from_ip_last_hour(p_ip_hash text) returns int
language sql security definer set search_path = public as $$
  select count(*)::int from public.reports where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
$$;
revoke all on function public.reports_from_ip_last_hour(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard: counts only, never names. Working days exclude Sundays, matching
-- the Forum's Monday to Saturday business hours.
-- ---------------------------------------------------------------------------
create or replace function public.working_days_between(a timestamptz, b timestamptz) returns int
language sql immutable as $$
  select count(*)::int from generate_series(
    (a at time zone 'Asia/Kolkata')::date + 1, (b at time zone 'Asia/Kolkata')::date, interval '1 day') d
  where extract(isodow from d) <> 7;
$$;

create or replace view public.dashboard_by_issue with (security_invoker = false) as
  select t.id as issue_type, t.label, t.sort,
         count(r.id) filter (where r.stage in (0,1)) as received,
         count(r.id) filter (where r.stage = 2)      as filed,
         count(r.id) filter (where r.stage = 3)      as escalated,
         count(r.id) filter (where r.stage = 4)      as resolved,
         count(r.id)                                 as total
    from public.issue_types t
    left join public.reports r on r.issue_type = t.id
   group by t.id, t.label, t.sort
   order by t.sort;

create or replace view public.dashboard_by_ward with (security_invoker = false) as
  select w.ward, w.councillor,
         count(r.id) filter (where r.stage in (0,1)) as received,
         count(r.id) filter (where r.stage = 2)      as filed,
         count(r.id) filter (where r.stage = 3)      as escalated,
         count(r.id) filter (where r.stage = 4)      as resolved,
         count(r.id)                                 as total,
         percentile_cont(0.5) within group (order by extract(epoch from (r.resolved_at - r.created_at)) / 86400)
           filter (where r.stage = 4)                as median_days_to_resolve
    from public.wards w
    left join public.reports r on r.ward = w.ward
   group by w.ward, w.councillor
   order by w.ward;

create or replace view public.dashboard_summary with (security_invoker = false) as
  with mapped as (
    select r.id, r.created_at, min(e.created_at) as mapped_at
      from public.reports r
      join public.report_events e on e.report_id = r.id and e.stage >= 1
     group by r.id, r.created_at),
  filed as (
    select r.id, r.official_filed_at, r.stage, r.resolved_at
      from public.reports r where r.official_filed_at is not null)
  select
    (select count(*) from public.reports)                              as total,
    (select count(*) from public.reports where stage in (0,1))         as received,
    (select count(*) from public.reports where stage = 2)              as filed,
    (select count(*) from public.reports where stage = 3)              as escalated,
    (select count(*) from public.reports where stage = 4)              as resolved,
    (select count(*) from public.reports where stage = 0
        and public.working_days_between(created_at, now()) > 3)         as unmapped_past_due,
    (select count(*) from public.reports where stage = 2
        and official_filed_at < now() - interval '21 days')             as filed_past_due,
    (select round(100.0 * count(*) filter (where public.working_days_between(created_at, mapped_at) <= 3) / nullif(count(*), 0))
        from mapped)                                                   as mapped_in_3_days_pct,
    (select round(100.0 * count(*) filter (where resolved_at <= official_filed_at + interval '21 days' or stage = 3)
        / nullif(count(*) filter (where resolved_at is not null or stage = 3 or official_filed_at < now() - interval '21 days'), 0))
        from filed)                                                    as acted_in_21_days_pct,
    (select percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 86400)
        from public.reports where stage = 4)                           as median_days_to_resolve,
    now()                                                              as computed_at;

revoke all on public.dashboard_by_issue, public.dashboard_by_ward, public.dashboard_summary from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.issue_types   enable row level security;
alter table public.wards         enable row level security;
alter table public.area_wards    enable row level security;
alter table public.reports       enable row level security;
alter table public.report_events enable row level security;
alter table public.joins         enable row level security;
alter table public.staff         enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- Master data is public to read; only staff may change it.
drop policy if exists "issue_types public read" on public.issue_types;
create policy "issue_types public read" on public.issue_types for select using (true);
drop policy if exists "issue_types staff write" on public.issue_types;
create policy "issue_types staff write" on public.issue_types for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "wards public read" on public.wards;
create policy "wards public read" on public.wards for select using (true);
drop policy if exists "wards staff write" on public.wards;
create policy "wards staff write" on public.wards for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "area_wards public read" on public.area_wards;
create policy "area_wards public read" on public.area_wards for select using (true);
drop policy if exists "area_wards staff write" on public.area_wards;
create policy "area_wards staff write" on public.area_wards for all using (public.is_staff()) with check (public.is_staff());

-- Reports, events and joins: staff only. The anon key has no path to them;
-- the website goes through the API, which uses the service role.
drop policy if exists "reports staff" on public.reports;
create policy "reports staff" on public.reports for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "report_events staff" on public.report_events;
create policy "report_events staff" on public.report_events for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "joins staff" on public.joins;
create policy "joins staff" on public.joins for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff self read" on public.staff;
create policy "staff self read" on public.staff for select using (user_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- Photos: private bucket, 10 MB, images only. Uploaded by the API, read by staff.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "report photos staff read" on storage.objects;
create policy "report photos staff read" on storage.objects for select
  using (bucket_id = 'report-photos' and public.is_staff());
