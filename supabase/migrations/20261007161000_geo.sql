-- Ward matching from a map pin or an area name (7 Oct 2026).
-- ward_boundaries holds the 36 MCG ward polygons once GMDA's GIS file is
-- loaded (no public API exists; see docs/deploy.md). Until then the
-- sector-to-ward table (area_wards) answers area lookups.

create extension if not exists postgis with schema extensions;

create table if not exists public.ward_boundaries (
  ward      smallint primary key references public.wards(ward),
  geom      extensions.geometry(MultiPolygon, 4326) not null,
  source    text,
  loaded_at timestamptz not null default now()
);
create index if not exists ward_boundaries_geom_idx on public.ward_boundaries using gist (geom);
alter table public.ward_boundaries enable row level security;
create policy "ward_boundaries public read" on public.ward_boundaries for select using (true);
create policy "ward_boundaries staff write" on public.ward_boundaries for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.ward_for_point(p_lat double precision, p_lng double precision) returns smallint
language sql stable security definer set search_path = public, extensions as $$
  select ward from public.ward_boundaries
   where extensions.ST_Contains(geom, extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326))
   limit 1;
$$;

-- "Sector 29", "sec-29", "Sector 29 Gurugram" all match the table row "Sector 29";
-- named colonies match on the full name.
create or replace function public.ward_for_area(p_area text) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare
  a text := lower(btrim(coalesce(p_area, '')));
  n text;
  w smallint;
begin
  if a = '' then return null; end if;
  select ward into w from public.area_wards where lower(area) = a limit 1;
  if w is not null then return w; end if;
  n := (regexp_match(a, '\msec(?:tor)?\.?\s*-?\s*(\d{1,3}\s*[a-z]?)'))[1];
  if n is not null then
    select ward into w from public.area_wards where lower(area) = 'sector ' || regexp_replace(n, '\s', '', 'g') limit 1;
    if w is not null then return w; end if;
  end if;
  select ward into w from public.area_wards where a like '%' || lower(area) || '%' order by length(area) desc limit 1;
  return w;
end $$;

-- Used by the public form (through the API) and by report creation
create or replace function public.detect_ward(p_lat double precision, p_lng double precision, p_area text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w smallint;
begin
  if p_lat is not null and p_lng is not null then
    w := public.ward_for_point(p_lat, p_lng);
    if w is not null then return jsonb_build_object('ward', w, 'source', 'map'); end if;
  end if;
  w := public.ward_for_area(p_area);
  if w is not null then return jsonb_build_object('ward', w, 'source', 'table'); end if;
  return jsonb_build_object('ward', null, 'source', null);
end $$;
revoke all on function public.ward_for_point(double precision, double precision), public.ward_for_area(text), public.detect_ward(double precision, double precision, text) from public, anon, authenticated;
