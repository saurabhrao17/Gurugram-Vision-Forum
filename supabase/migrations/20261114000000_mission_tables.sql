-- Mission 2029 MP page, step 1 of the plan: the tables and their locks (14 Nov 2026).
--
-- Plan: "Internal / Mission 2029 MP plan / 2026-11-14 / v2" (Drive, Gurugram-Vision-Forum folder).
-- This is step 1 only. It creates NEW tables, all named mission_*, all empty except two
-- small reference lists (level names and body kinds). It changes no existing table, policy
-- or function. Nothing reads or writes these tables yet: there is no page, no sign-in and no
-- API code for them. Each later step has its own vote and the owner's yes.
--
-- What this does, in one transaction:
--   1. creates the mission_ tables (members, places, shapes, body kinds, bodies, post holders,
--      party ladder, team notes, contact details, proposals, import batches, history, settings);
--   2. turns row level security ON for every one of them and creates NO policy, and takes every
--      right away from anon and authenticated, so only the service role (the API) can touch them,
--      the same rule as every other table on this project;
--   3. adds the history: every insert, update or delete on a mission_ table writes a line to
--      mission_history, and REFUSES the change if no acting member was named for it
--      (select set_config('mission.actor', '<member uuid>', true) inside the same transaction).
--      For phone and email the history keeps only that a number was shown, changed or added,
--      never the number;
--   4. makes the history add-only: the service role cannot update or delete a history line, a trigger
--      stops it, and the ONE exception is the scrub routine (mission_scrub_history), which removes
--      personal details from lines older than a year and leaves a dated mark;
--   5. adds two database rules that need no code: a person's entry cannot be marked Checked by the
--      same member who entered it, and a source link must start with http or https;
--   6. puts in the level names and the body kinds, each with an English and a Hindi name. The party
--      ladder tables are created EMPTY and stay empty until step 8; no party or tier name is here.
--
-- Decisions written down on purpose (found in review, 14 Nov 2026):
--   * Account deletion: the "entered by / checked by / updated by / loaded by / reviewed by" columns are plain
--     uuids with NO foreign key to auth.users (like mission_history.actor), so deleting a sign-in account never
--     fails because of them. Only mission_member keeps a foreign key (so a member is a real account). To remove
--     a member: set the actor, delete or deactivate the member row (set active = false is the normal way), then
--     delete the account. Deleting an account that still has a member row is refused, on purpose.
--   * The API uses the service role, which bypasses row level security, so it could in principle write a
--     history line directly, and mission.actor is not checked against mission_member. That is accepted for an
--     API-only design; it is why every write must go through the small routines of later steps, and why the
--     service role cannot change or remove a line once written.
--   * The history copies a changed row EXCEPT three things that can hold a phone number or email: the value of a
--     contact detail, the notes of a team link and the payload of a proposal (it records that they changed).
--   * Not here, by design: the retention months setting (step 9) and the party ladder label (step 8). Body kinds
--     carry usual_posts as typing suggestions in English only; they are not shown as labels, so they are exempt
--     from translation.
--
-- ROLLBACK (needs the owner's yes: it drops tables; run as one transaction):
--   begin;
--   drop table if exists public.mission_history, public.mission_contact_detail,
--     public.mission_team_link, public.mission_proposal, public.mission_import_batch,
--     public.mission_holder, public.mission_body, public.mission_body_kind,
--     public.mission_unit_party, public.mission_party_unit, public.mission_geometry,
--     public.mission_unit, public.mission_unit_kind, public.mission_setting,
--     public.mission_member cascade;
--   drop function if exists public.mission_audit(), public.mission_history_guard(),
--     public.mission_refuse_truncate(), public.mission_scrub_history(text, text);
--   commit;

begin;

-- ------------------------------------------------------------------ members
create table public.mission_member (
  user_id    uuid primary key references auth.users(id) on delete restrict,
  role       text not null check (role in ('viewer', 'contributor', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.mission_import_batch (
  id         uuid primary key default gen_random_uuid(),
  pack_name  text not null,
  file_name  text,
  row_count  integer not null default 0,
  loaded_by  uuid,
  status     text not null default 'loaded' check (status in ('loaded', 'retired')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ places
create table public.mission_unit_kind (
  code     text primary key,
  label_en text not null,
  label_hi text not null,
  rank     integer not null
);

create table public.mission_unit (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.mission_unit(id),
  kind          text not null references public.mission_unit_kind(code),
  name_en       text not null,
  name_hi       text,
  ac_no         integer,
  district      text,
  zone          text,
  locality_type text,
  source_url    text check (source_url is null or source_url ~ '^https?://'),
  source_date   date,
  confidence    text not null default 'needs_check' check (confidence in ('confirmed', 'inferred', 'needs_check')),
  pack_id       uuid references public.mission_import_batch(id),
  retired       boolean not null default false,
  aliases       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index mission_unit_parent_idx on public.mission_unit(parent_id);
create index mission_unit_kind_idx on public.mission_unit(kind);

create table public.mission_geometry (
  unit_id uuid primary key references public.mission_unit(id) on delete cascade,
  geojson jsonb not null,
  bbox    jsonb
);

-- ------------------------------------------------------------------ party ladder (EMPTY until step 8)
create table public.mission_party_unit (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.mission_party_unit(id),
  tier       text not null,
  name       text not null,
  ac_no      integer,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  source_date date
);

create table public.mission_unit_party (
  unit_id       uuid not null references public.mission_unit(id) on delete cascade,
  party_unit_id uuid not null references public.mission_party_unit(id) on delete cascade,
  primary key (unit_id, party_unit_id)
);

-- ------------------------------------------------------------------ bodies and post holders
create table public.mission_body_kind (
  code        text primary key,
  label_en    text not null,
  label_hi    text not null,
  usual_posts jsonb not null default '[]'::jsonb
);

create table public.mission_body (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references public.mission_unit(id),
  kind           text not null references public.mission_body_kind(code),
  name           text not null,
  website        text check (website is null or website ~ '^https?://'),
  office_address text,
  kind_note      text,
  source_url     text not null check (source_url ~ '^https?://'),
  source_date    date not null,
  state          text not null default 'proposed' check (state in ('proposed', 'checked', 'rejected')),
  auto_placed    boolean not null default false,
  entered_by     uuid not null,
  checked_by     uuid,
  checked_at     timestamptz,
  pack_id        uuid references public.mission_import_batch(id),
  retired        boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint mission_body_checked_ok check (state <> 'checked' or (checked_by is not null and checked_at is not null and checked_by <> entered_by))
);
create index mission_body_unit_idx on public.mission_body(unit_id);

create table public.mission_holder (
  id          uuid primary key default gen_random_uuid(),
  body_id     uuid references public.mission_body(id),
  unit_id     uuid references public.mission_unit(id),
  name        text not null,
  post        text not null,
  term_note   text,
  source_url  text not null check (source_url ~ '^https?://'),
  source_date date not null,
  state       text not null default 'proposed' check (state in ('proposed', 'checked', 'rejected')),
  former      boolean not null default false,
  entered_by  uuid not null,
  checked_by  uuid,
  checked_at  timestamptz,
  pack_id     uuid references public.mission_import_batch(id),
  created_at  timestamptz not null default now(),
  constraint mission_holder_one_parent check ((body_id is null) <> (unit_id is null)),
  constraint mission_holder_checked_ok check (state <> 'checked' or (checked_by is not null and checked_at is not null and checked_by <> entered_by))
);
create index mission_holder_body_idx on public.mission_holder(body_id);
create index mission_holder_unit_idx on public.mission_holder(unit_id);

-- ------------------------------------------------------------------ the team layer (typed in only by the team)
create table public.mission_team_link (
  id          uuid primary key default gen_random_uuid(),
  holder_id   uuid references public.mission_holder(id),
  body_id     uuid references public.mission_body(id),
  unit_id     uuid references public.mission_unit(id),
  person_name text,
  post        text,
  status      text not null default 'unknown' check (status in ('yes', 'progress', 'no', 'unknown')),
  owner_id    uuid references public.mission_member(user_id),
  notes       text,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Phone and email: a separate table (plan step 7A decides who sees them; nothing is stored in step 1).
create table public.mission_contact_detail (
  id           uuid primary key default gen_random_uuid(),
  team_link_id uuid references public.mission_team_link(id),
  body_id      uuid references public.mission_body(id),
  kind         text not null check (kind in ('phone', 'email')),
  value        text not null,
  entered_by   uuid,
  created_at   timestamptz not null default now(),
  constraint mission_contact_one_parent check ((team_link_id is null) <> (body_id is null))
);

-- ------------------------------------------------------------------ proposals, imports, settings
create table public.mission_proposal (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  payload     jsonb not null,
  source_url  text not null check (source_url ~ '^https?://'),
  source_date date not null,
  found_by    text not null check (found_by in ('hand', 'import', 'scheduled_run')),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);


create table public.mission_setting (
  key      text primary key,
  value_en text not null,
  value_hi text not null
);

-- ------------------------------------------------------------------ history (add-only)
create table public.mission_history (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid not null,
  action     text not null,
  table_name text not null,
  row_id     text not null,
  old_value  jsonb,
  new_value  jsonb,
  scrubbed_at timestamptz
);
create index mission_history_row_idx on public.mission_history(table_name, row_id);

-- Writes a history line for every change. Refuses the change when no actor is named.
create function public.mission_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_text text := nullif(current_setting('mission.actor', true), '');
  o jsonb;
  n jsonb;
  rid text;
begin
  if actor_text is null then
    raise exception 'mission: no acting member named for this change (set mission.actor)';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then n := to_jsonb(new); end if;
  -- Phone and email are never copied into the history.
  -- Also not copied: team notes and proposal payloads (they could hold a number typed in by mistake).
  if tg_table_name = 'mission_contact_detail' then
    o := case when o is null then null else o - 'value' end;
    n := case when n is null then null else n - 'value' end;
  elsif tg_table_name = 'mission_team_link' then
    o := case when o is null then null else o - 'notes' end;
    n := case when n is null then null else n - 'notes' end;
  elsif tg_table_name = 'mission_proposal' then
    o := case when o is null then null else o - 'payload' end;
    n := case when n is null then null else n - 'payload' end;
  end if;
  if tg_table_name = 'mission_unit_party' then
    rid := coalesce(n ->> 'unit_id', o ->> 'unit_id') || ':' || coalesce(n ->> 'party_unit_id', o ->> 'party_unit_id');
  else
    rid := coalesce(n ->> coalesce(tg_argv[0], 'id'), o ->> coalesce(tg_argv[0], 'id'));
  end if;
  insert into public.mission_history(actor, action, table_name, row_id, old_value, new_value)
  values (actor_text::uuid, lower(tg_op), tg_table_name, rid, o, n);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Attach the history to every table that holds data (not to the history itself).
create trigger mission_audit after insert or update or delete on public.mission_member
  for each row execute function public.mission_audit('user_id');
create trigger mission_audit after insert or update or delete on public.mission_unit
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_geometry
  for each row execute function public.mission_audit('unit_id');
create trigger mission_audit after insert or update or delete on public.mission_body
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_holder
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_party_unit
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_unit_party
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_team_link
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_contact_detail
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_proposal
  for each row execute function public.mission_audit();
create trigger mission_audit after insert or update or delete on public.mission_import_batch
  for each row execute function public.mission_audit();

-- The history cannot be edited or deleted, except by the scrub routine below.
create function public.mission_history_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('mission.scrub', true), '') <> 'on' then
    raise exception 'mission: history lines cannot be changed or deleted';
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'mission: history lines are never deleted or truncated, only scrubbed';
  end if;
  return new;
end $$;
create trigger mission_history_guard before update or delete on public.mission_history
  for each row execute function public.mission_history_guard();
create trigger mission_history_no_truncate before truncate on public.mission_history
  for each statement execute function public.mission_history_guard();

-- The scrub routine: removes personal details from the history lines of one row that are
-- at least a year old (kept at least one year from the day each line was written) and leaves
-- a dated mark. Called by the erase action (step 5) and the clean-up (step 9); not before.
create function public.mission_scrub_history(p_table text, p_row_id text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform set_config('mission.scrub', 'on', true);
  update public.mission_history
     set old_value = case when old_value is null then null else '{"scrubbed": true}'::jsonb end,
         new_value = case when new_value is null then null else '{"scrubbed": true}'::jsonb end,
         scrubbed_at = now()
   where table_name = p_table and row_id = p_row_id
     and at < now() - interval '1 year' and scrubbed_at is null;
  get diagnostics n = row_count;
  perform set_config('mission.scrub', 'off', true);
  return n;
end $$;
revoke execute on function public.mission_scrub_history(text, text) from public, anon, authenticated;
grant execute on function public.mission_scrub_history(text, text) to service_role;
revoke execute on function public.mission_audit(), public.mission_history_guard() from public, anon, authenticated;

-- Nothing may truncate a mission table (a truncate would skip the row-level history).
create function public.mission_refuse_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'mission: tables cannot be truncated';
end $$;
create trigger mission_no_truncate before truncate on public.mission_member for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_unit_kind for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_unit for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_geometry for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_party_unit for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_unit_party for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_body_kind for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_body for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_holder for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_team_link for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_contact_detail for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_proposal for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_import_batch for each statement execute function public.mission_refuse_truncate();
create trigger mission_no_truncate before truncate on public.mission_setting for each statement execute function public.mission_refuse_truncate();
revoke execute on function public.mission_refuse_truncate() from public, anon, authenticated;

-- ------------------------------------------------------------------ locks
alter table public.mission_member         enable row level security;
alter table public.mission_unit_kind      enable row level security;
alter table public.mission_unit           enable row level security;
alter table public.mission_geometry       enable row level security;
alter table public.mission_party_unit     enable row level security;
alter table public.mission_unit_party     enable row level security;
alter table public.mission_body_kind      enable row level security;
alter table public.mission_body           enable row level security;
alter table public.mission_holder         enable row level security;
alter table public.mission_team_link      enable row level security;
alter table public.mission_contact_detail enable row level security;
alter table public.mission_proposal       enable row level security;
alter table public.mission_import_batch   enable row level security;
alter table public.mission_setting        enable row level security;
alter table public.mission_history        enable row level security;

revoke all on public.mission_member, public.mission_unit_kind, public.mission_unit,
  public.mission_geometry, public.mission_party_unit, public.mission_unit_party,
  public.mission_body_kind, public.mission_body, public.mission_holder,
  public.mission_team_link, public.mission_contact_detail, public.mission_proposal,
  public.mission_import_batch, public.mission_setting, public.mission_history
  from anon, authenticated;

-- (Supabase grants every right on new tables to service_role by default, so take them all back, then give only what is needed.)
revoke all on public.mission_member, public.mission_unit_kind, public.mission_unit,
  public.mission_geometry, public.mission_party_unit, public.mission_unit_party,
  public.mission_body_kind, public.mission_body, public.mission_holder,
  public.mission_team_link, public.mission_contact_detail, public.mission_proposal,
  public.mission_import_batch, public.mission_setting from service_role;
grant select, insert, update, delete on public.mission_member, public.mission_unit_kind,
  public.mission_unit, public.mission_geometry, public.mission_party_unit,
  public.mission_unit_party, public.mission_body_kind, public.mission_body,
  public.mission_holder, public.mission_team_link, public.mission_contact_detail,
  public.mission_proposal, public.mission_import_batch, public.mission_setting
  to service_role;
-- The history: the service can read and add lines, never change or remove them.
-- (Supabase grants every right on new tables to service_role by default, so take them back first.)
revoke all on public.mission_history from service_role;
grant select, insert on public.mission_history to service_role;

-- ------------------------------------------------------------------ reference lists (levels and body kinds)
insert into public.mission_unit_kind (code, label_en, label_hi, rank) values
  ('seat',      'Seat',                              'सीट',                          1),
  ('segment',   'Assembly segment',                  'विधानसभा क्षेत्र',              2),
  ('ulb',       'Municipal body',                    'नगर निकाय',                    3),
  ('block',     'Rural block',                       'ग्रामीण खंड',                   3),
  ('ward',      'Ward',                              'वार्ड',                         4),
  ('panchayat', 'Gram panchayat',                    'ग्राम पंचायत',                  4),
  ('locality',  'Locality (sector, village, colony)', 'इलाका (सेक्टर, गाँव, कॉलोनी)', 5),
  ('society',   'Society or condominium',            'सोसायटी या कॉन्डोमिनियम',        6),
  ('unplaced',  'Unplaced (placement needed)',       'स्थान तय होना बाकी',            7);

insert into public.mission_body_kind (code, label_en, label_hi, usual_posts) values
  ('society_rwa',      'Society or condominium RWA',        'सोसायटी या कॉन्डोमिनियम आरडब्ल्यूए', '["President","Secretary","Treasurer"]'),
  ('sector_rwa',       'Sector RWA',                        'सेक्टर आरडब्ल्यूए',                '["President","Secretary","Treasurer"]'),
  ('colony_rwa',       'Colony or village RWA',             'कॉलोनी या गाँव आरडब्ल्यूए',        '["President","Secretary","Treasurer"]'),
  ('federation',       'Federation of RWAs',                'आरडब्ल्यूए महासंघ',                 '["President","Secretary"]'),
  ('seniors_council',  'Senior citizens'' council',         'वरिष्ठ नागरिक परिषद',               '["President","Secretary"]'),
  ('sarpanch_assoc',   'Sarpanch association',              'सरपंच संघ',                        '["President","Secretary"]'),
  ('trade_market',     'Market association or traders'' committee', 'बाज़ार संघ या व्यापारी समिति', '["President","General Secretary","Treasurer"]'),
  ('chemists',         'Chemists'' association',            'केमिस्ट संघ',                      '["President","Secretary"]'),
  ('hospitality',      'Hotels, banquets and tent dealers', 'होटल, बैंक्वेट और टेंट डीलर',        '["President","Secretary"]'),
  ('transport_union',  'Transport union',                   'ट्रांसपोर्ट यूनियन',                '["President","Secretary"]'),
  ('mandi_arhtiya',    'Arhtiya or mandi body',             'आढ़ती या मंडी संगठन',               '["President","Secretary"]'),
  ('trade_other',      'Other trade body',                  'अन्य व्यापार संगठन',                '["President","Secretary"]'),
  ('industrial',       'Industrial association',            'औद्योगिक संघ',                      '["President","Secretary","Treasurer"]'),
  ('industrial_area',  'Industrial-area owners'' or residents'' association', 'औद्योगिक क्षेत्र मालिक या निवासी संघ', '["President","Secretary"]'),
  ('chamber',          'Business chamber',                  'व्यापार मंडल',                      '["President","Secretary"]'),
  ('bni',              'BNI chapter',                       'बीएनआई चैप्टर',                     '["President","Secretary"]'),
  ('service_club',     'Lions, Rotary, Bharat Vikas Parishad and similar clubs', 'लायंस, रोटरी, भारत विकास परिषद जैसे क्लब', '["President","Secretary"]'),
  ('cghs',             'CGHS beneficiary or welfare body',  'सीजीएचएस लाभार्थी या कल्याण संगठन',  '["President","Secretary"]'),
  ('medical',          'Hospital or doctors'' association', 'अस्पताल या डॉक्टर संघ',              '["President","Secretary"]'),
  ('school_education', 'School, parents'' or alumni body',  'स्कूल, अभिभावक या पूर्व छात्र संगठन',  '["Chair","Secretary"]'),
  ('college_coaching', 'College or coaching association',   'कॉलेज या कोचिंग संघ',                '["President","Secretary"]'),
  ('professional',     'Bar or professional body',          'बार या पेशेवर संगठन',               '["President","Secretary"]'),
  ('community_social', 'Community or caste sabha',          'समुदाय या जाति सभा',                '["President","Secretary"]'),
  ('religious_cultural','Religious or cultural committee',  'धार्मिक या सांस्कृतिक समिति',        '["President","Secretary"]'),
  ('women_youth',      'Women''s or youth group',           'महिला या युवा समूह',                '["President","Secretary"]'),
  ('civic_ngo',        'Civic NGO',                         'नागरिक एनजीओ',                     '["President","Secretary"]'),
  ('farmer',           'Farmer union or cooperative',       'किसान यूनियन या सहकारी समिति',       '["President","Secretary"]'),
  ('ex_servicemen',    'Ex-servicemen body',                'पूर्व सैनिक संगठन',                 '["President","Secretary"]'),
  ('other',            'Other (name the kind in the kind note)', 'अन्य (प्रकार का नाम "प्रकार नोट" में लिखें)',       '[]');

insert into public.mission_setting (key, value_en, value_hi) values
  ('us_label',        'GVF Election Team', 'जीवीएफ चुनाव टीम'),
  ('status_yes',      'With us',           'हमारे साथ'),
  ('status_progress', 'In talks',          'बातचीत में'),
  ('status_no',       'Not with us',       'हमारे साथ नहीं'),
  ('status_unknown',  'Not known',         'पता नहीं');

-- History on the reference lists and settings too (after the seed rows above, which are not edits).
create trigger mission_audit after insert or update or delete on public.mission_unit_kind
  for each row execute function public.mission_audit('code');
create trigger mission_audit after insert or update or delete on public.mission_body_kind
  for each row execute function public.mission_audit('code');
create trigger mission_audit after insert or update or delete on public.mission_setting
  for each row execute function public.mission_audit('key');

commit;
