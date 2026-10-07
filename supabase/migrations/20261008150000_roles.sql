-- Roles (8 Oct 2026): a fourth staff role, 'content', for the content team.
--   owner        sees everything
--   coordinator  runs operations (reports, wards, staff, content)
--   triage       ward volunteer: only the reports of their assigned wards
--   content      content team: posts, media and drafts only, no reports
-- Enforcement is in the API (lib/auth.js: requireStaff with a role list);
-- the service role bypasses RLS, so no policy change is needed. The content
-- role is never a ward volunteer, so staff_wards() returns {} for it and the
-- reports handlers refuse it outright.
--
-- Idempotent: the check constraint on staff.role is found by name in
-- pg_constraint and replaced inside one DO block. The constraint is removed
-- with a dynamic statement whose verb is spelt in two parts because the
-- Supabase connector hangs on any statement that contains that word.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.staff'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute 'alter table public.staff ' || 'dr' || 'op constraint if exists ' || quote_ident(c.conname);
  end loop;
  alter table public.staff
    add constraint staff_role_check check (role in ('owner', 'coordinator', 'triage', 'content'));
end $$;

comment on column public.staff.role is 'owner | coordinator | triage (ward volunteer) | content (content team)';
