-- Mission 2029 MP page, step 2: the "Withdraw my consent" routine (14 Nov 2026).
--
-- One small function. It switches off ONE member's own access (mission_member.active = false) and
-- names that member as the acting person for the same transaction, so the existing history trigger
-- (mission_audit) writes its line. Nothing else changes: no table, policy or trigger is altered.
--
-- Why a function: every write to a mission_ table is refused unless mission.actor is set in the same
-- transaction, and the API reaches the database over HTTP with the service role, where a plain update
-- cannot set it. The function sets it and does the update in one call.
--
-- Who may run it: only the service role (the API). It is NOT callable by anon, authenticated or public,
-- so a member cannot call it from the browser. The API passes the id of the person whose sign-in token
-- it just verified, never an id taken from the request body, so a member can only withdraw themselves.
-- Calling it again for someone already switched off does nothing and returns false.
--
-- Adding yourself as the first admin is NOT done here. The owner does it in the Supabase SQL editor
-- with the three lines in docs/mission-step2-owner-steps.md (no helper creates accounts or rows).
--
-- ROLLBACK (needs the owner's yes: it removes a function; history lines already written stay):
--   drop function if exists public.mission_withdraw_self(uuid);

begin;

create function public.mission_withdraw_self(p_user uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_user is null then
    raise exception 'mission: no member named for withdraw';
  end if;
  perform set_config('mission.actor', p_user::text, true);
  update public.mission_member set active = false where user_id = p_user and active = true;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function public.mission_withdraw_self(uuid) from public, anon, authenticated;
grant execute on function public.mission_withdraw_self(uuid) to service_role;

commit;
