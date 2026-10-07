-- Visitors (the notice-and-consent gate), first-party analytics events, the
-- news feed, cron run log and link checks. Everything here is service-role
-- only: the website reaches it through /api/visitor, /api/news and
-- /api/health, the desk through /api/triage/visitors and the daily cron
-- through /api/cron/daily. Idempotent and free of drop statements.
--
-- Objects: tables visitors, visitor_events, news_sources, news_items,
-- cron_runs, link_status; columns reports.pincode, reports.city,
-- reports.visitor_token; functions visitors_from_ip_last_hour(text),
-- visitor_stats(int).

-- ---------------------------------------------------------------------------
-- Visitors: one row per device token the site stores after the resident
-- fills the gate (name, phone, email, area). Profile fields are overwritten
-- on every visit; visits counts how many times the token checked in.
-- ---------------------------------------------------------------------------
create table if not exists public.visitors (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique,
  name           text not null,
  phone          text not null,                   -- E.164, +91XXXXXXXXXX
  email          text not null,
  area           text,                            -- sector or colony
  pincode        text,
  city           text default 'Gurugram',
  consent_at     timestamptz not null,
  notice_version text,
  first_page     text,
  referrer       text,
  user_agent     text,
  ip_hash        text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  visits         int not null default 1
);
create index if not exists visitors_phone_idx   on public.visitors (phone);
create index if not exists visitors_email_idx   on public.visitors (email);
create index if not exists visitors_created_idx on public.visitors (created_at desc);
create index if not exists visitors_ip_hour_idx on public.visitors (ip_hash, created_at);
alter table public.visitors enable row level security;
revoke all on public.visitors from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visitor events: lean first-party analytics (page_view, report_start, ...).
-- No third-party tracker; the token is optional so unregistered visits count.
-- ---------------------------------------------------------------------------
create table if not exists public.visitor_events (
  id            bigserial primary key,
  visitor_token text,
  event         text not null,
  path          text,
  meta          jsonb,
  ip_hash       text,
  created_at    timestamptz not null default now()
);
create index if not exists visitor_events_created_idx on public.visitor_events (created_at desc);
create index if not exists visitor_events_event_idx   on public.visitor_events (event);
alter table public.visitor_events enable row level security;
revoke all on public.visitor_events from anon, authenticated;
revoke all on sequence public.visitor_events_id_seq from anon, authenticated;

-- Reports carry the gate's locality fields and the device token that filed them.
alter table public.reports add column if not exists pincode text;
alter table public.reports add column if not exists city text;
alter table public.reports add column if not exists visitor_token text;
create index if not exists reports_visitor_token_idx on public.reports (visitor_token);

-- ---------------------------------------------------------------------------
-- News: the sources the cron reads (seeded from data/news-sources.json when
-- empty) and the items it found. Public read goes through GET /api/news.
-- ---------------------------------------------------------------------------
create table if not exists public.news_sources (
  id              text primary key,
  name            text not null,
  url             text,
  type            text not null default 'none' check (type in ('rss','html','none')),
  selector        text,
  home            text,
  note            text,
  enabled         boolean not null default true,
  last_fetched_at timestamptz,
  last_status     text,                            -- 'ok' | 'error' | 'skipped'
  last_error      text
);
alter table public.news_sources enable row level security;
revoke all on public.news_sources from anon, authenticated;

create table if not exists public.news_items (
  id           bigserial primary key,
  source_id    text not null references public.news_sources(id) on delete cascade,
  title        text not null,
  url          text not null,
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  unique (source_id, url)
);
create index if not exists news_items_recent_idx on public.news_items ((coalesce(published_at, fetched_at)) desc);
alter table public.news_items enable row level security;
revoke all on public.news_items from anon, authenticated;
revoke all on sequence public.news_items_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cron run log and link checks (read by GET /api/health).
-- ---------------------------------------------------------------------------
create table if not exists public.cron_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  result      jsonb
);
create index if not exists cron_runs_started_idx on public.cron_runs (started_at desc);
alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from anon, authenticated;
revoke all on sequence public.cron_runs_id_seq from anon, authenticated;

create table if not exists public.link_status (
  url        text primary key,
  status     int,
  ok         boolean,
  checked_at timestamptz,
  error      text,
  where_used text
);
create index if not exists link_status_checked_idx on public.link_status (checked_at nulls first);
alter table public.link_status enable row level security;
revoke all on public.link_status from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limit for the gate: registrations per hashed IP in the last hour.
-- ---------------------------------------------------------------------------
create or replace function public.visitors_from_ip_last_hour(p_ip_hash text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.visitors where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
$$;
revoke all on function public.visitors_from_ip_last_hour(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visitor stats for the desk: counts only. Never returns a name or phone.
-- ---------------------------------------------------------------------------
create or replace function public.visitor_stats(p_days int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  with since as (
    select now() - make_interval(days => greatest(coalesce(p_days, 30), 1)) as t
  )
  select jsonb_build_object(
    'days', greatest(coalesce(p_days, 30), 1),
    'visitors_total', (select count(*) from public.visitors),
    'visitors_new', (select count(*) from public.visitors v, since where v.created_at >= since.t),
    'events_by_type', coalesce((
      select jsonb_object_agg(event, n) from (
        select e.event, count(*)::int as n
          from public.visitor_events e, since
         where e.created_at >= since.t
         group by e.event) x), '{}'::jsonb),
    'page_views_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day) from (
        select to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') as day, count(*)::int as n
          from public.visitor_events e, since
         where e.event = 'page_view' and e.created_at >= since.t
         group by 1) d), '[]'::jsonb),
    'top_paths', coalesce((
      select jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc, path) from (
        select coalesce(e.path, '') as path, count(*)::int as n
          from public.visitor_events e, since
         where e.event = 'page_view' and e.created_at >= since.t
         group by 1
         order by 2 desc
         limit 20) p), '[]'::jsonb));
$$;
revoke all on function public.visitor_stats(int) from public, anon, authenticated;
