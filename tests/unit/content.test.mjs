import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, slugify, slugFor, validatePost, PUBLIC_COLUMNS, publicPost, mediaUrl, MAX_MEDIA_BYTES } from "../../lib/content.js";
import { validateUpload, uploadPath } from "../../lib/handlers/triage/content-upload.js";
import { validateSocial } from "../../lib/handlers/triage/content.js";
import { makeHandler, parseDraft, buildRequest, MODEL, pickProvider, PROVIDERS } from "../../lib/handlers/triage/draft.js";
import { handle as handleContent, parseLimit } from "../../lib/handlers/content.js";

// Minimal res double in the shape Vercel gives us.
function fakeRes() {
  const r = { statusCode: null, headers: {}, body: null };
  r.status = (s) => { r.statusCode = s; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.end = (b) => { r.body = b ? JSON.parse(b) : null; return r; };
  return r;
}

// --- sanitizeHtml -----------------------------------------------------------
test("sanitizeHtml strips scripts, event handlers and javascript: URLs", () => {
  const dirty = '<p onclick="steal()">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a>' +
    '<img src="javascript:evil" alt="a"><!-- c --><style>p{}</style><iframe src="https://x"></iframe></p>';
  const out = sanitizeHtml(dirty);
  assert.ok(!/script/i.test(out), out);
  assert.ok(!/onclick/i.test(out), out);
  assert.ok(!/javascript:/i.test(out), out);
  assert.ok(!/iframe|style|alert|<!--/i.test(out), out);
  assert.equal(out, "<p>Hi <a>x</a></p>");
});

test("sanitizeHtml keeps allowed tags and adds rel/target to external links", () => {
  const out = sanitizeHtml('<h2>Head</h2><p>Text <strong>b</strong> <em>i</em><br></p><ul><li>one</li></ul>' +
    '<blockquote>q</blockquote><a href="https://mcg.gov.in/x" style="color:red">MCG</a>' +
    '<a href="#/report">in-site</a><img src="https://cdn.example/p.jpg" alt="A road" width="5">');
  assert.equal(out, '<h2>Head</h2><p>Text <strong>b</strong> <em>i</em><br></p><ul><li>one</li></ul>' +
    '<blockquote>q</blockquote><a href="https://mcg.gov.in/x" target="_blank" rel="noopener">MCG</a>' +
    '<a href="#/report">in-site</a><img src="https://cdn.example/p.jpg" alt="A road">');
});

test("sanitizeHtml drops unknown tags but keeps their text, and drops http images", () => {
  assert.equal(sanitizeHtml('<div class="x"><span>plain</span> <table><tr><td>t</td></tr></table></div>'), "plain t");
  assert.equal(sanitizeHtml('<img src="http://insecure/p.jpg">'), "");
  assert.equal(sanitizeHtml(""), "");
  assert.equal(sanitizeHtml(null), "");
});

// --- slugs ------------------------------------------------------------------
test("slugify lowercases, strips accents and punctuation", () => {
  assert.equal(slugify("  Sector 29: Drain Cleaned!  "), "sector-29-drain-cleaned");
  assert.equal(slugify("Café résumé"), "cafe-resume");
  assert.equal(slugify("!!!"), "post");
  assert.ok(slugify("a".repeat(200)).length <= 80);
  assert.match(slugFor("Hello World", () => 0), /^hello-world-[a-z2-9]{5}$/);
});

// --- validatePost -----------------------------------------------------------
const GOOD = {
  kind: "story", title: "Sector 29 drain cleaned after 40 days", summary: "What happened and who did it.",
  body: "<p>Residents reported it on <b>1 Sept</b>.</p><script>x()</script>", tags: ["drains", "sector 29"],
  published: "true", pinned: 0, link_url: "https://example.org/article", published_at: "2026-10-01T10:00:00Z"
};

test("validatePost accepts a good story and cleans it", () => {
  const { value, errors } = validatePost(GOOD);
  assert.deepEqual(errors, []);
  assert.equal(value.kind, "story");
  assert.equal(value.body, "<p>Residents reported it on <b>1 Sept</b>.</p>");
  assert.equal(value.published, true);
  assert.equal(value.pinned, false);
  assert.deepEqual(value.tags, ["drains", "sector 29"]);
  assert.equal(value.published_at, "2026-10-01T10:00:00.000Z");
  assert.equal(value.link_url, "https://example.org/article");
});

test("validatePost rejects a bad kind, a non-https link, an unknown embed host and a long title", () => {
  assert.deepEqual(validatePost({ ...GOOD, kind: "advert" }).errors, ["kind"]);
  assert.deepEqual(validatePost({ ...GOOD, link_url: "http://example.org" }).errors, ["link_url"]);
  assert.deepEqual(validatePost({ ...GOOD, link_url: "javascript:alert(1)" }).errors, ["link_url"]);
  assert.deepEqual(validatePost({ ...GOOD, embed_url: "https://evil.example/post/1" }).errors, ["embed_url"]);
  assert.deepEqual(validatePost({ ...GOOD, embed_url: "https://notx.com/post/1" }).errors, ["embed_url"]);
  assert.deepEqual(validatePost({ ...GOOD, title: "t".repeat(201) }).errors, ["title"]);
  assert.deepEqual(validatePost({ ...GOOD, title: "" }).errors, ["title"]);
  assert.deepEqual(validatePost({}).errors.sort(), ["kind", "title"]);
});

test("validatePost accepts embeds on the known hosts", () => {
  for (const u of ["https://x.com/gvf/status/1", "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc",
    "https://www.instagram.com/p/abc/", "https://www.facebook.com/gvf/posts/1", "https://twitter.com/gvf/status/1"]) {
    const { value, errors } = validatePost({ kind: "social", title: "t", embed_url: u });
    assert.deepEqual(errors, [], u);
    assert.equal(value.embed_url, u);
  }
});

test("validatePost rejects bad tags, dates, summary length and media fields", () => {
  assert.deepEqual(validatePost({ ...GOOD, tags: Array.from({ length: 11 }, (_, i) => "tag" + i) }).errors, ["tags"]);
  assert.deepEqual(validatePost({ ...GOOD, tags: [1] }).errors, ["tags"]);
  assert.deepEqual(validatePost({ ...GOOD, published_at: "yesterday" }).errors, ["published_at"]);
  assert.deepEqual(validatePost({ ...GOOD, summary: "s".repeat(501) }).errors, ["summary"]);
  assert.deepEqual(validatePost({ ...GOOD, body: "<p>" + "x".repeat(20001) + "</p>" }).errors, ["body"]);
  assert.deepEqual(validatePost({ ...GOOD, media_path: "../etc/passwd" }).errors, ["media_path"]);
  assert.deepEqual(validatePost({ ...GOOD, media_type: "application/x-msdownload" }).errors, ["media_type"]);
  assert.deepEqual(validatePost({ kind: "popup", title: "t", starts_at: "2026-10-02T00:00:00Z", ends_at: "2026-10-01T00:00:00Z" }).errors, ["ends_at"]);
});

test("validatePost partial keeps only sent fields and clears with empty strings", () => {
  const { value, errors } = validatePost({ title: " New title ", link_url: "", ends_at: "", pinned: "yes" }, { partial: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { title: "New title", link_url: "", ends_at: null, pinned: true });
  assert.deepEqual(validatePost({ reporter_phone: "x" }, { partial: true }).value, {});
});

test("publicPost keeps the public columns only and adds media_url", () => {
  const row = { id: "1", kind: "photo", title: "t", media_path: "posts/2026/10/1-a b.jpg", created_by: "x <x@y.z>", ip: "nope" };
  const out = publicPost(row, "https://proj.supabase.co/");
  assert.ok(!("created_by" in out));
  assert.ok(!("ip" in out));
  assert.equal(out.media_url, "https://proj.supabase.co/storage/v1/object/public/media/posts/2026/10/1-a%20b.jpg");
  assert.equal(publicPost({ id: "2", kind: "news", title: "t" }, "https://proj.supabase.co").media_url, null);
  assert.ok(!PUBLIC_COLUMNS.includes("created_by"));
  assert.equal(mediaUrl("https://p.co", "a/b.png"), "https://p.co/storage/v1/object/public/media/a/b.png");
});

// --- public content handler --------------------------------------------------
test("GET /api/content returns posts with media_url, social links and a cache header", async () => {
  const sb = {
    rpc: async (fn, args) => { assert.equal(fn, "content_public"); assert.deepEqual(args, { p_kind: "news", p_limit: 5 }); return { data: [{ id: "1", kind: "news", title: "t", media_path: "posts/x.jpg", created_by: "me" }], error: null }; },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: { x: "https://x.com/gvf" } } }) }) }) })
  };
  const res = fakeRes();
  await handleContent({ method: "GET", query: { kind: "news", limit: "5" } }, res, sb, { SUPABASE_URL: "https://p.co" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=120");
  assert.equal(res.body.posts.length, 1);
  assert.ok(!("created_by" in res.body.posts[0]));
  assert.equal(res.body.posts[0].media_url, "https://p.co/storage/v1/object/public/media/posts/x.jpg");
  assert.deepEqual(res.body.settings.social, { x: "https://x.com/gvf" });

  const bad = fakeRes();
  await handleContent({ method: "GET", query: { kind: "advert" } }, bad, sb, {});
  assert.equal(bad.statusCode, 400);
  const post = fakeRes();
  await handleContent({ method: "POST", query: {} }, post, sb, {});
  assert.equal(post.statusCode, 405);
  assert.equal(parseLimit("999"), 200);
  assert.equal(parseLimit(undefined), 50);
  assert.equal(parseLimit("0"), 1);
});

// --- settings ---------------------------------------------------------------
test("validateSocial accepts https or empty and rejects the rest", () => {
  const { value, errors } = validateSocial({ x: "https://x.com/gvf", facebook: "", instagram: "http://insta.com/gvf", tiktok: "https://t.com" });
  assert.deepEqual(errors, ["instagram"]);
  assert.deepEqual(value, { x: "https://x.com/gvf", facebook: "" });
});

// --- upload validation --------------------------------------------------------
test("upload validator rejects a 25 MB file and an exe, accepts a 2 MB jpeg", () => {
  assert.equal(validateUpload({ name: "big.mp4", size: 25 * 1024 * 1024, type: "video/mp4" }), null);
  assert.equal(validateUpload({ name: "setup.exe", size: 1000, type: "application/x-msdownload" }), null);
  assert.equal(validateUpload({ name: "x.jpg", size: 0, type: "image/jpeg" }), null);
  assert.equal(validateUpload({ name: "x.jpg", size: MAX_MEDIA_BYTES + 1, type: "image/jpeg" }), null);
  assert.deepEqual(validateUpload({ name: "Ward 12 meet.JPG", size: 2 * 1024 * 1024, type: "image/jpeg" }), { name: "Ward_12_meet.JPG", size: 2 * 1024 * 1024, type: "image/jpeg" });
  assert.equal(uploadPath("a.jpg", new Date("2026-10-08T05:00:00Z")), `posts/2026/10/${new Date("2026-10-08T05:00:00Z").getTime()}-a.jpg`);
});

// --- draft handler ------------------------------------------------------------
const okAuth = async () => ({ user: { id: "u" }, staff: { user_id: "u", name: "A", role: "owner", email: "a@b.co" } });

test("draft handler returns 503 without GROQ_API_KEY, even with an Anthropic key", async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: "sk-test" }]) {
    const handler = makeHandler({ env, auth: okAuth, fetchImpl: async () => { throw new Error("must not be called"); } });
    const res = fakeRes();
    await handler({ method: "POST", body: { brief: "Drain cleaned in sector 29 after residents' petition", kind: "news" } }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { ok: false, error: "draft_unavailable" });
  }
});

test("draft handler parses a fenced JSON reply from an injected fetch", async () => {
  let captured;
  const reply = "Here you go:\n```json\n" + JSON.stringify({
    title: "Drain cleaned in Sector 29", summary: "Cleared after residents' petition [verify].",
    body: "<p>Residents of Sector 29 reported a blocked drain.</p><script>x()</script>",
    title_hi: "सेक्टर 29 में नाला साफ", summary_hi: "निवासियों की याचिका के बाद साफ किया गया [verify]।", extra: "ignored"
  }) + "\n```";
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ model: MODEL, choices: [{ finish_reason: "stop", message: { content: reply } }] }) };
  };
  const handler = makeHandler({ env: { GROQ_API_KEY: "sk-test" }, auth: okAuth, fetchImpl });
  const res = fakeRes();
  await handler({ method: "POST", body: { brief: "Drain in sector 29 cleaned after petition", kind: "news", lang: "en" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.draft.title, "Drain cleaned in Sector 29");
  assert.equal(res.body.draft.body, "<p>Residents of Sector 29 reported a blocked drain.</p>");
  assert.equal(res.body.draft.title_hi, "सेक्टर 29 में नाला साफ");
  assert.deepEqual(Object.keys(res.body.draft).sort(), ["body", "summary", "summary_hi", "title", "title_hi"]);
  assert.equal(res.body.truncated, false);
  assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer sk-test");
  assert.equal(captured.body.model, MODEL);
  assert.equal(captured.body.max_tokens, 1500);
  assert.equal(captured.body.messages.length, 2);
  assert.match(captured.body.messages[0].content, /non-partisan/);
  assert.match(captured.body.messages[0].content, /\[verify\]/);
  assert.match(captured.body.messages[1].content, /Drain in sector 29/);
});

test("draft handler validates input and reports upstream failures", async () => {
  const handler = makeHandler({ env: { GROQ_API_KEY: "k" }, auth: okAuth, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { type: "rate_limit_error" } }) }) });
  let res = fakeRes();
  await handler({ method: "POST", body: { brief: "short", kind: "advert" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fields.sort(), ["brief", "kind"]);
  res = fakeRes();
  await handler({ method: "POST", body: { brief: "A long enough brief about a ward meeting", kind: "news" } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "draft_failed");
  res = fakeRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
  const denied = makeHandler({ env: { GROQ_API_KEY: "k" }, auth: async () => { const { HttpError } = await import("../../lib/auth.js"); throw new HttpError(403, "forbidden"); } });
  res = fakeRes();
  await denied({ method: "POST", body: {} }, res);
  assert.equal(res.statusCode, 403);
});

test("parseDraft is defensive", () => {
  assert.equal(parseDraft("no json here"), null);
  assert.equal(parseDraft("[1,2]"), null);
  assert.equal(parseDraft(null), null);
  const d = parseDraft('Sure! {"title":"T","summary":"S","body":"<p>B</p>","title_hi":"ट","summary_hi":"स"} Done.');
  assert.equal(d.title, "T");
  assert.equal(d.body, "<p>B</p>");
  assert.equal(parseDraft("```\n{\"title\": \"X\"}\n```").title, "X");
  const req = buildRequest({ brief: "b".repeat(20), kind: "popup", lang: "hi" });
  assert.equal(req.messages[0].role, "user");
  assert.match(req.messages[0].content, /pop-up/i);
});

test("draft provider: Groq is the only one; other keys are ignored", () => {
  assert.equal(pickProvider({}), null);
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "a" }), null, "no paid fallback (owner, 11 Oct 2026)");
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "g" }), "groq");
  assert.equal(pickProvider({ GROQ_API_KEY: "g", GEMINI_API_KEY: "x" }), "groq");
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "a", DRAFT_PROVIDER: "anthropic" }), null, "a forced Anthropic provider is ignored");
  assert.equal(pickProvider({ GEMINI_API_KEY: "x" }), null, "Gemini was dropped (10 Oct 2026)");
  assert.equal(PROVIDERS.groq.model, "openai/gpt-oss-120b");
});

test("draft handler talks to Groq's free API and reads its reply", async () => {
  let captured;
  const reply = JSON.stringify({ title: "Park cleaned", summary: "Forty volunteers.", body: "<p>Done.</p>", title_hi: "पार्क साफ़", summary_hi: "चालीस स्वयंसेवक।" });
  const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: reply } }] }) }; };
  const handler = makeHandler({ env: { GROQ_API_KEY: "free-key" }, auth: okAuth, fetchImpl });
  const res = fakeRes();
  await handler({ method: "POST", body: { brief: "Sewa drive in Sector 45 park with forty volunteers", kind: "news" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.provider, "groq");
  assert.equal(res.body.model, "openai/gpt-oss-120b");
  assert.equal(res.body.draft.title, "Park cleaned");
  assert.equal(res.body.draft.title_hi, "पार्क साफ़");
  assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(captured.headers.authorization, "Bearer free-key");
  assert.match(captured.body.messages[0].content, /non-partisan/);
  assert.deepEqual(captured.body.response_format, { type: "json_object" });
  assert.match(captured.body.messages[1].content, /Sector 45/);
});

test("draft handler talks to Groq's free API with the OpenAI-style shape", async () => {
  let captured;
  const reply = JSON.stringify({ title: "Townhall on 20 October", summary: "Sector 29 community centre.", body: "<p>6 pm.</p>", title_hi: "20 अक्टूबर को टाउनहॉल", summary_hi: "सेक्टर 29 सामुदायिक केंद्र।" });
  const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, status: 200, json: async () => ({ model: "llama-3.3-70b-versatile", choices: [{ finish_reason: "stop", message: { role: "assistant", content: reply } }] }) }; };
  const handler = makeHandler({ env: { GROQ_API_KEY: "gsk-free", DRAFT_MODEL: "llama-3.3-70b-versatile" }, auth: okAuth, fetchImpl });
  const res = fakeRes();
  await handler({ method: "POST", body: { brief: "First townhall on 20 October at the Sector 29 community centre, 6 pm", kind: "popup" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.provider, "groq");
  assert.equal(res.body.draft.title, "Townhall on 20 October");
  assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(captured.headers.authorization, "Bearer gsk-free");
  assert.equal(captured.body.messages[0].role, "system");
  assert.deepEqual(captured.body.response_format, { type: "json_object" });
  assert.equal(res.body.truncated, false);
});
