# Gurugram Vision Forum website

Read HANDOFF.md first; it holds the context, research, design rules and roadmap.

## Stack (decided 7 Oct 2026, see docs/decisions.md and docs/deploy.md)
- Vercel hosts the static site from `site/` and the API functions in `api/`. Supabase holds the data (Postgres, Storage, Auth). No Cloudflare, no Freshdesk.
- Domain: gurugramvisionforum.org (gurgaonvisionforum.org redirects to it).

## Layout
- `site/` is the website: `index.html`, `styles.css`, `data.js`, `app.js`. Static, hash-routed, no framework, no build step unless we deliberately add one.
- `api/index.js` is the single Vercel function, reached through the `/api/:path*` rewrite in `vercel.json`: a router that maps every `/api/*` path to a handler in `lib/handlers/` (`report`, `report/upload-url`, `report/attach`, `status`, `join`, `dashboard`, `ward`, `geocode`, `follow`, `public/report`, `public/reports`, `cron/daily`, `hooks/whatsapp`, `hooks/exotel`, `triage/*`). Add a route by adding a handler and one line in the router. The Hobby plan allows 12 functions per deployment, so never add files under `api/`. `lib/` holds shared code. ESM, Node 20+.
- The volunteer desk is the `#/desk` route inside `site/app.js` (English only; internal tool). It talks only to `/api/triage/*` with a Supabase Auth bearer token. `triage.html` is a redirect kept for old links.
- Maps: MapLibre with OpenStreetMap tiles, lazy-loaded from unpkg only when a map is shown; `/api/geocode` and `/api/ward` do search and ward detection server-side (Google when `GOOGLE_MAPS_KEY` is set). Ward polygons live in `ward_boundaries` (PostGIS), sector names in `area_wards`.
- `supabase/migrations/` is the schema; `supabase/seed.sql` is generated from `site/data.js` by `npm run seed`. Apply both to a new project in that order.
- `archive/` holds the single-file v3 build (what was published as the Claude artifact) and the older v2. Reference only; do not edit.
- `data/` holds the content exports (JSON and CSVs) that seed the master-data sheet. `site/data.js` is the source of truth until the sheet exists; regenerate the exports from it, not the other way round.
- `design/tokens-and-components.css` is a copy of `site/styles.css` kept as the design-system reference; update both together.
- `docs/` holds the launch guide and the civic-platform benchmark. `deck/` holds the original PDF.
- `tests/smoke.mjs` is the Playwright smoke test (file:// pass plus an http pass with a mocked API); `tests/unit/` are node:test unit tests for the API validation. Run both before committing.

## Rules
- Content lives in `site/data.js` (`window.GVF`). Edit data, not markup, to change issues, portals, charters, roles, wards, Hindi strings.
- Every issue type carries what its official portal needs (`GVF.FILING`: fields and document slots with required flags). The report form collects these at step 3, the API stores them in `reports.extra` and `reports.attachments` (files go to the private `report-photos` bucket through one-hour upload tokens and signed URLs; the browser never holds a storage key), and the desk shows the checklist with what is missing. When a portal changes its form, update `FILING`, run `npm run seed`, and write the live `issue_types.filing` with `gvf_set_filing()`.
- Design tokens and components are in `styles.css`; keep the navy-led palette, saffron as accent only (never saffron text on white), Anek/Noto type, 44 px targets, visible focus, reduced-motion support.
- Public copy is non-partisan; never add party framing to civic tools. Party appears only as a factual field (ward table).
- Never display or transmit a reporter's phone number publicly; public pages and dashboards show counts, never names.
- Dashboard shows commitments vs actuals with a date and source; never present the deck's targets as results.
- Every external link must be an official page; update `GVF.VERIFIED` when links are checked.
- The site is fully bilingual. Static markup uses `data-i18n`, `data-i18n-ph` and `data-i18n-aria` keys with Hindi in `GVF.HI`. Everything rendered from data or from app.js goes through `hs("English text")`, which looks the English up in `GVF.HS` (English → Hindi); values sent to the API stay English (`unh()` maps a typed Hindi area back; selects keep English `value` attributes). Blog posts carry `hb` (Hindi HTML). When English copy changes, add or update the matching `HS` entry; the smoke test fails on any Latin word left in Hindi mode that is not an acronym.
- Secrets never go in the HTML or JS; they belong in the Vercel environment (`.env.example` lists them). The browser only ever calls `/api/*`.
- The API returns no reporter details: status gives stage and dates after a reference plus last-4 check; the dashboard gives counts and publishes nothing before 50 reports; the public feed (`public_reports` view, `/r/<ref>`, `/map`) carries no name, contact, description, spot, ticket or file and rounds coordinates to about 100 m.
- Notifications go through the `outbox` table (filled by the `reports_notify_stage` trigger and the daily cron) and are sent by `/api/cron/daily`; never email from a request handler. Inbound WhatsApp and Exotel webhooks create reports with their `source` and dedupe on `inbound_messages`.
- Real URLs (`/report`, `/r/<ref>`, `/map`…) are rewritten to `index.html` in `vercel.json` and moved into the hash at boot; keep the view list in `vercel.json` and in the boot regex in `app.js` in step.
- The site must keep working when the API is unreachable: local reference, "saved on this device" notice, local track view.
- Test before committing: `npm test` (unit) and `node tests/smoke.mjs` (Playwright on 390 px and 1366 px: every route, the 4-step report flow, track, sheets, search, theme and language toggles, the mocked API pass, zero console errors).

## Next build items (in order)
1. Load the MCG ward boundary file (from GMDA's GIS cell) into `ward_boundaries`; volunteers spot-check `area_wards`.
2. Go-live settings the owner supplies: domain in Vercel, `CRON_SECRET`, `COORDINATOR_EMAIL`, Resend key and verified sending domain, then WhatsApp (`L.whatsapp` deep link and the Meta webhook vars) and Exotel after registration.
3. Quarterly review of `GVF.FILING` against each portal's live form; WhatsApp stage-change templates after Meta verification.
4. Analytics (privacy-respecting, counts only) and a public open-data export of the anonymised feed.
