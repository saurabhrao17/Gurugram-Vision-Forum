-- Weekly round-up and subscribers (8 Oct 2026): the daily cron drafts one
-- post a week from the Forum's own data (lib/autopost.js), the team reviews
-- it from the desk, and confirmed subscribers get it by email. Settings for
-- the autopost and for search-engine pings live in site_settings.
-- Idempotent and free of drop statements. Service-role only: the public
-- API (/api/subscribe) writes subscribers through the server, never anon.
--
-- Objects: table subscribers; column posts.digest_sent_at; site_settings
-- rows 'autopost' and 'seo'.

-- ---------------------------------------------------------------------------
-- Subscribers: double opt-in. A row is created on POST /api/subscribe with a
-- token; confirmed_at is set when the confirm link is opened; unsubscribed_at
-- when the unsubscribe link is. Only rows with confirmed_at set and
-- unsubscribed_at null are ever mailed. Email and language only (DPDP:
-- minimum data for one purpose, one weekly email).
-- ---------------------------------------------------------------------------
create table if not exists public.subscribers (
  id              bigserial primary key,
  email           text not null unique,                 -- lower-cased by the API
  lang            text not null default 'en' check (lang in ('en','hi')),
  token           text not null unique,                 -- 32 hex characters
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now(),
  source          text                                  -- where the form was ('site', 'footer', ...)
);
create index if not exists subscribers_confirmed_idx on public.subscribers (confirmed_at) where unsubscribed_at is null;
alter table public.subscribers enable row level security;
revoke all on public.subscribers from anon, authenticated;
revoke all on sequence public.subscribers_id_seq from anon, authenticated;

-- When the weekly digest for a post was queued to subscribers (null: not yet).
alter table public.posts add column if not exists digest_sent_at timestamptz;
create index if not exists posts_source_idx on public.posts (source);

-- Autopost: enabled, which UTC weekday the draft is made (0 Sunday .. 6
-- Saturday; 1 Monday) and how many hours the team has to hold or edit it
-- before it publishes itself (0 publishes at once, -1 never auto-publishes).
-- SEO: whether published posts are pinged to IndexNow (needs INDEXNOW_KEY).
insert into public.site_settings (key, value) values
  ('autopost', '{"enabled": true, "weekday": 1, "review_hours": 48}'::jsonb),
  ('seo', '{"indexnow": true}'::jsonb)
on conflict (key) do nothing;
