-- A link counts as broken only after it fails two nightly checks in a row
-- (owner's decision, 9 Oct 2026): government sites often miss one night.
-- fails = consecutive failed checks; a good check resets it to 0. Links that
-- are failing now start at 1, so one more failed night counts them.
alter table public.link_status add column if not exists fails smallint not null default 0;
update public.link_status set fails = 1 where ok = false and fails = 0;
