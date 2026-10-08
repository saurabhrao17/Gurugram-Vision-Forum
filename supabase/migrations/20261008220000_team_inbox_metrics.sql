-- Team structure, inbox and performance (owner's ask, 8 Oct 2026):
--  * a coordinator over a cluster of 5-6 wards, plus the ward lead and
--    support volunteer; people carry a mobile number; assignment is per
--    person, not per ward;
--  * an inbox for mail that reaches the Forum (through an inbound-email
--    webhook), worked from the desk like join requests;
--  * ward ageing and per-person activity for the Performance tab and the
--    daily brief to owners.

alter table public.staff
  add column if not exists phone  text,
  add column if not exists active boolean not null default true;

alter table public.ward_volunteers drop constraint if exists ward_volunteers_role_check;
alter table public.ward_volunteers add constraint ward_volunteers_role_check check (role in ('coordinator', 'lead', 'support'));

create or replace view public.ward_assignments with (security_invoker = false) as
  -- a replaced view may only append columns: the original eight stay first
  select w.ward, w.councillor,
         l.user_id as lead_user_id,        sl.name as lead_name,        sl.email as lead_email,
         s.user_id as support_user_id,     ss.name as support_name,     ss.email as support_email,
         c.user_id as coordinator_user_id, sc.name as coordinator_name, sc.email as coordinator_email, sc.phone as coordinator_phone,
         sl.phone as lead_phone, ss.phone as support_phone
    from public.wards w
    left join public.ward_volunteers l on l.ward = w.ward and l.role = 'lead'
    left join public.staff sl on sl.user_id = l.user_id
    left join public.ward_volunteers s on s.ward = w.ward and s.role = 'support'
    left join public.staff ss on ss.user_id = s.user_id
    left join public.ward_volunteers c on c.ward = w.ward and c.role = 'coordinator'
    left join public.staff sc on sc.user_id = c.user_id
   order by w.ward;
revoke all on public.ward_assignments from anon, authenticated;

-- Replace one person's ward roles in one transaction. p_wards is a jsonb
-- array of {ward, role}; another person already holding (ward, role) is
-- replaced, since the roster is the source of truth.
create or replace function public.set_staff_wards(p_user uuid, p_wards jsonb, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  delete from public.ward_volunteers where user_id = p_user;
  for r in select (x->>'ward')::smallint as ward, x->>'role' as role from jsonb_array_elements(coalesce(p_wards, '[]'::jsonb)) x loop
    if r.ward between 1 and 36 and r.role in ('coordinator', 'lead', 'support') then
      insert into public.ward_volunteers (ward, role, user_id, assigned_at, assigned_by)
      values (r.ward, r.role, p_user, now(), p_by)
      on conflict (ward, role) do update set user_id = excluded.user_id, assigned_at = now(), assigned_by = excluded.assigned_by;
    end if;
  end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('ward', ward, 'role', role) order by ward, role), '[]'::jsonb)
            from public.ward_volunteers where user_id = p_user);
end $$;
revoke all on function public.set_staff_wards(uuid, jsonb, text) from public, anon, authenticated;

-- Inbox: mail that reaches the Forum (inbound-email webhook), worked from the desk.
create table if not exists public.inbox (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'email',
  external_id text unique,
  from_email  text,
  from_name   text,
  subject     text,
  body_text   text,
  received_at timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new', 'read', 'done')),
  notes       text,
  handled_by  text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists inbox_status_received_idx on public.inbox (status, received_at desc);
alter table public.inbox enable row level security;
revoke all on public.inbox from anon, authenticated;

-- Ageing per ward: open reports by age, overdue, last week's flow, last activity.
create or replace function public.ward_ageing() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ward', w.ward, 'councillor', w.councillor,
    'open',        (select count(*) from public.reports r where r.ward = w.ward and r.stage < 4),
    'a0_3',        (select count(*) from public.reports r where r.ward = w.ward and r.stage < 4 and r.created_at >  now() - interval '3 days'),
    'a4_7',        (select count(*) from public.reports r where r.ward = w.ward and r.stage < 4 and r.created_at <= now() - interval '3 days'  and r.created_at > now() - interval '7 days'),
    'a8_21',       (select count(*) from public.reports r where r.ward = w.ward and r.stage < 4 and r.created_at <= now() - interval '7 days'  and r.created_at > now() - interval '21 days'),
    'a22p',        (select count(*) from public.reports r where r.ward = w.ward and r.stage < 4 and r.created_at <= now() - interval '21 days'),
    'unmapped',    (select count(*) from public.reports r where r.ward = w.ward and r.stage = 0),
    'overdue',     (select count(*) from public.reports r where r.ward = w.ward and ((r.stage = 0 and public.working_days_between(r.created_at, now()) > 3) or (r.stage = 2 and r.official_filed_at < now() - interval '21 days'))),
    'received_7d', (select count(*) from public.reports r where r.ward = w.ward and r.created_at > now() - interval '7 days'),
    'resolved_7d', (select count(*) from public.reports r where r.ward = w.ward and r.resolved_at > now() - interval '7 days'),
    'oldest_open_days', (select coalesce(max(extract(epoch from (now() - r.created_at)) / 86400)::int, 0) from public.reports r where r.ward = w.ward and r.stage < 4),
    'last_activity_at', (select max(e.created_at) from public.report_events e join public.reports r on r.id = e.report_id where r.ward = w.ward)
  ) order by w.ward), '[]'::jsonb)
  from public.wards w;
$$;
revoke all on function public.ward_ageing() from public, anon, authenticated;

-- Activity per person: wards held, actions logged on the timeline (the actor
-- column carries "Name <email>" or the email), open and overdue in their wards.
create or replace function public.staff_activity() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', s.user_id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'role', s.role, 'active', s.active,
    'wards', (select coalesce(jsonb_agg(jsonb_build_object('ward', v.ward, 'role', v.role) order by v.ward), '[]'::jsonb) from public.ward_volunteers v where v.user_id = s.user_id),
    'actions_7d',  (select count(*) from public.report_events e where s.email is not null and e.actor ilike '%' || s.email || '%' and e.created_at > now() - interval '7 days'),
    'actions_30d', (select count(*) from public.report_events e where s.email is not null and e.actor ilike '%' || s.email || '%' and e.created_at > now() - interval '30 days'),
    'last_action_at', (select max(e.created_at) from public.report_events e where s.email is not null and e.actor ilike '%' || s.email || '%'),
    'open_in_wards', (select count(*) from public.reports r where r.stage < 4 and r.ward in (select v.ward from public.ward_volunteers v where v.user_id = s.user_id)),
    'overdue_in_wards', (select count(*) from public.reports r where r.ward in (select v.ward from public.ward_volunteers v where v.user_id = s.user_id)
                           and ((r.stage = 0 and public.working_days_between(r.created_at, now()) > 3) or (r.stage = 2 and r.official_filed_at < now() - interval '21 days')))
  ) order by s.role, s.name), '[]'::jsonb)
  from public.staff s;
$$;
revoke all on function public.staff_activity() from public, anon, authenticated;
