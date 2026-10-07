-- Advisor fixes after the first apply (7 Oct 2026): pin search_path on every
-- function; keep SECURITY DEFINER functions off the anon REST surface; and
-- revoke the anon key's table grants on private tables even though RLS
-- already denies it.
alter function public.gvf_make_ref() set search_path = public;
alter function public.reports_before_insert() set search_path = public;
alter function public.reports_before_update() set search_path = public;
alter function public.reports_log_event() set search_path = public;
alter function public.working_days_between(timestamptz, timestamptz) set search_path = public;

-- is_staff() is evaluated inside RLS policies by the calling role, so signed-in
-- users keep EXECUTE; anon never needs it.
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

revoke all on public.reports, public.report_events, public.joins, public.staff from anon;
