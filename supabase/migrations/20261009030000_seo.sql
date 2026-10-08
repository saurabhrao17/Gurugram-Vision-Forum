-- Automated SEO management (owner's ask, 8 Oct 2026): the nightly audit of
-- the site's own pages, Core Web Vitals from PageSpeed Insights, and brand
-- mentions from Google News. Read by the desk's SEO tab (owner, coordinator,
-- content). Nothing here is public.
create table if not exists public.seo_pages (
  url          text primary key,
  path         text not null,
  lang         text not null default 'en',
  kind         text not null,                 -- app | guide | ward | blog | index
  status       int,
  ms           int,
  title        text,
  description  text,
  words        int,
  score        int,                           -- 0-100
  issues       jsonb not null default '[]',   -- [{code, severity, msg}]
  facts        jsonb not null default '{}',   -- h1, canonical, hreflang, jsonld, og, images…
  checked_at   timestamptz
);
create index if not exists seo_pages_checked_idx on public.seo_pages (checked_at);
alter table public.seo_pages enable row level security;

create table if not exists public.seo_vitals (
  id           bigserial primary key,
  url          text not null,
  strategy     text not null default 'mobile',
  performance  int, seo int, accessibility int, best_practices int,
  lcp_ms       int, cls numeric(6,3), tbt_ms int, fcp_ms int, speed_index_ms int,
  checked_at   timestamptz not null default now()
);
create index if not exists seo_vitals_url_idx on public.seo_vitals (url, checked_at desc);
alter table public.seo_vitals enable row level security;

create table if not exists public.seo_mentions (
  id           bigserial primary key,
  url          text not null unique,
  title        text not null,
  source       text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now()
);
create index if not exists seo_mentions_pub_idx on public.seo_mentions (published_at desc);
alter table public.seo_mentions enable row level security;
