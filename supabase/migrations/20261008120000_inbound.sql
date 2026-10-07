-- Inbound channels (WhatsApp Cloud API webhook, Exotel helpline): one row per
-- provider message or call so retries never create a second report, and a
-- phone-scoped status lookup for "status" replies on WhatsApp.
-- Idempotent; service role only (the webhooks run inside the API).

create table if not exists public.inbound_messages (
  id           bigserial primary key,
  provider     text not null check (provider in ('whatsapp','exotel')),
  external_id  text not null,
  from_number  text,
  payload      jsonb,
  report_id    uuid references public.reports(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists inbound_messages_report_idx on public.inbound_messages (report_id);

alter table public.inbound_messages enable row level security;
-- No policies: RLS denies anon and authenticated; the service role bypasses it.
revoke all on public.inbound_messages from public, anon, authenticated;
revoke all on sequence public.inbound_messages_id_seq from public, anon, authenticated;

-- Newest report from this phone in the last 7 days: ref, stage and created_at
-- only, or null. Used by the WhatsApp webhook when a sender asks for "status"
-- without quoting a reference. The sender's number is the identity check.
create or replace function public.report_for_phone_recent(p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ref', r.ref, 'stage', r.stage, 'created_at', r.created_at)
    from public.reports r
   where r.reporter_phone = p_phone
     and r.created_at > now() - interval '7 days'
   order by r.created_at desc
   limit 1;
$$;
revoke all on function public.report_for_phone_recent(text) from public, anon, authenticated;
grant execute on function public.report_for_phone_recent(text) to service_role;
