# Deploying the Forum: Vercel + Supabase

Decided 7 October 2026: the site runs on Vercel (static files plus API functions) and Supabase (Postgres, Storage, Auth). This replaces the Cloudflare + Freshdesk plan in the launch guide; the phases there still apply, with Phase 2 and 3 done by this repository instead of a vendor and a freelancer. Domain: gurugramvisionforum.org, with gurgaonvisionforum.org redirecting to it.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Website | Vercel, static from `site/` | No build step. `vercel.json` sets `outputDirectory` to `site`. |
| `POST /api/report`, `GET /api/status`, `POST /api/join`, `GET /api/dashboard` | Vercel serverless functions in `api/` | Node 20+, ESM. Hold the Supabase service key. |
| Reports, events, joins, master data | Supabase Postgres, schema in `supabase/migrations/` | Row Level Security on every table. Anon key reads master data only. |
| Photos | Supabase Storage bucket `report-photos` | Private, 10 MB, images only. Upload path is the next build item. |
| Volunteer logins | Supabase Auth + `staff` table | Rows in `staff` grant access to reporter details. |

## One-time setup

1. **Supabase project.** Create a project named "Gurugram Vision Forum" in the Catalyse X SR17 organisation, region Mumbai (ap-south-1). Then apply, in order: `supabase/migrations/20261007120000_init.sql` and `supabase/seed.sql`. Either paste them into the SQL editor or run them through the Supabase MCP tool from Claude Code. Regenerate `seed.sql` with `npm run seed` whenever `site/data.js` changes.
2. **Vercel project.** Import the GitHub repository `saurabhrao17/Gurugram-Vision-Forum`. Framework preset: Other. Leave build command empty. Production branch: `main`.
3. **Environment variables** (Vercel → Settings → Environment Variables, all environments):
   - `SUPABASE_URL`: the project's API URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase → Settings → API. Mark it Sensitive. Never put it in `site/`.
   - `IP_HASH_SALT`: any long random string.
   - `TURNSTILE_SECRET` (optional): turns on bot checks for both forms. Needs the matching site key in `site/index.html`.
4. **Domain.** Vercel → Domains: add `gurugramvisionforum.org` and `www`, follow the DNS records shown at the registrar. Add `gurgaonvisionforum.org` as a redirect to the first.
5. **First volunteer login.** Invite the coordinator in Supabase → Authentication → Users, then insert their user id into `public.staff` with role `coordinator`.

## Checks after each deploy

- `GET /api/dashboard` returns `{"ok":true,"published":false,...}` before 50 reports.
- Submit a report from a phone: the confirmation shows a server reference (the device shows "saved on this device only" if the API is unreachable).
- Track page: reference plus last four digits of the mobile returns the stage; a wrong last four is refused.
- `node tests/smoke.mjs` passes locally; `npm test` runs the unit tests for the API validation.

## Privacy, as enforced

- Phone numbers and names live in `reports` and `joins`, readable only by `staff` or the service role.
- The status endpoint returns stage, dates, desk and official ticket number. Nothing about the reporter.
- The dashboard endpoint returns counts and medians only, and nothing at all until 50 reports exist.
- IP addresses are stored as salted hashes for rate limiting (5 reports per address per hour).
- Retention: reports are to be deleted 24 months after closure. A scheduled job for this is a next build item.

## Next build items on this stack

1. Triage view for volunteers (`#/triage`, Supabase Auth): list and filter reports, set stage and desk, paste official ticket numbers.
2. Photo upload from the report form to the `report-photos` bucket.
3. Daily cron (Vercel Cron) for SLA flags: unmapped past 3 working days, filed past 21 days; email to the coordinator.
4. Stage-change notifications by email, then WhatsApp once Meta verification is done.
5. WhatsApp and Exotel webhooks creating reports with `source` set accordingly.
6. Public anonymised report pages with follow buttons.
7. 24-month retention job.
