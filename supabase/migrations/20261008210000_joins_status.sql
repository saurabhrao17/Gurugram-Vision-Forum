-- Join requests get a workflow so the desk can work them: new -> contacted
-- -> onboarded | declined, with internal notes and who last handled it.
alter table public.joins
  add column if not exists status text not null default 'new',
  add column if not exists notes text,
  add column if not exists handled_by text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.joins drop constraint if exists joins_status_check;
alter table public.joins add constraint joins_status_check check (status in ('new', 'contacted', 'onboarded', 'declined'));
create index if not exists joins_status_created_idx on public.joins (status, created_at desc);
