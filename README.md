# Gurugram Vision Forum

Website and launch material for the Gurugram Vision Forum, a citizens' platform that routes Gurugram's civic problems to the desk responsible and follows them to closure.

Start with [HANDOFF.md](HANDOFF.md): project context, research record, design system, site notes, CRM evaluation, launch guide and benchmark. Working rules for contributors and for Claude Code are in [CLAUDE.md](CLAUDE.md).

| Folder | Contents |
| --- | --- |
| `site/` | The website: `index.html`, `styles.css`, `data.js`, `app.js`. Open `index.html` in a browser; no build step. |
| `api/`, `lib/` | Vercel serverless functions (report, status, join, dashboard) and their shared code |
| `supabase/` | Database schema (migrations) and the generated seed |
| `archive/` | Single-file v3 build (as published) and the earlier v2, for reference |
| `data/` | Site content as JSON and CSV, the seed for the master-data sheet |
| `design/` | The design-system stylesheet on its own |
| `docs/` | Launch guide and civic-platform benchmark |
| `deck/` | The original PDF deck |
| `tests/` | Unit tests (`npm test`) and the Playwright smoke test (`node tests/smoke.mjs`) |

Runs on Vercel and Supabase; see [docs/deploy.md](docs/deploy.md). Domain: gurugramvisionforum.org.

Not a government website. Emergencies: 112.
