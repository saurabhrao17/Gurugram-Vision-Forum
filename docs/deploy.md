# Deploying the Forum: Vercel + Supabase

Decided 7 October 2026: the site runs on Vercel (static files plus API functions) and Supabase (Postgres, Storage, Auth). This replaces the Cloudflare + Freshdesk plan in the launch guide; the phases there still apply, with Phase 2 and 3 done by this repository instead of a vendor and a freelancer. Domain: gurugramvisionforum.org, with gurgaonvisionforum.org redirecting to it.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Website | Vercel, static from `site/` | No build step. `vercel.json` sets `outputDirectory` to `site`. |
| `/api/*` (report, status, join, dashboard, ward, geocode, triage/*) | One Vercel serverless function, `api/[...path].js`, routing to `lib/handlers/` | Node 20+, ESM. Holds the Supabase service key. One function because the Hobby plan caps deployments at 12; a 13th file under `api/` fails the deploy with `exceeded_serverless_functions_per_deployment`. |
| Reports, events, joins, master data | Supabase Postgres, schema in `supabase/migrations/` | Row Level Security on every table. Anon key reads master data only. |
| Photos | Supabase Storage bucket `report-photos` | Private, 10 MB, images only. Upload path is the next build item. |
| Volunteer logins | Supabase Auth + `staff` table | Rows in `staff` grant access to reporter details. |
| Volunteer desk | `site/triage.html` + `api/triage/*` | List, filter and update reports; manage accounts. Bearer token from Supabase Auth on every call; the API uses the service role after checking `staff`. |

## One-time setup

1. **Supabase project.** Done 7 Oct 2026: project `Gurugram-Vision-Forum`, ref `xiirhismxuahujdcxsuw`, organisation Catalyse X SR17, region Mumbai (ap-south-1), API URL `https://xiirhismxuahujdcxsuw.supabase.co`. Both migrations in `supabase/migrations/` and `supabase/seed.sql` are applied (17 issue types, 36 wards). For a fresh project, apply them in file order. Regenerate `seed.sql` with `npm run seed` whenever `site/data.js` changes.
   Note for Claude Code: the Supabase connector holds any `drop ... if exists` statement for a confirmation that never arrives in a non-interactive session and then times out, and it times out on large scripts. Apply in chunks of one object group each, sequentially, without `drop` statements on a new project.
2. **Vercel project.** Done 7 Oct 2026: project `gurugram-vision-forum` (id `prj_mm4lhQP11LPgbV3pvvFxTLvctcIV`) on the saurabhrao17's projects team, imported from `saurabhrao17/Gurugram-Vision-Forum`, preset Other, no build command, production branch `main`. Production alias: https://gurugram-vision-forum.vercel.app (renamed from gurugram-visio-forum on 7 Oct 2026; the old alias still resolves). Every push to `main` deploys production; pull requests get preview URLs.
3. **Environment variables** (set 7 Oct 2026 for Production and Preview; Vercel → Settings → Environment Variables):
   - `SUPABASE_URL`: the project's API URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase → Settings → API. Mark it Sensitive. Never put it in `site/`.
   - `IP_HASH_SALT`: any long random string.
   - `TURNSTILE_SECRET` (optional): turns on bot checks for both forms. Needs the matching site key in `site/index.html`.
   - `GOOGLE_MAPS_KEY` (optional): Google Geocoding for the place search; without it the API uses OpenStreetMap Nominatim.
4. **Domain.** Vercel → Domains: add `gurugramvisionforum.org` and `www`, follow the DNS records shown at the registrar. Add `gurgaonvisionforum.org` as a redirect to the first.
5. **Volunteer desk and the first owner.** The desk is the `#/desk` route of the main site (linked from the public footer as "Volunteer sign-in"; a "Desk" item appears in the navigation once signed in; the old `triage.html` redirects). Sign-in is Supabase Auth with email and password; the API checks every request against `public.staff`. Bootstrap once: in Supabase → Authentication → Users → Add user → Create new user, enter the owner's email and a password with "Auto Confirm User" ticked. Then run in the SQL editor:
   ```sql
   insert into public.staff (user_id, name, role, email)
   select id, 'Owner name', 'owner', email from auth.users where email = 'owner@example.org';
   ```
   From then on, owners and coordinators add volunteers from the desk's Team tab (no email is sent; hand the temporary password over in person). Roles: `owner` (everything, can remove accounts), `coordinator` (everything except removing accounts), `triage` = ward volunteer (sees only the wards assigned to them).
6. **Ward volunteers.** Each ward has one lead and one support volunteer, set in the Team tab's ward grid (`ward_volunteers` table). Every ticket shows its ward's volunteers, and ward volunteers see only their wards' reports. Assignments can be changed at any time; the change takes effect on the volunteer's next request.
7. **Maps and ward matching.** The report form has a map pin picker and a place search; the desk has a map of open reports by stage.
   - Map tiles: OpenStreetMap raster tiles through MapLibre, loaded only when a map is shown. Free with attribution; fine at launch scale. For heavy traffic switch to a tile provider (MapTiler, Google) by changing `osmStyle()` in `site/app.js`.
   - Place search: `GET /api/geocode` uses Google Geocoding when `GOOGLE_MAPS_KEY` is set in Vercel (best for Indian addresses; needs a Google Cloud billing account, free monthly credit covers this scale; restrict the key to the Geocoding API), otherwise OpenStreetMap Nominatim, bounded to Gurugram.
   - Ward from a pin: `ward_boundaries` (PostGIS) holds the 36 ward polygons once GMDA's GIS file is loaded. **No public API provides them.** Ask GMDA's GIS cell (OneMap GGM team) for the MCG ward boundary shapefile or KML, or file an RTI; then load it with `ST_GeomFromGeoJSON` into `ward_boundaries`. Until then `ward_for_point` returns null.
   - Ward from an area name: `area_wards` (sector or colony to ward). Fill it from the 2023 delimitation notification (Phase 4 of the launch guide); `ward_for_area` understands "Sector 29", "Sec-29" and colony names inside longer text.
   - Every report stores the resident's ward, the detected ward and its source; the desk flags a mismatch so volunteers can correct it.

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

1. Load the ward boundary file into `ward_boundaries` and fill `area_wards`, so wards are set automatically and checked.
2. Photo upload from the report form to the `report-photos` bucket.
3. Daily cron (Vercel Cron) for SLA flags: unmapped past 3 working days, filed past 21 days; email to the coordinator.
4. Stage-change notifications by email, then WhatsApp once Meta verification is done.
5. WhatsApp and Exotel webhooks creating reports with `source` set accordingly.
6. Public anonymised report pages with follow buttons, on the same map.
7. 24-month retention job.
