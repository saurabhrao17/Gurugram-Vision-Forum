// The topic pipeline: the SEO desk's content gaps written up automatically.
// The cron step `topics` (seo group, 03:00 IST through seo-cron.yml) picks
// the topic cluster with the most public discussion and no recent post (a
// "gap", or a "stale" cluster whose newest post is over 90 days old), and
// drafts one post about it in English and Hindi; the round-up's publish pass
// (cron step autopost) publishes it after the review window unless someone
// tags it `hold` on the desk.
//
// Why this stays people-first and inside Google's spam policies (scaled
// content abuse, doorway pages):
//   - a post is written only where residents are publicly discussing the
//     issue (MIN_DEMAND posts in a fortnight) and says something the guide
//     cannot: what was raised, where, with links to the public posts;
//   - every fact comes from data: the public posts (title, link, area), the
//     official guide (agency, portal, documents, deadlines, ladder) and the
//     official notices. The model, when a key is set, writes only the short
//     opening paragraph, checked like the round-up's prose (no links, no
//     number that is not in the data); every other section is built here;
//   - at most PER_WEEK_DEFAULT posts a week (site_settings.topics.per_week,
//     1-5), one per topic in REFRESH_DAYS, each with a byline, a disclosure
//     line and the review window; a cluster with nothing new to say (no
//     public discussion) stays with its guide alone;
//   - never the Forum's own reports: they are confidential to the team.
import { gvf, hs } from "../site-data.js";
import { classify } from "../signals.js";
import { aiComplete, extractJson, pickProvider } from "../ai.js";
import { sanitizeHtml, validatePost, LIMITS } from "../content.js";
import { chartersFor, label as catLabel } from "./guides.js";
import { clusterHealth } from "./clusters.js";

export const SOURCE_PREFIX = "auto:topic:";
export const AUTHOR = "Gurugram Vision Forum data desk";
export const PER_WEEK_DEFAULT = 3;
export const PER_WEEK_MAX = 5;
export const MIN_DEMAND = 2;           // public posts in the window before a topic is worth a post
export const WINDOW_DAYS = 14;
export const REFRESH_DAYS = 30;        // one post per topic a month at most
export const EXAMPLES_MAX = 5;
export const NEWS_DAYS = 30;
export const NEWS_MAX = 3;
const DAY = 86400000;

export const DISCLOSURE_EN = "This topic update is compiled automatically from public posts, official notices and the Forum's guide, and checked by the Forum team before publication. Corrections through the Join form on the site.";
export const DISCLOSURE_HI = "यह विषय-अपडेट सार्वजनिक पोस्ट, आधिकारिक सूचनाओं और फ़ोरम की गाइड से अपने-आप तैयार होता है और प्रकाशन से पहले फ़ोरम की टीम इसे जाँचती है। सुधार के लिए साइट के जुड़ें फ़ॉर्म से लिखें।";

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const SOURCE_EN = { reddit: "Reddit", news: "news" };
const SOURCE_HI = { reddit: "रेडिट", news: "समाचार" };
const URL_MAX = 2000;

// "Headline - The Tribune" -> { title: "Headline", publisher: "The Tribune" }
export function splitPublisher(raw) {
  const t = one(raw);
  const m = /^(.{20,}?)\s+[-–|]\s+([^-–|]{2,40})$/.exec(t);
  return m ? { title: m[1].slice(0, 160), publisher: m[2].trim() } : { title: t.slice(0, 160), publisher: null };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const one = (s) => String(s || "").replace(/\s+/g, " ").trim();
const httpsUrl = (u) => typeof u === "string" && /^https:\/\//i.test(u);

export const isTopicPost = (p) => typeof p?.source === "string" && p.source.startsWith(SOURCE_PREFIX);
export const topicOf = (p) => (isTopicPost(p) ? p.source.slice(SOURCE_PREFIX.length).split(":")[0] : null);

export function topicSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const per = Number(s.per_week);
  return { enabled: s.enabled !== false, per_week: Number.isInteger(per) && per >= 1 && per <= PER_WEEK_MAX ? per : PER_WEEK_DEFAULT };
}

// ---------------------------------------------------------------------------
// Which topic next. health: clusterHealth() rows; posts: topic posts (any
// state) with source and created_at. Returns { id, reason } or { skipped }.
// ---------------------------------------------------------------------------
export function pickTopic(health, posts, { now = Date.now(), perWeek = PER_WEEK_DEFAULT } = {}) {
  const mine = (posts || []).filter(isTopicPost);
  const thisWeek = mine.filter((p) => (Date.parse(p.created_at || 0) || 0) > now - 7 * DAY).length;
  if (thisWeek >= perWeek) return { skipped: "weekly_limit" };
  const recent = new Set(mine.filter((p) => (Date.parse(p.created_at || 0) || 0) > now - REFRESH_DAYS * DAY).map(topicOf));
  const queue = eligible(health).filter((c) => !recent.has(c.id));
  if (!queue.length) return { skipped: "nothing_to_write" };
  return { id: queue[0].id, reason: queue[0].status };
}

// Clusters the pipeline will write about, most discussed first.
export function eligible(health) {
  return (health || []).filter((c) => c && c.id !== "other" && (c.status === "gap" || c.status === "stale") && c.demand >= MIN_DEMAND)
    .slice().sort((a, b) => b.demand - a.demand);
}

// ---------------------------------------------------------------------------
// Facts: everything the post may say about one topic.
// signals: rows { title, url, source, area, posted_at, issue_type }
// news: rows { title, url, published_at, source }
// ---------------------------------------------------------------------------
export function topicFacts(id, { signals = [], news = [], now = Date.now() } = {}) {
  const G = gvf();
  const cat = (G.CATS || []).find((c) => c.id === id);
  if (!cat) return null;
  const since = now - WINDOW_DAYS * DAY;
  const mine = (signals || []).filter((s) => s && s.issue_type === id && (Date.parse(s.posted_at || 0) || 0) >= since)
    .sort((a, b) => (Date.parse(b.posted_at || 0) || 0) - (Date.parse(a.posted_at || 0) || 0));
  const areaCount = new Map();
  for (const s of mine) if (s.area) areaCount.set(s.area, (areaCount.get(s.area) || 0) + 1);
  const areas = [...areaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([area, n]) => ({ area, n }));
  const seen = new Set();
  const examples = [];
  for (const s of mine) {
    const { title, publisher } = splitPublisher(s.title);
    // A link is used whole or not at all: a cut URL is a broken link.
    if (!title || !httpsUrl(s.url) || String(s.url).length > URL_MAX || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    examples.push({ title, url: String(s.url), source: SOURCE_EN[s.source] ? s.source : "news", publisher, area: s.area || null });
    if (examples.length >= EXAMPLES_MAX) break;
  }
  const newsSince = now - NEWS_DAYS * DAY;
  const notices = (news || []).filter((n) => n && n.title && httpsUrl(n.url) && (Date.parse(n.published_at || n.fetched_at || 0) || now) >= newsSince)
    .filter((n) => classify(n.title).issue_type === id).slice(0, NEWS_MAX)
    .filter((n) => String(n.url).length <= URL_MAX)
    .map((n) => ({ title: one(n.title).slice(0, 200), url: String(n.url), source: one(n.source).slice(0, 80) }));
  const filing = (G.FILING || {})[id] || cat.filing || {};
  const charters = chartersFor(cat);
  const main = charters.find((c) => c.id === "cmwindow") || charters[0] || null;
  const channel = (cat.channels || []).find((c) => httpsUrl(c.href)) || null;
  return {
    id, label: cat.label, label_hi: catLabel(cat, "hi"),
    agency: cat.agency || "", owns: cat.owns || "",
    count: mine.length, residents: mine.filter((s) => s.source === "reddit").length, news: mine.filter((s) => s.source !== "reddit").length, areas, examples, notices,
    portal: filing.portal ? { name: filing.portal, url: httpsUrl(filing.url) ? filing.url : null, note: filing.note || "" } : null,
    channel: channel ? { k: channel.k || "", v: channel.v || "", href: channel.href } : null,
    required: [...(filing.fields || []), ...(filing.docs || [])].filter((f) => f && f.r).map((f) => f.l || f.k).filter(Boolean).slice(0, 8),
    deadline: main ? { t: main.t || "", dl: main.dl || "", right: main.right || "" } : null,
    ladder: Array.isArray(cat.ladder) ? cat.ladder.slice(0, 6) : [],
    month: new Date(now).getUTCMonth(), year: new Date(now).getUTCFullYear(),
    date: new Date(now).toISOString().slice(0, 10)
  };
}

export const isThin = (f) => !f || f.count < MIN_DEMAND || !f.examples.length;

// ---------------------------------------------------------------------------
// Titles, summaries and the built sections.
// ---------------------------------------------------------------------------
export function titleFor(f, lang) {
  return lang === "hi"
    ? `गुरुग्राम में ${f.label_hi}: ${MONTHS_HI[f.month]} ${f.year} अपडेट`
    : `${f.label} in Gurugram: ${MONTHS_EN[f.month]} ${f.year} update`;
}

// "3 posts by residents and 5 news reports" (only the kinds there are).
export function sourcesPhrase(f, lang) {
  const r = f.residents || 0, n = f.news != null ? f.news : f.count - r;
  if (lang === "hi") return [r ? `निवासियों की ${r} पोस्ट` : "", n ? `${n} समाचार रिपोर्ट` : ""].filter(Boolean).join(" और ");
  return [r ? `${r} ${r === 1 ? "post" : "posts"} by residents` : "", n ? `${n} news ${n === 1 ? "report" : "reports"}` : ""].filter(Boolean).join(" and ");
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s) => { const t = one(s); return t && !/[.!?।]$/.test(t) ? t + "." : t; };
const areaList = (f, lang) => f.areas.map((a) => (lang === "hi" ? hs(a.area, "hi") : a.area));
const joinEn = (p) => (p.length <= 1 ? p.join("") : p.slice(0, -1).join(", ") + " and " + p[p.length - 1]);
const joinHi = (p) => (p.length <= 1 ? p.join("") : p.slice(0, -1).join(", ") + " और " + p[p.length - 1]);

export function summaryFor(f, lang) {
  const areas = areaList(f, lang);
  if (lang === "hi") return `पिछले ${WINDOW_DAYS} दिनों में ${f.label_hi} पर ${sourcesPhrase(f, "hi")}${areas.length ? `, सबसे ज़्यादा ${joinHi(areas)} से` : ""}। ज़िम्मेदार कौन है, शिकायत कहाँ करें और कुछ न हो तो क्या करें।`;
  return `${cap(sourcesPhrase(f, "en"))} on ${f.label.toLowerCase()} in Gurugram in the last ${WINDOW_DAYS} days${areas.length ? `, most about ${joinEn(areas)}` : ""}. Who is responsible, where to file it and what to do if nothing happens.`;
}

export function introFor(f, lang) {
  const areas = areaList(f, lang);
  if (lang === "hi") return `<p>पिछले ${WINDOW_DAYS} दिनों में गुरुग्राम में ${f.label_hi} पर ${sourcesPhrase(f, "hi")} आईं${areas.length ? `, सबसे ज़्यादा ${esc(joinHi(areas))} के बारे में` : ""}। नीचे वे लिंक हैं, यह काम किस विभाग का है, और शिकायत ऐसे कैसे दर्ज करें कि उस पर कार्रवाई हो।</p>`;
  return `<p>In the last ${WINDOW_DAYS} days there were ${sourcesPhrase(f, "en")} on ${esc(f.label.toLowerCase())} in Gurugram${areas.length ? `, most of them about ${esc(joinEn(areas))}` : ""}. Below are the links, which office is responsible, and how to file a complaint that gets acted on.</p>`;
}

export function sectionsFor(f, lang) {
  const hi = lang === "hi";
  const h = (en, hiText) => `<h2>${hi ? hiText : en}</h2>`;
  const out = [];
  out.push(h("What was raised", "क्या उठाया गया"));
  out.push(`<ul>${f.examples.map((e) => `<li><a href="${esc(e.url)}">${esc(e.title)}</a> (${esc(e.publisher || (hi ? SOURCE_HI[e.source] : SOURCE_EN[e.source]))}${e.area ? `, ${esc(hi ? hs(e.area, "hi") : e.area)}` : ""})</li>`).join("")}</ul>`);
  out.push(h("Who is responsible", "ज़िम्मेदार कौन है"));
  out.push(`<p><strong>${esc(sentence(hs(f.agency, lang)))}</strong>${f.owns ? ` ${esc(hs(f.owns, lang))}` : ""}</p>`);
  out.push(h("How to file it", "शिकायत कैसे दर्ज करें"));
  const how = [];
  if (f.portal) how.push(`<p>${hi ? "कहाँ:" : "Where:"} ${f.portal.url ? `<a href="${esc(f.portal.url)}"><strong>${esc(hs(f.portal.name, lang))}</strong></a>` : `<strong>${esc(hs(f.portal.name, lang))}</strong>`}.${f.portal.note ? ` ${esc(hs(f.portal.note, lang))}` : ""}</p>`);
  else if (f.channel) how.push(`<p><a href="${esc(f.channel.href)}"><strong>${esc(hs(f.channel.k, lang))}</strong></a> ${esc(hs(f.channel.v, lang))}</p>`);
  if (f.required.length) how.push(`<p>${hi ? "पोर्टल ये माँगता है:" : "The portal asks for:"}</p><ul>${f.required.map((x) => `<li>${esc(hs(x, lang))}</li>`).join("")}</ul>`);
  how.push(`<p>${hi ? `या <a href="/report/${f.id}">फ़ोरम को रिपोर्ट करें</a>: फ़ोरम इसे सही डेस्क पर दर्ज करता है और टिकट पर नज़र रखता है।` : `Or <a href="/report/${f.id}">report it through the Forum</a>: the Forum files it with the right desk and follows the ticket.`}</p>`);
  out.push(how.join(""));
  if (f.deadline && (f.deadline.dl || f.deadline.right)) {
    out.push(h("How long it should take", "कितना समय लगना चाहिए"));
    out.push(`<p>${f.deadline.t ? `<strong>${esc(hs(f.deadline.t, lang))}</strong>${f.deadline.dl ? `: ${esc(hs(f.deadline.dl, lang))}.` : "."} ` : ""}${esc(hs(f.deadline.right, lang))}</p>`);
  }
  if (f.ladder.length) {
    out.push(h("If nothing happens", "अगर कुछ न हो"));
    out.push(`<ol>${f.ladder.map((s) => `<li>${esc(hs(s, lang))}</li>`).join("")}</ol>`);
  }
  if (f.notices.length) {
    out.push(h("Official notices this month", "इस महीने की आधिकारिक सूचनाएँ"));
    out.push(`<ul>${f.notices.map((n) => `<li><a href="${esc(n.url)}">${esc(n.title)}</a>${n.source ? ` (${esc(n.source)})` : ""}</li>`).join("")}</ul>`);
  }
  const guide = hi ? `/hi/guide/${f.id}` : `/guide/${f.id}`;
  out.push(`<p>${hi ? `पूरी जानकारी, दस्तावेज़ और समय-सीमाएँ: <a href="${guide}">${esc(f.label_hi)} की गाइड</a>।` : `Every detail, document and deadline: <a href="${guide}">the ${esc(f.label.toLowerCase())} guide</a>.`}</p>`);
  return out.join("");
}

const disclosure = (lang) => `<p><em>${lang === "hi" ? DISCLOSURE_HI : DISCLOSURE_EN}</em></p>`;

// ---------------------------------------------------------------------------
// The AI path writes only the opening paragraph in both languages, from the
// facts, with no links and no number that is not in the facts.
// ---------------------------------------------------------------------------
export const SYSTEM = [
  "You write the opening paragraph of a short civic update for the Gurugram Vision Forum, a non-partisan citizens' forum in Gurugram, India.",
  "Use ONLY the facts given: the topic, the count of public posts, the areas and the example post titles. Summarise what residents are raising in plain language, 50 to 110 words.",
  "Do not invent anything, do not add numbers that are not in the data, no links, no HTML, no names of people, parties or officials; agencies only, and keep agency acronyms (GMDA, MCG, DHBVN, HRERA, HSPCB, DTCP) in Latin script in both languages.",
  "Reply with one JSON object only: {\"intro_en\",\"intro_hi\"}. intro_hi is natural Hindi in Devanagari."
].join(" ");

export function allowedNumbers(f) {
  const set = new Set([WINDOW_DAYS, f.count, f.year, f.month + 1, ...Array.from({ length: 11 }, (_, i) => i)]);
  for (const a of f.areas) { set.add(a.n); for (const m of String(a.area).match(/\d+/g) || []) set.add(Number(m)); }
  for (const e of f.examples) for (const m of e.title.match(/\d+/g) || []) set.add(Number(m));
  return set;
}

export function checkIntro(text, f, lang) {
  const s = one(text);
  if (s.length < 120 || s.length > 1200) return null;
  if (/[<>]|https?:\/\/|www\./i.test(s)) return null;
  const nums = allowedNumbers(f);
  for (const m of s.matchAll(/\d+/g)) if (!nums.has(Number(m[0]))) return null;
  if (lang === "hi" && !/[ऀ-ॿ]/.test(s)) return null;
  return `<p>${esc(s)}</p>`;
}

export async function aiIntro(f, env, fetchImpl) {
  if (!pickProvider(env || {}) || !fetchImpl) return null;
  try {
    const facts = { topic_en: f.label, topic_hi: f.label_hi, public_posts: f.count, days: WINDOW_DAYS, areas: f.areas, example_titles: f.examples.map((e) => e.title), responsible: f.agency };
    const r = await aiComplete(env, { system: SYSTEM, user: JSON.stringify(facts), json: true, maxTokens: 900 }, fetchImpl);
    if (!r.ok || r.truncated) return null;
    const obj = extractJson(r.text);
    if (!obj) return null;
    const en = checkIntro(obj.intro_en, f, "en");
    const hi = checkIntro(obj.intro_hi, f, "hi");
    return en && hi ? { en, hi, provider: r.provider || null } : null;
  } catch (e) {
    console.error("topics ai failed", e);
    return null;
  }
}

// The post row for one topic, or null when there is not enough to say.
export async function buildTopicPost(id, { signals, news, env = {}, fetchImpl = null, now = Date.now() } = {}) {
  const f = topicFacts(id, { signals, news, now });
  if (isThin(f)) return null;
  const ai = await aiIntro(f, env, fetchImpl);
  const body = sanitizeHtml((ai ? ai.en : introFor(f, "en")) + sectionsFor(f, "en")) + disclosure("en");
  const body_hi = sanitizeHtml((ai ? ai.hi : introFor(f, "hi")) + sectionsFor(f, "hi")) + disclosure("hi");
  const ym = f.date.slice(0, 7);
  const post = {
    kind: "story",
    title: titleFor(f, "en"),
    title_hi: titleFor(f, "hi"),
    summary: summaryFor(f, "en").slice(0, LIMITS.summary),
    summary_hi: summaryFor(f, "hi").slice(0, LIMITS.summary),
    body, body_hi,
    tags: ["auto", "topic", id],
    slug: `${id}-gurugram-${ym}`,
    source: `${SOURCE_PREFIX}${id}:${f.date}`,
    author: AUTHOR
  };
  const { errors } = validatePost(post);
  if (errors.length) { console.error("topics: post rejected by validatePost", errors); return null; }
  return { ...post, ai: !!ai, provider: ai ? ai.provider : null, count: f.count };
}

// ---------------------------------------------------------------------------
// The desk's view: per cluster, what the pipeline does with it.
//   queued    : will be drafted (position in the queue, at per_week a week)
//   draft     : drafted, publishes at publish_at unless held
//   held      : drafted and tagged hold; waits for the team
//   published : the topic post is live
//   guide     : nothing to write (no public discussion); the guide covers it
//   covered   : the cluster has fresh posts
// ---------------------------------------------------------------------------
export function pipelineState(health, topicPosts, { now = Date.now(), perWeek = PER_WEEK_DEFAULT, reviewHours = 48, enabled = true } = {}) {
  const latest = new Map();
  for (const p of (topicPosts || []).filter(isTopicPost)) {
    const id = topicOf(p);
    const t = Date.parse(p.created_at || 0) || 0;
    if (!latest.has(id) || t > (Date.parse(latest.get(id).created_at || 0) || 0)) latest.set(id, p);
  }
  const queue = eligible(health).filter((c) => { const p = latest.get(c.id); return !p || (Date.parse(p.created_at || 0) || 0) <= now - REFRESH_DAYS * DAY; }).map((c) => c.id);
  const map = {};
  for (const c of health || []) {
    const p = latest.get(c.id);
    const fresh = p && (Date.parse(p.created_at || 0) || 0) > now - REFRESH_DAYS * DAY;
    if (fresh && p.published) map[c.id] = { state: "published", slug: p.slug, at: p.published_at || null };
    else if (fresh && Array.isArray(p.tags) && p.tags.includes("hold")) map[c.id] = { state: "held", slug: p.slug };
    else if (fresh) map[c.id] = { state: "draft", slug: p.slug, publish_at: reviewHours < 0 ? null : new Date((Date.parse(p.created_at || 0) || now) + reviewHours * 3600000).toISOString() };
    else if (queue.includes(c.id)) map[c.id] = { state: enabled ? "queued" : "off", position: queue.indexOf(c.id) + 1, eta_days: enabled ? Math.floor(queue.indexOf(c.id) / perWeek) * 7 : null };
    else if (c.status === "ok") map[c.id] = { state: "covered" };
    else map[c.id] = { state: "guide" };
  }
  return map;
}

// ---------------------------------------------------------------------------
// The cron step. deps: { fetch, now }. Reads the fortnight's public signals,
// the month's notices, the published posts (for cluster health) and the
// topic posts; writes at most one draft.
// ---------------------------------------------------------------------------
export async function topicsStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), settings = null, reviewHours = 48, posts = [] } = {}) {
  const out = { drafted: false, skipped: null };
  const s = topicSettings(settings);
  if (!s.enabled) { out.skipped = "disabled"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const { data: signals, error: se } = await sb.from("signals").select("title, url, source, area, posted_at, issue_type").gte("posted_at", since).order("posted_at", { ascending: false }).limit(1000);
  if (se) throw new Error(`signals select: ${se.message || se}`);
  const { data: rows, error: pe } = await sb.from("posts").select("id, slug, source, tags, published, published_at, created_at").order("created_at", { ascending: false }).limit(500);
  if (pe) throw new Error(`posts select: ${pe.message || pe}`);
  const mine = (rows || []).filter(isTopicPost);
  const health = clusterHealth({ posts, signals: signals || [], now, days: WINDOW_DAYS });
  const pick = pickTopic(health, mine, { now, perWeek: s.per_week });
  if (pick.skipped) { out.skipped = pick.skipped; return out; }
  const { data: items, error: ne } = await sb.from("news_items").select("title, url, published_at, source_id, news_sources(name)").gte("fetched_at", new Date(now - NEWS_DAYS * DAY).toISOString()).order("fetched_at", { ascending: false }).limit(200);
  if (ne) throw new Error(`news_items select: ${ne.message || ne}`);
  const news = (items || []).map((n) => ({ title: n.title, url: n.url, published_at: n.published_at, source: (n.news_sources && n.news_sources.name) || n.source_id }));
  const post = await buildTopicPost(pick.id, { signals: signals || [], news, env, fetchImpl, now });
  out.topic = pick.id;
  if (!post) { out.skipped = "thin"; return out; }
  const { value, errors } = validatePost(post);
  if (errors.length) throw new Error(`topic post invalid: ${errors.join(",")}`);
  const nowIso = new Date(now).toISOString();
  const row = { ...value, slug: post.slug, created_by: "cron:topics", published: reviewHours === 0, published_at: reviewHours === 0 ? nowIso : null };
  let { error: ie } = await sb.from("posts").insert(row);
  if (ie && ie.code === "23505") { row.slug = `${post.slug}-${nowIso.slice(8, 10)}`; ({ error: ie } = await sb.from("posts").insert(row)); }
  if (ie) throw new Error(`posts insert: ${ie.message || ie}`);
  Object.assign(out, { drafted: true, slug: row.slug, ai: post.ai, published: row.published, mentions: post.count });
  if (env && env.COORDINATOR_EMAIL) {
    const when = reviewHours < 0 ? "It will not publish until someone on the desk publishes it." : reviewHours === 0 ? "It was published at once (review window 0 hours)." : `It publishes on ${new Date(now + reviewHours * 3600000).toISOString().replace("T", " ").slice(0, 16)} UTC unless held (add the tag "hold" or edit it on the desk's Content tab).`;
    const { error: oe } = await sb.from("outbox").insert({ to_email: env.COORDINATOR_EMAIL, subject: `Topic post draft ready: ${post.title}`, kind: "autopost",
      body_text: [`The SEO desk's topic pipeline drafted a post on ${pick.id} (${post.count} public posts in ${WINDOW_DAYS} days)${post.ai ? `, opening paragraph by ${post.provider || "the AI provider"}` : ""}.`, "", post.title, post.summary, "", when, ""].join("\n") });
    if (oe) console.error("topics outbox insert failed", oe);
  }
  return out;
}
