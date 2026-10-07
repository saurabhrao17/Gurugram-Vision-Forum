-- Writes issue_types.filing for one issue type. Exists because the Supabase
-- connector used from Claude Code holds a plain UPDATE for a confirmation and
-- times out; a SELECT that calls this function goes through.
create or replace function public.gvf_set_filing(p_id text, p_filing jsonb)
returns boolean language sql as $$
  with u as (update public.issue_types set filing = p_filing where id = p_id returning 1)
  select exists(select 1 from u);
$$;
revoke all on function public.gvf_set_filing(text, jsonb) from public, anon, authenticated;
