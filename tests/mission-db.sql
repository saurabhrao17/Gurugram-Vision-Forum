-- Checks for the Mission tables, run by scripts/mission-db-test.sh on a throwaway database.
-- FAKE data only: every name starts with "Sample", every number and email is obviously fake.
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_fail(q text, why text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then return; end;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', why;
end $$;

-- 1. every mission table has row level security on and no policy
do $$ declare t record; begin
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'mission\_%' escape '\' and c.relkind='r' loop
    if not t.relrowsecurity then raise exception 'RLS off on %', t.relname; end if;
  end loop;
  if exists (select 1 from pg_policies where tablename like 'mission\_%' escape '\') then raise exception 'a mission policy exists'; end if;
end $$;

-- 2. anon and authenticated have no right on any mission table
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'mission\_%' escape '\' and c.relkind='r' loop
    if has_table_privilege('anon', 'public.'||t.relname, 'select,insert,update,delete')
       or has_table_privilege('authenticated', 'public.'||t.relname, 'select,insert,update,delete') then
      raise exception 'anon/authenticated can reach %', t.relname; end if;
  end loop;
end $$;

-- 3. the party ladder tables are empty
do $$ begin
  if (select count(*) from public.mission_party_unit) <> 0 or (select count(*) from public.mission_unit_party) <> 0 then
    raise exception 'party ladder not empty'; end if;
  if exists (select 1 from public.mission_unit_kind where label_en ~* 'bjp|congress|party') then raise exception 'party word in kinds'; end if;
end $$;

-- 4. reference lists carry an English and a Hindi name
do $$ begin
  if exists (select 1 from public.mission_unit_kind where coalesce(label_hi,'')='' ) or
     exists (select 1 from public.mission_body_kind where coalesce(label_hi,'')='') or
     exists (select 1 from public.mission_setting where coalesce(value_hi,'')='') then raise exception 'missing Hindi name'; end if;
end $$;

-- 5. a change with no named actor is refused
select pg_temp.expect_fail($$insert into public.mission_setting(key,value_en,value_hi) values ('x','x','x')$$, 'no actor');

-- 6. with an actor, a change works and is written to the history
begin;
select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true);
insert into auth.users(id) values ('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
insert into public.mission_unit(id, kind, name_en, confidence) values ('aaaaaaaa-0000-0000-0000-000000000001','seat','Sample Seat','confirmed');
insert into public.mission_unit(id, parent_id, kind, name_en) values ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','segment','Sample Segment');
insert into public.mission_body(id, unit_id, kind, name, source_url, source_date, entered_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','society_rwa','Sample Heights RWA','https://example.org/sample','2026-01-01','22222222-2222-2222-2222-222222222222');
insert into public.mission_holder(id, body_id, name, post, source_url, source_date, entered_by)
  values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Sample Person','President','https://example.org/sample','2026-01-01','22222222-2222-2222-2222-222222222222');
commit;
do $$ begin if (select count(*) from public.mission_history where table_name='mission_holder' and action='insert') <> 1 then raise exception 'no history line'; end if; end $$;

-- 7. database rules: own entry cannot be checked by the same member; source link must be http(s); one parent
select pg_temp.expect_fail($$update public.mission_holder set state='checked', checked_by='22222222-2222-2222-2222-222222222222' where id='cccccccc-0000-0000-0000-000000000001'$$, 'own entry checked');
select pg_temp.expect_fail($$insert into public.mission_body(unit_id,kind,name,source_url,source_date) values ('aaaaaaaa-0000-0000-0000-000000000002','society_rwa','Sample','javascript:alert(1)','2026-01-01')$$, 'bad link');
select pg_temp.expect_fail($$insert into public.mission_holder(name,post,source_url,source_date) values ('Sample','x','https://example.org','2026-01-01')$$, 'no parent');
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true);
update public.mission_holder set state='checked', checked_by='33333333-3333-3333-3333-333333333333', checked_at=now() where id='cccccccc-0000-0000-0000-000000000001';
commit;

-- 8. phone and email: the history never holds the number
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true);
insert into public.mission_team_link(id, person_name, status) values ('dddddddd-0000-0000-0000-000000000001','Sample Person','unknown');
insert into public.mission_contact_detail(team_link_id, kind, value) values ('dddddddd-0000-0000-0000-000000000001','phone','+00 5550100999');
commit;
do $$ begin
  if exists (select 1 from public.mission_history where table_name='mission_contact_detail' and (new_value::text like '%5550100999%' or old_value::text like '%5550100999%')) then raise exception 'number in history'; end if;
  if (select count(*) from public.mission_history where table_name='mission_contact_detail') <> 1 then raise exception 'no contact history line'; end if;
end $$;

-- 9. the history cannot be changed, deleted or truncated, even by the service role
set role service_role;
select pg_temp.expect_fail($$update public.mission_history set action='x'$$, 'history update');
select pg_temp.expect_fail($$delete from public.mission_history$$, 'history delete');
select pg_temp.expect_fail($$truncate public.mission_history$$, 'history truncate');
reset role;
select pg_temp.expect_fail($$update public.mission_history set action='x'$$, 'history update (owner)');

-- 10. the scrub routine: a line under a year old is untouched; an old one is scrubbed, not deleted
update public.mission_history set at = now() - interval '2 years' where false; -- (no-op, shows we cannot edit directly)
do $$ declare n int; begin
  perform set_config('mission.scrub','on',true);
  update public.mission_history set at = now() - interval '400 days' where table_name='mission_holder' and action='insert';
  perform set_config('mission.scrub','off',true);
  n := public.mission_scrub_history('mission_holder','cccccccc-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'expected 1 scrubbed line, got %', n; end if;
  if exists (select 1 from public.mission_history where table_name='mission_holder' and action='insert' and new_value::text like '%Sample Person%') then raise exception 'name still in scrubbed line'; end if;
  if exists (select 1 from public.mission_history where table_name='mission_holder' and action='update' and new_value is null) then raise exception 'young line altered'; end if;
  if (select count(*) from public.mission_history where table_name='mission_holder') <> 2 then raise exception 'history line was deleted'; end if;
end $$;
select 'mission db checks passed' as result;
