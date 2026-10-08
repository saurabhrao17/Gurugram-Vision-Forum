-- Social publishing: one row per (post, platform) share attempt. Queued by the
-- desk, sent at once by POST /api/triage/social and retried by the cron step
-- `social`. Tokens never live here: they are Vercel environment variables.
create table if not exists public.social_posts (
  id           bigserial primary key,
  post_id      uuid not null references public.posts(id) on delete cascade,
  platform     text not null check (platform in ('facebook','instagram','telegram','bluesky','x')),
  status       text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  external_id  text,
  external_url text,
  attempts     int  not null default 0,
  last_error   text,
  created_by   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  unique (post_id, platform)
);
create index if not exists social_posts_status_idx on public.social_posts (status, created_at);
alter table public.social_posts enable row level security;
