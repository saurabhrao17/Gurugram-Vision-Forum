# Gurugram Vision Forum — project handoff (chat export)

Exported 7 October 2026 from the Claude project "Gurugram Vision Forum". Owner: Saurabh Rao (CA/CFO, Gurugram). Prepared so that Claude Code, a freelancer or a teammate can pick the work up without the original chat.

This single file records everything the conversation produced: context, research, the design brief, the v3 website, the CRM evaluation, the integration ("connections") list, the step-by-step launch guide and the civic-platform benchmark. The companion files (site code, data, design tokens, deck) are listed in section 10.

---

## 0. Quick start for Claude Code

Paste this as the first message in Claude Code after unzipping the bundle:

> Read HANDOFF.md fully before doing anything. The canonical website is `site/index.html` (single file, hash-routed, no build step). `site-split/` is the same site split into `index.html`, `styles.css`, `data.js`, `app.js` for easier editing; keep both in sync or pick one and delete the other. All content that the pages render lives in the `window.GVF` object in `data.js` (also exported as `data/gvf-data.json` and CSVs). Do not change the design system in `styles.css` without reading section 4 of HANDOFF.md. Public copy must stay non-partisan (see section 1). Nothing on the site may collect or display a reporter's phone number publicly.

Suggested repo layout once in Claude Code:

```
gvf/
  README.md            (copy of this file, or a pointer to it)
  CLAUDE.md            (project rules for Claude Code; a starter is in section 10)
  site/                (static site: index.html, styles.css, data.js, app.js)
  worker/              (Cloudflare Worker: /report, /status, /join, nightly dashboard.json)  [to build]
  data/                (gvf-data.json, CSVs, later the master-data sheet export)
  docs/                (launch-guide.md, civic-platform-benchmark.md, design notes)
  deck/                (original PDF deck)
```

Links that still work outside this bundle:

| What | Link |
| --- | --- |
| Live v3 site (Claude artifact, same URL as v1/v2) | https://claude.ai/artifact/2E2tCJya8m4VqNLmdGehfY |
| Launch guide (Claude Doc, editable) | https://claude.ai/code/artifact/019e58ec-7278-4dc9-9b35-9486efca03c5 |
| Civic platform benchmark (Claude Doc) | https://claude.ai/code/artifact/56dc105d-420d-4ebc-bb8d-2a2c91ced665 |
| Design brief (Advanced Research artifact, not exportable; its decisions are in section 4) | task wf-5828ad28-c812-5fe0-b0e5-4b408e95534c |

---

## 1. The project in one page

**What the Forum is.** Gurugram Vision Forum (GVF) is a citizens–governance civic-policy platform for Gurugram, Haryana. It links residents, government bodies (MCG, GMDA, HSVP, DTCP, district administration, DHBVN, police) and elected representatives. Taglines from the deck: "Citizens and Governance in Partnership"; "Collaborate. Contribute. Change."; "Gurugram: Growing Together".

**Six programmes (from the deck):** policy dialogues with MCG/GMDA officials; urban innovation labs; community townhalls; sewa drives (environment, education, cleanliness); an annual Vision Summit; a digital platform for issue reporting, collaboration and tracking.

**Organisation (from the deck):** Advisory Board of 8–12 experts (corporate, legal, academic, urban planning, media); City Executive Committee (operations, government liaison, policy); Area Chapters (sector/ward committees), Volunteers, Youth Fellows. Funding mix planned: membership 35%, CSR 30%, event sponsorship 20%, grants 15%. Registration as NGO/Trust/Forum is in progress.

**Year-1 roadmap (from the deck):** Q1 Foundation (advisory board, registration, charter, branding/digital); Q2 Mobilisation (area chapters, volunteers, youth fellowship, partnerships); Q3 Outreach (policy dialogues, sewa projects, townhalls, first innovation lab); Q4 Consolidation (Vision Summit, policy documents, impact assessment, year-2 plan).

**Contacts (from the deck):** Project lead Sidharth Yadav, +91 98993 75445, contact@gurugramvisionforum.org, Sector 29, Gurugram. The deck's website line says gurgaonvisionforum.org, which does not match the email domain; the site currently uses gurugramvisionforum.org and the owner must decide.

**Facts used in copy (from the deck, treat as claims):** 12.8 lakh+ residents (2024); 1,000+ corporations and 600+ startups; about 1,100 tonnes of waste a day with roughly 81% dumped without recovery. Municipal turnout 2025 under 42% (research, see section 3).

**Brand:** saffron, green and blue palette; circular unity motif; skyline silhouette. The logo mark used on the site is a placeholder drawn in SVG (ring plus three bars); a real mark is still needed.

**Non-negotiables agreed in the chat**

1. Public copy is non-partisan. The deck frames the Forum around BJP goodwill; everything citizen-facing says "elected representatives" and keeps party politics off civic tools. Party labels appear only where they are a factual record (e.g., the ward table's "party as elected").
2. Every stakeholder, portal and helpline on the site links to its official page; links are dated ("verified 25 Sep 2026") and re-checked monthly.
3. A reporter's phone number is never sent to an authority or shown publicly; public pages and the dashboard show counts, never names.
4. The dashboard never shows the deck's target numbers (75% / 68% / 82%) as results; it shows commitments versus actuals with "Source · Last updated", and a designed empty state until there are 50 real reports.
5. The GMDA integrated portal is the official system of record; the Forum stores its ticket number and builds the public, followable layer on top, it does not replace it.
6. Mobile-first, Hindi toggle, WCAG 2.2 AA intent, 44 px tap targets, reduced-motion respected.

---

## 2. What happened in the conversation, in order

| Step | Date (2026) | What was produced | Where it is now |
| --- | --- | --- | --- |
| 1 | 23–24 Sep | Read the deck; built v1 single-page prototype | Superseded; same artifact URL |
| 2 | 24 Sep | Owner's dictated requirements: working official links for every stakeholder; interactive civic-responsibility section (home/society/ward/city, do's and don'ts, what you owe vs are owed); Hindi toggle; ward-councillor directory; report tracking; dashboard (received/open/closed/awaiting by cause); complaint form with sector/ward selection linked to OneMap auto-fill and post-submission guidance on official forms; mobile friendly; admin/CMS back office; dedicated Blog, Photos & Videos pages; deep research on best NGO/civic sites | Captured in sections 3–5 |
| 3 | 24 Sep | v2 built (157 KB single file), Playwright-tested, published | `site/v2-gurugram-vision-forum.html` |
| 4 | 25 Sep | Civic-platform benchmark (15 platforms) with evidence, matrix, Gurugram warnings, 11-item roadmap | `docs/civic-platform-benchmark.md`, appendix B here |
| 5 | 25–29 Sep | Owner: "too many words; world-class, professional grade, keep all links and info". Advanced research produced a design brief; v3 rebuilt from it | Section 4; `site/index.html` |
| 6 | 29 Sep | v3 published (160 KB raw, 45 KB gzipped); all flows pass on 390 px and 1366 px | Artifact URL above |
| 7 | 30 Sep | "Room for improvement" list; complaint-CRM evaluation (WhatsApp + AI calling + tracking + auto-mapping + queues) | Sections 5.7 and 6 |
| 8 | 30 Sep | Full list of connections needed to make the site record complaints and report back | Section 7 |
| 9 | 30 Sep | Step-by-step launch guide for a non-technical owner, as an editable Claude Doc | `docs/launch-guide.md`, appendix A here |
| 10 | 7 Oct | This export | — |

---

## 3. Research record

### 3.1 Data-source findings that constrain the build

- **OneMap GGM (onemapggm.gmda.gov.in) has no public API.** True ward auto-fill needs the MCG/GMDA 36-ward GIS layer and a point-in-polygon check in the form. Until then the form uses a manual ward dropdown plus links to OneMap and the voter lists; the interim fix is a sector-to-ward lookup table (Phase 4 of the launch guide).
- **The 2023 ward delimitation notification on ulbharyana.gov.in is a scanned PDF** (no text layer). Someone must read and type the sector/colony-to-ward table, then spot-check against OneMap.
- **MCG zone boundaries change often**; store zone as a field on each ward row rather than hard-coding.
- **36 councillors were elected on 2 March 2025, results declared 12 March 2025.** Some independents have since joined parties; the table records party as elected. Councillor office contacts are still to be collected (Phase 4).
- **newzpapr.com (a news source) was blocked** from the research environment; councillor list was cross-checked from other reporting.
- **hspcb.gov.in** could not be verified at the time; all other official links in 3.2 were opened and confirmed on 25 Sep 2026.
- The CPGRAMS 21-day timeline (DARPG guidelines, August 2024) and all deadlines in the rights charters should be re-verified at launch.

### 3.2 Official portals and helplines (24 in the site directory, all linked)

| Portal | Level | For | How / phone | Link |
| --- | --- | --- | --- | --- |
| GMDA integrated grievance portal | Gurugram | Civic complaints for GMDA, MCG, MC Manesar | Web, WhatsApp 78400 01817, myGurugram app · 18001801817 | https://services.gmda.gov.in/ |
| Municipal Corporation of Gurugram | Gurugram | Property tax, building plans, licences, certificates | Online services and zonal offices | https://www.mcg.gov.in/ |
| District Administration, Gurugram | Gurugram | DC office, control room, representatives | Helpline directory and CM Window counter | https://gurugram.gov.in/ |
| OneMap GGM | Gurugram | Ward, sector and jurisdiction maps | Search a sector or drop a pin | https://onemapggm.gmda.gov.in/ |
| Gurugram Police | Gurugram | FIR, verification, women safety, cyber | Women 181, children 1098, cyber 1930 · 112 | https://haryanapolice.gov.in/ |
| CM Window, Haryana | Haryana | Grievance against any Haryana department | Online or at any DC or SDM office | https://cmharyanacell.nic.in/ |
| Auto Appeal System, Right to Service | Haryana | Late notified services escalate automatically | Up to the Right to Service Commission | https://aas.saralharyana.nic.in/ |
| Saral Haryana | Haryana | Notified state services with time limits | Apply, track, keep the number | https://saralharyana.gov.in/ |
| Haryana ULB services and property tax | Haryana | Property tax and no-dues certificate | Search your property ID | https://ulbhryndc.org/ |
| HRERA Gurugram | Haryana | Builder delays, defects, refunds | Online complaint; hearings in Gurugram | https://haryanarera.gov.in/ |
| Town and Country Planning (DTCP) | Haryana | Licensed colonies, handover, violations | District Town Planner, Gurugram | https://tcpharyana.gov.in/ |
| HSVP | Haryana | HSVP sectors, plots, internal services | Estate Officer, Gurugram | https://hsvphry.org.in/ |
| DHBVN | Haryana | Electricity outages, meters, bills | Consumer portal for bills and complaints · 1912 | https://dhbvn.org.in/ |
| Haryana State Pollution Control Board | Haryana | Air, water, noise, construction dust | Regional office, Gurugram | https://hspcb.gov.in/ |
| Haryana Legislative Assembly | Haryana | MLA profiles, attendance, questions | Members section | https://haryanaassembly.gov.in/ |
| CPGRAMS | India | Central departments, 21-day timeline | Interim reply if longer; appeal after feedback | https://pgportal.gov.in/ |
| Swachhata app | India | Garbage, dumping, public toilets | Geo-tagged photo, routed to the ward | https://swachhbharaturban.gov.in/ |
| Sameer app (CPCB) | India | Air quality readings and complaints | Photo complaint to the state board | https://cpcb.nic.in/ |
| RTI Online | India | Information from central bodies, 30 days | 10 rupee fee; first appeal online | https://rtionline.gov.in/ |
| National Consumer Helpline and e-Daakhil | India | Sellers, services, e-commerce disputes | File before the District Commission on e-Daakhil · 1915 | https://consumerhelpline.gov.in/ |
| National Cybercrime Reporting Portal | India | Online and UPI fraud, harassment | Report within the first hour · 1930 | https://cybercrime.gov.in/ |
| NHAI | India | NH-48, expressways, tolls | Helpline for highway issues · 1033 | https://nhai.gov.in/ |
| Voter registration (ECI) | India | Register or shift your vote here | Form 6 new, Form 8 shift · 1950 | https://voters.eci.gov.in/ |
| MyGov | India | Central consultations and ideas | Register and take part | https://www.mygov.in/ |

Other official links used on the site: GMDA toll-free 1800 180 1817; GMDA WhatsApp 78400 01817 (wa.me/917840001817); myGurugram app; district helplines https://gurugram.gov.in/helpline/; district list of representatives https://gurugram.gov.in/public-representative/; Haryana assembly https://haryanaassembly.gov.in/; MoSPI minister profile https://mospi.gov.in/sites/default/files/profileHonMin/Minister_Profile_28062024.pdf; Lok Sabha members https://sansad.in/ls/members; Haryana ULB directorate https://ulbharyana.gov.in/; MoHUA https://mohua.gov.in/; CAQM https://caqm.nic.in/; Haryana government https://haryana.gov.in/.

### 3.3 Elected representatives and office holders (as researched, Sep 2026; verify before publishing)

| Role | Holder | Official page |
| --- | --- | --- |
| Member of Parliament, Gurgaon | Rao Inderjit Singh (BJP), Union Minister of State (IC), Statistics and Planning | https://mospi.gov.in/sites/default/files/profileHonMin/Minister_Profile_28062024.pdf , https://sansad.in/ls/members , https://gurugram.gov.in/public-representative/ |
| Chief Minister and Council of Ministers | Nayab Singh Saini, Chief Minister | https://cmharyanacell.nic.in/ , https://haryana.gov.in/ |
| MLA, Gurgaon (77) | Mukesh Sharma (BJP) | https://haryanaassembly.gov.in/ , https://gurugram.gov.in/public-representative/ |
| MLA, Badshahpur (76) | Rao Narbir Singh (BJP), Cabinet Minister | https://haryanaassembly.gov.in/ , https://gurugram.gov.in/public-representative/ |
| MLA, Sohna (78) | Tejpal Tanwar (BJP) | https://haryanaassembly.gov.in/ , https://gurugram.gov.in/public-representative/ |
| MLA, Pataudi (75) | Bimla Chaudhary (BJP) | https://haryanaassembly.gov.in/ , https://gurugram.gov.in/public-representative/ |
| Municipal Corporation of Gurugram | Mayor Raj Rani Malhotra; Municipal Commissioner; 36 councillors | https://www.mcg.gov.in/ , https://services.gmda.gov.in/ |
| Gurugram Metropolitan Development Authority | Chief Executive Officer | https://www.gmda.gov.in/ , https://services.gmda.gov.in/ , https://onemapggm.gmda.gov.in/ |

The site's Who's who page groups 27 roles into five tiers: Parliament and Union (MP, MoHUA, NHAI, CAQM); Haryana Government (CM, four MLAs, ULB Department, DTCP, Right to Service Commission, HRERA); District administration (DC, SDMs, Commissioner of Police, District Consumer Commission/Registrar); City agencies (GMDA, MCG, MC Manesar, HSVP, DHBVN, HSPCB); Your ward and colony (ward councillor, junior engineer and sanitation supervisor, RWA/AOA, Forum area chapter). Each role has a remit sentence and official links (see data/roles.csv).

### 3.4 The 36 MCG wards (elected 2 March 2025, declared 12 March 2025)

| Ward | Councillor | Party as elected |
| --- | --- | --- |
| 1 | Sundar Singh | BJP |
| 2 | Jyotsna Yadav | BJP |
| 3 | Rakesh Yadav | Independent |
| 4 | Pradeep Kadam | Independent |
| 5 | Ram Avtar Rana | JJP |
| 6 | Satpal | Congress |
| 7 | Dinesh Dahiya | Independent |
| 8 | Naresh Kumar | BJP |
| 9 | Avnish Raghav | Independent |
| 10 | Mahabir | Independent |
| 11 | Kuldeep Yadav | BJP |
| 12 | Ruchi | Independent |
| 13 | Pawan Kumar | BJP |
| 14 | Pratham Vashistha | BJP |
| 15 | Bharati Harshana | BJP |
| 16 | Vikramjit Singh | BJP |
| 17 | Neha Dewatwal | Independent |
| 18 | Jyoti Jaildar | BJP |
| 19 | Raj Singh Amit | BJP |
| 20 | Narayan Bhadana | BJP |
| 21 | Sonia Yadav | BJP |
| 22 | Vikash Yadav | BJP, unopposed |
| 23 | Kunal Yadav | Independent |
| 24 | Aarti Yadav | BJP |
| 25 | Anoop Singh | BJP |
| 26 | Sunita Rani | BJP |
| 27 | Ashish Gupta | BJP |
| 28 | Dharambir Bhangrola | BJP |
| 29 | Usha | BJP |
| 30 | Madhu Batra | BJP |
| 31 | Dalip Kumar Sahani | BJP |
| 32 | Vijay | BJP |
| 33 | Sarika Bhardwaj | Independent |
| 34 | Surekha | BJP |
| 35 | Parminder Kataria | Independent |
| 36 | Rekha | BJP |

Verify links on the site: MCG https://www.mcg.gov.in/ and the 2025 municipal voter lists https://gurugram.gov.in/voter-list-for-mc-election-gurugram-2025/. Office phone, email, zone, JE and sanitation supervisor per ward are still to be collected (launch guide, Phase 4).

### 3.5 The 17 issue types and their responsible desks (the routing table)

| Issue (id) | Responsible desk | Roles involved |
| --- | --- | --- |
| Roads, footpaths (`roads`) | GMDA for master roads, MCG for internal roads | gmda, mcg, hsvp, dtcp, nhai, councillor, je |
| Garbage (`waste`) | MCG sanitation wing | mcg, ulb, mohua, councillor, je, rwa |
| Water, sewer (`water`) | GMDA for bulk supply, MCG for distribution | gmda, mcg, hsvp, je |
| Drains, flooding (`drains`) | GMDA for master drains, MCG for internal drains | gmda, mcg, dc, je |
| Streetlights (`lights`) | MCG for internal roads, GMDA for master roads | mcg, gmda, je |
| Parks, trees (`parks`) | MCG horticulture; HSVP in its sectors; Forest Department for trees | mcg, hsvp |
| Traffic (`traffic`) | Gurugram Traffic Police; GMDA for signals | police, gmda, mcg |
| Electricity (`power`) | DHBVN | dhbvn |
| Air, noise (`pollution`) | HSPCB regional office, Gurugram | hspcb, caqm, mcg, dc |
| Stray animals (`animals`) | MCG veterinary wing | mcg, je |
| Illegal construction (`construction`) | MCG town planning; DTCP for licensed colonies; HSVP in its sectors | mcg, dtcp, hsvp |
| Property tax (`property`) | MCG | mcg, ulb, rts |
| Builders, societies (`housing`) | HRERA Gurugram; DTCP; District Registrar | hrera, dtcp, dc |
| Police, cyber (`safety`) | Gurugram Police | police |
| Consumer (`consumer`) | National Consumer Helpline; District Commission, Gurugram | consumer |
| RTI (`rti`) | The Public Information Officer of that office |  |
| Something else (`other`) | Depends on the subject; the Forum maps it | cm, chapter |

Each issue also carries a remit paragraph, 2–5 official channels with links/phones, and a 3–4 step escalation ladder (see data/issue-types.csv). The standard ladder for MCG/GMDA items: (1) ticket on the GMDA portal, keep the number, only you can close it; (2) no action in time: the officer named on the ticket, then the zone Joint Commissioner or Executive Engineer; (3) still pending: MCG Commissioner and Mayor, or GMDA CEO; (4) final: CM Window with every ticket number attached.

### 3.6 The 11 rights charters (deadline you can quote back)

| Charter | The right | Deadline chip |
| --- | --- | --- |
| Right to Service, Haryana | A notified service within its time limit, or an automatic appeal. | Notified limit |
| CPGRAMS, central complaints | A reply within 21 days from any central ministry or body. | 21 days |
| CM Window and the MCG ladder | A tracked escalation when a civic ticket is closed without a fix. | 3 levels, then CM Window |
| Right to Information | Any record a public authority holds, within 30 days, for 10 rupees. | 30 days |
| Solid Waste Management Rules, 2016 | Segregated waste collected at your door, transported separately and processed. | Daily collection |
| RERA and apartment ownership | Interest or a refund for delay; defects fixed for five years after possession. | 5-year defect liability |
| Consumer Protection Act, 2019 | Redress for defective goods and deficient services, filed from where you live. | District: up to 50 lakh |
| Police: what you are entitled to | A Zero FIR at any station for a cognisable offence, and a free copy. | Cyber fraud: 1 hour |
| Electricity standards of performance | Supply restored and meters fixed within regulator limits, with compensation for delay. | HERC time limits |
| Air quality: GRAP | Enforcement against dust, burning and emissions as the AQI worsens. | GRAP stages 1 to 4 |
| Your vote in Gurugram | Register at your Gurugram address, or shift an existing registration online. | Form 6 new, Form 8 shift |

Each charter has three how-to steps, a why paragraph and source links (data/charters.csv). They are plain-language summaries for orientation, not legal advice.

---

## 4. Design brief and the design system as built

### 4.1 Decisions from the design brief (Advanced Research, 29 Sep 2026)

The brief benchmarked world-class civic and NGO sites and set these rules; v3 implements all of them.

1. **The home page is a router, not a brochure.** Hero question "Who fixes my problem?" with 17 issue tiles. Picking a tile opens a three-column panel: Responsible desk (agency + remit), Official channels (links, phones, WhatsApp, app), If nobody answers (numbered escalation ladder), plus "Report it here too" and "Open the portal".
2. **Summary first, detail one tap deeper, everywhere.** Cards carry one line; sheets/drawers carry the steps and sources.
3. **GOV.UK component grammar:** step-by-step list, tags, summary list (check-and-send), task list with checkboxes, error summary on forms, start-button pattern.
4. **Navy-led palette; saffron is an accent only.** Saffron is never used as text on white (contrast about 2.0:1); it appears as fills, bars, rings and the primary button with navy text.
5. **Type:** Anek Latin + Anek Devanagari for headings, Noto Sans + Noto Sans Devanagari for body (Google Fonts). Body 18 px, 19 px on wide screens; 66 ch measure; 4/8 px spacing scale; 12-column grid; 1200 px container.
6. **Motifs:** a flat skyline divider with a saffron ground line; a 36-segment "unity ring" (one segment per ward) used for the civic score and empty states.
7. **Dashboard as commitments versus actuals** with "Source · Last updated"; designed empty states; never publish deck targets as results.
8. **In-place EN | हिं toggle** (no reload; dictionary of 150 UI strings; long guides stay English for now).
9. **Navigation:** mobile bottom bar Home · Report · Wards · Track · Menu; desktop six-item nav plus a saffron "Report an issue" button; global search with Ctrl/⌘-K across issues, portals, rights, roles and wards.
10. **Accessibility:** WCAG 2.2 AA intent, 44 px targets, visible focus ring (3 px navy + 6 px saffron), colour never the only signal, prefers-reduced-motion respected, skip link, aria-live on the result panel.
11. **Word budgets:** hero ≤ 25 words, intro ≤ 30, card ≤ 20, sentences ≤ 25, tile labels 1–2 words.
12. **Performance budget:** ≤ 150 KB gzipped (v3 is 45 KB gzipped with fonts loaded from Google Fonts).
13. **Caveats the brief flagged:** domain mismatch; BJP wording to keep off civic tools; gallery/press rows are placeholders until the team publishes; contrast ratios calculated, not tested with a screen reader; verify the CPGRAMS 21-day rule.

### 4.2 Tokens (from `styles.css`, `:root`)

| Token | Light | Dark |
| --- | --- | --- |
| --ink (headings, primary) | #0B2545 | #E6EAF0 |
| --blue (links, icons) | #0A4A8C | #7FB2F0 |
| --blue-50 / --blue-100 | #EAF2FB / #D4E4F7 | #132238 / #1B3050 |
| --green / --green-50 | #0F6B3A / #E8F5EC | #4ADE80 / #0F2A1C |
| --saffron / --saffron-700 / --saffron-50 | #FF9933 / #B45309 / #FFF4E6 | #FF9933 / #FFB35C / #2E1F0E |
| --warn / --warn-50 | #8A5A00 / #FFF7E0 | #F5C451 / #2E2410 |
| --danger / --danger-50 | #B42318 / #FCECEA | #F28B82 / #3A1512 |
| --text / --muted | #1B2430 / #4B5563 | #E6EAF0 / #A7B1BE |
| --line / --line-2 | #D9DEE5 / #EAEEF3 | #26303B / #1E2731 |
| --paper (page) / --surface (cards) / --surface-2 | #FAFAF7 / #FFFFFF / #F3F5F8 | #0F1419 / #161C24 / #1C2430 |
| --sel-bg / --sel-fg (selected tile, chip, step number) | #0B2545 / #FFFFFF | #7FB2F0 / #0B2545 |
| Tricolour footer line | saffron · white · #138808 | same |

Other tokens: radii `--r-card` 12 px, `--r-ctl` 8 px, `--r-pill` 999 px; header height 64 px; bottom bar 64 px; shadow `0 18px 48px -20px rgba(11,37,69,.35)`; focus ring `0 0 0 3px var(--ink), 0 0 0 6px var(--saffron)`. Dark mode follows `prefers-color-scheme` and a manual toggle stored as `data-theme` on `<html>`.

### 4.3 Type scale

| Element | Size |
| --- | --- |
| Display (hero) | clamp(2.25rem, 5vw, 3.5rem), weight 700, line-height 1.08, letter-spacing -0.02em |
| h1 | clamp(2rem, 3.4vw, 2.75rem) |
| h2 | clamp(1.625rem, 2.6vw, 2.125rem) |
| h3 | clamp(1.25rem, 1.8vw, 1.5rem), weight 600 |
| h4 | 1.125rem |
| Body | 1.125rem (1.1875rem at ≥1024 px), line-height 1.6; Hindi 1.75 |
| Lead | clamp(1.25rem, 1.6vw, 1.375rem) |
| Small / meta | 1rem / 0.88–0.95rem |

### 4.4 Components in `styles.css`

Buttons (`.btn`, `-primary` saffron with navy text, `-ink`, `-line`, `-sm`); sticky translucent header with brand, nav, EN|हिं toggle, theme toggle, search and Report button; fixed mobile bottom bar; full-screen mobile menu grid; hero search; issue tiles (3 columns under 480 px, 4 to 768 px, 6 above) with `aria-pressed` selection; result panel with three columns (`.pcol`) and a footer; step-by-step list (`.steps`, saffron first marker option); skyline SVG and divider; glance counters with count-up; teaser cards; chips and directory rows with level tags (Gurugram / Haryana / India); tags (`.tag` blue/green/warn/danger/saffron); rights cards; who's-who bands with issue filter highlighting; forms (fields, hints, error summary, 4-segment progress bar, summary list, confirmation box with monospace reference); track timeline; ward finder cards and responsive table (stacks under 640 px); civic charter tabs, task list (don'ts have a red left rule), entitlements list, 36-segment score ring; dashboard KPIs on a navy band, stacked bars with legend, commitments table, empty state; updates cards with placeholder SVG; post layout; about org/mix/trust blocks; join role cards; right-hand sheet (bottom sheet on mobile) with tabs; command palette; footer with tricolour line; toast; reveal motion with reduced-motion fallback; print styles.

### 4.5 Icons

One inline SVG sprite with 48 symbols (`#i-*`): brand mark `i-mark`, UI (search, phone, check, chevrons, menu, close, globe, sun, moon, pin, map, home, fix, wards, track, dash, rights, who, charter, news, join, info, link, chat, app, mail, alert, arrow, up) and one per issue type (roads, waste, water, drains, lights, parks, traffic, power, pollution, animals, construction, property, housing, safety, consumer, rti, other). Stroke 1.75, round caps, 24-unit viewBox.

---

## 5. The v3 website: technical notes

### 5.1 Shape

- One static HTML file, no build step, no framework; vanilla ES5-compatible JavaScript; hash routing (`#/route/arg`); content rendered from `window.GVF` data.
- `site/index.html` is canonical (160,227 bytes; 45 KB gzipped). `site-split/` is the same file split into `index.html` + `styles.css` + `data.js` + `app.js`; both versions were smoke-tested on 7 Oct 2026 (home renders, 17 tiles, panel opens, all routes switch, zero console or page errors).
- Fonts load from Google Fonts (Anek Latin, Anek Devanagari, Noto Sans, Noto Sans Devanagari). In an offline test environment they fall back to system fonts; check the type on a real phone.

### 5.2 Routes

| Hash | View | Notes |
| --- | --- | --- |
| `#/` or `#/fix` | Home (router) | `#/fix/:issueId` pre-selects a tile and opens the panel |
| `#/report` | 4-step report form | `#/report/:issueId` pre-fills the issue type and shows the desk hint |
| `#/track` | Where is my report | `#/track/:ref` loads the reference |
| `#/directory` | 24 official channels with filter chips | |
| `#/rights` | 11 charters | `#/rights/:id` opens the sheet (Your right / How to claim / Source) |
| `#/who` | Who's who in five tiers | `#/who/:roleId` opens the role sheet; dropdown filter highlights roles for an issue |
| `#/wards` | Ward finder + 36-row table with search | |
| `#/charter` | Civic charter (Home / Society / Ward / City tabs), task list, score ring | ticks persist in localStorage |
| `#/dashboard` | Accountability: KPIs, commitments, reports by cause and status | empty state + "Preview the layout with sample data" toggle (clearly badged) |
| `#/updates` | Stories / Photos / Videos / In the news tabs | `#/updates/:slug` opens one of 4 sample stories |
| `#/join` | Three roles + form | |
| `#/about` | Org structure, trust blocks, funding mix, contact | |
| `#/accessibility` | Accessibility statement | |

### 5.3 Data model (`window.GVF`)

| Key | Count | Shape |
| --- | --- | --- |
| `L` | 37 | named official URLs |
| `CATS` | 17 | `{id, ic, label, hl (Hindi), agency, owns, channels[{k,v,href,ic}], ladder[], roles[]}` |
| `PORTALS` | 24 | `{n, h, l (city/state/central), f (≤8-word purpose), how, ph, t[] tags}` |
| `FILTERS` | 8 | directory filter chips |
| `CHARTERS` | 11 | `{id, ic, t, right, dl (deadline chip), how[3], why, src[[label,url]]}` |
| `ROLES` | 27 | `{b (role), who (holder), owns, links[[label,url]]}` |
| `TIERS` | 5 | `{h, s, r[] role ids}` |
| `WARDS` | 36 | `[ward, councillor, party]` |
| `AREAS` | 182 | datalist of sectors 1–115 and named colonies |
| `CIVIC` | 4 tabs | `{id, t, owe[{id, t, dont?}], ent[{t, l, h}]}` — 26 "owe" items in total |
| `BLOG` | 4 | sample stories with HTML bodies |
| `MEDIA` | — | photo/video/news placeholders |
| `STATS` | — | sample dashboard rows (layout preview only) and the three commitments |
| `FUNDING` | 4 | 35/30/20/15 |
| `HI` | 150 | Hindi UI dictionary keyed by `data-i18n` ids |
| `VERIFIED` | — | "25 Sep 2026" |

Exports in this bundle: `data/gvf-data.json` (everything), `data/issue-types.csv`, `data/portals.csv`, `data/charters.csv`, `data/roles.csv`, `data/wards.csv`. These are the seed for the "GVF master data" Google Sheet in the launch guide.

### 5.4 Behaviour worth knowing before editing `app.js`

- **Report flow:** validates per step (phone 10–14 digits, consent required), builds a summary list, generates a reference `GVF-YYYY-XXXXX` (5 chars from an unambiguous alphabet), saves the report to `localStorage.gvf_reports` (last 20), shows a confirmation with the official channel to file with, a field to save the official ticket number (advances stage to "Filed officially"), "Email a copy to the Forum" (mailto with a formatted body) and "Copy the report". Nothing is sent to a server yet.
- **Track:** five stages (Received, Mapped, Filed officially, Escalated, Resolved); reads only this device's localStorage; the empty state explains that any reference will work once the case system is live.
- **Geolocation:** "Use my location" pins coordinates and offers a Google Maps check; coordinates go into the summary.
- **Ward select:** choosing a ward shows the councillor and notes that the report is copied to the councillor once the office contact is verified.
- **Search:** index built at load from CATS, PORTALS, CHARTERS, ROLES, WARDS; opened by header button, menu button or Ctrl/⌘-K.
- **i18n:** `data-i18n` and `data-i18n-ph` attributes; English captured from the DOM at load; Hindi from `GVF.HI`; `<html lang>` switches; tile labels, category select and who-filter re-render. Long-form content (charters, remits, posts) is English only.
- **Theme:** `gvf_theme` in localStorage; otherwise follows the OS.
- **Civic score:** ticks in `gvf_civic`; ring lights `round(pct*36)` segments; message changes at 40% and 80%.
- **Dashboard:** `sample=false` by default; KPIs show "—"; commitments show "Reporting starts at launch".

### 5.5 Test record (29 Sep 2026, Playwright, Chromium)

Mobile 390×844 and desktop 1366×860: every route; pre-filled report (`#/report/waste`) through all four steps to a reference; ward hint; geolocation; ticket save; track timeline; rights and role sheets; charter score (2/26 → 8%); dashboard sample toggle; who-filter (6 hot roles for garbage); mobile menu; search (3 hits for "cyber"); theme toggle; Hindi toggle. Zero page errors. Fixed during testing: router map lacked `home`; mobile header overflow; tile grid overflow and long tile labels; dark-mode selection colours; responsive commitments table.

### 5.6 Known limits (honest list given to the owner)

1. Reports live only on the reporter's phone until the Worker + case system exist.
2. Ward auto-fill is manual; needs a sector-to-ward table or a GIS layer.
3. Councillor office numbers, MLA/MP contact pages, photos, videos and the logo are placeholders.
4. Hindi covers the interface, not the long guides.
5. Single file with hash routes: fine for launch, but production should move to real URLs on a static build with a CMS and analytics so pages index and share properly.
6. Contrast ratios are calculated, not screen-reader tested; privacy policy page still to be written.

### 5.7 Room for improvement (next build items)

- Wire the three endpoints (`POST /report`, `GET /status`, `POST /join`) and the nightly `dashboard.json` (brief in launch guide Appendix B).
- Add "Report on WhatsApp" button (deep link with pre-filled text) and the helpline number once they exist.
- Photo upload in the report form (R2, 10 MB, images only).
- Public, anonymised report pages with follow / "me too" (benchmark roadmap item 3) after the case system is live.
- Sector-to-ward lookup in the form; later point-in-polygon on a ward GeoJSON.
- Real URLs (`/report`, `/wards`…) via a static generator or Webflow, with Open Graph tags per page.
- Privacy notice page; DPDP-aligned consent text; 24-month retention.
- Replace placeholder logo mark; real photos and video embeds (no autoplay).
- Hindi long-form content fields in the CMS.
- Screen-reader pass; measured contrast; Lighthouse ≥ 90 on mobile.

---

## 6. Complaint-handling CRM evaluation (30 Sep 2026)

Requirement: WhatsApp built in, AI calling built in, citizen tracking, auto-mapping (routing) and queue management. No low-cost product has all five natively at good quality.

| Platform | WhatsApp | AI calling | Citizen tracking | Auto-mapping / queues | Cost signal |
| --- | --- | --- | --- | --- | --- |
| Yellow.ai | Built in | Built in (VoiceX) | Via bot and notifications | Inbox with SLA and escalation | Enterprise quote |
| Kapture CX | Built in (flow bots) | Via telephony partner (Exotel/Knowlarity) | Portal and WhatsApp updates | NLP routing, SLA escalation, auto CSAT | Enterprise quote, Indian vendor |
| Freshdesk Omni | Built in | Marketplace voice-AI apps (Synthflow, SquawkVoice) on Freshcaller | Portal and WhatsApp | Skill/load routing, SLA policies | From about USD 15/agent |
| Exotel (Ameyo) | Built in | Built in (voicebot, IVR, call deflection to WhatsApp) | Weak case tracking | ACD, skill routing, SLA dashboards | Quote |
| Zoho Desk | Built in | Third party | Portal and WhatsApp | Zia routing only on Enterprise (USD 40/user); Standard 14, Professional 23 | Cheapest, pairs with Zoho Books |
| Zendesk (dropped) | Built in | Generative voice AI only on Suite Enterprise; AI agents billed per resolution | Yes | Yes | Suite from USD 55/agent plus add-ons |

**Recommendation given**

- Best single stack for exactly the five criteria: **Yellow.ai** if a corporate CSR partner funds it; **Kapture CX** for an Indian vendor at lower enterprise cost, accepting voice through Exotel or Knowlarity.
- Best value to launch with (and what the launch guide assumes): **Freshdesk Omni + Exotel**. Freshdesk handles WhatsApp intake, routing rules per issue type and ward, SLA queues and the citizen portal; Exotel's voicebot takes Hindi calls and makes status and feedback callbacks. **Zoho Desk** is the cheaper cousin if the Forum wants it beside Zoho Books, with AI calling bolted on.
- The benchmark doc (Sep 24) assumed Zoho CRM; the launch guide (Sep 30) names Freshdesk; the owner has not confirmed either. One comment in the benchmark doc asks to confirm Zoho CRM vs FixMyStreet Pro/Mark-a-Spot.

**Before signing anything**

1. WhatsApp Business API needs a Meta-verified legal entity, so the Forum's registration must finish first.
2. Ask for a Hindi and Hinglish voice demo on a real complaint, not the sales script.
3. Get the per-conversation WhatsApp and per-minute voice rates in writing; seat prices hide them.
4. Insist on an export API so the site's dashboard reads live counts by cause, ward and status.

---

## 7. Connections needed to make the site record complaints and report back

Items marked **(go-live)** are the minimum to start recording complaints.

**7.1 Foundations**

- Domain and hosting **(go-live)**: pick gurugramvisionforum.org or gurgaonvisionforum.org; host the static site on Cloudflare Pages, Vercel or Webflow with SSL.
- Serverless backend **(go-live)**: a small function layer (Cloudflare Workers or Vercel functions) that holds API keys. The browser must never call the CRM directly.
- Mail domain **(go-live)**: Google Workspace or Zoho Mail for contact@ and noreply@, with SPF, DKIM and DMARC.
- Legal entity and Meta Business verification: required before WhatsApp Business API; blocks every WhatsApp item below.
- TRAI DLT registration: required for any SMS templates in India.
- Virtual number: Exotel or Knowlarity number for the helpline and AI calls.

**7.2 Complaint intake: site → case system**

- Report form → CRM ticket API **(go-live)**: Freshdesk, Zoho Desk or Kapture creates the ticket and returns the reference shown on screen.
- Photo upload → storage **(go-live)**: Cloudflare R2 or S3, or CRM attachments; size limits and malware scan.
- Spam control **(go-live)**: Cloudflare Turnstile on both forms; mobile OTP via SMS or WhatsApp to cut fake reports.
- Confirmation → email and WhatsApp/SMS **(go-live for email)**: transactional email (ZeptoMail, SES or SendGrid) plus a WhatsApp template with the reference once the API is live.
- WhatsApp intake → CRM channel: native connector in Freshdesk/Zoho, or Meta Cloud API via Gupshup or Twilio; the site's "Report on WhatsApp" button deep-links to it.
- Phone intake → CRM: Exotel IVR or voicebot creates a ticket with the recording and transcript.
- Join form → CRM contacts: volunteer, chapter lead and fellow records tagged by role and sector, with an autoresponder.

**7.3 Auto-mapping inside the case system**

- Issue-to-desk rules: load the 17 categories with agency, channels and ladder as routing rules and custom fields, so each ticket lands in the right queue with its SLA.
- Ward lookup service: a sector-to-ward table now, point-in-polygon on a ward GeoJSON later (MCG/GMDA layer or one traced from the 2023 delimitation). The form calls it to prefill the ward.
- Ward contacts directory: councillor, JE and sanitation supervisor per ward in the CRM, so tickets copy to the right people.
- Official ticket field: GMDA/MCG/DHBVN ticket number stored on the case; no public API exists, so volunteers file and paste it.

**7.4 Reporting back to the site: case system → site**

- Status lookup API **(go-live)**: rate-limited endpoint keyed by reference plus OTP or the last four digits of the mobile, feeding the Track page. Until then, the CRM's customer portal link.
- Stage-change notifications: CRM webhooks → WhatsApp/SMS/email at each of the five stages.
- Dashboard feed: a scheduled job pulls CRM counts by cause, ward, status and SLA compliance and publishes a JSON file to the CDN; the dashboard reads it. Metabase can produce the same feed.
- Public report list: dropped on 8 Oct 2026 (owner: reports are confidential; the public sees counts per ward, issue and stage only).
- Monthly open-data CSV from the same job.

**7.5 Content and directory upkeep: team → site**

- CMS: Webflow, WordPress or Sanity for stories, photos, videos, press, with image hosting and YouTube embeds.
- Directory, charters, roles, wards as data: a Google Sheet or CMS collection the build pulls from, so a volunteer can fix a link without a developer.
- Monthly link checker: automated check of the 24 portals that updates the "verified" date.
- Hindi fields: a second-language field on every CMS entry.

**7.6 Maps, analytics, compliance**

- Map and geocoding keys: Google Maps or Mapbox for the spot picker and address-to-coordinates.
- Analytics: PostHog events for tile picked, report started, report sent, track used, language toggle.
- Uptime and error monitoring: Sentry plus a status ping (UptimeRobot).
- Consent and retention: store consent timestamp with each ticket; privacy notice aligned to the DPDP Act; scheduled CRM export as backup.

**Order of work:** (1) domain, hosting, backend, mail, form → CRM, email confirmation, status API; (2) ward lookup, desk rules, ward contacts, dashboard feed, CMS; (3) entity verification → WhatsApp intake and notifications → phone and AI calling → public report pages. Three decisions unblock most of this: the domain, the CRM, and finishing the registration.

---

## 8. The launch guide

The full step-by-step guide for a non-technical owner (Phases 0–7, operating rhythm, accounts and costs, freelancer brief, Freshdesk cheat-sheet, Hindi/English message templates, AI call scripts) is reproduced in **Appendix A** of this file and as `docs/launch-guide.md`.

---

## 9. Open decisions and questions for Saurabh

1. **Domain:** gurugramvisionforum.org (recommended; matches the email) or gurgaonvisionforum.org (on the deck)? Buy both either way.
2. **Case system:** Freshdesk Omni (launch guide assumes it), Zoho Desk (cheaper, next to Zoho Books) or Kapture/Yellow.ai (enterprise)?
3. **Legal form and registration status** of the Forum (trust, society, Section 8); gates WhatsApp API, Exotel KYC and DLT.
4. **The WhatsApp number**: a fresh SIM never used with the WhatsApp app.
5. **Social handles** for the footer and share links.
6. **Councillor office contacts, MCG zone/JE per ward, sector-to-ward table** (volunteer work, Phase 4).
7. **Confirmation that public copy drops the BJP framing** used in the deck (currently done on the site; the deck still has it).
8. **Logo**: provide the real mark; the site's SVG mark is a placeholder.
9. **Photos, video and press** for the Updates page.
10. **Owner and coordinator names** for the launch tracker.

---

## 10. Files in this bundle and a starter CLAUDE.md

| Path | What it is |
| --- | --- |
| `HANDOFF.md` | This file |
| `site/index.html` | Canonical v3 website, single file (published at the artifact URL) |
| `site/v2-gurugram-vision-forum.html` | Previous v2 build, kept for reference (longer copy, same data) |
| `site-split/index.html`, `styles.css`, `data.js`, `app.js` | v3 split into editable parts; functionally identical |
| `design/tokens-and-components.css` | The design system stylesheet on its own (same as `site-split/styles.css`) |
| `data/gvf-data.js`, `data/gvf-data.json` | All site content as data |
| `data/issue-types.csv`, `portals.csv`, `charters.csv`, `roles.csv`, `wards.csv` | Seed for the master-data Google Sheet |
| `docs/launch-guide.md` | Step-by-step launch guide (also Appendix A) |
| `docs/civic-platform-benchmark.md` | Benchmark and roadmap (also Appendix B) |
| `deck/gurugram-vision-forum-deck.pdf` | The original 14-slide deck (Oct 2025) |

**Starter `CLAUDE.md` for the repo** (copy into the repo root and edit):

```markdown
# Gurugram Vision Forum website

Read HANDOFF.md first; it holds the context, research, design rules and roadmap.

## Rules
- Static site in site/ (index.html, styles.css, data.js, app.js). No framework, no build step unless we deliberately add one.
- Content lives in data.js (window.GVF). Edit data, not markup, to change issues, portals, charters, roles, wards, Hindi strings.
- Design tokens and components are in styles.css; keep the navy-led palette, saffron as accent only (never saffron text on white), Anek/Noto type, 44 px targets, visible focus, reduced-motion support.
- Public copy is non-partisan; never add party framing to civic tools. Party appears only as a factual field (ward table).
- Never display or transmit a reporter's phone number publicly; public pages and dashboards show counts, never names.
- Dashboard shows commitments vs actuals with a date and source; never present the deck's targets as results.
- Every external link must be an official page; update the VERIFIED date when links are checked.
- Keep Hindi strings in GVF.HI in step with new UI text (data-i18n keys).
- Test with Playwright on 390 px and 1366 px before committing: every route, the 4-step report flow, track, sheets, search, theme and language toggles, zero console errors.

## Next build items (in order)
1. Cloudflare Worker: POST /report (Turnstile + Freshdesk ticket), GET /status (ref + last4), POST /join, nightly dashboard.json. Secrets in Worker env, never in HTML.
2. Wire the site's report form, track page, join form and dashboard to those endpoints with clear error states.
3. Photo upload to R2 (images, 10 MB).
4. "Report on WhatsApp" deep link and helpline number once available.
5. Privacy notice page; sector-to-ward lookup; real URLs and OG tags.
```

**Three first prompts for Claude Code**

1. "Using HANDOFF.md section 5 and the freelancer brief in Appendix A, scaffold `worker/` as a Cloudflare Worker with `/report`, `/status`, `/join` and a scheduled `dashboard.json` job against the Freshdesk API; use environment secrets; write a README with the deploy steps."
2. "Update `site-split/app.js` so the report form posts to `/report`, shows the server reference, handles errors, and the track page reads `/status`; keep the localStorage fallback when the endpoint is unreachable; re-run the Playwright checks."
3. "Add a `privacy` route and view matching the design system, using the privacy rules in HANDOFF.md section 1 and Appendix A; add Hindi strings for its UI."

---

## Appendix A: launch guide, step by step (30 Sep 2026)

### Before you start

You can do about 80 percent of this yourself with a browser and a credit card; the remaining 20 percent is one freelancer job of two to three days (Phase 3) and vendor onboarding calls. Expect eight to ten weeks end to end, mostly waiting on registration and approvals, not on work.

**Who does what**

| Role | Does | Who |
| --- | --- | --- |
| Owner (you) | Buys the domain, opens every account, approves everything, keeps the passwords | Saurabh |
| Coordinator | Runs the checklist week to week, chases vendors and volunteers | One Forum committee member |
| Freelancer | Connects the website to the case system, builds the status lookup and the dashboard feed | Hired for Phase 3 and Phase 6 (brief in Appendix B) |
| Vendor onboarding teams | Configure Freshdesk, Exotel and WhatsApp on screen-share calls; they do this free for new accounts | Ask for it at sign-up |
| Two data volunteers | Fill the master sheet: ward contacts, sector-to-ward table | Chapter volunteers |

**Rules that save you pain later**

1. Open every account with one Forum email (contact@gurugramvisionforum.org once it exists; until then a fresh Gmail you control), never a personal or staff email.
2. Put every login in a password manager (Bitwarden is free) and share the vault with the coordinator.
3. Turn on two-factor authentication on the domain, email and case-system accounts the day you open them.
4. Keep one Google Sheet called "GVF launch tracker" with every step below as a row: owner, status, date done.

**Rough budget for year one** (estimates in Indian rupees; confirm current prices at sign-up): about Rs 15,000 to 40,000 one-time for the freelancer, and Rs 8,000 to 20,000 a month once WhatsApp, three case-system seats and the helpline number are live. Appendix A itemises it.

### Phase 0: three decisions (this week)

Nothing else can start until these are written down.

1. **Domain name.** The deck uses gurgaonvisionforum.org, the email uses gurugramvisionforum.org. Pick one; buy the other too and point it at the first so nobody lands on a dead page. Recommendation: gurugramvisionforum.org, the city's legal name and the one on the email.
2. **Case system.** Freshdesk Omni for launch, three agent seats. It has WhatsApp built in, routing and SLA queues, a public tracking portal, and an onboarding team. Zoho Desk is the cheaper alternative if you want it beside Zoho Books; the steps below name Freshdesk, and every step has a Zoho equivalent.
3. **Owner and coordinator.** One person owns the accounts and the bank card; one person runs the tracker. Write both names on the tracker sheet.

Also decide now, because they gate later phases: the legal form of the Forum (trust, society or Section 8 company), since Meta and Exotel both ask for the registration certificate; and the mobile number that will become the WhatsApp line, a new SIM never used with the WhatsApp app.

### Phase 1: domain, email and hosting (week 1 to 2)

One provider for domain, hosting and spam protection keeps this to two accounts: Cloudflare and Google Workspace. Everything in this phase is point-and-click; no code.

**Step 1: buy the domain (30 minutes)**

1. Go to cloudflare.com, create an account with the Forum email, turn on two-factor.
2. Domain Registration, then Register domains: search gurugramvisionforum.org, buy it, and buy gurgaonvisionforum.org as well. Turn on auto-renew for both.
3. Under the domain, WHOIS privacy is on by default; leave it on.

**Step 2: email on the domain (1 hour, then 1 to 2 days for checks)**

1. Go to workspace.google.com, choose Business Starter, one user: contact@gurugramvisionforum.org. Later add noreply@ and reports@ as free aliases, not paid users.
2. Google asks you to prove you own the domain. It shows a TXT record. In Cloudflare, open the domain, DNS, Add record, paste it exactly, save. Back in Google, click Verify.
3. Google then shows MX records. Add them in Cloudflare DNS the same way. Send yourself a test email from your personal account; reply to it.
4. In the Google Admin console, Apps, Google Workspace, Gmail, Authenticate email: turn on DKIM and copy the record it shows into Cloudflare DNS. Then add one more TXT record named _dmarc with the value `v=DMARC1; p=quarantine; rua=mailto:contact@gurugramvisionforum.org`. This keeps the Forum's confirmation emails out of spam.
5. Move the Forum's Cloudflare login to contact@ once it works.

**Step 3: put the website online (30 minutes)**

1. In Cloudflare, Workers and Pages, Create, Pages, Upload assets. Name the project gvf-site.
2. Rename the file you received to index.html, put it in a folder, upload the folder. Cloudflare gives a temporary address ending in pages.dev; open it on your phone and check it works.
3. Custom domains, Set up a custom domain: type gurugramvisionforum.org; Cloudflare adds the record itself. Repeat with www. Within an hour the site opens on the real address with https.
4. Point the second domain: in gurgaonvisionforum.org, Rules, Redirect Rules, create one that sends all traffic to https://gurugramvisionforum.org.

**Step 4: spam protection and the backend home (15 minutes)**

1. Cloudflare, Turnstile, Add widget, name it gvf-forms, domain gurugramvisionforum.org. Save the Site key and Secret key in the password manager; the freelancer needs them.
2. Nothing else to do here: the freelancer will create a Cloudflare Worker in this same account in Phase 3. Do not share your password; add the freelancer as a member with limited access (Manage Account, Members, Invite) and remove them after.

**Done when:** the site opens on https://gurugramvisionforum.org on a phone, an email to contact@ arrives, and a test email sent from contact@ to a Gmail account lands in the inbox, not spam.

### Phase 2: set up the case system (week 2 to 3)

By the end of this phase a volunteer can log a complaint by hand, it lands in the right queue with a deadline, and the reporter gets an email with a reference. Book Freshdesk's onboarding call at sign-up and do steps 3 to 7 with them on screen; Appendix C is the cheat-sheet to hand them.

1. **Sign up.** freshworks.com, Freshdesk Omni, free trial, with contact@. Portal name gvf (your helpdesk address becomes gvf.freshdesk.com). Buy the lowest paid plan with WhatsApp and SLA policies after the trial; three seats to start.
2. **Add people.** Admin settings, Team, Agents: add the coordinator and two triage volunteers. Volunteers who only file tickets for others do not need seats.
3. **Create groups, one per desk.** Admin settings, Team, Groups: MCG sanitation; MCG roads, lights and parks; GMDA roads, water and drains; DHBVN; Traffic Police; Police and cyber; HSPCB pollution; Property and plans; Builders and societies; Consumer; RTI; Policy and other. A ticket's group is its queue.
4. **Add ticket fields.** Admin settings, Workflows, Ticket Fields: Issue type (dropdown, the 17 site categories), Ward (dropdown 1 to 36 plus Not sure), Area (text), Exact spot (text), Coordinates (text), Affects (dropdown: me, society, sector, city), Official ticket number (text), Official channel (dropdown: GMDA portal, Swachhata, DHBVN 1912, Police, HRERA, CM Window, CPGRAMS, other), Stage (dropdown: Received, Mapped, Filed officially, Escalated, Resolved), Consent given (checkbox), Website reference (text).
5. **Set the deadlines.** Admin settings, Workflows, SLA Policies: first response within 3 working days; resolution target 21 days; reminders to the group at 2 days and 18 days; escalation email to the coordinator on breach. Set business hours to Monday to Saturday, 10 am to 6 pm, Asia/Kolkata.
6. **Automate the routing.** Admin settings, Workflows, Automations, Ticket creation rules: one rule per issue type, "if Issue type is Garbage then assign to group MCG sanitation and add tag ward-N". Ticket update rules: when Stage changes, email the reporter with the matching template from Appendix D; when Official ticket number is filled, set Stage to Filed officially.
7. **Connect email.** Admin settings, Channels, Email: add contact@ as the support address. Freshdesk shows a forwarding address; in Gmail settings for contact@, add a filter that forwards everything with "report" in the subject to it. Turn on the automatic "ticket received" reply and paste the Received template from Appendix D.
8. **Switch on the tracking portal.** Admin settings, Channels, Portals: enable the customer portal, allow login by email link, hide agent names. This is the fallback tracking page until the freelancer wires the site's own Track page.
9. **Set the public look.** Portal name Gurugram Vision Forum, logo, saffron accent, and a one-line notice: not a government site, emergencies 112.
10. **Test.** Log three tickets by hand as different issue types. Check each lands in the right group with a 3-day deadline, the reporter email arrives, and changing Stage sends the update email.

**Done when:** the three test tickets pass step 10, and the coordinator can find any ticket by its website reference in under a minute.

### Phase 3: connect the website to the case system (week 3 to 4)

This is the one job you hire out. A competent web developer does it in two to three days; you supply access and test the result. Send Appendix B as the brief.

1. **Hire.** Post the brief on Upwork or Fiverr, or ask a Gurugram agency. Ask for two things: a link to a similar form-to-helpdesk integration they built, and a fixed price. Typical range Rs 15,000 to 40,000.
2. **Give access, not passwords.** Invite them to Cloudflare as a member with Workers and Pages rights only. Create a Freshdesk API key for them from an agent profile you can delete later (Profile settings, API key). Hand over the Turnstile keys from Phase 1.
3. **What they build**, in order:
    1. A Cloudflare Worker that receives the website's report form, checks the Turnstile token, creates the Freshdesk ticket with every field from Phase 2 step 4, and returns the ticket's reference. The site already generates a GVF reference; the Worker stores it in Website reference so both numbers work.
    2. Photo upload: form photos go to Cloudflare R2 storage and attach to the ticket; 10 MB limit, images only.
    3. The Track page: a Worker endpoint that takes a reference plus the last four digits of the mobile and returns the Stage and dates from Freshdesk, nothing else. The site's timeline reads it.
    4. The Join form: creates a Freshdesk contact tagged with the chosen role and sector, and emails the coordinator.
    5. Replace the site's current local-only behaviour with these endpoints, publish the updated file to Pages, and give you the new file.
4. **Test with them on a call.** Submit a report from your phone with a photo; confirm it appears in Freshdesk in the right group, the email arrives, and the Track page shows Received. Change the Stage in Freshdesk; confirm the Track page and the email both update. Try a wrong last-four-digits; it must refuse.
5. **Close out.** Delete the temporary agent and its API key, remove the freelancer from Cloudflare, and file their handover note in Drive: where the Worker lives, how to redeploy the site, and how to rotate keys.

**Done when:** a stranger can report from the website on a phone and track it the next day without anyone touching it by hand.

### Phase 4: the master data that makes routing work (week 3 to 5, in parallel)

Routing is only as good as three tables. Two volunteers build them in one Google Sheet called "GVF master data", shared with the coordinator and, view-only, with the freelancer.

1. **Create the sheet with six tabs.** Issue types (17 rows: category, responsible desk, official channels, escalation ladder, Freshdesk group); Portals (24 rows: name, link, what it is for, phone, date last verified); Charters (11 rows); Roles (27 rows); Wards (36 rows); Sector to ward (one row per sector or colony). Start by copying what the website already shows; the developer can export it for you in an hour.
2. **Ward contacts (2 weeks of calls).** For each of the 36 wards: councillor name, office phone, email if any, the MCG zone and its junior engineer for roads, the sanitation supervisor. Sources: the MCG office at Civil Lines, the zonal offices, the councillor's own social page, RWA federations. Log the date and who confirmed each number; unverified rows stay marked "unverified" and the site says so.
3. **Sector-to-ward table.** Take the 2023 ward delimitation notification on ulbharyana.gov.in (it is a scanned PDF, so somebody reads and types it), list every sector, colony and village against its ward, then spot-check 20 rows against OneMap GGM. Where a sector splits across wards, note both and the dividing road.
4. **Load routing into Freshdesk.** From the Issue types tab, the coordinator sets the group in each Phase 2 automation rule. From the Wards tab, add the councillor email to the ticket-created rule as a CC once the office confirms it wants copies.
5. **Hand the sheet to the freelancer.** They point the site's directory, rights, roles, ward table and the report form's ward dropdown at this sheet, so a corrected phone number reaches the website within a day without a developer.
6. **Set a monthly link check.** A volunteer opens the 24 portal links on the first working day of the month, fixes any that moved, and updates the verified date column; the footer's "links verified" date reads from it.

**Done when:** every ward row has at least a confirmed councillor number, the sector table covers all HSVP sectors and the main licensed colonies, and a change in the sheet appears on the site without anyone editing code.

### Phase 5: WhatsApp, helpline number, AI calling and SMS (after registration, week 4 to 8)

Everything here needs the Forum's registration certificate, so start the paperwork on day one. Until WhatsApp is approved, the website's "Report on WhatsApp" button can point to a normal WhatsApp Business app number; messages are then logged in Freshdesk by hand.

**Step 1: finish the legal entity (week 1 to 4).** Register the trust, society or Section 8 company; get the PAN, a current-account bank statement and a utility bill or rent agreement in the Forum's name at one address. Meta, Exotel and the SMS registry all ask for the same three documents. 12A and 80G registration can follow later.

**Step 2: Meta business verification (1 to 3 weeks, mostly waiting).**

1. business.facebook.com, create a Business Portfolio named Gurugram Vision Forum with contact@.
2. Settings, Security Centre, Start verification. Upload the registration certificate and the bank statement or utility bill; the legal name and address must match exactly.
3. Meta may phone or email the Forum; answer within a day or the request lapses.

**Step 3: WhatsApp Business API inside Freshdesk (1 day once verified).**

1. Freshdesk, Admin settings, Channels, WhatsApp, Connect. It opens Meta's sign-in. Use the new SIM number from Phase 0; it must never have been on the WhatsApp app.
2. Display name: Gurugram Vision Forum. Meta approves the name in a day or two.
3. Submit message templates for approval: the five stage messages in Appendix D, English and Hindi, category Utility. Approval takes minutes to a day each.
4. In Freshdesk automations, switch the Stage-change notifications from email-only to email plus WhatsApp template.
5. Ask the freelancer to change the website's "Report on WhatsApp" link to the new number with a pre-filled first message: "Hi, I want to report a civic issue".
6. Set a WhatsApp auto-reply for the first message that asks for issue type, area, spot, photo, and gives the reference once a volunteer files it. Freshdesk's chatbot builder does this without code; the onboarding team sets it up in an hour.

**Step 4: helpline number and AI calling with Exotel (1 to 2 weeks).**

1. exotel.com, sign up as the Forum, complete KYC with the same three documents plus an authorised-signatory letter on letterhead.
2. Buy one virtual number (a Gurugram landline-style number reads as official). Order: a Freshdesk integration so every call creates a ticket with the recording attached, then a simple menu: 1 for a new complaint, 2 for the status of an existing one, 3 to speak to a volunteer.
3. Phase two of the same account: Exotel's AI voicebot for Hindi and English intake and for outbound calls. Give their team the two scripts in Appendix E. Insist on a live test in Hindi with a real complaint before you pay for it.
4. Put the number on the website, in the footer and the report confirmation.

**Step 5: SMS as a fallback (optional, 2 weeks).** Register the Forum on any telecom's DLT portal (Airtel, Jio, Vi or BSNL) with the same documents, register a sender ID such as GVFRUM and the five stage templates. Freshdesk or Exotel sends the SMS. Skip this if WhatsApp delivery rates are above 95 percent after a month.

**Done when:** a report sent on WhatsApp becomes a Freshdesk ticket in the right group, the reporter gets the reference on WhatsApp, a call to the helpline creates a ticket with a recording, and a status change reaches the reporter on WhatsApp within a minute.

### Phase 6: updates, dashboard, analytics, monitoring (week 6 to 10)

These make the site a living thing rather than a launch page. Order them by what the team will actually use; the dashboard feed matters more than a content system.

**Step 1: dashboard feed (freelancer, 1 day).** A scheduled job in the same Cloudflare Worker reads Freshdesk every night and writes one small file: counts of reports by issue type, by ward, by Stage, and the share of tickets that met the 3-day and 21-day commitments. The site's dashboard reads that file and shows "Updated: date". Nothing about individual reporters is in it. Publish the first month only after 50 reports, as the site already promises.

**Step 2: updates without a developer (choose one).**

1. Simplest: a Google Drive folder "GVF updates" with one sub-folder per story (a text file with title, date, tag, body, plus photos). The freelancer adds a job that turns it into the Updates page. A volunteer can publish by dropping a folder in.
2. Fuller: move the site to Webflow with a content collection for stories, photos, videos and press, and forms wired to the same Worker. Two to three weeks of agency work; do it in year two when there is a communications volunteer.

**Step 3: analytics (30 minutes).** posthog.com, free plan, create a project named GVF site, copy the one-line snippet to the freelancer to paste in. Ask for five events only: issue tile picked, report started, report sent, track used, Hindi switched on. The monthly dashboard post uses these numbers.

**Step 4: monitoring (15 minutes).** uptimerobot.com, free plan, monitor https://gurugramvisionforum.org every 5 minutes with an alert to contact@ and the coordinator's phone. Add the Worker's status endpoint as a second monitor.

**Step 5: backups and exports (monthly, 20 minutes).** On the first of the month the coordinator exports all tickets from Freshdesk (Reports, Export) to a dated file in a restricted Drive folder, and downloads the master sheet as a copy. Keep twelve months.

**Done when:** the dashboard shows real counts with a date, a volunteer has published one update without help, PostHog shows the five events, and an outage alert has been tested by taking the site down for a minute.

### Phase 7: testing and go-live

Go live in two steps: a quiet launch with three RWAs for two weeks, then the public townhall. Tick every box before the quiet launch.

- [ ] Five test reports sent from the website (two with photos), one from WhatsApp, one by phone; all five appear in the right Freshdesk group with the right deadline
- [ ] Every test reporter received the reference by email, and by WhatsApp where enabled
- [ ] Track page shows the correct stage for each; a wrong mobile number is refused
- [ ] Stage moved to Resolved on one ticket; the reporter got the feedback message and the ticket closed only after their reply
- [ ] The 24 directory links open and the verified date is this month
- [ ] All 36 ward rows show a councillor name; unverified numbers are marked
- [ ] Hindi toggle checked on a phone by a Hindi-first volunteer; nothing overlaps or cuts off
- [ ] Site opened on a slow mobile connection: loads in under three seconds
- [ ] Privacy notice page live, consent wording checked by your lawyer, retention set to 24 months
- [ ] Not-a-government-site line and 112 visible on every page footer
- [ ] Uptime alert tested; backup export done once
- [ ] Coordinator and two triage volunteers have completed one full week of triage on test tickets
- [ ] Second domain redirects to the first; www works
- [ ] Contact page phone answers, or diverts to the helpline menu

**Quiet launch (2 weeks).** Share the link and WhatsApp number with three RWAs, one each in an HSVP sector, a licensed colony and old Gurugram. Aim for 50 reports. Fix whatever confused people before wider release.

**Public launch.** Announce at the first townhall with the number of reports mapped and filed so far. Publish the first dashboard the same week.

### Operating rhythm after launch

The system only stays credible if the three promises on the dashboard are kept: mapped in 3 working days, escalated at 21 days, published monthly. This is the roster that keeps them.

| When | Who | What |
| --- | --- | --- |
| Every working day, 30 min | Triage volunteer on duty | Open new tickets, confirm the desk and ward, file on the official portal, paste the official ticket number, move Stage to Filed |
| Every working day | Same | Reply to reporters who answered a WhatsApp or email; close only after the reporter confirms the fix |
| Twice a week | Coordinator | Check the SLA breach list; escalate anything past 21 days one rung up the ladder and move Stage to Escalated |
| Weekly, Monday | Coordinator | Send the committee a five-line summary: new, filed, escalated, resolved, oldest open |
| Monthly, 1st working day | Coordinator + one volunteer | Publish the dashboard, run the link check, export the backup, review unverified ward contacts |
| Monthly | Committee | Pick the two recurring problems for the next policy dialogue from the dashboard |
| Quarterly | Owner | Review access: remove departed volunteers from Freshdesk, Cloudflare, Drive; rotate the API key |

**Privacy rules that never change**

1. A reporter's phone number is never sent to an authority or a councillor; the ticket goes with area, ward, spot and photos only.
2. Public pages and the dashboard never show names; only counts.
3. Reports are deleted 24 months after closure unless the reporter asks earlier; the monthly backup follows the same rule.
4. Only agents with a seat can see reporter details; volunteers who file on behalf of others work from the WhatsApp thread, not the ticket.

### Appendix A: accounts and monthly costs

All figures are approximate list prices as of September 2026 in Indian rupees; confirm on each vendor's pricing page before you commit, and expect annual billing to be cheaper.

| Account | Used for | Opened with | Cost |
| --- | --- | --- | --- |
| Cloudflare | Two domains, DNS, hosting, spam check, backend Worker, photo storage | contact@ | Domains about Rs 1,000 to 1,500 each per year; everything else free at this scale |
| Google Workspace | contact@, aliases, Drive, Sheets | contact@ | One user, about Rs 150 to 700 per month depending on plan |
| Bitwarden | Password vault shared with the coordinator | contact@ | Free |
| Freshdesk Omni | Tickets, routing, SLAs, WhatsApp, portal | contact@ | Three seats; plans start around USD 15 to 30 per seat per month, so roughly Rs 4,000 to 8,000 per month; WhatsApp conversations billed by Meta on top, paise per utility message |
| Meta Business | WhatsApp Business API verification | contact@ | Free |
| Exotel | Helpline number, call recording, later the voicebot | contact@ | Number and plan from a few thousand rupees per month plus per-minute charges; voicebot priced separately, get a quote |
| DLT (one telecom) | SMS sender ID and templates | contact@ | Small one-time fee; SMS billed per message |
| PostHog | Site analytics | contact@ | Free tier |
| UptimeRobot | Outage alerts | contact@ | Free tier |
| Freelancer | Phase 3 and the dashboard feed | Contract | Rs 15,000 to 40,000 one time; Rs 3,000 to 8,000 per later change |

Running total once everything is live: about Rs 8,000 to 20,000 a month, most of it Freshdesk seats and calling. The largest hidden cost is volunteer time for triage, about 30 minutes a day.

### Appendix B: freelancer brief to copy and send

Paste this as the job post or email. It is written so a developer can quote a fixed price.

```markdown
Project: connect a static civic website to Freshdesk (Gurugram Vision Forum)

What exists: a single-file HTML site (provided) hosted on Cloudflare Pages, with a 4-step report form, a track page, a join form and a dashboard that currently work only in the browser. A Freshdesk Omni account with groups, custom fields and SLAs already configured. Cloudflare account access (Workers, Pages, R2, Turnstile) and a Freshdesk API key will be provided.

Deliverables:
1. Cloudflare Worker endpoint POST /report: verify the Turnstile token; create a Freshdesk ticket with fields issue type, ward, area, exact spot, coordinates, affects, consent, website reference, requester name, phone, email, description; return the ticket id. Rate-limit by IP.
2. Photo upload to R2 (images only, 10 MB max), attached to the ticket.
3. Endpoint GET /status?ref=&last4=: return only stage, created date and last-updated date when the reference and the last four digits of the requester phone match; otherwise 404. No other fields.
4. Endpoint POST /join: create a Freshdesk contact with role and sector tags; email the coordinator.
5. Update the provided HTML so the report form, track page and join form call these endpoints, with clear error messages; keep the existing design and Hindi toggle unchanged; publish to Pages.
6. Scheduled Worker (nightly) that writes /data/dashboard.json: counts by issue type, ward and stage, plus the percentage of tickets meeting the 3-working-day first response and 21-day resolution SLAs; the dashboard reads this file.
7. Handover: a one-page note on how to redeploy the site, rotate the API key and change the WhatsApp number; all secrets stored as Worker secrets, none in the HTML.

Acceptance: a report submitted from a phone with a photo appears in the correct Freshdesk group within 10 seconds; the reporter's acknowledgement email arrives; the track page reflects a stage change made in Freshdesk; a wrong last-four is refused; dashboard.json updates nightly.

Please quote a fixed price and a delivery date. Two to three days of work is expected.
```

### Appendix C: Freshdesk configuration cheat-sheet

Hand this to the Freshdesk onboarding team; it is everything Phase 2 asks for, in their vocabulary.

**Groups (queues) and where each issue type goes**

| Issue type on the website | Group | First response | Resolution target |
| --- | --- | --- | --- |
| Garbage; Stray animals | MCG sanitation | 3 working days | 21 days |
| Roads, footpaths (internal); Streetlights; Parks, trees | MCG works | 3 working days | 21 days |
| Roads (master); Water, sewer; Drains, flooding | GMDA | 3 working days | 21 days |
| Electricity | DHBVN | 3 working days | 14 days |
| Traffic | Traffic Police | 3 working days | 21 days |
| Police, cyber | Police and cyber | 1 working day | 14 days |
| Air, noise | HSPCB pollution | 3 working days | 21 days |
| Property tax; Illegal construction | Property and plans | 3 working days | 30 days |
| Builders, societies | Builders and societies | 3 working days | 30 days |
| Consumer | Consumer | 3 working days | 30 days |
| RTI | RTI | 3 working days | 45 days |
| Something else | Policy and other | 3 working days | 21 days |

**Custom ticket fields:** Issue type (dropdown, 17 values), Ward (dropdown 1 to 36 and Not sure), Area, Exact spot, Coordinates, Affects (me, society, sector, city), Official channel (dropdown), Official ticket number, Stage (Received, Mapped, Filed officially, Escalated, Resolved), Consent given (checkbox), Website reference.

**Automation rules**

1. On ticket create: set group from Issue type (one rule per type); add tag from Ward; set Stage to Received; send the Received template to the requester.
2. On update, when Stage changes: send the matching template (email and WhatsApp).
3. On update, when Official ticket number becomes non-empty: set Stage to Filed officially.
4. On update, when Stage becomes Resolved: send the Resolved template with the feedback question; do not close the ticket until the requester replies or 7 days pass.
5. Time-based: 2 days after creation with Stage still Received, remind the group; at 18 days without resolution, email the coordinator; on SLA breach, set priority to Urgent and set Stage to Escalated.

**Business hours:** Monday to Saturday, 10:00 to 18:00, Asia/Kolkata; SLA timers respect these hours.

**Portal:** customer portal on, login by email link, agent names hidden, ticket list shows Stage and last update only.

**Roles:** Owner (you), Coordinator as admin, triage volunteers as agents restricted to their groups.

### Appendix D: message templates for each stage

One message per stage, under 60 words, the reference in every one. Submit the WhatsApp versions to Meta as Utility templates; the same text works for email and SMS. Curly braces are the fields Freshdesk fills in.

| Stage | English | Hindi |
| --- | --- | --- |
| Received | Gurugram Vision Forum: we received your report {ref} about {issue} at {area}. A volunteer will map it to the responsible desk within 3 working days. Track it at gurugramvisionforum.org/#/track. Not a government service; emergencies 112. | गुरुग्राम विज़न फ़ोरम: {area} में {issue} की आपकी रिपोर्ट {ref} मिल गई है। 3 कार्यदिवसों में एक स्वयंसेवक इसे ज़िम्मेदार विभाग से जोड़ेगा। स्थिति: gurugramvisionforum.org/#/track। यह सरकारी सेवा नहीं है; आपातकाल में 112। |
| Mapped | Report {ref}: this is handled by {desk}. Please also file it at {channel} and reply with the ticket number so we can follow it. | रिपोर्ट {ref}: यह {desk} का काम है। कृपया इसे {channel} पर भी दर्ज करें और टिकट नंबर हमें भेजें ताकि हम इसका पीछा कर सकें। |
| Filed officially | Report {ref} is now filed with {desk} as ticket {official}. We check it every week and will escalate if nothing happens within 21 days. | रिपोर्ट {ref} अब {desk} में टिकट {official} के रूप में दर्ज है। हम हर हफ़्ते जाँच करेंगे और 21 दिन में कार्रवाई न होने पर आगे बढ़ाएँगे। |
| Escalated | Report {ref} had no action within 21 days, so we have escalated it to {level}. You can quote both numbers if you contact them yourself. | रिपोर्ट {ref} पर 21 दिन में कार्रवाई नहीं हुई, इसलिए हमने इसे {level} तक पहुँचाया है। स्वयं संपर्क करने पर आप दोनों नंबर बता सकते हैं। |
| Resolved | Report {ref}: {desk} says this is fixed. Is it? Reply YES to close or NO to reopen. Thank you for reporting; it helps the whole ward. | रिपोर्ट {ref}: {desk} के अनुसार समस्या ठीक हो गई है। क्या सच में? बंद करने के लिए YES, दोबारा खोलने के लिए NO लिखें। रिपोर्ट करने के लिए धन्यवाद। |

Two more you will need: a **reminder** when a reporter has not sent the official ticket number after 5 days, and a **reopened** message when they reply NO. Keep the same shape.

### Appendix E: scripts for the AI calls

Give both scripts to Exotel's voicebot team as the specification. The bot must offer Hindi first, switch to English on request, and hand over to a volunteer or take a callback whenever it fails twice on the same question.

**Script 1: intake call (inbound, someone calls the helpline)**

1. Greeting: "Gurugram Vision Forum. This is an automated line and it is not a government service. For an emergency, hang up and dial 112. To report a civic problem press or say 1; to check a report press or say 2; to speak to a volunteer press or say 3."
2. Issue: "In a few words, what is the problem?" The bot maps the answer to one of the 17 issue types and confirms: "So this is about garbage collection. Correct?"
3. Place: "Which sector, colony or society?" then "Any landmark, like a gate or a house number?"
4. Since when, and any earlier complaint number.
5. Contact: "Should we use this number to update you?" Ask for a name.
6. Consent: "We will share the problem and the place with the responsible department, without your phone number. Say yes to agree."
7. Close: read back a summary, give the reference number twice, say it will also arrive by WhatsApp or SMS, and name the official channel to file with. Create the Freshdesk ticket with the recording and transcript attached.

**Script 2: feedback call (outbound, after a desk marks a ticket resolved)**

1. "This is Gurugram Vision Forum about your report {ref} on {issue} at {area}. The department says it is fixed. Is that right? Say yes or no."
2. On yes: thank them, close the ticket, ask one question: "On a scale of one to five, how easy was it to report?"
3. On no: "What is still wrong?" record the answer, set Stage to Escalated, and tell them a volunteer will call within two working days.
4. On no answer: try once more the next working day, then send the Resolved template on WhatsApp instead.

**Rules for both:** never ask for ID numbers, bank details or passwords; keep every call under four minutes; store the recording with the ticket and delete it with the ticket; announce that the call is recorded at the start.

---

## Appendix B: civic platform benchmark and launch roadmap (25 Sep 2026)

### Summary

The evidence points to one design: public, followable reports routed to a named desk with a clock on them, a loop that closes only when the resident confirms, and monthly publication of what happened. Fourteen platforms across the UK, US, Spain, Iceland and India were benchmarked; the findings below decide the launch build.

1. Visible collective input speeds resolution. Across 100 US cities on SeeClickFix, comments and follows doubled the probability of closure and cut resolution time by up to five days.
2. A closed loop creates repeat participation. mySociety found that a fix turns first-time reporters into repeat reporters; San Francisco surveys found responsiveness makes participation self-reinforcing.
3. Ward-to-engineer routing with SLAs works at scale in India. Swachhata (built on ICMyC) runs 2.7 crore complaints at a 93% average resolution rate with 12-hour to 1-week limits, closed to the citizen's satisfaction.
4. Report cards change representatives' behaviour. Praja has ranked Mumbai and Delhi councillors since 2011 from RTI data, and its audits expose gaps such as no citizen feedback step after closure.
5. An institutional commitment is the difference between a suggestion box and a lever. Better Reykjavík's council processes the 10–15 top-voted ideas every month; about 1,000 accepted since 2011.

Launch shortlist (0–3 months): WhatsApp-first intake into Zoho CRM; ward→desk routing with a 3-day / 21-day clock; public report pages with hidden identity and a follow button; a monthly dashboard by cause and ward; a trust page with registration, people and accounts.

### What measurably raises resolution

Four mechanisms have measured effects; everything else in civic tech is design opinion.

| Mechanism | Evidence | Size of effect | Source |
| --- | --- | --- | --- |
| Visible collective input (comments, likes, follows on a report) | Schiff, Public Administration Review 2025: requests from 100 US cities on SeeClickFix; Oakland officials could see comments and follows, San Francisco officials saw only counts | Oakland requests 2x more likely to close and resolved 5 days faster on average | [GovInsider summary](https://govinsider.asia/intl-en/article/redesigning-citizen-service-request-apps-to-improve-government-responsiveness-us-study), [DOI 10.1111/puar.13747](https://doi.org/10.1111/puar.13747) |
| Closing the loop with the reporter | mySociety research with UK universities on FixMyStreet users; San Francisco resident surveys 2011, 2013, 2015 | A fix turns first-time reporters into repeat reporters; participation responds to responsiveness and becomes self-reinforcing | [mySociety](https://www.mysociety.org/tag/fixmystreet-for-councils/), [Stowers 2022](https://journals.sagepub.com/doi/10.1177/0160323X211064253) |
| Ward-to-engineer routing with a service-level clock | Swachhata platform (ICMyC), 4,503 cities, 31,000+ engineers, 30,000+ wards mapped; limits of 12 hours to 1 week, closure to the citizen's satisfaction, engineer uploads a proof photo | 2.7 crore+ complaints at a 93% average resolution rate | [Janaagraha](https://www.janaagraha.org/work/swachhata-technology-platform/) |
| Precise location and asset identity | FixMyStreet Pro asset layers (streetlight and drain IDs), roadworks alerts to prevent duplicate reports, Open311 middleware in Bristol | Oxfordshire cut call handling from about 4 minutes to 2 (£16,048 a year in staff time); councils report up to 300% shift from phone to online | [mySociety](https://www.mysociety.org/tag/fixmystreet-for-councils/) |

Two further findings shape outreach rather than the product. Safety and health categories are resolved faster than others, so a cross-category dashboard must show medians per category. Over 80% of reports are made about the reporter's home neighbourhood, and NYC data identifies neighbourhoods with dense under-reporting linked to socioeconomic traits: villages and unauthorised colonies in Gurugram will not report unless someone goes there ([Stowers 2022](https://journals.sagepub.com/doi/10.1177/0160323X211064253), [NYU Marron Institute](https://marroninstitute.nyu.edu/papers/estimating-reporting-bias-in-311-compliant-data)).

One institutional finding from the deliberation platforms: a study of Decidim across Catalan municipalities found officials valued transparency, organised information and proposal collection far more than deliberation or any transfer of decision power ([Borge et al. 2023](https://journals.sagepub.com/doi/abs/10.1177/00027642221092798)). Build for transparency first; deliberation features follow once officers trust the data.

### Feature-by-platform matrix

No single platform has all nine features; the Forum's launch build combines the routing of Swachhata, the visibility of FixMyStreet and SeeClickFix, the closure rule of the GMDA portal, and the accountability layer of Praja. Platform names link to the page each row was taken from.

| Platform (run by) | Routes to responsible desk | Time limit / SLA | Public report pages | Follow, vote, comment | Closure and feedback | Public dashboard or open data | Proposals or budgeting | WhatsApp or chat intake | Representative report cards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [FixMyStreet / FixMyStreet Pro](https://www.mysociety.org/tag/fixmystreet-for-councils/) (mySociety charity, UK; 31 councils on Pro) | Yes, by location across authorities | Council-set; status updates from council systems | Yes, all reports published | Subscribe to a duplicate's updates; comments | Reporter marks fixed; council updates | Yes, open report data and hotspots | No | No | No |
| [SeeClickFix 311 CRM](https://govinsider.asia/intl-en/article/redesigning-citizen-service-request-apps-to-improve-government-responsiveness-us-study) (CivicPlus, US) | Yes, category to department | Configured per agency | Yes | Yes: comments, likes, follows | Agency closes; status loop and acknowledgement | Yes, service-level and backlog reporting | No | No | No |
| [NYC 311](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0186314) (City of New York; about 2 million requests a year) | Yes | Published agency SLAs | Partial: open data and maps | No | Agency closes | Yes, full open data | No | No | No |
| [OneService](https://govinsider.asia/intl-en/article/redesigning-citizen-service-request-apps-to-improve-government-responsiveness-us-study) (Municipal Services Office, Singapore) | Yes, to the agency | Internal | No: reporters cannot see others' issues | No | Status in reporter inbox | No | No | Yes: WhatsApp and Telegram chatbot since 2021 | No |
| [ICMyC](https://www.janaagraha.org/i-change-my-city/) (Janaagraha, Bengaluru and Mumbai) | Yes, ward to in-charge engineer | Partial | Yes | Yes: complaint voting, geo-map | Verified reporter and engineer in contact | Yes: budget briefs, Ward Infrastructure Index | Yes: MyCityMyBudget | No | No |
| [Swachhata](https://www.janaagraha.org/work/swachhata-technology-platform/) (MoHUA with Janaagraha; 4,503 cities) | Yes, to the ward sanitary inspector | Yes: 12 hours to 1 week | Yes: nearby complaints visible | Yes: vote, comment, share | Reporter can re-open; engineer uploads proof photo; feedback | Yes: city resolution rates and rankings | No | No | No |
| [MyBMC MARG](https://play.google.com/store/apps/details?id=com.esri.ugms_bmc&hl=en_IN) (BMC, Mumbai; 114 categories) | Yes, to department | Timelines shown per status | Not documented | No | Satisfaction rating on closure; after photos | Ward-wise analytics for supervisors, not public | No | No | No |
| [BBMP Sahaaya 2.0 / Namma Bengaluru](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbbmp-s-sahaaya-pulled-from-app-stores-leaving-citizens-in-a-lurch-3379354) (BBMP, Bengaluru) | Yes, department and category | Partial | No | No | Daily status tracking | No | No | No | No |
| [GMDA integrated portal](https://services.gmda.gov.in/) (GMDA for GMDA, MCG, MC Manesar; Gurugram baseline) | Yes, across the three bodies | Per-category timelines, not published as a dashboard | No | No | Reporter consent to close (verify in current SOP) | No public dashboard | No | Yes: WhatsApp 78400 01817, toll-free, app | No |
| [Praja Foundation](https://www.praja.org/praja_docs/praja_downloads/Mumbai%20Councillors%20Card_2021.pdf) (NGO, Mumbai and Delhi) | Not a reporting tool | Audits the city's own 3-day charter | Publishes complaint data from RTI | No | Flags missing citizen feedback step | Yes: white papers, ward data | No | No | Yes, annual since 2011 |
| [Reap Benefit Solve Ninja](https://thebetterindia.com/changemakers/reap-benefit-bengaluru-youth-whatsapp-chatbot-civic-climate-issue-solutions-10516446) (NGO, 18 states) | No: citizen action first, data shared with government | No | Yes: shared forum and SamaajData | Peer groups and mentoring circles | Action logs and skill profile | Yes: 1 million+ crowdsourced data points | No | Yes: WhatsApp AI mentor bot, 1.5 lakh users | No |
| [Decidim](https://decidim.org/blog/2026-04-07-case-study-participatory-budget-2020-2023-in-barcelona/) (Barcelona City Council; open source) | No | No | Yes: proposals and process history | Yes: endorsements and comments | Proposal status traceable to implementation | Yes: process transparency | Yes: EUR 30 million budget 2020-23 | No | No |
| [Consul / Decide Madrid](https://www.tandfonline.com/doi/full/10.1080/10630732.2020.1786337) (Madrid City Council; open source) | No | No | Yes | Yes: supports and debates | Proposal status | Yes | Yes | No | No |
| [Better Reykjavík](https://www.coe.int/en/web/interculturalcities/-/better-reykjavik) (Citizens Foundation with the City) | No | Yes: council processes top 10-15 ideas monthly | Yes | Yes: points for and against | Formal review; about 1,000 ideas accepted | Yes | Yes: EUR 18 million+ since 2011 | No | No |
| [Mark-a-Spot / Open311](https://www.mark-a-spot.com/citizen-reporting-platforms) (open source, Germany) | Yes | Configurable | Yes | Yes | Status via Open311 | Yes | No | No | No |

Read across the row for the GMDA portal: it already has routing, WhatsApp intake and a reporter-controlled close, but nothing public. The Forum's value is the four empty columns on that row: public pages, following, a published dashboard, and accountability of representatives.

### Platform notes

Three governance models recur: an NGO layer that routes into government systems (mySociety, Janaagraha), a municipal system with an NGO auditing it from outside (Praja over BMC), and a citizen-action network that supplies data governments lack (Reap Benefit). The Forum is the first model at launch and grows into the second.

| Platform | Model and governance | Copy | Avoid |
| --- | --- | --- | --- |
| FixMyStreet (mySociety, UK, 2007) | Charity runs the public site; councils buy FixMyStreet Pro, which drops reports into their own systems via Open311. 31 authorities use it as their primary channel. | Report by location without knowing which body owns the road; every report public; asset IDs on streetlights and drains; roadworks alerts that stop duplicate reports; Open311 middleware so the CRM can be swapped later. | Ranking areas against each other: mySociety's 2018 research found report mixes differ so much by area that comparisons mislead. |
| SeeClickFix 311 CRM (CivicPlus, US, 2008) | Commercial 311 CRM sold to cities; acquired by CivicPlus; about 7 million requests, 5.3 million resolved. | Acknowledge within an hour, then post the ticket ID and updates in the public thread; follows and comments visible to staff; service-level and backlog reports. | Depending on the city to monitor a third-party feed; Boston did, Cambridge ignored it. |
| NYC 311 (City of New York) | City-run; full open data of about 2 million requests a year feeds academic and civic analysis. | Publish the raw request log; measure under-reporting by neighbourhood. | Treating request counts as need: poor neighbourhoods under-report. |
| OneService (Singapore, 2015; chatbot 2021) | Government-run single front door; WhatsApp and Telegram chatbot collects structured fields. | Structured chat intake: issue type, date, time, location, photo. | Hiding other people's reports; the study above shows visibility is what speeds resolution. |
| ICMyC and Swachhata (Janaagraha with MoHUA, 2012 and 2016) | NGO-built platform adopted by a ministry; 4,503 cities; 31,000 engineers; nine languages. | Ward-to-engineer routing; SLA tiers by category; proof photo on closure; reporter can re-open; vote and comment on nearby complaints; public city rankings. | Letting field staff mark resolved or rejected without review; app reviews show rejections for location, society status and premature closures with unrelated photos. |
| MyBMC MARG (BMC, Mumbai, 2026) | Municipal app on ArcGIS; 114 categories; employee workflow with after photos. | Satisfaction rating on closure; before-and-after photo pair; ward-wise supervisor dashboards. | Keeping dashboards internal only. |
| BBMP Sahaaya / Namma Bengaluru (BBMP) | Municipal app run by a private agency; pulled from app stores for a month in January 2025 without the corporation knowing; residents report 300 complaints with poor engineer response. | Nothing new; a warning that municipal apps are fragile. | Depending on a single municipal app as the only channel. |
| GMDA integrated portal (Gurugram) | GMDA-run for GMDA, MCG and MC Manesar; web, toll-free, WhatsApp, app. | Use it as the system of record; store its ticket number on every Forum report. | Duplicating it. |
| Praja Foundation (Mumbai since 1999, Delhi since 2016) | NGO obtains complaint and deliberation data by RTI; co-authored BMC's 1999 Citizen's Charter; annual councillor report cards. | Ward-wise average days to close by category; closure rate versus time taken; councillor attendance and questions matched against citizen complaints; the 5-choice satisfaction question it recommends. | Reading closure rate alone: Mumbai closed 83% in 2017 but average days rose from 15 to 48, and 96% of escalated cases went all the way to the Commissioner. |
| Reap Benefit Solve Ninja (Bengaluru, 2012; 18 states) | Youth cadre with a WhatsApp AI mentor bot; open-source Samaaja stack; SamaajData holds 1 million+ points. Chennai flood heat map used by the corporation for desilting; Delhi inputs fed 15 climate policies. | WhatsApp-first intake; discover, investigate, solve, share loop; city groups, mentoring circles and quarterly meetups to keep volunteers active. | Expecting volunteers to stay without belonging structures. |
| Decidim (Barcelona, 2016) and Consul (Madrid, 2015) | Open-source, city-run; 25,000 sign-ups in two months, 10,860 proposals, 410 meetings in Barcelona's first process. | Proposals with a traceable status; face-to-face meetings recorded on the platform; residency verification for votes. | Launching deliberation before officers trust the data. |
| Better Reykjavík (Citizens Foundation, 2010) | NGO platform with a formal council agreement: top 10-15 ideas processed monthly; 70,000 of 120,000 residents have taken part. | A written monthly commitment from MCG or GMDA to respond to the top issues; points for and against each idea. | Ideas boards with no processing commitment. |
| Mark-a-Spot / Open311 (Germany) | Fully open-source reporting stack with Open311 API. | Adopt Open311 field names so a later MCG integration is a mapping, not a rebuild. | Proprietary lock-in in the CRM. |

One Gurugram-specific reading: the GMDA portal already gives the Forum a system of record, so the Forum should not build its own ticket system. It should build the public layer on top, keyed to GMDA ticket numbers.

### Gurugram-specific warnings

Five risks are visible in local and Indian evidence, and each has a design answer.

1. Complainants get identified and pressured. A February 2026 Swachhata reviewer was contacted by a municipal officer for name and address, then by the corporator asking them to stop posting online; they stopped ([App Store reviews](https://apps.apple.com/in/app/swachhata-mohua/id1124033628)). Answer: public report pages show the ward and the issue, never the reporter; the Forum, not the resident, is the named party on escalations.
2. Complaints get rejected on jurisdiction or closed with the wrong photo. A Gurugram reviewer's Aravalli dumping complaints were rejected by MCG on the ground that Suncity is a society; a November 2025 reviewer had a sewage complaint marked resolved with a photo from another location, with no escalation route ([App Store reviews](https://apps.apple.com/in/app/swachhata-mohua/id1124033628)). Answer: the Forum's routing table records the licence and handover status of each colony, and a rejection is itself a tracked status with a 21-day escalation clock.
3. Closure counts hide slow delivery. Praja's RTI audit of Mumbai: complaints rose 49% from 61,910 in 2015 to 92,329 in 2017; closure rose to 83% but the average days to resolve rose from 15 to 48; the councillor code was blank on 77% of complaints; 96% of escalated cases reached the Commissioner because the intermediate levels did not act ([Praja white paper, April 2018](https://www.praja.org/praja_docs/praja_downloads/Report%20on%20Civic%20Issues%20Registered%20by%20Citizens%20and%20Deliberations%20done%20by%20Municipal%20Councillors%20in%20Mumbai.pdf)). Answer: publish median days by category and ward, not only closure rate, and tag every report with its ward and councillor.
4. Municipal apps can disappear. BBMP's Sahaaya was unavailable in both app stores for a month in January 2025 while the corporation, which had outsourced it, was unaware ([Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbbmp-s-sahaaya-pulled-from-app-stores-leaving-citizens-in-a-lurch-3379354)). Answer: the Forum's channels (WhatsApp, web) stay up regardless, and mirror the GMDA ticket number rather than replacing it.
5. Reporting is skewed to those who already report. Over 80% of reports are made about the reporter's home neighbourhood, and under-reporting clusters in poorer areas ([Stowers 2022](https://journals.sagepub.com/doi/10.1177/0160323X211064253), [NYU Marron Institute](https://marroninstitute.nyu.edu/papers/estimating-reporting-bias-in-311-compliant-data)). In Gurugram this means villages, unauthorised colonies and worker settlements. Answer: assign youth fellows and area chapters to wards with low report counts, and read a low count as under-reporting until a walk-through says otherwise.

### Prioritised roadmap

Eleven items in three phases; the first five are the launch build and each carries its evidence.

| Phase | # | Feature | Why (evidence) | Platform it comes from | Build note |
| --- | --- | --- | --- | --- | --- |
| Launch, months 0-3 | 1 | WhatsApp-first intake (bot for structured fields, human desk behind it) feeding Zoho CRM; web form second | 1.5 lakh users on Reap Benefit's bot; OneService's chatbot collects issue, date, time, location in structured fields; GMDA already takes WhatsApp | Reap Benefit, OneService, GMDA | Zoho CRM plus a WhatsApp Business API provider; the site's category and ward fields become the bot's questions |
| Launch | 2 | Ward-to-desk routing table with an SLA clock: 3 working days to map, 21 days to escalate; closure only on reporter confirmation | Swachhata's 12-hour to 1-week limits at 93% resolution; Praja shows closure without a clock hides 48-day averages | Swachhata, Praja | One table in the CRM: category x jurisdiction (MCG, GMDA, HSVP, DTCP, private colony) x officer level x days |
| Launch | 3 | Public report pages with the reporter hidden, plus follow and "me too" | Visible comments and follows doubled closure odds and cut 5 days in the 100-city study; FixMyStreet made reporting public by design | SeeClickFix, FixMyStreet | Each report gets a public URL keyed to the GMDA ticket; identity never shown; upvotes moderated |
| Launch | 4 | Monthly accountability dashboard from the CRM: received, filed, past due, closed, median days, by cause and ward | SeeClickFix service-level reporting; Swachh Manch city dashboard; Praja's ward-wise days-to-close | SeeClickFix, Swachhata, Praja | Replace the prototype's sample figures with a CRM export on the first of each month |
| Launch | 5 | Trust page: registration, office bearers, funders, annual accounts, response-time commitments | 2026 nonprofit checklists: a sceptical funder verifies who you are in two clicks; Praja and mySociety publish accounts and donors | mySociety, Praja | One page; update quarterly |
| Next, months 3-9 | 6 | Councillor and officer scorecards from RTI data: House and ward-committee attendance, questions raised, complaints per ward versus resolution | Praja's report cards since 2011; its finding that 38 Mumbai councillors asked no question in 2017 | Praja | First RTI to MCG for House attendance and ward-wise complaint data; publish twice a year |
| Next | 7 | Proposals module for policy dialogues with traceable status: submitted, discussed, accepted, implemented; points for and against | Decidim's process history; Better Reykjavík's monthly council processing of top ideas | Decidim, Better Reykjavík | Ask MCG and GMDA for a written commitment to respond to the top five issues each quarter |
| Next | 8 | 36-ward GIS auto-fill in the form; asset IDs for streetlights where MCG has them | FixMyStreet asset layers cut misreports; Oxfordshire halved call handling time | FixMyStreet | Needs the MCG or GMDA ward shapefile; point-in-polygon on the web form |
| Next | 9 | Youth fellows as ward owners: each fellow runs one ward's data collection, with city groups and quarterly meetups | 80% of Reap Benefit fellows continue as civic intermediaries; belonging structures keep volunteers active | Reap Benefit | Pair each fellow with an area chapter and the ward councillor |
| Later, months 9-18 | 10 | Participatory budgeting pilot with MCG ward funds | Bengaluru allocated INR 120 crore through MyCityMyBudget in FY 2020-21; Barcelona EUR 30 million 2020-23 | ICMyC, Decidim | Start with one ward and a public list of what was funded |
| Later | 11 | Open data exports (Open311-style) and an annual Gurugram ward infrastructure index | NYC's open request log; Janaagraha's Ward Infrastructure Index drives budget allocation | NYC 311, ICMyC | Publish the CRM export as CSV monthly; index once a year |

A native app is not on the list. WhatsApp plus a fast mobile web page reaches more residents than an app store listing, and municipal app history in Bengaluru shows the maintenance risk.

### What not to build

- A second ticketing system. The GMDA portal is the system of record for GMDA, MCG and MC Manesar; the Forum stores its ticket number and builds the public layer above it.
- A native app before WhatsApp and the web page hit a ceiling. Sahaaya's month-long absence from the app stores is the cost of the app route.
- Public reporter identities. The pressure on complainants documented in Swachhata reviews is the reason.
- Unmoderated upvote rankings. Visible collective input speeds resolution, but a ranking that any group can flood becomes a lobbying tool; moderate and cap votes per account.
- Area-versus-area league tables. mySociety's 2018 research found the mix of reports varies too much by area for fair comparison; publish per-ward medians with the caveat, not rankings.
- A closure rate without a time measure. Mumbai's 83% closure sat beside a 48-day average.
- Deliberation features before a written response commitment exists. Officials value transparency and organised proposals first; get the monthly or quarterly commitment, then open the proposals module.

### Sources

Pages opened for this document, as of 25 September 2026. Figures from the App Store reviews and the Deccan Herald report are single accounts, not measurements.

- Schiff, K.J., Does collective citizen input impact government service provision? Evidence from SeeClickFix requests, Public Administration Review 2025, [DOI 10.1111/puar.13747](https://doi.org/10.1111/puar.13747); summary at [GovInsider](https://govinsider.asia/intl-en/article/redesigning-citizen-service-request-apps-to-improve-government-responsiveness-us-study)
- Stowers, G., Back to Basics: City Services and 311 Service Requests, State and Local Government Review 2022, [SAGE](https://journals.sagepub.com/doi/10.1177/0160323X211064253)
- NYU Marron Institute, [Estimating Reporting Bias in 311 Complaint Data](https://marroninstitute.nyu.edu/papers/estimating-reporting-bias-in-311-compliant-data)
- Wang et al., Structure of 311 service requests as a signature of urban location, PLOS One 2017, [PLOS](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0186314)
- mySociety, [FixMyStreet for Councils](https://www.mysociety.org/tag/fixmystreet-for-councils/) (asset IDs, roadworks alerts, Open311, Oxfordshire savings, repeat-reporter research) and [FixMyStreet research note on area comparisons](https://www.mysociety.org/category/community/fixmystreet/)
- Janaagraha, [Swachhata Technology Platform](https://www.janaagraha.org/work/swachhata-technology-platform/) and [I Change My City](https://www.janaagraha.org/i-change-my-city/); [MyCityMyBudget figure](https://www.janaagraha.org/)
- Praja Foundation, [Report on Civic Issues Registered by Citizens and Deliberations by Municipal Councillors in Mumbai, April 2018](https://www.praja.org/praja_docs/praja_downloads/Report%20on%20Civic%20Issues%20Registered%20by%20Citizens%20and%20Deliberations%20done%20by%20Municipal%20Councillors%20in%20Mumbai.pdf) and [Mumbai Councillors Report Card 2021](https://www.praja.org/praja_docs/praja_downloads/Mumbai%20Councillors%20Card_2021.pdf)
- Swachhata-MoHUA, [App Store listing and reviews](https://apps.apple.com/in/app/swachhata-mohua/id1124033628)
- BMC, [MyBMC MARG on Google Play](https://play.google.com/store/apps/details?id=com.esri.ugms_bmc&hl=en_IN)
- Deccan Herald, [BBMP's Sahaaya pulled from app stores, 30 January 2025](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbbmp-s-sahaaya-pulled-from-app-stores-leaving-citizens-in-a-lurch-3379354)
- GMDA, [integrated grievance portal](https://services.gmda.gov.in/)
- The Better India, [Reap Benefit's WhatsApp chatbot, 16 October 2025](https://thebetterindia.com/changemakers/reap-benefit-bengaluru-youth-whatsapp-chatbot-civic-climate-issue-solutions-10516446)
- Decidim, [Case study: Participatory Budget 2020-2023 in Barcelona](https://decidim.org/blog/2026-04-07-case-study-participatory-budget-2020-2023-in-barcelona/); [Participedia on Decidim](https://participedia.net/case/decidim-participatory-budgeting-in-barcelona); Borge, Balcells and Padró-Solanet, Democratic Disruption or Continuity? [American Behavioral Scientist 2023](https://journals.sagepub.com/doi/abs/10.1177/00027642221092798); Charnock et al., Going Beyond the Smart City?, [Journal of Urban Technology 2020](https://www.tandfonline.com/doi/full/10.1080/10630732.2020.1786337)
- Council of Europe Intercultural Cities, [Better Reykjavík](https://www.coe.int/en/web/interculturalcities/-/better-reykjavik)
- Mark-a-Spot, [Citizen reporting platforms guide](https://www.mark-a-spot.com/citizen-reporting-platforms)
- Elevation, [Nonprofit Website Best Practices: The 2026 Checklist](https://www.elevationweb.org/?p=2431); Bloomerang, [Nonprofit fundraising website best practices](https://bloomerang.com/blog/nonprofit-fundraising-website-best-practices)

---

*End of handoff. Exported 7 October 2026.*
