-- Newsletter campaigns (8 Oct 2026, owner's ask: operate the newsletter from
-- the desk, never from the mail provider's dashboard). A campaign is written
-- on the desk in English and Hindi, tested on the writer's own address and
-- sent to every confirmed subscriber either as one Resend Broadcast (to the
-- mirrored contacts) or, without a mirror, one mail per subscriber through
-- the outbox with the Forum's own unsubscribe link. Only the service role
-- (the API) touches it. Applied live with execute_sql.
create table if not exists public.campaigns (
  id            bigserial primary key,
  subject       text not null,
  subject_hi    text,
  body          text not null,
  body_hi       text,
  post_id       uuid references public.posts(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  channel       text check (channel in ('broadcast','outbox')),
  broadcast_id  text,
  recipients    int not null default 0,
  sent          int not null default 0,
  failed        int not null default 0,
  last_error    text,
  test_sent_at  timestamptz,
  created_by    text,
  sent_by       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  sent_at       timestamptz
);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
revoke all on sequence public.campaigns_id_seq from anon, authenticated;
alter table public.outbox add column if not exists campaign_id bigint references public.campaigns(id) on delete set null;
create index if not exists outbox_campaign_idx on public.outbox (campaign_id) where campaign_id is not null;
