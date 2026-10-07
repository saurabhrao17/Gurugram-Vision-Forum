-- Content the Forum's team publishes from the desk without a deploy: daily
-- news, stories, photos, videos, social-media posts, testimonials and small
-- pop-up announcements. Plus site settings (social links, banner) and a
-- public bucket for media. Idempotent; nothing here drops anything.
-- Tables are service-role only: the API writes them after checking staff,
-- and the public site reads through content_public().

create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('story','news','photo','video','social','testimonial','popup')),
  slug          text unique,
  title         text not null,
  title_hi      text,
  summary       text,
  summary_hi    text,
  body          text,
  body_hi       text,
  media_path    text,
  media_type    text,
  link_url      text,
  embed_url     text,
  source        text,
  author        text,
  quote_by      text,
  tags          text[] not null default '{}',
  published     boolean not null default false,
  published_at  timestamptz,
  pinned        boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists posts_kind_published_idx on public.posts (kind, published, published_at desc);
create index if not exists posts_published_at_idx on public.posts (published_at desc);

create or replace function public.posts_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'posts_bu') then
    create trigger posts_bu before update on public.posts for each row execute function public.posts_before_update();
  end if;
end $$;

alter table public.posts enable row level security;
revoke all on public.posts from anon, authenticated;

-- Key/value settings edited from the desk: social links, banner.
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;

insert into public.site_settings (key, value) values
  ('social', '{"x":"","facebook":"","instagram":"","youtube":"","whatsapp":""}'::jsonb),
  ('banner', '{}'::jsonb)
on conflict (key) do nothing;

-- Public media bucket: images, video and PDF up to 20 MB. Uploads go through
-- signed upload URLs issued by the API to managers; reads are public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 20971520,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'media_public_read') then
    create policy media_public_read on storage.objects for select using (bucket_id = 'media');
  end if;
end $$;

-- Published posts for the public site: published, not scheduled for later,
-- popups only inside their window. Pinned first, then newest. Everything
-- except created_by. Called by the API with the service role.
create or replace function public.content_public(p_kind text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  out jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p) - 'created_by'), '[]'::jsonb)
    into out
    from (select *
            from public.posts
           where published = true
             and published_at is not null
             and published_at <= now()
             and (p_kind is null or p_kind = '' or kind = p_kind)
             and (kind <> 'popup' or ((starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())))
           order by pinned desc, published_at desc
           limit lim) p;
  return out;
end $$;
revoke all on function public.content_public(text, int) from public, anon, authenticated;
