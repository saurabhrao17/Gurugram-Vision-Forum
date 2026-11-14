-- Checks for the Mission tables, run by scripts/mission-db-test.sh on a throwaway database.
-- FAKE data only: every name starts with "Sample", every number and email is obviously fake.
\set ON_ERROR_STOP on
-- (a test helper in the throwaway database only) expect_fail(query, why, message_fragment): the query must fail AND its error text must contain the fragment.
create or replace function public.test_expect_fail(q text, why text, frag text) returns void language plpgsql as $$
declare msg text;
begin
  begin execute q; exception when others then
    get stacked diagnostics msg = message_text;
    if position(lower(frag) in lower(msg)) = 0 then raise exception 'FAILED FOR THE WRONG REASON (%): %', why, msg; end if;
    return;
  end;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', why;
end $$;
grant execute on function public.test_expect_fail(text,text,text) to public;

-- 1. every mission table has row level security on and no policy; every data table has the history trigger and the truncate refusal
do $$ declare t record; begin
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'mission\_%' escape '\' and c.relkind='r' loop
    if not t.relrowsecurity then raise exception 'RLS off on %', t.relname; end if;
    if t.relname <> 'mission_history' then
      if not exists (select 1 from pg_trigger g where g.tgrelid = ('public.'||t.relname)::regclass and g.tgname='mission_audit') then raise exception 'no history trigger on %', t.relname; end if;
      if not exists (select 1 from pg_trigger g where g.tgrelid = ('public.'||t.relname)::regclass and g.tgname='mission_no_truncate') then raise exception 'no truncate refusal on %', t.relname; end if;
    end if;
  end loop;
  if exists (select 1 from pg_policies where tablename like 'mission\_%' escape '\') then raise exception 'a mission policy exists'; end if;
end $$;

-- 2. anon and authenticated have no right on any mission table; service_role has no truncate/trigger/references; history is select+insert only
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'mission\_%' escape '\' and c.relkind='r' loop
    if has_table_privilege('anon', 'public.'||t.relname, 'select,insert,update,delete,truncate')
       or has_table_privilege('authenticated', 'public.'||t.relname, 'select,insert,update,delete,truncate') then
      raise exception 'anon/authenticated can reach %', t.relname; end if;
    if has_table_privilege('service_role', 'public.'||t.relname, 'truncate') or has_table_privilege('service_role', 'public.'||t.relname, 'trigger') or has_table_privilege('service_role', 'public.'||t.relname, 'references') then
      raise exception 'service_role has an extra right on %', t.relname; end if;
  end loop;
  if has_table_privilege('service_role','public.mission_history','update') or has_table_privilege('service_role','public.mission_history','delete') then raise exception 'service_role can change history'; end if;
  if not (has_table_privilege('service_role','public.mission_history','select') and has_table_privilege('service_role','public.mission_history','insert')) then raise exception 'service_role cannot read/add history'; end if;
end $$;

-- 2b. functions: only service_role may run the scrub routine; the audit/guard/truncate functions are not callable by anon, authenticated or public
do $$ begin
  if has_function_privilege('anon','public.mission_scrub_history(text,text)','execute') or has_function_privilege('authenticated','public.mission_scrub_history(text,text)','execute') then raise exception 'scrub routine callable by anon/authenticated'; end if;
  if not has_function_privilege('service_role','public.mission_scrub_history(text,text)','execute') then raise exception 'service_role cannot run the scrub routine'; end if;
  if has_function_privilege('anon','public.mission_audit()','execute') or has_function_privilege('authenticated','public.mission_audit()','execute')
     or has_function_privilege('anon','public.mission_history_guard()','execute') or has_function_privilege('authenticated','public.mission_history_guard()','execute')
     or has_function_privilege('anon','public.mission_refuse_truncate()','execute') or has_function_privilege('authenticated','public.mission_refuse_truncate()','execute') then raise exception 'a mission function is callable by anon/authenticated'; end if;
end $$;
-- a key with no rights reads nothing and writes nothing
set role anon;
select public.test_expect_fail($$select * from public.mission_unit$$, 'anon read', 'permission denied');
select public.test_expect_fail($$insert into public.mission_setting(key,value_en,value_hi) values ('a','a','a')$$, 'anon write', 'permission denied');
reset role;
set role authenticated;
select public.test_expect_fail($$select * from public.mission_holder$$, 'authenticated read', 'permission denied');
select public.test_expect_fail($$select public.mission_scrub_history('mission_holder','x')$$, 'authenticated scrub', 'permission denied');
reset role;

-- 3. the party ladder tables are empty, and no party word is in any seeded label
do $$ begin
  if (select count(*) from public.mission_party_unit) <> 0 or (select count(*) from public.mission_unit_party) <> 0 then raise exception 'party ladder not empty'; end if;
  if exists (select 1 from public.mission_unit_kind where label_en ~* 'bjp|congress|party|mandal|booth')
     or exists (select 1 from public.mission_body_kind where label_en ~* 'bjp|congress|party|mandal|booth')
     or exists (select 1 from public.mission_setting where value_en ~* 'bjp|congress|party|mandal|booth') then raise exception 'party word in seeded labels'; end if;
end $$;

-- 4. reference lists carry an English and a Hindi name
do $$ begin
  if exists (select 1 from public.mission_unit_kind where coalesce(label_hi,'')='' ) or
     exists (select 1 from public.mission_body_kind where coalesce(label_hi,'')='') or
     exists (select 1 from public.mission_setting where coalesce(value_hi,'')='') then raise exception 'missing Hindi name'; end if;
end $$;

-- 5. a change with no named actor is refused (for the right reason)
select public.test_expect_fail($$insert into public.mission_setting(key,value_en,value_hi) values ('x','x','x')$$, 'no actor', 'no acting member named');

-- 6. with an actor, a change works and is written to the history
begin;
select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true) \gset
insert into auth.users(id) values ('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333'),('44444444-4444-4444-4444-444444444444');
insert into public.mission_unit(id, kind, name_en, confidence) values ('aaaaaaaa-0000-0000-0000-000000000001','seat','Sample Seat','confirmed');
insert into public.mission_unit(id, parent_id, kind, name_en) values ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','segment','Sample Segment');
insert into public.mission_body(id, unit_id, kind, name, source_url, source_date, entered_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','society_rwa','Sample Heights RWA','https://example.org/sample','2026-01-01','22222222-2222-2222-2222-222222222222');
insert into public.mission_holder(id, body_id, name, post, source_url, source_date, entered_by)
  values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Sample Person','President','https://example.org/sample','2026-01-01','22222222-2222-2222-2222-222222222222');
commit;
do $$ begin if (select count(*) from public.mission_history where table_name='mission_holder' and action='insert') <> 1 then raise exception 'no history line'; end if; end $$;

-- 7. database rules
select public.test_expect_fail($$update public.mission_holder set state='checked', checked_by='22222222-2222-2222-2222-222222222222', checked_at=now() where id='cccccccc-0000-0000-0000-000000000001'$$, 'own entry checked', 'mission_holder_checked_ok');
select public.test_expect_fail($$update public.mission_holder set state='checked' where id='cccccccc-0000-0000-0000-000000000001'$$, 'checked without a checker', 'mission_holder_checked_ok');
select public.test_expect_fail($$insert into public.mission_body(unit_id,kind,name,source_url,source_date,entered_by) values ('aaaaaaaa-0000-0000-0000-000000000002','society_rwa','Sample','javascript:alert(1)','2026-01-01','22222222-2222-2222-2222-222222222222')$$, 'bad link', 'source_url');
select public.test_expect_fail($$insert into public.mission_holder(name,post,source_url,source_date,entered_by) values ('Sample','x','https://example.org','2026-01-01','22222222-2222-2222-2222-222222222222')$$, 'no parent', 'mission_holder_one_parent');
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true) \gset
update public.mission_holder set state='checked', checked_by='33333333-3333-3333-3333-333333333333', checked_at=now() where id='cccccccc-0000-0000-0000-000000000001';
commit;

-- 8. phone and email, team notes and proposal payloads never reach the history
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true) \gset
insert into public.mission_team_link(id, person_name, status, notes) values ('dddddddd-0000-0000-0000-000000000001','Sample Person','unknown','call +00 5550100888 please');
insert into public.mission_contact_detail(team_link_id, kind, value) values ('dddddddd-0000-0000-0000-000000000001','phone','+00 5550100999');
insert into public.mission_proposal(kind, payload, source_url, source_date, found_by) values ('holder','{"phone":"+00 5550100777"}','https://example.org/p','2026-01-01','hand');
commit;
do $$ begin
  if exists (select 1 from public.mission_history where new_value::text like '%5550100999%' or old_value::text like '%5550100999%' or new_value::text like '%5550100888%' or new_value::text like '%5550100777%') then raise exception 'a number reached the history'; end if;
  if (select count(*) from public.mission_history where table_name='mission_contact_detail') <> 1 then raise exception 'no contact history line'; end if;
end $$;

-- 9. the party link has a history line with a combined id
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true) \gset
insert into public.mission_party_unit(id, tier, name) values ('eeeeeeee-0000-0000-0000-000000000001','sample_tier','Sample Unit');
insert into public.mission_unit_party(unit_id, party_unit_id) values ('aaaaaaaa-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000001');
commit;
do $$ begin if not exists (select 1 from public.mission_history where table_name='mission_unit_party' and row_id='aaaaaaaa-0000-0000-0000-000000000002:eeeeeeee-0000-0000-0000-000000000001') then raise exception 'no party link history'; end if; end $$;
delete from public.mission_unit_party where false;

-- 10. the history cannot be changed, deleted or truncated, even with the scrub flag on, even by the owner
set role service_role;
select public.test_expect_fail($$update public.mission_history set action='x'$$, 'history update', 'permission denied');
select public.test_expect_fail($$delete from public.mission_history$$, 'history delete', 'permission denied');
select public.test_expect_fail($$truncate public.mission_history$$, 'history truncate', 'permission denied');
select public.test_expect_fail($$truncate public.mission_contact_detail cascade$$, 'service truncate', 'permission denied');
select set_config('mission.scrub','on',false);
select public.test_expect_fail($$update public.mission_history set action='x'$$, 'update with scrub flag as service', 'permission denied');
select set_config('mission.scrub','off',false);
reset role;
select public.test_expect_fail($$update public.mission_history set action='x'$$, 'history update (owner)', 'cannot be changed or deleted');
select public.test_expect_fail($$delete from public.mission_history$$, 'history delete (owner)', 'cannot be changed or deleted');
select public.test_expect_fail($$truncate public.mission_history$$, 'history truncate (owner)', 'cannot be changed or deleted');
select public.test_expect_fail($$truncate public.mission_contact_detail cascade$$, 'table truncate (owner)', 'cannot be truncated');
begin; select set_config('mission.scrub','on',true);
select public.test_expect_fail($$delete from public.mission_history$$, 'delete even with the scrub flag', 'never deleted or truncated');
select public.test_expect_fail($$truncate public.mission_history$$, 'truncate even with the scrub flag', 'never deleted or truncated');
rollback;

-- 11. account deletion: an account that only entered rows can be deleted (no foreign key); a member's account cannot while the member row exists
delete from auth.users where id='22222222-2222-2222-2222-222222222222';
begin; select set_config('mission.actor','11111111-1111-1111-1111-111111111111', true) \gset
insert into public.mission_member(user_id, role) values ('44444444-4444-4444-4444-444444444444','contributor');
commit;
select public.test_expect_fail($$delete from auth.users where id='44444444-4444-4444-4444-444444444444'$$, 'member account delete', 'mission_member');

-- 12. the scrub routine, called as service_role: a line under a year old is untouched; an old one is scrubbed, not deleted
do $$ begin
  perform set_config('mission.scrub','on',true);
  update public.mission_history set at = now() - interval '400 days' where table_name='mission_holder' and action='insert';
  perform set_config('mission.scrub','off',true);
end $$;
set role service_role;
do $$ declare n int; begin
  n := public.mission_scrub_history('mission_holder','cccccccc-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'expected 1 scrubbed line, got %', n; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.mission_history where table_name='mission_holder' and action='insert' and new_value::text like '%Sample Person%') then raise exception 'name still in scrubbed line'; end if;
  if (select scrubbed_at from public.mission_history where table_name='mission_holder' and action='insert') is null then raise exception 'old line not marked scrubbed'; end if;
  if (select scrubbed_at from public.mission_history where table_name='mission_holder' and action='update') is not null then raise exception 'young line was scrubbed'; end if;
  if not exists (select 1 from public.mission_history where table_name='mission_holder' and action='update' and new_value::text like '%Sample Person%') then raise exception 'young line lost its content'; end if;
  if (select count(*) from public.mission_history where table_name='mission_holder') <> 2 then raise exception 'history line was deleted'; end if;
end $$;
select 'mission db checks passed' as result;
