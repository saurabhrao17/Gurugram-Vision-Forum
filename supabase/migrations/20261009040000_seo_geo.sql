-- The automated SEO desk, part two: GEO (AI answer citations), Search
-- Console and Bing data, the internal link crawl and site-wide checks.
-- Written only by the cron (service role); read only by GET /api/triage/seo.

-- AI answer checks: a resident's question put to an answer engine with web
-- grounding, and whether the answer cited the Forum.
create table if not exists public.seo_geo (
  id bigserial primary key,
  question_key text not null,
  question text not null,
  issue text,
  engine text not null default 'gemini-search',
  model text,
  cited boolean,
  mentioned boolean,
  position int,
  sources jsonb not null default '[]',
  answer text,
  error text,
  checked_at timestamptz not null default now()
);
create index if not exists seo_geo_checked on public.seo_geo (checked_at desc);
create index if not exists seo_geo_key on public.seo_geo (question_key, checked_at desc);

-- Search performance from Google Search Console and Bing Webmaster Tools,
-- summed over a 28-day window: one row per source, dimension and key.
create table if not exists public.seo_search (
  id bigserial primary key,
  source text not null check (source in ('google', 'bing')),
  dim text not null check (dim in ('query', 'page')),
  key text not null,
  clicks int not null default 0,
  impressions int not null default 0,
  ctr numeric(7,4),
  position numeric(7,2),
  period_start date,
  period_end date not null,
  fetched_at timestamptz not null default now(),
  unique (source, dim, key, period_end)
);
create index if not exists seo_search_latest on public.seo_search (source, dim, period_end desc);

-- Google's index status per URL (URL Inspection API).
create table if not exists public.seo_index (
  url text primary key,
  verdict text,
  coverage text,
  indexing text,
  robots text,
  google_canonical text,
  last_crawl timestamptz,
  checked_at timestamptz not null default now()
);

-- Internal link targets that are not in the sitemap, with their HTTP status.
create table if not exists public.seo_links (
  url text primary key,
  status int,
  ok boolean,
  checked_at timestamptz not null default now()
);

-- Site-wide checks (robots.txt, sitemap, llms.txt, security headers, the
-- www redirect, Search Console sitemaps, Bing crawl stats).
create table if not exists public.seo_site (
  key text primary key,
  ok boolean,
  detail text,
  data jsonb not null default '{}',
  checked_at timestamptz not null default now()
);

alter table public.seo_geo enable row level security;
alter table public.seo_search enable row level security;
alter table public.seo_index enable row level security;
alter table public.seo_links enable row level security;
alter table public.seo_site enable row level security;
