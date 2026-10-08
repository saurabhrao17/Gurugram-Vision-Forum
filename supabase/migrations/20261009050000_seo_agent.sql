-- The SEO agent (lib/seo/agent.js, cron step `agent`, three times a day
-- through .github/workflows/seo-agent.yml): what it found, what it did and
-- what it reported. Written only by the cron (service role); read only by
-- GET /api/triage/seo.

-- One row per problem the agent tracks, from first seen to fixed.
create table if not exists public.seo_tasks (
  key text primary key,
  area text not null,
  severity text not null check (severity in ('high', 'medium', 'low')),
  owner text not null check (owner in ('auto', 'wait', 'code', 'person')),
  title text not null,
  detail text,
  action text,
  status text not null default 'open' check (status in ('open', 'fixed')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  last_action_at timestamptz,
  last_result text,
  data jsonb not null default '{}'
);
create index if not exists seo_tasks_status on public.seo_tasks (status, severity);

-- The agent's timeline: plans, actions, checks and reports, newest first.
create table if not exists public.seo_agent_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  day date not null,
  phase text,
  kind text not null check (kind in ('plan', 'action', 'check', 'report')),
  task_key text,
  text text not null,
  ok boolean,
  data jsonb not null default '{}'
);
create index if not exists seo_agent_log_day on public.seo_agent_log (day desc, at desc);

-- Daily reports and weekly plans (also committed to the seo-agent-log branch).
create table if not exists public.seo_agent_reports (
  id text primary key,            -- daily:2026-10-09 | weekly:2026-W41
  kind text not null check (kind in ('daily', 'weekly')),
  day date not null,
  summary jsonb not null default '{}',
  markdown text not null,
  created_at timestamptz not null default now()
);
create index if not exists seo_agent_reports_day on public.seo_agent_reports (kind, day desc);

alter table public.seo_tasks enable row level security;
alter table public.seo_agent_log enable row level security;
alter table public.seo_agent_reports enable row level security;
