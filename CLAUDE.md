# Gurugram Vision Forum website

Read HANDOFF.md first; it holds the context, research, design rules and roadmap.

## Stack (decided 7 Oct 2026, see docs/decisions.md and docs/deploy.md)
- Vercel hosts the static site from `site/` and the API functions in `api/`. Supabase holds the data (Postgres, Storage, Auth). No Cloudflare, no Freshdesk.
- Domain: gurugramvisionforum.org (gurgaonvisionforum.org redirects to it).

## Layout
- `site/` is the website: `index.html`, `styles.css`, `data.js`, `app.js`. Static, hash-routed, no framework, no build step unless we deliberately add one.
- `api/` holds the Vercel serverless functions (`report`, `status`, `join`, `dashboard`, and `triage/*` for the volunteer desk); `lib/` holds their shared code. ESM, Node 20+.
- `site/triage.html` + `site/triage.js` is the volunteer desk (English only; internal tool). It shares `styles.css` and `data.js` with the public site and talks only to `/api/triage/*` with a Supabase Auth bearer token.
- `supabase/migrations/` is the schema; `supabase/seed.sql` is generated from `site/data.js` by `npm run seed`. Apply both to a new project in that order.
- `archive/` holds the single-file v3 build (what was published as the Claude artifact) and the older v2. Reference only; do not edit.
- `data/` holds the content exports (JSON and CSVs) that seed the master-data sheet. `site/data.js` is the source of truth until the sheet exists; regenerate the exports from it, not the other way round.
- `design/tokens-and-components.css` is a copy of `site/styles.css` kept as the design-system reference; update both together.
- `docs/` holds the launch guide and the civic-platform benchmark. `deck/` holds the original PDF.
- `tests/smoke.mjs` is the Playwright smoke test (file:// pass plus an http pass with a mocked API); `tests/unit/` are node:test unit tests for the API validation. Run both before committing.

## Rules
- Content lives in `site/data.js` (`window.GVF`). Edit data, not markup, to change issues, portals, charters, roles, wards, Hindi strings.
- Design tokens and components are in `styles.css`; keep the navy-led palette, saffron as accent only (never saffron text on white), Anek/Noto type, 44 px targets, visible focus, reduced-motion support.
- Public copy is non-partisan; never add party framing to civic tools. Party appears only as a factual field (ward table).
- Never display or transmit a reporter's phone number publicly; public pages and dashboards show counts, never names.
- Dashboard shows commitments vs actuals with a date and source; never present the deck's targets as results.
- Every external link must be an official page; update `GVF.VERIFIED` when links are checked.
- Keep Hindi strings in `GVF.HI` in step with new UI text (`data-i18n` keys).
- Secrets never go in the HTML or JS; they belong in the Vercel environment (`.env.example` lists them). The browser only ever calls `/api/*`.
- The API returns no reporter details: status gives stage and dates after a reference plus last-4 check; the dashboard gives counts and publishes nothing before 50 reports.
- The site must keep working when the API is unreachable: local reference, "saved on this device" notice, local track view.
- Test before committing: `npm test` (unit) and `node tests/smoke.mjs` (Playwright on 390 px and 1366 px: every route, the 4-step report flow, track, sheets, search, theme and language toggles, the mocked API pass, zero console errors).

## Next build items (in order)
1. Photo upload from the report form to the `report-photos` bucket (images, 10 MB) through an API function.
2. Vercel Cron for SLA flags (3 working days unmapped, 21 days filed) and stage-change emails; WhatsApp templates after Meta verification.
3. "Report on WhatsApp" deep link and helpline number once they exist; WhatsApp and Exotel webhooks creating reports.
4. Privacy notice page; sector-to-ward lookup from `area_wards`; public anonymised report pages; real URLs and OG tags; 24-month retention job.
5. Clearer geolocation message in the report form (permission denied vs unavailable).
