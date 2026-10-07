# Area → MCG ward lookup: sources, coverage, spot-checks

Compiled 7 Oct 2026 for `data/area-wards.csv` and `supabase/seed_area_wards.sql`
(`public.area_wards`). Ward numbers follow the 2023 delimitation (36 wards,
ULB Haryana final notification 15 Dec 2023) used for the 2 March 2025 election;
councillor names in `site/data.js` `WARDS` were used to confirm numbers.

The CSV has **245 rows** covering **35 of 36 wards** (ward 36 has no source
naming its areas) and **80 sector entries**. 132 rows rest on a press report of
the final notification; 114 rows carry `verify` in the note and should be
treated as suggestions until a volunteer confirms them.

## How the sources were reached

The research session's network policy blocked every site except a web-search
index: `ulbharyana.gov.in`, `mcg.gov.in`, `gurugram.gov.in`, the SEC press
note on `cdnbbsr.s3waas.gov.in`, `amarujala.com`, `tribuneindia.com`,
`newzpapr.com`, `samvadabroadcast.com` and Wikipedia all refused the proxy.
Every mapping below therefore comes from search-result excerpts of those
pages, not from reading the pages themselves. The official notification PDF
was never opened. **First job for whoever has an open browser:** download the
final notification from the ULB "Ward Bandi" page (link below) and diff it
against the CSV; then re-run `npm run seed`-style regeneration from the
generator if the owner keeps it (`scratchpad/gen-area-wards.mjs` was the
one-off generator; the CSV is now the source of truth).

## Sources

| Key | Source | Date | What it gave |
|---|---|---|---|
| ULB | Directorate of Urban Local Bodies, Haryana, "Ward Bandi" notifications page: https://ulbharyana.gov.in/Home/WardBandiNewNotification | preliminary 28 Aug 2023, final 15 Dec 2023, reservation 3 Jan 2025 | The authoritative list. Listed in the index but **could not be fetched**. |
| AU | Amar Ujala, "वार्ड परिसीमन को शासन की मंजूरी, चुनाव के लिए सक्रिय हुए नेता": https://www.amarujala.com/delhi-ncr/gurgaon/government-approves-ward-delimitation-leaders-become-active-for-elections-gurgaon-news-c-24-1-noi1094-21236-2023-12-17 | 17 Dec 2023 | Reports the government's 14 Dec 2023 approval and prints the ward-wise area list. Excerpts recovered for wards 1, 2, 4, 5, 6 (start), 8, 9, 12, 15–21 (partial), 25, 27, 29 (inferred from position), 30, 31, 32 (start), 34, 35. Rows marked "press report of final notification" come from here. |
| NZ | newzpapr.com, "Wards": https://newzpapr.com/wards-4/ | page updated Sept 2026 | Two lists on one page: "New Municipal Wards of Gurugram 2025" and the pre-2023 list. Wherever both AU and NZ were visible they agree (wards 1, 2, 12, 14–18, 34, 35), so NZ was used to fill wards 3, 7, 10, 11, 13, 14, 22, 23, 26, 28, 33. Its 19–24 block is labelled inconsistently (see "Uncertain"). Also carries the 8 Sept 2026 six-zone office order. |
| SV | Samvada Broadcast: https://samvadabroadcast.com/mcg-ward-division-dlf-2-split-in-parts/ and https://samvadabroadcast.com/ward-2councillor-elections-mcg/ | Sept 2023 / 2024 | Draft (Aug 2023) put DLF 2 blocks J and Q in ward 1; final put all of DLF 2 in ward 2 with Sirhaul, Dundahera, Surya Vihar. |
| Zee | Zee News, full list of 2025 winners: https://zeenews.india.com/india/gurugram-municipal-corporation-election-result-full-list-of-winners-2871150.html | 12 Mar 2025 | Ward → councillor, matches `WARDS` in `site/data.js`. |
| Councillor pages | Narayan Bhadana (ward 20) https://www.narayanbhadana.com/about ; Raj Singh Amit Bhadana (19) https://www.facebook.com/rajsinghamitbhadana/ ; Kunal Yadav (23) https://www.instagram.com/kunalyadav_ward23/ ; Aarti Yadav (24) https://www.facebook.com/aartiyadavward32/ ; Ram Avtar Rana (5) https://www.facebook.com/JJPRamavtarrana/ | 2025–26 | Office addresses and stated areas, used only to confirm which ward number a block belongs to. |
| Tribune | "Four Gurugram MC zones restructured…": https://www.tribuneindia.com/news/delhi/four-gurugram-mc-zones-restructured-for-easy-execution-of-works-better-administrative-control ; "Gurugram to have 36 wards": https://www.tribuneindia.com/news/haryana/gurugram-to-have-36-wards-for-mc-elections-535168 | 2023, 2025 | 36-ward count; zone groupings (used only as a consistency check). A later Tribune item places "ward 25 (HSVP sectors incl. Sector 17)". |
| Desh Rojana | two clusters / eight zones order: https://www.deshrojana.com/haryana/gurugram/gurugram-news-major-reshuffle-in-municipal-corporation-gurugram-will-be/article-2027 | 2026 | Zone → ward grouping (consistency check). |
| GeoIQ | https://geoiq.io/places/Ward-No.7,-Sector-105/y1kQaWQJBK | — | "Ward No. 7, Sector 105". |
| District | Voter list for MC election Gurugram 2025 (ward- and booth-wise PDFs): https://gurugram.gov.in/voter-list-for-mc-election-gurugram-2025/ | Jan 2025 | Blocked; the booth PDFs name streets and colonies per ward and are the best official cross-check after the notification. |
| SEC | Press note, municipal elections 2025: https://cdnbbsr.s3waas.gov.in/s31c6a0198177bfcc9bd93f6aab94aad3c/uploads/2025/02/202502221607687499.pdf | 22 Feb 2025 | Blocked. |
| Draft map | "Proposed ward MCG 04.08.2023" (scan on Scribd): https://www.scribd.com/document/828699204/PROPOSED-WARD-MCG-04-08-2023-p2-1 | 4 Aug 2023 | The draft; numbering differs from the final in the 19–24 group. |
| Old map | OpenCity 35-ward GeoJSON (pre-2023): https://data.opencity.in/dataset/gurugram-wards-map | 2024 | Do **not** load into `ward_boundaries`; it is the old delimitation. |

## Coverage

- `site/data.js` `AREAS` has 182 entries; **123 have a row**. The rest are
  listed below by reason.
- HSVP sectors inside MCG with a row (80): 1–7, 9, 9B, 10, 10A, 12A, 14–18,
  21–33, 37, 37B, 37D, 38–47, 49–58, 61, 62, 65–75, 100–106, 109–115.
- Licensed colonies and villages with a row: all of DLF 1–5, Cyber City,
  Sushant Lok 1–3, South City 1–2, Palam Vihar and Extension, Udyog Vihar,
  Ardee City, Suncity, Nirvana Country, Rosewood City, Mayfield Garden,
  Malibu Towne, Uppal Southend, Greenwood City, Ambience Island, and the
  villages Nathupur, Sikanderpur, Sirhaul, Dundahera, Chakkarpur, Wazirabad,
  Kanhai, Silokhera, Jharsa, Islampur, Ghasola, Fazilpur Jharsa, Badshahpur,
  Ghata, Kadarpur, Ullawas, Bhondsi, Basai, Kadipur, Khandsa, Dhanwapur,
  Daultabad, Dhankot, Bajghera, Mollahera, Chauma Khera, Sukhrali, Narsinghpur,
  Kherki Daula, Mohammadpur Jharsa, Begumpur Khatola, Sihi, Tigra, Behrampur.

### In `AREAS` but given no row

Outside MCG wards (the form should say "outside MCG wards"):

- **Sectors 76–95**: Municipal Corporation Manesar (created Dec 2020). MCG's
  last sectors on that side are 74A/75/75A (ward 17).
- **Manesar, IMT Manesar**: MC Manesar / HSIIDC.

Inside or at the edge of MCG but no source names the ward:

- **Sectors 8, 11, 12, 13** (old city; probably wards 26–31 group).
- **Sectors 19, 20** (Udyog Vihar / Dundahera side; probably ward 2 or 3).
- **Sector 34, 35, 36** (Hero Honda Chowk / Khandsa; probably 9, 10 or 11.
  AU's ward 16 list prints "Sector 34", almost certainly a misprint for 72;
  it was not used.)
- **Sector 48** (Tikri, Vipul World, Central Park, Bestech Park View, Vatika
  City are all Sector 48/49; probably ward 15 or 16 — the old ward 26 had
  Sector 48, 49, Fazilpur and Uppal Southend together).
- **Sectors 59, 60, 63, 64** (Golf Course Extension; probably ward 20, which
  has 58, 61, 62, Ghata, Ullawas, Kadarpur).
- **Sectors 96–99, 107, 108** (Dwarka Expressway; probably wards 5, 6 or 7).
- **Jacubpura, Sadar Bazar** (AU's ward 31 list has the adjoining Jawahar
  Nagar, Mahavir Pura, Ashok Puri and Dayanand Colony, so 31 is likely, but
  neither name appeared).
- **Tikri, Naharpur Rupa, Vatika City, Central Park, Emaar Palm Drive, Vipul
  World, Orchid Petals, Bestech Park View**: no source.
- **Ward 36** (councillor Rekha Saini, BJP; her husband Dinesh Saini was the
  pre-2023 councillor for the Gurgaon-village/Sector 12 ward): no list seen.
  The zone orders group 36 with 1–4 and 35, so it is on the north side
  (Gurgaon Gaon / Sector 3 / Ashok Vihar 3 are the candidates).
- Corridor names (**Sohna Road, Golf Course Road, Golf Course Extension Road,
  MG Road, Dwarka Expressway, Old Gurugram, New Gurugram**) span several wards
  and were deliberately left unmapped; the form should ask for a sector.

### Uncertain (why 114 rows say "verify")

1. **Wards 19–24.** Amar Ujala's final list gives 19 = Bhondsi/Mohan Nagar,
   20 = Kadarpur/Ullawas/Ghata/Sectors 55, 58, 61, 62/Sushant Lok 2, and
   starts 21 with Wazirabad. newzpapr's page carries the same southeastern
   blocks but labels the Sushant Lok 1 / Sectors 29-30-44-45 / Kanhai /
   Silokhera / South City 1 block as ward 19/20 in one place and 21 in
   another (the Aug 2023 draft numbered the group differently). Councillor
   evidence supports Amar Ujala (Raj Singh Amit Bhadana gives Bhondsi as his
   address; Narayan Bhadana's office is in Sushant Lok 2, Sector 55), so the
   CSV puts the Sushant Lok 1 block in **21**, Ardee City/Suncity/Sectors
   52–56 in **22** (Vikash Yadav, unopposed, Wazirabad), Chakkarpur/DLF 1/
   Sector 28 in **23** (Kunal Yadav), and DLF 4/DLF 5/Sectors 42, 43, 27/
   Saraswati Kunj in **24** (Aarti Yadav's stated area). Wazirabad village
   itself is given to 21 and is probably split with 22.
2. **Ward 10 vs 11 vs 6** on the west: newzpapr's blocks for Kadipur village/
   Sector 10A/Pace City 1 (10) and Basai/Dhanwapur/Sectors 100–104 (11) were
   not seen in Amar Ujala; AU's ward 6 begins "Sector 102, 102A", so 102 was
   moved to 6 and 103/106/Daultabad/Dhankot follow it.
3. **Ward 13** (Sector 15 Parts 1–2, Kirti Nagar, Sectors 31, 40, Prem Puri)
   is newzpapr only.
4. **Sector 12A**: AU lists it in ward 25; newzpapr in ward 26. CSV says 25.
5. **Split sectors**: 37 (9/10), 43 (21/24), 49 (15/16), 50 (14/15), 53
   (22/24), 57 (14/22), Rajendra Park (34/7), Surat Nagar (34/11), Dhanwapur
   (11/7), Greenwood City (12/21), Jyoti Park (30/32), Arjun Nagar (30/29).
6. "Derived" rows (Sector 24 ← DLF 3, 25 ← DLF 2, 26 ← DLF 1, 32 ← Silokhera,
   47 ← Malibu Towne) map a sector through the colony that occupies it.

## 20 rows most worth a volunteer spot-check (OneMap GGM, onemapggm.gmda.gov.in)

Check each against the MCG ward layer on OneMap GGM, or the ward-wise booth
list on gurugram.gov.in, and edit `data/area-wards.csv` then regenerate the SQL.

| # | area | ward in CSV | why |
|---|---|---|---|
| 1 | Sushant Lok 1 | 21 | draft/final numbering conflict; biggest colony in the uncertain block |
| 2 | Sector 45 | 21 | same block; Kanhai village |
| 3 | Sector 44 | 21 | same block |
| 4 | South City 1 | 21 | same block; Block I separately in 12 |
| 5 | Sector 43 | 24 | Sushant Lok 1 is Sector 43 but listed in 21 |
| 6 | DLF Phase 4 | 24 | only newzpapr block + councillor's stated area |
| 7 | DLF Phase 5 | 24 | Sector 53 listed in 22 |
| 8 | Sector 53 | 22 | 22 vs 24 |
| 9 | Sector 56 | 22 | Sushant Lok 2 (Sector 55/56) listed in 20 |
| 10 | Sector 57 | 14 | 14 (Sushant Lok 3) vs 22 |
| 11 | Wazirabad | 21 | 21 vs 22 |
| 12 | Sector 12A | 25 | 25 (AU) vs 26 (newzpapr) |
| 13 | Sector 14 | 25 | ward 31's councillor (Dalip Sahani) held the old Sector 14 ward |
| 14 | Sector 31 | 13 | newzpapr only; old ward had 31 with Jharsa (12) |
| 15 | Sector 40 | 13 | 13 vs the Kanhai block (21) |
| 16 | Sector 15 | 13 | newzpapr only |
| 17 | Sector 10A | 10 | 10 vs 9; also Sector 37 split |
| 18 | Basai | 11 | 11 vs 9 (Basai Enclave) vs 6 |
| 19 | Sector 102 | 6 | AU start of ward 6; newzpapr had 100–104 in 11 |
| 20 | Laxman Vihar / Sector 4 | 33 | AU excerpt runs it into ward 30; newzpapr says 33 |

## Keeping it current

- Ward boundaries do not change until the next delimitation (before the 2030
  election). Zone orders (Jan 2025 four zones; 2026 eight zones; Sept 2026 six
  zones) regroup wards for MCG engineering and do not move areas between
  wards.
- When the GMDA GIS cell's boundary file is loaded into `ward_boundaries`,
  `/api/ward` should prefer the polygon hit and use `area_wards` only as a
  fallback for reports without a pin; the `note` column is there so the desk
  can show "verify" rows differently.
