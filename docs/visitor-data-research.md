# Visitor data, consent and analytics for gurugramvisionforum.org

Research note, 7 October 2026. Written for the Forum's owner; not legal advice. Check the Gazette text and a lawyer before launch. Where a source summarises the law second-hand, it is marked as such.

## 1. What the law asks of the Forum

**Which law.** The [Digital Personal Data Protection Act, 2023](https://dpdpa.com/dpdpa2023/chapter-2/chapter2.html) (DPDP Act) is the law. Its rules, the DPDP Rules, 2025, were notified in the Gazette on 13/14 November 2025 ([SCC Online](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/), [Cyril Amarchand alert](https://www.cyrilshroff.com/wp-content/uploads/2025/11/Client-Alert-DPDP-Rules-Nov-2025.pdf)). They come into force in phases: the Data Protection Board and its machinery immediately, consent managers from November 2026, and the core duties of notice, consent, security, breach reporting, retention and data-principal rights from **13 May 2027** ([EY summary](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/pdf/2025/11/ey-india-dpdp-act-2023-and-rules-2025-pov.pdf), [ipleaders guide](https://blog.ipleaders.in/dpdp-rules-2025-operational-compliance-guide/)). Build to the final rules now; retrofitting a consent record is harder than starting with one.

**Is a civic non-profit a Data Fiduciary?** Yes. A Data Fiduciary is any "person" who decides why and how personal data is processed, and "person" includes an association of persons, a society, a trust and a company ([section 2, via dpdp wiki](https://dpdp.myndsolution.com/wiki/guides/who-does-the-act-apply-to/)). The only exclusions are purely personal or domestic use, and data the person has themselves made public ([section 3](https://dpdpa.com/dpdpa2023/chapter-1/section3.html)). There is no non-profit exemption. A registration form that stores name, mobile, email and sector makes the Forum a Data Fiduciary from the first record.

**Lawful basis.** Processing needs either consent or one of the narrow "legitimate uses" in [section 7](https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html) (the person volunteered the data for a specific purpose, legal duties, emergencies, employment). There is no GDPR-style "legitimate interest" for marketing. For a registration gate, consent is the basis; for a report, section 7(a) also applies because the resident volunteers the data to get the report mapped and tracked.

**Notice (section 5, Rule 3).** Before or while asking for consent, the Forum must show a notice that can be read on its own, in English or any Eighth Schedule language (so Hindi too), listing: the data collected, itemised; the purpose of each item; the service it enables; how to withdraw consent; how to exercise rights; how to complain to the Data Protection Board ([Mondaq on the final rules](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified), [KPMG](https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2025/11/dpdp-rules-2025-guidance-to-dpdp-act-implementation.pdf)).

**Consent (section 6).** Free, specific, informed, unconditional and unambiguous, given by a clear affirmative act, limited to what the stated purpose needs. No pre-ticked boxes, no bundling ("register and receive WhatsApp updates" must be two boxes). Withdrawal must be as easy as giving consent, after which processing stops and the data is erased unless a law requires keeping it. The Forum carries the burden of proving consent was given, so store the timestamp, the notice version and what was ticked.

**Purpose limitation and minimisation.** Collect only what the stated purpose needs. For a Gurugram civic forum, name, mobile and sector are enough to map a report; email is useful for updates; **pin code and city add nothing for a city-specific site and should be optional or dropped.** Asking for less is also the single biggest lever on drop-off (section 4).

**Rights (sections 11–14, Rule 14).** Access a summary of what is held, correction, erasure, a grievance channel, and nomination of another person. The site must publish how to make these requests and answer within a reasonable period, at most 90 days ([Medianama](https://www.medianama.com/2025/11/223-rights-data-principals-dpdp-rules-2025/)).

**Retention (section 8(7), Rules 6 and 8).** Erase when consent is withdrawn or the purpose is served. The Third Schedule's three-year defaults apply only to very large e-commerce, gaming and social platforms, not to the Forum, so set your own period and state it (the repo already plans 24 months). Give 48 hours' notice before erasing for inactivity. Keep processing logs for one year ([KS&K on retention](https://ksandk.com/md/data-protection-and-data-privacy/data-retention-and-deletion-under-indias-dpdp-rules/)).

**Breach (section 8(6), Rule 7).** Every breach is reportable, with no "serious harm" threshold: tell each affected person and the Board without delay in plain language, then a detailed report to the Board within 72 hours ([KS&K breach timeline](https://ksandk.com/data-protection-and-data-privacy/dpdp-data-breach-notification-timeline/)).

**Children.** Under-18s need verifiable parental consent. Simplest course: state that registration is for adults and do not knowingly register minors.

**Penalties (Schedule to the Act).** Up to ₹250 crore for failing to keep reasonable security safeguards, ₹200 crore for failing to report a breach, ₹200 crore for children's-data breaches, ₹50 crore for other breaches; the Board scales these to the gravity and the size of the entity ([IIT BHU summary](https://iitbhu.ac.in/contents/institute/cf/cis/doc/dpdp_act_rules_summary.pdf)).

### Consent notice: the elements, in both languages

Show this as a standalone box above the submit button, with two unticked checkboxes. Keep a versioned copy.

| Element | English | हिंदी |
| --- | --- | --- |
| Who | Gurugram Vision Forum (registered address, contact@gurugramvisionforum.org) collects the details below. | गुरुग्राम विज़न फ़ोरम (पंजीकृत पता, contact@gurugramvisionforum.org) नीचे दिए विवरण एकत्र करता है। |
| What | Name, mobile number, email, sector or area. Pin code and city are optional. | नाम, मोबाइल नंबर, ईमेल, सेक्टर या क्षेत्र। पिन कोड और शहर वैकल्पिक हैं। |
| Why | To map your report to the right office, send you its status, and tell you about Forum meetings in your area. | आपकी शिकायत को सही कार्यालय तक पहुँचाने, उसकी स्थिति बताने और आपके क्षेत्र की फ़ोरम बैठकों की सूचना देने के लिए। |
| Not sold | We never sell, rent or trade your data. Your phone number is never shown publicly or sent to any authority. | हम आपका डेटा कभी नहीं बेचते, किराये पर नहीं देते और न ही बदलते हैं। आपका फ़ोन नंबर कभी सार्वजनिक नहीं किया जाता और न किसी प्राधिकरण को भेजा जाता है। |
| How long | Kept for 24 months after your last activity, then erased; we will tell you 48 hours before. | आपकी अंतिम गतिविधि के 24 महीने बाद मिटा दिया जाता है; मिटाने से 48 घंटे पहले सूचना दी जाएगी। |
| Rights | You can see, correct or delete your data, or withdraw consent, at any time from Settings or by email. Withdrawal is as easy as signing up. | आप कभी भी सेटिंग्स या ईमेल से अपना डेटा देख, सुधार या हटा सकते हैं, या सहमति वापस ले सकते हैं। सहमति वापस लेना उतना ही आसान है जितना देना। |
| Complain | Grievances: privacy@gurugramvisionforum.org, answered within 30 days. You may also complain to the Data Protection Board of India. | शिकायत: privacy@gurugramvisionforum.org, 30 दिन में उत्तर। आप भारतीय डेटा संरक्षण बोर्ड में भी शिकायत कर सकते हैं। |
| Checkbox 1 | [ ] I agree to the processing described above. | [ ] मैं ऊपर बताए गए डेटा उपयोग से सहमत हूँ। |
| Checkbox 2 | [ ] Send me updates on WhatsApp and email (optional). | [ ] मुझे WhatsApp और ईमेल पर अपडेट भेजें (वैकल्पिक)। |
| Age | I am 18 or older. | मेरी आयु 18 वर्ष या अधिक है। |

## 2. How websites track visitors today, and what to use

**First-party, cookieless analytics.** [Plausible](https://plausible.io/data-policy), [Umami](https://umami.is/docs) and [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) set no cookies; each counts a visitor with a hash of IP plus browser that resets daily, so nobody can be followed across days. They record page, referrer, country, device class and the events you name. Vercel's is one line in `vercel.json` and discards raw session data after 24 hours. [PostHog](https://posthog.com/docs/privacy/cookieless-tracking) does the same in "cookieless: always" mode, but its funnels, replays and `identify()` calls need cookies and consent. **Google Analytics 4** sets cookies, ships a 45 KB script, shares data with Google and needs a consent banner; avoid it.

**Cookie banners** are a European artefact. The DPDP Act regulates personal data, not cookies as such; a cookieless counter needs no banner. If you add anything that stores an identifier, that identifier is personal data and needs the notice above.

**Fingerprinting** (building an ID from screen size, fonts, GPU and so on) is treated by the UK ICO and the EU EDPB as tracking that needs the same consent as cookies, and the ICO called Google's 2025 decision to permit it "irresponsible" because people cannot clear a fingerprint the way they clear cookies ([DLA Piper](https://privacymatters.dlapiper.com/2025/01/googles-u-turn-on-device-fingerprinting-icos-response-and-subsequent-guidance/)). It is hidden tracking by design and would break the "we never track you silently" promise. Do not use it.

**Registration walls** turn anonymous readers into known users; see section 4 for the evidence. **UTM links** (`?utm_source=whatsapp`) only tag the campaign a visit came from; they carry no personal data and are safe. **Email capture** needs its own checkbox. **WhatsApp click-to-chat** (`wa.me/…`) sends nothing to the Forum until the person sends a message; Meta sees the click and the number, which the privacy page should say.

**What Indian government portals do.** CPGRAMS, MyGov and the Swachhata app all let anyone browse, then require a mobile OTP (CPGRAMS and MyGov a full registration) only at the moment of filing or participating. NIC-built sites follow the [Guidelines for Indian Government Websites 3.0](https://guidelines.india.gov.in/scope-and-objective/), which require a published privacy policy and typically run an NIC or Google Analytics counter stating that only aggregate usage is kept. The lesson: open content, identity at the point of action.

**Recommended stack for the Forum**

1. **Registration gate, first-party.** One form: name, mobile with OTP, sector (auto-suggested), email optional, pin and city optional. The notice above, two unticked boxes. Store `consent_version`, `consented_at`, `channels` on the Supabase user row. One click withdrawal and deletion in Settings.
2. **Server-side event log, no third parties.** `/api/event` writes `page_view`, `report_start`, `report_step`, `report_submit`, `register` to an `events` table with the route, referrer, a daily-rotating hash of IP+UA (never the raw IP), and `user_id` only after registration. This gives the dashboard funnel numbers the Forum needs with nothing leaving the Vercel–Supabase boundary.
3. **Vercel Web Analytics** for traffic shape, or self-hosted Umami on Supabase Postgres if you want to own the numbers. Either is cookieless and needs no banner.
4. **Practices to refuse:** buying or renting contact lists; pre-ticked boxes; consent bundled with service; walls on helpline numbers or portal links; hidden pixels or fingerprint scripts; third-party ad tags; sending phone numbers to authorities; keeping data past the stated period.

## 3. Timing of the registration ask

**Evidence.** [Nielsen Norman Group](https://www.nngroup.com/articles/login-walls/) has advised against walls before any content since 1999: people leave rather than climb them. [Baymard](https://baymard.com/blog/meal-kits-launch) saw 81% abandonment when a wall blocked basic information. Publisher data favours asking once a reader has shown interest: [Mather Economics](https://www.mathereconomics.com/casestudy/how-registration-walls-impact-subscriber-growth/) placed the ask on the second article and saw known users grow fivefold with a 3.14% registration rate per prompt; a hard wall on the first article produced lifetime-value changes from −1.7% to +59% depending on the audience. [Rest of World](https://restofworld.org/inside/learned-in-first-months-registration-wall/) found 87% of people who started registering finished it, and that roughly 1.5–2.7 of every 1,000 page views became registrations. All of these are self-reported case studies, not controlled trials.

**Recommended default (owner to confirm).**

| Moment | Behaviour |
| --- | --- |
| First page view | Open. No prompt. |
| Second page view or 90 seconds on site, whichever first | Soft prompt, dismissable ("Not now"), shown once per 7 days. |
| Start of the report form | Mobile with OTP at step 1 (already the design). Full notice and consent before submit, never after. |
| Tracking a report, joining, downloading | Required. |
| Helplines, portal links, charters, ward table | Never gated. These are public-safety information. |

Measure `register / soft-prompt shown` and `report_submit / report_start` from the event log for a month, then move the prompt earlier or later.
