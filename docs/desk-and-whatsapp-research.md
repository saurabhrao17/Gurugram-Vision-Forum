# The desk, the WhatsApp bot and what is missing: research and roadmap

Written 8 October 2026 for the owner. Three questions were asked: how the team sees the people who sign up through the Join form; whether the dashboard, ticket system and content system can become a modern, WhatsApp-first operation at the lowest possible cost; and what the desk is missing today. Part 1 answers the first (built today). Part 2 is the WhatsApp research with verified prices. Part 3 is the audit of the desk, feature by feature, with a ranked roadmap. Everything in Part 3 was checked against the code, not assumed.

## Part 1: join requests (built today)

Until today a Join-form sign-up went into the `joins` table and nowhere else: no desk tab, no email, not even a count on the Health tab. It could only be read inside Supabase.

Now:

- **Desk → Join requests tab** (owner and coordinator): every sign-up with name, role, area, note, phone and email; a status per person (new → contacted → onboarded or declined), internal notes, who last handled it, a search box, status filter, counts and a CSV export. A badge on the tab shows how many are new. "Create desk account" jumps to the Team tab for someone you are onboarding as a ward volunteer.
- **Coordinator email**: each new request queues a mail to `COORDINATOR_EMAIL` naming the person and the role (never the phone or email, since mail gets forwarded); the cron sends it. This needs the Resend key and `COORDINATOR_EMAIL` set in Vercel (go-live item 2 in CLAUDE.md).
- The reporter-facing promise on the Join page ("The Forum writes to you within a week") is now something the desk can keep: the new count is visible the moment someone signs in.

## Part 2: WhatsApp for the Forum, the cheapest way that works

### What the Forum already has

The API already contains a Meta WhatsApp Cloud API webhook (`/api/hooks/whatsapp`): an inbound message becomes a report with `source = whatsapp`, the sender gets a reference back in English and Hindi, and "status" or a reference number returns the current stage. It is switched off only because the Meta side (business verification, a phone number, four environment variables) is not done. So the question is not "which bot platform to buy" but "what to put on top of Meta's own API, and whether a middleman is worth paying for".

### Prices, as published in October 2026 (verify on Meta's rate card before budgeting; the sandbox could not open Meta's own page, these come from several concurring provider rate cards)

Meta bills per delivered message since 1 July 2025; the old per-conversation model is gone. India list rates, before 18% GST:

| Message type | Who starts it | Meta's price |
| --- | --- | --- |
| Service reply (you answer a resident who wrote to you, within 24 h) | Resident | Free for the first 1,000 a month per number, then about ₹0.115 (from 1 October 2026) |
| Utility template (stage update on their report, "ticket filed", reminder) | Forum | about ₹0.115 |
| Marketing template (digest, drive announcement) | Forum | about ₹0.86 |
| Authentication template (one-time codes) | Forum | about ₹0.115 |

What that means for the Forum: a year of 2,000 reports with four stage updates each is roughly 8,000 utility messages, about ₹920 plus GST. Replies to residents who message first are free up to 1,000 a month. The cost that matters is the platform fee a middleman charges, not Meta's messages.

### The options, cheapest first

| Option | Platform fee | What you get | Fit |
| --- | --- | --- | --- |
| **Meta Cloud API directly** (what the code already targets) | ₹0 | The raw API: inbound webhook, outbound templates, interactive buttons, lists, WhatsApp Flows (forms inside the chat). You build the inbox and automation yourself (ours is the desk). | Best fit. Zero platform cost; the Forum keeps every message in its own database; the desk is the inbox. |
| **Gupshup self-serve** | No subscription; about $0.001 per message on top of Meta | A BSP that fronts the same API with a dashboard and easier onboarding | Fine if Meta verification proves hard to do alone; adds almost nothing per message. |
| **AiSensy / Interakt / Wati** | ₹999–₹4,999 a month plus their own per-message card | No-code inbox, broadcast campaigns, templates UI, chatbot builder | Pay for an inbox we already have. Only worth it if the team refuses to use the desk. |
| **Glific** (Indian, open source, built for NGOs) | ₹15,000 one-time + ₹9,500 a month (annual ₹85,500); pilots run ₹5,000–7,000 a month | Flow builder, NGO community, Indian support, no per-seat pricing | Good product, but ₹1.1 lakh a year is donation money the Forum does not need to spend for one bot. |
| **Turn.io** (Africa-born, nonprofit-focused) | Quote only; a 40% nonprofit discount is advertised for the UK; messages prepaid in USD | Team inbox with AI features, no markup on Meta's prices | Needs a quote; priced in dollars. |
| **Chatwoot** (open-source inbox) | Free self-hosted (your server), or $19 per agent a month on their cloud for WhatsApp | A proper shared inbox with assignment, labels and canned replies | Only if the team wants a chat-style inbox instead of a case desk; it does not know about wards, stages or tickets. |

Sources: MyOperator, ChatMaxima, Flowcall, Blueticks and 2Factor rate cards for the Meta prices; RichAutomate, CodingClave and ReplyKaro comparisons for the BSP fees; glific.org/pricing and the Launchpad page; Turn.io's billing pages and the Charity Digital listing; eesel and Featurebase for Chatwoot.

### Recommendation

Go direct to Meta's Cloud API, which costs nothing beyond messages, and build three things on top of what already exists:

1. **Outbound stage updates on WhatsApp** (utility templates: "received", "filed, ticket X", "escalated", "resolved, did it get fixed?"). The outbox already queues emails on every stage change; the same trigger can queue a WhatsApp row and the cron sends it through the Graph API. Residents who reported by WhatsApp currently get nothing after the first reply; this closes that hole for about 11 paise a message.
2. **A WhatsApp Flow for intake** so a report arrives structured (issue type, area, spot, photo, consent) instead of free text that the desk must classify by hand. Flows run on the Cloud API and are billed as a normal message.
3. **Join by WhatsApp**: "join" as a keyword opens a short Flow (name, sector, role) that lands in the same Join requests tab.

What the owner must do, in order: Meta Business verification for the Forum (a registered society or trust document and the website), a phone number that is not on a personal WhatsApp, create the WhatsApp Business app in Meta for Developers, and give me the four values for Vercel (`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`). Templates need Meta's approval (usually a day). A BSP such as Gupshup is the fallback if verification stalls; the code would not change.

Risks to note: service replies stop being free beyond 1,000 a month from October 2026, so a broadcast-heavy use (newsletter on WhatsApp) belongs in a Channel, which is free, not in the API; and Meta's number quality rating drops if people block marketing messages, so the Forum should send marketing templates only to people who opted in on the website.

## Part 3: desk audit

Method: a full read of `site/app.js` (desk section), `site/index.html`, `lib/handlers/triage/*`, `lib/auth.js`, the cron and the migrations, against the admin features of FixMyStreet Pro (SocietyWorks), SeeClickFix 311 CRM (CivicPlus) and the practice of small NGO helpdesks.

### What the desk does well today

Role-scoped sign-in (owner, coordinator, ward volunteer, content); a reports list with stage, issue, ward, overdue and search filters and paging; a detail sheet with the full filing checklist per portal, attachments through signed URLs, a copy-for-the-authority text with no reporter details, an "ask the reporter for the missing items" message, a timeline of stage events and notes, and a save that moves the stage with the right automatic rules; a map of pinned reports; ward lead and support assignment; staff accounts; a content studio with AI drafting and English↔Hindi translation, pop-ups, social links and the weekly round-up settings; visitors with CSV export; the pulse; a health page; a daily SLA digest to the coordinator. That is more than most Indian civic groups run.

### What is missing, in the order it hurts

| # | Gap (verified in code) | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | **No acknowledgement to the reporter on submit** (the trigger fires only on stage change) and **no WhatsApp stage updates** at all; WhatsApp reporters get nothing after the first reply | The loop that brings people back is "we got it, here is what happened"; silence is the single biggest trust loss | Small (email) + Part 2 item 1 (WhatsApp) |
| 2 | **Join requests invisible** | Built today | Done |
| 3 | **Email goes out once a day, 50 at a time** (the outbox is drained only by the 03:50 UTC cron) | A stage change at 10 am reaches the reporter the next morning; a volunteer's "ask the reporter" never goes out at all (it is clipboard only) | Small: a second cron slot or a send-on-write for utility mails |
| 4 | **No per-report assignment**: volunteers are linked to wards, not to cases; no "mine" view; no reminder or follow-up date; escalated reports have no SLA rule | Nobody owns a case; the digest only covers unmapped and filed-21-days | Medium: `assignee`, `follow_up_at`, a "My cases" chip, digest rows for escalated and due follow-ups |
| 5 | **No audit log**: edits to desk, ward, ticket, escalation or resolution leave no record; only stage changes and typed notes become events | Accountability inside the team and evidence when an authority disputes a date | Small: a trigger that logs changed fields into `report_events` |
| 6 | **Timeline notes are not internal**: the track API returns every event note to the reporter (`report_status` includes `note`) | A volunteer's "JE unhelpful, try SDO" is readable by the reporter who knows the reference and last-4 | Small: an `internal` flag on events, hidden from `report_status` |
| 7 | **Duplicate detection**: none across reports (only per inbound message) | Three reports of the same dump are three tickets; FixMyStreet and SeeClickFix both prompt on nearby reports | Medium: nearby-and-same-issue check on submit and a "merge into" action on the desk |
| 8 | **Staff cannot create a report** (walk-in, phone call, WhatsApp group) or edit location, description or reporter details, or attach a file | Half of a civic group's intake is verbal | Medium: "New report" on the desk with `source = volunteer`; staff uploads |
| 9 | **No reports export, no bulk actions, no sort, no saved views** | Monthly reporting to RWAs and funders is done by hand | Small each: CSV export of the filtered list; sort by age; "overdue in my wards" preset |
| 10 | **Team tab cannot edit a role, reset a password, deactivate or invite**; the role select offers "Owner", which the API refuses | Onboarding a volunteer takes the owner's help each time | Small |
| 11 | **Subscribers and the outbox have no desk view**; Health shows counts only, no retry | Failed mails are invisible until someone opens Supabase | Small |
| 12 | **Stale copy**: Pulse says it includes the Forum's own reports (it does not, since today); AI draft says "needs the Claude key" (it uses the free keys first); Health says "every link" (15 a run) | Confuses the team | Fixed in this change |
| 13 | **Map does not refresh when filters change**; the summary counts ignore filters | Minor | Small |
| 14 | **No push notifications, no keyboard shortcuts, no dark mode on the desk** | Nice to have; the research on reporting apps says speed and usefulness matter more | Later |

### Roadmap (what I propose to build next, in order)

1. **Close the loop** (gap 1, 3, 6): acknowledgement mail on submit; a second outbox run at 09:30 UTC (15:00 IST) so updates go out the same day; internal notes flag; WhatsApp utility templates once the owner's Meta values arrive.
2. **Cases, not wards** (gap 4, 5): assignee and follow-up date on a report, "My cases" and "Due today" chips, escalation SLA row in the digest, field-change audit trigger.
3. **Intake from the desk and duplicates** (gap 7, 8): "New report" for walk-ins and calls; nearby-same-issue prompt on the public form; merge on the desk.
4. **Operations hygiene** (gap 9, 10, 11): reports CSV, sort, role edit and password reset, subscriber and outbox views with retry.
5. **WhatsApp intake Flow and join-by-WhatsApp** (Part 2 items 2 and 3) after the templates are approved.

Each step is a day or two of work, tests included, and none of them needs a paid service. The only money in this plan is Meta's per-message charge, around ₹1,000 a year at the volumes the Forum will see in its first year.

## Part 4: the weekly-digest list and a newsletter tool (added 8 Oct 2026)

The owner asked where the footer's "Weekly digest" sign-ups can be seen, for subscribe and unsubscribe to run by themselves, and for a link to a free or cheapest tool with rich features.

### What the Forum already had

`POST /api/subscribe` with double opt-in (a confirmation mail with a token link; nothing is sent until it is clicked), an unsubscribe link with the same token in every digest, and the weekly round-up mailed to confirmed addresses through the outbox. Missing: a desk view, and any editor or send tool beyond the automated round-up.

### Tools compared (free tiers as published in October 2026; the sandbox could not open the vendors' own pricing pages, so confirm before relying on a number)

| Tool | Free tier | Rich features on free | Fit |
|---|---|---|---|
| **Resend (Contacts + Broadcasts)** | 1,000 contacts, unlimited broadcast sends, 1 domain; transactional stays 3,000 mails a month. Next tier about $40 a month for 5,000 contacts. | Broadcast editor, templates, unsubscribe link and page, contact webhooks (`contact.created/updated/deleted`), API for contacts. Audiences are deprecated in favour of global contacts with segments and topics. | **Chosen.** Already the site's mail provider: one account, one API key, one webhook endpoint, no new vendor and no data in a third place. |
| Brevo | 300 mails a day, unlimited contacts (some sources say 100,000), Brevo branding on mails, automation to 2,000 contacts. | Drag-and-drop editor, templates, segmentation, basic CRM. | Best fallback once the list passes 1,000: unlimited contacts, but a second account and branding. |
| Kit (ConvertKit) | Up to 10,000 subscribers, unlimited broadcasts, forms and landing pages; one basic automation; Kit branding. | Tagging, segmentation, editor. | Good at scale; creator-oriented; a second account. |
| MailerLite | Cut in 2026 to 250 subscribers and 2,500 mails a month. | Editor, 3 automations. | Too small now. |
| Mailchimp | 500 contacts, 1,000 sends a month. | Editor. | Smaller than Resend's free tier. |
| Listmonk (self-hosted) | Free software, needs a server (about ₹400 a month) and SMTP (Resend). | Full featured. | More to run than the Forum should carry. |

### What was built

- Desk → Subscribers (owner only, like Visitors: it is personal data): counts, status chips, search, CSV, Stop emails / Put back / Erase, Sync, and "add an address", which only sends the confirmation mail.
- `lib/audience.js`: confirmed addresses are pushed to Resend contacts (address and language only, never a name); a stop pushes `unsubscribed: true`; an erasure deletes the contact; the nightly cron step `audience` retries whatever failed.
- `/api/hooks/email` also takes Resend's contact webhooks, so an unsubscribe through a Broadcast's own link stops the Forum's digest too. A contact re-subscribed on Resend's side is put back only if it had once confirmed here; double opt-in is never bypassed.
- Env: a full-access `RESEND_API_KEY` (the current key may be sending-only), the webhook endpoint subscribed to the contact events with its secret in `RESEND_WEBHOOK_SECRET`.

### Why not a second tool now

The list is small, the round-up already goes out automatically, and every extra vendor is another place personal data lives and another login to keep. Resend's free tier carries the Forum to 1,000 subscribers at no cost; the CSV export moves the list to Brevo or Kit in a minute when that day comes.

## Sources

- WhatsApp pricing (India, October 2026): [MyOperator](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026), [ChatMaxima](https://chatmaxima.com/whatsapp-api-pricing/india/), [Flowcall rate card](https://www.flowcall.co/blog/whatsapp-business-api-pricing), [Blueticks](https://blueticks.co/blog/whatsapp-business-pricing-marketing-messages-2026), [2Factor](https://2factor.in/v3/lp/whatsapp-business-api-pricing.php), [ChatLivo](https://blog.chatlivo.com/whatsapp-business-api-pricing/).
- BSP fees: [RichAutomate comparison](https://richautomate.in/blog/whatsapp-api-pricing-comparison-india-2026), [RichAutomate cheapest total cost](https://richautomate.in/blog/cheapest-whatsapp-business-api-india-2026), [CodingClave Gupshup vs others](https://codingclave.com/guides/whatsapp-api-pricing-india-2026-comparison), [ReplyKaro Wati vs AiSensy vs Interakt](https://www.replykaro.com/blog/wati-vs-aisensy-vs-interakt-2026), [AiSensy provider list](https://m.aisensy.com/blog/whatsapp-api-providers/).
- NGO platforms: [Glific pricing](https://glific.org/pricing/), [Glific Launchpad Oct 2026](https://glific.org/glific-launchpad-oct-2026/), [Glific FAQ](https://glific.org/faq/), [Turn.io message billing](https://learn.turn.io/l/en/article/p1kwnp0ym6-billing-management), [Turn.io on Meta's pricing change](https://learn.turn.io/l/en/article/d4vkdto61u-how-to-reduce-your-whats-app-service-message-costs), [Charity Digital: Turn.io for nonprofits](https://charitydigital.org.uk/products/turnio-for-nonprofits-build-a-chat-service-through-whatsapp).
- Inbox software: [Chatwoot pricing (eesel)](https://www.eesel.ai/blog/chatwoot-pricing), [Chatwoot pricing (Featurebase)](https://www.featurebase.app/blog/chatwoot-pricing), [Chatwoot: all channels on every plan](https://www.chatwoot.com/compare/intercom).
- WhatsApp Flows: [ChatDaddy guide](https://chatdaddy.tech/blog/whatsapp-flows), [Kanal guide](https://getkanal.com/blog/whatsapp-flows-guide-ecommerce), [baat.ai](https://baat.ai/knowledge-base/what-are-whatsapp-flows).
- Civic CRM benchmarks: [SocietyWorks FixMyStreet Pro features](https://www.societyworks.org/category/features/), [FixMyStreet Pro dashboard](https://www.societyworks.org/2018/02/09/how-to-use-the-fixmystreet-pro-dashboard-to-get-insights-on-your-service-levels/), [FixMyStreet Pro user guide](https://fixmystreet.org/pro-manual/print/), [G-Cloud 15 pricing document](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/586634/617647349179126-pricing-document-2026-01-27-1603.pdf), [SeeClickFix 311 CRM](https://www.civicplus.com/?p=25805), [Capterra SeeClickFix reviews](https://www.capterra.in/software/202342/seeclickfix).
- Resend: blog "Manage subscribers using Resend Audiences" (1,000 contacts free, $40/month for 5,000), changelog "New contact webhooks", docs "Migrating from audiences to segments" (via search summaries; resend.com itself was not reachable from the sandbox). Brevo, Kit, MailerLite free tiers from 2026 reviews (sendx.io, costbench.com, dreamlit.ai, mailmodo.com, skillscouter.com).
