# Social publishing from the desk: what is free, what is not, and how each account is connected

Researched 8 October 2026 for the owner's ask: keep the Forum's social accounts fed from the desk, through free APIs where they exist, so nobody has to re-type a post into five apps. This note records what was found, the decision, and the exact setup for each account. The code is `lib/social.js`, the endpoint `POST /api/triage/social`, the desk controls are on Content (the composer's "Also share to" boxes, a published post's Share button, Settings → Social publishing).

## Part 1. The options, as they stand in October 2026

| Platform | Official API for posting | Cost | What the Forum needs | Verdict |
|---|---|---|---|---|
| **Facebook Page** | Graph API, `POST /{page-id}/feed` (text + link) or `/{page-id}/photos` (image + caption) | Free | A Meta developer app, the Page, a long-lived Page access token with `pages_manage_posts` and `pages_read_engagement`. The permissions work for the app's own admins without App Review, which is all a single organisation needs. | **Built.** |
| **Instagram** | Graph API content publishing: create a media container (`/{ig-user-id}/media` with `image_url` and `caption`), poll `status_code`, then `/{ig-user-id}/media_publish`. 100 API posts per 24 h. Image must be on a public URL (the Forum's public `media` bucket is). No text-only posts. | Free | An Instagram **professional** account (Business or Creator) linked to the Facebook Page, the same app and token with `instagram_basic` and `instagram_content_publish`. | **Built.** Needs a photo on the post. |
| **Telegram channel** | Bot API `sendMessage` / `sendPhoto` to `@channel` | Free | A bot from @BotFather made an admin of the channel. | **Built.** The cheapest broadcast channel there is; worth opening one. |
| **Bluesky** | AT Protocol `com.atproto.repo.createRecord`, with a link facet and either an image blob (≤ 1 MB) or a link card | Free | An account and an app password. | **Built.** |
| **X (Twitter)** | API v2 `POST /2/tweets` with OAuth 1.0a user context | **No free write tier for new developer accounts** since the move to pay-per-use in 2026: about $0.015 per post, $0.20 per post with a link, from prepaid credits; media upload v1.1 is gone from self-serve. | A developer account with credits, an app with read-write user tokens. | **Wired, optional.** At the Forum's volume (a few posts a week with links) that is roughly ₹70-150 a month; the owner decides whether to load credits. Until then the post is copied by hand. |
| **LinkedIn company page** | Community Management API, `w_organization_social` | Free, but **access is granted only to legally registered entities** after an application with a verified Page, registered address and privacy policy; a Development tier first, a screencast for the Standard tier. Personal-profile posting (`w_member_social`, "Share on LinkedIn") is self-serve but posts as a person, not as the Forum. | A registered society or trust | **Not built.** Apply once the Forum is registered; meanwhile copy and paste. |
| **WhatsApp Channel** | None. Meta's Cloud API does not expose Channels; the only "APIs" are unofficial gateways that drive a phone session (Whapi and the like, paid, against the terms). | – | – | **Not built.** Post by hand from the channel admin's phone. |
| **YouTube** | Data API upload, free quota | Free | OAuth refresh token | **Not built.** Videos are uploaded on YouTube itself and embedded by URL on the site; nothing is gained by routing a 100 MB upload through a 60-second serverless function. |

### Scheduler services (one API for all platforms)

Ayrshare closed its free Basic plan; the trial is 28 days and paid plans start at $149 a month. Upload-Post gives 10 uploads a month free, then $24 a month. Zernio and PostPeer advertise free tiers of about 20 posts or 2 accounts. Buffer's API works on its free plan but only with a personal key and a changing feature set. Postiz is open source and free if self-hosted, which means a server to run. All of them end up calling the same five platform APIs above, so for an organisation with its own accounts they add a bill and a middleman without adding a platform the Forum can reach. **Decision: go straight to the platform APIs; no scheduler service.** If the team ever wants a visual calendar across accounts, Postiz (self-hosted) or Upload-Post ($24) are the fallbacks.

## Part 2. How it works on the desk

1. Write the post on Content. Add a photo if Instagram is one of the targets.
2. Tick the accounts under "Also share to" and save the post as **Published**. The post goes to the site at once and the shares go out in the same request; each result shows as a chip on the post's row (FB ✓, TG ✓…), linking to the live post. A failure shows ✕ with the reason on hover; the cron's `social` step retries queued shares up to three times.
3. A post published earlier can be shared later from its **Share** button.
4. Settings → Social publishing shows which accounts are connected and the last 20 shares.

What goes out: the title, the summary clipped to the platform's limit, the post's public link (`/blog/<slug>` for stories and news, `/updates` otherwise) and up to four hashtags from the tags. Never a reporter's details; the `hold` tag never leaks.

## Part 3. Connecting each account, step by step

Every key goes into Vercel → Project → Settings → Environment Variables (Production), then Deployments → Redeploy. Never paste a key in chat, a commit or the site.

### Facebook Page and Instagram (one setup, free)

1. Make sure the Forum has a **Facebook Page** and that the Instagram account is a **professional** account (Instagram → Settings → Account type) **linked to that Page** (Page settings → Linked accounts → Instagram).
2. Go to developers.facebook.com → My Apps → **Create App** → use case "Other" → type **Business** → name it "Gurugram Vision Forum desk". Add the **Facebook Login for Business** and **Instagram** products.
3. Open **Tools → Graph API Explorer**. Pick the app, then **Generate Access Token** with these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. Log in as the Page admin. (These work for the app's own admins, developers and testers without App Review, which is all the Forum needs.)
4. Turn it into a **long-lived user token** (60 days): in the Explorer's address box run `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<the token from step 3>` (App ID and secret are under App settings → Basic).
5. Get the **Page token** (never expires while the user token that made it is valid and the person stays admin): run `GET /me/accounts` with the long-lived token. Copy the Page's `id` → `META_PAGE_ID`, and its `access_token` → `META_PAGE_TOKEN`.
6. Get the Instagram account id: run `GET /<PAGE_ID>?fields=instagram_business_account`. Copy the id → `META_IG_USER_ID`.
7. Redeploy. The desk's Settings → Social publishing now shows Facebook Page and Instagram as Connected. Test with a photo post ticked for both.

If the Page token stops working (the admin changed their password, or 60 days passed on a token that was not exchanged), repeat steps 3 to 5.

### Telegram channel (free, ten minutes)

1. In Telegram, create a **channel** (New channel → public → pick a name like `gurugramvisionforum`).
2. Open **@BotFather**, send `/newbot`, name it "Gurugram Vision Forum" with a username ending in `bot`. Copy the token → `TELEGRAM_BOT_TOKEN`.
3. In the channel's settings → Administrators → **Add admin** → search the bot's username → allow "Post messages".
4. `TELEGRAM_CHAT_ID` = `@gurugramvisionforum` (the channel's public name with the @).
5. Redeploy and test with a text post.

### Bluesky (free, five minutes)

1. Create the account at bsky.app (for example `gurugramvisionforum.bsky.social`). A custom domain handle such as `gurugramvisionforum.org` can be set later under Settings → Handle with one DNS TXT record.
2. Settings → **Privacy and security → App passwords → Add app password**, name it "desk". Copy it → `BLUESKY_APP_PASSWORD`. `BLUESKY_HANDLE` = the handle without the @.
3. Redeploy and test.

### X / Twitter (optional, paid per post)

1. developer.x.com → sign up for a developer account; the console asks for a payment method and sells prepaid credits (there is a small bonus on the first card). Set a spending limit.
2. Create a **Project** and an **App**. Under User authentication settings choose **Read and write**, app type Web App, any callback URL (the desk does not use it), the site URL as the website.
3. Keys and tokens: **API Key and Secret** → `X_API_KEY`, `X_API_SECRET`. Then **Access Token and Secret** generated for the Forum's own account **after** the read-write setting was saved (regenerate if it says Read only) → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
4. Redeploy and test with a short post. Each post with a link costs about $0.20 of credit.

### LinkedIn (later)

Once the Forum is a registered society or trust: developer.linkedin.com → create an app tied to the Forum's Page → verify the Page → request the **Community Management API** (Development tier) with the Forum's legal name, address, website and privacy policy. When approved, the posting call is `POST https://api.linkedin.com/rest/posts` with the organisation URN as author and `w_organization_social`; it can be added to `lib/social.js` as one more publisher. Until then: copy the text from the post row and paste it on the Page.

## Part 4. Rules kept

- Keys only in Vercel; the desk learns "connected" or "not connected", nothing more.
- Every attempt is a row in `social_posts` with the live link or the error, so the Health tab and the desk can show what went out.
- Nothing is posted without a person ticking a box: the weekly round-up publishes itself to the site, but it is shared to social only when someone presses Share.
- One post, one share per platform; a repeat press is refused with "already shared" so the accounts never get duplicates.

Sources read on 8 October 2026: Meta's Instagram Platform content-publishing and Pages API documentation summaries; X's rate-limit page and 2026 pricing write-ups (Elfsight, Outstand, PostProxy, Upload-Post); Microsoft Learn's LinkedIn Community Management overview and migration guide; Ayrshare's pricing and its help-centre note on the retired Basic plan; Upload-Post, Zernio and PostPeer pricing pages; Telegram Bot API `sendPhoto` reference; Whapi's notes on WhatsApp Channels.
