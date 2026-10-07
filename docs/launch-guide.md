# Gurugram Vision Forum: launch guide, step by step

Sep 30, 2026 · Saurabh Rao (written with Claude; live copy at https://claude.ai/code/artifact/019e58ec-7278-4dc9-9b35-9486efca03c5)

## Before you start

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

## Phase 0: three decisions (this week)

Nothing else can start until these are written down.

1. **Domain name.** The deck uses gurgaonvisionforum.org, the email uses gurugramvisionforum.org. Pick one; buy the other too and point it at the first so nobody lands on a dead page. Recommendation: gurugramvisionforum.org, the city's legal name and the one on the email.
2. **Case system.** Freshdesk Omni for launch, three agent seats. It has WhatsApp built in, routing and SLA queues, a public tracking portal, and an onboarding team. Zoho Desk is the cheaper alternative if you want it beside Zoho Books; the steps below name Freshdesk, and every step has a Zoho equivalent.
3. **Owner and coordinator.** One person owns the accounts and the bank card; one person runs the tracker. Write both names on the tracker sheet.

Also decide now, because they gate later phases: the legal form of the Forum (trust, society or Section 8 company), since Meta and Exotel both ask for the registration certificate; and the mobile number that will become the WhatsApp line, a new SIM never used with the WhatsApp app.

## Phase 1: domain, email and hosting (week 1 to 2)

One provider for domain, hosting and spam protection keeps this to two accounts: Cloudflare and Google Workspace. Everything in this phase is point-and-click; no code.

**Step 1: buy the domain (30 minutes)**

1. Go to cloudflare.com, create an account with the Forum email, turn on two-factor.
2. Domain Registration, then Register domains: search gurugramvisionforum.org, buy it, and buy gurgaonvisionforum.com as well (done 8 Oct 2026 on Vercel Domains). Turn on auto-renew for both.
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
4. Point the second domain: in gurgaonvisionforum.com, Rules, Redirect Rules, create one that sends all traffic to https://gurugramvisionforum.org.

**Step 4: spam protection and the backend home (15 minutes)**

1. Cloudflare, Turnstile, Add widget, name it gvf-forms, domain gurugramvisionforum.org. Save the Site key and Secret key in the password manager; the freelancer needs them.
2. Nothing else to do here: the freelancer will create a Cloudflare Worker in this same account in Phase 3. Do not share your password; add the freelancer as a member with limited access (Manage Account, Members, Invite) and remove them after.

**Done when:** the site opens on https://gurugramvisionforum.org on a phone, an email to contact@ arrives, and a test email sent from contact@ to a Gmail account lands in the inbox, not spam.

## Phase 2: set up the case system (week 2 to 3)

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

## Phase 3: connect the website to the case system (week 3 to 4)

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

## Phase 4: the master data that makes routing work (week 3 to 5, in parallel)

Routing is only as good as three tables. Two volunteers build them in one Google Sheet called "GVF master data", shared with the coordinator and, view-only, with the freelancer.

1. **Create the sheet with six tabs.** Issue types (17 rows: category, responsible desk, official channels, escalation ladder, Freshdesk group); Portals (24 rows: name, link, what it is for, phone, date last verified); Charters (11 rows); Roles (27 rows); Wards (36 rows); Sector to ward (one row per sector or colony). Start by copying what the website already shows; the developer can export it for you in an hour.
2. **Ward contacts (2 weeks of calls).** For each of the 36 wards: councillor name, office phone, email if any, the MCG zone and its junior engineer for roads, the sanitation supervisor. Sources: the MCG office at Civil Lines, the zonal offices, the councillor's own social page, RWA federations. Log the date and who confirmed each number; unverified rows stay marked "unverified" and the site says so.
3. **Sector-to-ward table.** Take the 2023 ward delimitation notification on ulbharyana.gov.in (it is a scanned PDF, so somebody reads and types it), list every sector, colony and village against its ward, then spot-check 20 rows against OneMap GGM. Where a sector splits across wards, note both and the dividing road.
4. **Load routing into Freshdesk.** From the Issue types tab, the coordinator sets the group in each Phase 2 automation rule. From the Wards tab, add the councillor email to the ticket-created rule as a CC once the office confirms it wants copies.
5. **Hand the sheet to the freelancer.** They point the site's directory, rights, roles, ward table and the report form's ward dropdown at this sheet, so a corrected phone number reaches the website within a day without a developer.
6. **Set a monthly link check.** A volunteer opens the 24 portal links on the first working day of the month, fixes any that moved, and updates the verified date column; the footer's "links verified" date reads from it.

**Done when:** every ward row has at least a confirmed councillor number, the sector table covers all HSVP sectors and the main licensed colonies, and a change in the sheet appears on the site without anyone editing code.

## Phase 5: WhatsApp, helpline number, AI calling and SMS (after registration, week 4 to 8)

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

## Phase 6: updates, dashboard, analytics, monitoring (week 6 to 10)

These make the site a living thing rather than a launch page. Order them by what the team will actually use; the dashboard feed matters more than a content system.

**Step 1: dashboard feed (freelancer, 1 day).** A scheduled job in the same Cloudflare Worker reads Freshdesk every night and writes one small file: counts of reports by issue type, by ward, by Stage, and the share of tickets that met the 3-day and 21-day commitments. The site's dashboard reads that file and shows "Updated: date". Nothing about individual reporters is in it. Publish the first month only after 50 reports, as the site already promises.

**Step 2: updates without a developer (choose one).**

1. Simplest: a Google Drive folder "GVF updates" with one sub-folder per story (a text file with title, date, tag, body, plus photos). The freelancer adds a job that turns it into the Updates page. A volunteer can publish by dropping a folder in.
2. Fuller: move the site to Webflow with a content collection for stories, photos, videos and press, and forms wired to the same Worker. Two to three weeks of agency work; do it in year two when there is a communications volunteer.

**Step 3: analytics (30 minutes).** posthog.com, free plan, create a project named GVF site, copy the one-line snippet to the freelancer to paste in. Ask for five events only: issue tile picked, report started, report sent, track used, Hindi switched on. The monthly dashboard post uses these numbers.

**Step 4: monitoring (15 minutes).** uptimerobot.com, free plan, monitor https://gurugramvisionforum.org every 5 minutes with an alert to contact@ and the coordinator's phone. Add the Worker's status endpoint as a second monitor.

**Step 5: backups and exports (monthly, 20 minutes).** On the first of the month the coordinator exports all tickets from Freshdesk (Reports, Export) to a dated file in a restricted Drive folder, and downloads the master sheet as a copy. Keep twelve months.

**Done when:** the dashboard shows real counts with a date, a volunteer has published one update without help, PostHog shows the five events, and an outage alert has been tested by taking the site down for a minute.

## Phase 7: testing and go-live

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

## Operating rhythm after launch

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

## Appendix A: accounts and monthly costs

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

## Appendix B: freelancer brief to copy and send

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

## Appendix C: Freshdesk configuration cheat-sheet

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

## Appendix D: message templates for each stage

One message per stage, under 60 words, the reference in every one. Submit the WhatsApp versions to Meta as Utility templates; the same text works for email and SMS. Curly braces are the fields Freshdesk fills in.

| Stage | English | Hindi |
| --- | --- | --- |
| Received | Gurugram Vision Forum: we received your report {ref} about {issue} at {area}. A volunteer will map it to the responsible desk within 3 working days. Track it at gurugramvisionforum.org/#/track. Not a government service; emergencies 112. | गुरुग्राम विज़न फ़ोरम: {area} में {issue} की आपकी रिपोर्ट {ref} मिल गई है। 3 कार्यदिवसों में एक स्वयंसेवक इसे ज़िम्मेदार विभाग से जोड़ेगा। स्थिति: gurugramvisionforum.org/#/track। यह सरकारी सेवा नहीं है; आपातकाल में 112। |
| Mapped | Report {ref}: this is handled by {desk}. Please also file it at {channel} and reply with the ticket number so we can follow it. | रिपोर्ट {ref}: यह {desk} का काम है। कृपया इसे {channel} पर भी दर्ज करें और टिकट नंबर हमें भेजें ताकि हम इसका पीछा कर सकें। |
| Filed officially | Report {ref} is now filed with {desk} as ticket {official}. We check it every week and will escalate if nothing happens within 21 days. | रिपोर्ट {ref} अब {desk} में टिकट {official} के रूप में दर्ज है। हम हर हफ़्ते जाँच करेंगे और 21 दिन में कार्रवाई न होने पर आगे बढ़ाएँगे। |
| Escalated | Report {ref} had no action within 21 days, so we have escalated it to {level}. You can quote both numbers if you contact them yourself. | रिपोर्ट {ref} पर 21 दिन में कार्रवाई नहीं हुई, इसलिए हमने इसे {level} तक पहुँचाया है। स्वयं संपर्क करने पर आप दोनों नंबर बता सकते हैं। |
| Resolved | Report {ref}: {desk} says this is fixed. Is it? Reply YES to close or NO to reopen. Thank you for reporting; it helps the whole ward. | रिपोर्ट {ref}: {desk} के अनुसार समस्या ठीक हो गई है। क्या सच में? बंद करने के लिए YES, दोबारा खोलने के लिए NO लिखें। रिपोर्ट करने के लिए धन्यवाद। |

Two more you will need: a **reminder** when a reporter has not sent the official ticket number after 5 days, and a **reopened** message when they reply NO. Keep the same shape.

## Appendix E: scripts for the AI calls

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
