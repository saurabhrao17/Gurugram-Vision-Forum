# Decisions log

| Date | Decision | Why |
| --- | --- | --- |
| 7 Oct 2026 | Domain is gurugramvisionforum.org; gurgaonvisionforum.org redirects to it | Matches the email domain and the city's legal name. Both were available on 7 Oct 2026 and still need to be bought. |
| 7 Oct 2026 | Vercel + Supabase instead of Cloudflare Pages/Workers + Freshdesk | The owner already runs both. No per-seat cost, data stays in Postgres, public report pages and open data become simple. The triage inbox and SLA automation are built here instead of configured in Freshdesk. |
| 7 Oct 2026 | Server generates the report reference | One source of truth. The browser only falls back to a local reference when the API is unreachable, and says so. |
| 7 Oct 2026 | Status lookup needs reference plus last four digits of the mobile | Launch guide appendix B deliverable 3; returns stage and dates only. |
| 7 Oct 2026 | Dashboard publishes nothing until 50 reports | HANDOFF.md section 1, rule 4. The endpoint returns the running total only. |
| 7 Oct 2026 | Volunteer desk signs in with email and password, accounts created by the coordinator | No email sending needed at launch, so no SMTP or redirect-URL setup; Supabase's built-in mailer is rate-limited. Magic links can come later with custom SMTP. |
| 7 Oct 2026 | The desk is a separate static page (`triage.html`), not a route in the public app | Keeps the public bundle and its Hindi dictionary unchanged, and keeps reporter details out of the public app's code paths. |
| 7 Oct 2026 | The desk lives inside the main site at `#/desk` | Owner's ask: move freely between public pages and the desk. The earlier separate page was a privacy convenience, not a requirement. |
| 7 Oct 2026 | Ward volunteers: one lead and one support per ward, scoped to their wards; coordinators and owners see all | Owner's operating model. Assignments are data (`ward_volunteers`), changed from the Team tab. |
| 7 Oct 2026 | Maps start on OpenStreetMap tiles and Nominatim; Google Geocoding switches in when a key is provided | Works today without a billing account. Google is better for Indian addresses and is a one-line environment change. |
| 7 Oct 2026 | Ward boundaries come from GMDA's GIS file, not an API | No public API exists for MCG wards. The database and form are ready for the file; until then wards come from the resident, the sector table and the desk. |
| 7 Oct 2026 | All API routes go through one serverless function (`api/[...path].js`) | The Hobby plan allows 12 functions per deployment; the desk and map work took us to 13 and every deploy failed. One router removes the ceiling and keeps new routes a one-line change. |
