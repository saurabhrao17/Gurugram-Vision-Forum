-- Subscribers sync (8 Oct 2026, owner's ask: see the weekly-digest sign-ups
-- on the desk and manage subscribe/unsubscribe automatically through a free
-- newsletter tool). The Forum stays the record (double opt-in, token links);
-- confirmed subscribers are mirrored to Resend contacts (free to 1,000
-- contacts, Broadcasts editor, its own unsubscribe link) and unsubscribes
-- flow back through the contact webhooks. Applied live with execute_sql.
alter table public.subscribers
  add column if not exists synced_at timestamptz,
  add column if not exists sync_error text,
  add column if not exists external_id text,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists subscribers_unsynced_idx on public.subscribers (confirmed_at)
  where synced_at is null and confirmed_at is not null and unsubscribed_at is null;
