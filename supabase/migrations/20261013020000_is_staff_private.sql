-- Move is_staff() out of the exposed API schema (13 Oct 2026).
--
-- Why: Supabase's security advisor (lint 0029, authenticated_security_definer_
-- function_executable) warns that public.is_staff() is a SECURITY DEFINER
-- function callable by signed-in users through /rest/v1/rpc/is_staff. It only
-- tells the caller whether THEY are staff, so the exposure is small, but the
-- RLS policies need signed-in users to be able to run it, so a plain REVOKE
-- would break every staff policy ("permission denied for function"). The fix
-- Supabase recommends: put the function in a schema that PostgREST does not
-- expose (private), keep EXECUTE for authenticated / service_role, and point
-- the policies at it. The API (service role) never calls it.
--
-- What this does, in one transaction:
--   1. creates schema private (not in the API's exposed schemas) and
--      private.is_staff() with the same body, search_path = '' and
--      fully-qualified names;
--   2. recreates the 10 policies that used public.is_staff(), same names,
--      commands and roles, calling private.is_staff();
--   3. drops public.is_staff().
-- Do not add private to the API's "Exposed schemas" in the Supabase dashboard.
--
-- ROLLBACK (run as one transaction; restores the previous state):
--   begin;
--   create or replace function public.is_staff() returns boolean
--     language sql stable security definer set search_path = public as $$
--       select exists (select 1 from public.staff where user_id = auth.uid());
--     $$;
--   revoke execute on function public.is_staff() from public, anon;
--   grant execute on function public.is_staff() to authenticated, service_role;
--   -- then for each policy below: drop policy if exists "<name>" on <table>;
--   -- and create it again with public.is_staff() in place of private.is_staff():
--   --   issue_types "issue_types staff write", wards "wards staff write",
--   --   area_wards "area_wards staff write", ward_boundaries
--   --   "ward_boundaries staff write"  (all: for all using (f) with check (f));
--   --   reports "reports staff", report_events "report_events staff",
--   --   joins "joins staff" (all: for all using (f) with check (f));
--   --   staff "staff self read" (for select using (user_id = auth.uid() or f));
--   --   ward_volunteers "ward_volunteers staff read" (for select using (f));
--   --   storage.objects "report photos staff read"
--   --   (for select using (bucket_id = 'report-photos' and f)).
--   -- (f = public.is_staff()). Then: drop function private.is_staff();
--   commit;

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;
revoke all on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated, service_role;

drop policy if exists "issue_types staff write" on public.issue_types;
create policy "issue_types staff write" on public.issue_types for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "wards staff write" on public.wards;
create policy "wards staff write" on public.wards for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "area_wards staff write" on public.area_wards;
create policy "area_wards staff write" on public.area_wards for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "ward_boundaries staff write" on public.ward_boundaries;
create policy "ward_boundaries staff write" on public.ward_boundaries for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "reports staff" on public.reports;
create policy "reports staff" on public.reports for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "report_events staff" on public.report_events;
create policy "report_events staff" on public.report_events for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "joins staff" on public.joins;
create policy "joins staff" on public.joins for all using (private.is_staff()) with check (private.is_staff());

drop policy if exists "staff self read" on public.staff;
create policy "staff self read" on public.staff for select using (user_id = auth.uid() or private.is_staff());

drop policy if exists "ward_volunteers staff read" on public.ward_volunteers;
create policy "ward_volunteers staff read" on public.ward_volunteers for select using (private.is_staff());

drop policy if exists "report photos staff read" on storage.objects;
create policy "report photos staff read" on storage.objects for select
  using (bucket_id = 'report-photos' and private.is_staff());

drop function if exists public.is_staff();

commit;
