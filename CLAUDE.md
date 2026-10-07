# Gurugram Vision Forum website

Read HANDOFF.md first; it holds the context, research, design rules and roadmap.

## Layout
- `site/` is the website: `index.html`, `styles.css`, `data.js`, `app.js`. Static, hash-routed, no framework, no build step unless we deliberately add one.
- `archive/` holds the single-file v3 build (what was published as the Claude artifact) and the older v2. Reference only; do not edit.
- `data/` holds the content exports (JSON and CSVs) that seed the master-data sheet. `site/data.js` is the source of truth until the sheet exists; regenerate the exports from it, not the other way round.
- `design/tokens-and-components.css` is a copy of `site/styles.css` kept as the design-system reference; update both together.
- `docs/` holds the launch guide and the civic-platform benchmark. `deck/` holds the original PDF.
- `tests/smoke.mjs` is the Playwright smoke test; run it before committing.

## Rules
- Content lives in `site/data.js` (`window.GVF`). Edit data, not markup, to change issues, portals, charters, roles, wards, Hindi strings.
- Design tokens and components are in `styles.css`; keep the navy-led palette, saffron as accent only (never saffron text on white), Anek/Noto type, 44 px targets, visible focus, reduced-motion support.
- Public copy is non-partisan; never add party framing to civic tools. Party appears only as a factual field (ward table).
- Never display or transmit a reporter's phone number publicly; public pages and dashboards show counts, never names.
- Dashboard shows commitments vs actuals with a date and source; never present the deck's targets as results.
- Every external link must be an official page; update `GVF.VERIFIED` when links are checked.
- Keep Hindi strings in `GVF.HI` in step with new UI text (`data-i18n` keys).
- Secrets never go in the HTML or JS; they belong in the Worker environment.
- Test with Playwright on 390 px and 1366 px before committing: every route, the 4-step report flow, track, sheets, search, theme and language toggles, zero console errors. `node tests/smoke.mjs` does the basic pass.

## Next build items (in order)
1. Cloudflare Worker: POST /report (Turnstile + Freshdesk ticket), GET /status (ref + last4), POST /join, nightly dashboard.json. Secrets in Worker env, never in HTML.
2. Wire the site's report form, track page, join form and dashboard to those endpoints with clear error states; keep the localStorage fallback.
3. Photo upload to R2 (images, 10 MB).
4. "Report on WhatsApp" deep link and helpline number once available.
5. Privacy notice page; sector-to-ward lookup; real URLs and OG tags.
