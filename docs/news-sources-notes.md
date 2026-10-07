# News sources: what each official site offers

Companion to `data/news-sources.json`. Compiled 7 October 2026; first live check the same evening.

**How it is checked.** The development sandbox cannot reach any government host, so `.github/workflows/news-sources.yml` runs `scripts/check-news-sources.mjs` on GitHub Actions (manually and every Monday 03:00 UTC). It fetches every source plus the probe list in `data/news-candidates.json`, parses them exactly as the daily cron would, prints a table in the job summary and, with `--dump`, the first 160 anchors of each HTML page with their ancestor chain so a selector can be chosen. Run it on one source with `--only=id1,id2`. The `verified` field in the JSON records the outcome: a date means items were parsed on that day; `unverified` means the URL is set but the selector still has to be confirmed on the next run; `failing`, `blocked` (times out from GitHub's US runners, so the host probably answers only Indian IPs) and `js-only` explain why an entry is switched off (`enabled: false`); `none` means there is no page to fetch.

## Result of the live checks (7 October 2026, runs 37684031089 and 37687124291)

| Outcome | Sources |
| --- | --- |
| Items parsed, on | gurugram-district-notices (the home page's New Updates tab, 31 items), ulb-whats-new, ulb-notifications, haryana-assembly (now the WordPress feed), hrera (23), dhbvn (home-page notices), cpcb-announcements (88, title taken from the row), pib-rss (Chandigarh regional feed, Hindi) |
| HTTP error, kept on | gurugram-district-feed (500; recovers by itself if the site is fixed) |
| Off: no linked titles or JavaScript-rendered list | lokbhavan (card titles are not links, feed 500), haryana-portal (events list scripted, feed 403), haryana-police (ASP.NET postback), mcg, nhai, hsvp-tenders |
| Off: times out from GitHub runners (likely India-only) | prharyana, gmda, dtcp, eci-press (re-check from an Indian machine with `--only=prharyana,gmda,dtcp,eci-press`) |
| Off: broken TLS chain, http refused | hspcb |
| Off: not a feed | mygov-blog |

9 of the 21 page-bearing entries are on. Parser changes made from these runs: a selector collects every matching container (card grids, several tables); share, login, payment and "View all" links count as navigation; a link whose text is only "View (2 MB)" or a file size takes its title from the table row, and the date too when it sits in another cell; "Click here ->" prefixes and quotes are stripped from titles; the probe dumps 160 anchors and takes `--only=id`. The probe list `data/news-candidates.json` is empty again; add URLs there to try them on the next run.

**Still open:** DIPR (prharyana.gov.in) is the one source worth chasing, since it carries GMDA, MCG and police press notes; it needs a fetch from India. GMDA's own site likewise.

## Table

| id | Site | Page | Type | Verified | Renders without JS | Cadence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gurugram-district-feed | gurugram.gov.in | /feed/ | rss | unverified | yes | irregular | S3WaaS/WordPress; posts are sparse, notices are the content |
| gurugram-district-notices | gurugram.gov.in | /notice_category/announcements/ | html | unverified | yes | weekly to monthly | Orders, advisories, AQI advisories, tenders |
| ulb-whats-new | ulbharyana.gov.in | /Home/WhatsNew | html | index (items Aug 2026) | yes | weekly | Best MCG notice source; Gurugram sector-level permissions |
| ulb-notifications | ulbharyana.gov.in | /Home/Notification | html | index (items Dec 2025) | yes | monthly | Gazette notifications, ward delimitation, codes |
| haryana-assembly | haryanaassembly.gov.in | /news-press-release/ | html | index (items May 2026) | yes | session-driven | WordPress; /feed/ likely |
| hsvp-tenders | hsvphry.org.in | /Home/Tenders | html | index (Jun 2026) | yes | rare | IT tenders only; low value |
| prharyana | prharyana.gov.in | /en/press-releases | html | unverified | yes (Drupal) | daily | DIPR; Hindi and English; /en/rss.xml likely |
| haryana-portal | haryana.gov.in | /notice/ | html | unverified | yes | weekly | S3WaaS; state-wide |
| lokbhavan | lokbhavan.haryana.gov.in | /press-releases/ | html | index | yes | weekly | Governor's office |
| gmda | gmda.gov.in | home (replace) | html | unverified | likely | several per week | Press pages not indexed; find the menu link |
| mcg | mcg.gov.in | home (replace) | html | unverified | likely | weekly | Not indexed; use ulb-whats-new meanwhile |
| haryana-police | haryanapolice.gov.in | home (replace) | html | unverified | likely | daily | Press notes exist (relayed by UNI) |
| dhbvn | dhbvn.org.in | home (replace) | html | unverified | likely | weekly | Shutdown notices are the useful item |
| hspcb | hspcb.gov.in | home (replace) | html | unverified | likely | monthly | Site rebuilt after a hack; ops on hrocmms.nic.in |
| hrera | haryanarera.gov.in | /login/loginview/2 | html | index (Aug 2026) | yes | weekly | Public notices and cause lists as PDFs |
| dtcp | tcpharyana.gov.in | home (replace) | html | unverified | likely | weekly | ASP.NET; find Public Notices .aspx |
| cpcb-announcements | cpcb.nic.in | /archive-important-announcements.php | html | index | yes | monthly | Current items on index.php and /media-corner-new/ |
| pib-rss | pib.gov.in | /RssMain.aspx | rss | unverified | n/a | daily | Per-ministry and regional feeds; covers NHAI, ECI, MoHUA, Consumer Affairs, DARPG |
| mygov-blog | blog.mygov.in | /feed/ | rss | unverified | n/a | weekly | WordPress |
| eci-press | eci.gov.in | /press-release | html | unverified | **no, JS-only** | daily | Use PIB instead |
| nhai | nhai.gov.in | /#/press-release | html | unverified | **no, JS-only** | weekly | Angular SPA; use PIB MoRTH feed |
| swachh | sbmurban.org | none | none | | | | Campaign site |
| cm-window | cmharyanacell.nic.in | none | none | | | | Login portal |
| saral | saralharyana.gov.in | none | none | | | | Login portal |
| cpgrams | pgportal.gov.in | none | none | | | | Login portal |
| rti-online | rtionline.gov.in | none | none | | | | Filing portal |
| consumer-helpline | consumerhelpline.gov.in | none | none | | | | Filing portal |
| cybercrime | cybercrime.gov.in | none | none | | | | Filing portal |
| onemap | onemapggm.gmda.gov.in | none | none | | **no, JS-only** | | GIS viewer |
| social-handles | X / Facebook | none | none | | **no, JS + login** | daily | No fetchable public page |

Counts: 21 entries with a page (2 RSS, 19 HTML), of which 7 are index-verified, 12 unverified-by-pattern, 2 JS-only; 9 entries with no usable page.

## Sources that render only with JavaScript (fetcher skips)

- eci.gov.in (React app, press notes loaded from an API)
- nhai.gov.in (Angular, hash routes)
- onemapggm.gmda.gov.in (GIS viewer)
- X and Facebook pages of MCG, GMDA, Gurugram Police, DC Gurugram

For all four, PIB's RSS covers the central bodies; for the Gurugram agencies the practical route is the DIPR portal (prharyana.gov.in), which carries their press notes, plus ulbharyana.gov.in for MCG notices.

## Selector guidance

Selectors in the JSON are starting points based on each platform:

- S3WaaS (gurugram.gov.in, haryana.gov.in): notice lists are tables; `table td a` catches the PDF or detail link. Taxonomy feeds exist at `/notice_category/<slug>/feed/`.
- ASP.NET MVC (ulbharyana, hsvphry): `table tr td a`.
- WordPress (haryanaassembly, lokbhavan, blog.mygov.in): prefer `/feed/`; else `article h2 a`.
- Drupal (prharyana): `.view-content a`; prefer `/en/rss.xml`.
- PHP lists (haryanarera, cpcb): PDF links with `viewPdf`, `.pdf`.

The fetcher should dedupe on `href`, keep the link text as the title, parse `dd-mm-yyyy` dates from the same row, and ignore links whose text is under 12 characters (navigation).

## Verification command

Run from any machine that can reach Indian government hosts:

```sh
jq -r '.[] | select(.url != "") | .url' data/news-sources.json | while read u; do
  printf '%s | ' "$u"; curl -sS -L -o /tmp/p.html -w '%{http_code} %{size_download}' --max-time 30 -A 'Mozilla/5.0' "$u"; echo
done
```

A 200 with a body over roughly 5 KB and visible `<a href` tags means the page renders server-side; a tiny body with a `<div id="root">` or `<app-root>` means JS-only. Update `verified` and `selector` accordingly.
