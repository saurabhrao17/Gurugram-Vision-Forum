# Decisions log

| Date | Decision | Why |
| --- | --- | --- |
| 7 Oct 2026 | Domain is gurugramvisionforum.org; gurgaonvisionforum.org redirects to it | Matches the email domain and the city's legal name. Both were available on 7 Oct 2026 and still need to be bought. |
| 7 Oct 2026 | Vercel + Supabase instead of Cloudflare Pages/Workers + Freshdesk | The owner already runs both. No per-seat cost, data stays in Postgres, public report pages and open data become simple. The triage inbox and SLA automation are built here instead of configured in Freshdesk. |
| 7 Oct 2026 | Server generates the report reference | One source of truth. The browser only falls back to a local reference when the API is unreachable, and says so. |
| 7 Oct 2026 | Status lookup needs reference plus last four digits of the mobile | Launch guide appendix B deliverable 3; returns stage and dates only. |
| 7 Oct 2026 | Dashboard publishes nothing until 50 reports | HANDOFF.md section 1, rule 4. The endpoint returns the running total only. |
