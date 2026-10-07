-- Gurugram pulse (8 Oct 2026): a daily scan of public discussion about civic
-- problems in Gurugram, classified into the Forum's issue types, and the
-- weekly insight built from it. Both tables are service-role only: the site
-- reads the latest insight through GET /api/pulse, the desk reads insights
-- and signals through GET /api/triage/insights, and the daily cron writes
-- them. Idempotent and free of drop statements.
--
-- Privacy: a signal is a public post's title, snippet, link and date only.
-- No author name, user handle or other personal detail is stored anywhere
-- here; the fetchers never copy those fields.
--
-- Objects: tables signals, insights.

-- ---------------------------------------------------------------------------
-- Signals: one row per public post, news item or Forum report that mentions a
-- civic problem. Sources: 'reddit' (public JSON of r/gurgaon and r/gurugram),
-- 'news' (Google News RSS searches) and 'reports' (the Forum's own reports,
-- by reference only). Rows older than 60 days are deleted by the cron.
-- ---------------------------------------------------------------------------
create table if not exists public.signals (
  id          bigserial primary key,
  source      text not null check (source in ('reddit', 'news', 'reports')),
  external_id text not null,                      -- post id, url hash or report ref
  title       text not null,
  snippet     text,                               -- first 300 characters of the body, if any
  url         text,
  posted_at   timestamptz,
  fetched_at  timestamptz not null default now(),
  issue_type  text,                               -- one of the site's issue types, or 'other'
  area        text,                               -- first area name mentioned, if any
  ward        smallint,
  score       int not null default 0,             -- reddit: ups + comments; news: 5; reports: 10
  lang        text,                               -- 'en' | 'hi'
  unique (source, external_id)
);
create index if not exists signals_posted_idx on public.signals (posted_at desc);
create index if not exists signals_issue_idx  on public.signals (issue_type);
alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;
revoke all on sequence public.signals_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Insights: the pulse the cron computes each day over the last 7 days against
-- the 7 before (topics, areas, examples, trend, headline and summary in both
-- languages, suggested actions). `data` is what GET /api/pulse returns.
-- ---------------------------------------------------------------------------
create table if not exists public.insights (
  id           bigserial primary key,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  generated_at timestamptz not null default now(),
  data         jsonb not null,
  published    boolean not null default true
);
create index if not exists insights_generated_idx on public.insights (generated_at desc);
alter table public.insights enable row level security;
revoke all on public.insights from anon, authenticated;
revoke all on sequence public.insights_id_seq from anon, authenticated;
