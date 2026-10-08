-- Reporter replies (8 Oct 2026, owner's ask): the desk asks a reporter for
-- the missing filing items by email from the Forum's own address, and the
-- reply comes back to the ticket by itself.
--  * outbox.reply_to: the ask carries Reply-To desk@<domain> so a reply
--    reaches the inbound webhook, never a volunteer's own mailbox;
--  * inbox.report_id / report_ref / attachments: an inbound mail whose
--    subject or body carries a report reference is linked to that report,
--    and its files are stored on the report (private bucket) and listed here;
--  * reports.asked_at: when the reporter was last asked.
-- Applied live with execute_sql.
alter table public.outbox add column if not exists reply_to text;
alter table public.inbox
  add column if not exists report_id uuid references public.reports(id) on delete set null,
  add column if not exists report_ref text,
  add column if not exists attachments jsonb not null default '[]'::jsonb;
create index if not exists inbox_report_idx on public.inbox (report_id, received_at desc) where report_id is not null;
alter table public.reports add column if not exists asked_at timestamptz;
