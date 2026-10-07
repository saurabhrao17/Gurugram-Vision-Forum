// Gurugram pulse: a daily scan of public discussion about civic problems in
// Gurugram, classified into the site's issue types (CATS in site/data.js),
// located to its area names (AREAS), summed into a weekly pulse and turned
// into suggested actions for the team.
//
// Sources are lawful and free only: Reddit's public JSON listing (with a
// User-Agent, as its API rules ask), Google News RSS search feeds and the
// Forum's own reports. X/Twitter, Quora, Facebook and the like are not read:
// their terms forbid scraping and they offer no free public feed.
//
// Privacy: a signal is a public post's title, snippet, link and date only.
// Author names and user handles are never copied out of a feed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseRss, USER_AGENT } from "./news-fetch.js";
import { aiComplete, extractJson, pickProvider } from "./ai.js";

export const SITE = "https://gurugramvisionforum.org";
export const FETCH_TIMEOUT_MS = 8000;
export const SNIPPET_MAX = 300;
export const REDDIT_URLS = [
  "https://www.reddit.com/r/gurgaon/new.json?limit=75",
  "https://www.reddit.com/r/gurugram/new.json?limit=50"
];
export const REDDIT_KEEP_SCORE = 50; // an uncategorised post is kept only when this popular
export const NEWS_QUERIES = [
  "Gurugram civic", "Gurgaon waterlogging", "Gurugram garbage", "Gurugram GMDA", "Gurugram MCG", "Gurugram traffic",
  "Gurugram pollution AQI", "Gurugram water supply", "Gurugram stray dogs", "Gurugram illegal construction",
  "Gurugram DHBVN power cut", "Gurugram RWA"
];
export const NEWS_SCORE = 5;
export const EXAMPLES_PER_TOPIC = 5;
export const AREAS_PER_TOPIC = 5;
export const ACTIONS_MAX = 5;
export const SOURCES = ["reddit", "news"];

// ---------------------------------------------------------------------------
// Taxonomy from site/data.js, loaded once in a bare vm context (as
// lib/link-check.js does) so the labels, Hindi labels and area names stay
// the site's own.
// ---------------------------------------------------------------------------
const DATA_URL = new URL("../site/data.js", import.meta.url);
let taxonomyCache = null;
export function taxonomy(url = DATA_URL) {
  if (taxonomyCache) return taxonomyCache;
  const src = readFileSync(url, "utf8");
  const window = {};
  const ctx = vm.createContext({ window, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(src, ctx, { filename: "data.js" });
  const G = window.GVF || {};
  const cats = Array.isArray(G.CATS) ? G.CATS : [];
  const labels = {};
  for (const c of cats) labels[c.id] = { label: c.label || c.id, hl: c.hl || c.label || c.id };
  taxonomyCache = { cats, areas: Array.isArray(G.AREAS) ? G.AREAS.slice() : [], labels };
  return taxonomyCache;
}
export const labelOf = (id) => (taxonomy().labels[id] || { label: id, hl: id });

// ---------------------------------------------------------------------------
// Keywords per issue type: English, Hinglish (romanised Hindi) and Hindi.
// Latin keywords match whole words (plural -s/-es allowed); Devanagari ones
// match at the start of a word so inflections (गड्ढा, गड्ढे, गड्ढों) count.
// ---------------------------------------------------------------------------
export const KEYWORDS = {
  waste: ["garbage", "kachra", "kooda", "kuda", "dump", "dumping", "litter", "littering", "sanitation", "trash", "landfill", "bandhwari", "sweeper", "safai", "कचरा", "कूड़ा", "गंदगी", "सफाई"],
  drains: ["waterlogging", "waterlogged", "water logging", "jalbharav", "jal bharav", "sewer overflow", "sewage overflow", "flooded", "flooding", "drain", "drainage", "nala", "nallah", "manhole", "sewer", "sewage", "नाला", "नाली", "जलभराव", "सीवर"],
  roads: ["pothole", "gaddha", "gadha", "gaddhe", "road caved", "road cave-in", "cave-in", "footpath", "pavement", "broken road", "road condition", "kharab sadak", "sadak", "speed breaker", "सड़क", "गड्ढ", "फुटपाथ", "फ़ुटपाथ"],
  lights: ["streetlight", "street light", "street lights", "dark stretch", "no lights", "lights not working", "street lamp", "स्ट्रीट लाइट", "स्ट्रीटलाइट", "अंधेरा"],
  traffic: ["jam", "traffic jam", "wrong side", "wrong-side", "signal", "traffic signal", "red light", "encroachment", "congestion", "u-turn", "u turn", "parking", "rash driving", "overspeeding", "challan", "ट्रैफ़िक", "ट्रैफिक", "जाम", "रॉन्ग साइड"],
  power: ["power cut", "powercut", "power cuts", "bijli", "dhbvn", "outage", "electricity", "load shedding", "transformer", "voltage", "बिजली", "बिजली कटौती"],
  pollution: ["aqi", "smog", "dust", "burning", "garbage burning", "stubble", "grap", "noise", "pollution", "air quality", "hspcb", "प्रदूषण", "धुआं", "धुआँ", "शोर"],
  animals: ["stray dog", "stray dogs", "dog bite", "dog bites", "cattle", "stray cattle", "monkey", "monkeys", "stray animals", "cow", "cows", "आवारा कुत्त", "कुत्त", "आवारा पशु", "बंदर"],
  water: ["water supply", "tanker", "tankers", "low pressure", "dirty water", "no water", "water shortage", "contaminated water", "paani", "pani", "jal", "पानी", "पानी की किल्लत", "टैंकर"],
  parks: ["park", "parks", "trees", "tree cutting", "green belt", "greenbelt", "garden", "biodiversity park", "aravalli", "aravallis", "पार्क", "पेड़", "ग्रीन बेल्ट"],
  safety: ["theft", "snatching", "chain snatching", "cyber fraud", "cyberfraud", "fraud", "police", "robbery", "harassment", "molestation", "scam", "unsafe", "पुलिस", "चोरी", "साइबर", "ठगी"],
  construction: ["illegal construction", "unauthorised construction", "unauthorized construction", "encroachment", "illegal building", "demolition", "dtcp", "building collapse", "अवैध निर्माण", "अतिक्रमण"],
  property: ["property tax", "property id", "house tax", "संपत्ति कर", "प्रॉपर्टी टैक्स"],
  housing: ["builder", "builders", "rera", "possession", "rwa", "maintenance", "society", "flat buyers", "homebuyers", "home buyers", "occupation certificate", "structural audit", "बिल्डर", "सोसाइटी", "रेरा", "मेंटेनेंस"],
  consumer: ["refund", "e-commerce", "ecommerce", "consumer forum", "consumer court", "overcharging", "overcharged", "उपभोक्ता", "रिफंड"],
  rti: ["rti", "right to information", "सूचना का अधिकार", "आरटीआई"]
};

const DEVANAGARI = /[ऀ-ॿ]/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEAD = "(?:^|[^\\p{L}\\p{N}_])";
const TRAIL = "(?=$|[^\\p{L}\\p{N}_])";
function keywordRe(kw) {
  const body = escapeRe(kw).replace(/\s+/g, "[\\s-]+");
  return DEVANAGARI.test(kw) ? new RegExp(LEAD + body, "iu") : new RegExp(LEAD + body + "(?:e?s)?" + TRAIL, "iu");
}
const COMPILED = Object.entries(KEYWORDS).map(([type, list]) => [type, list.map(keywordRe)]);

// Keyword hits per issue type; the type with most hits wins, ties go to the
// order of KEYWORDS. { issue_type: 'other', score: 0 } when nothing matches.
export function classify(input) {
  const s = String(input || "");
  if (!s.trim()) return { issue_type: "other", score: 0 };
  let best = "other", bestScore = 0;
  for (const [type, res] of COMPILED) {
    let hits = 0;
    for (const re of res) if (re.test(s)) hits++;
    if (hits > bestScore) { best = type; bestScore = hits; }
  }
  return { issue_type: best, score: bestScore };
}

export const detectLang = (s) => (DEVANAGARI.test(String(s || "")) ? "hi" : "en");

// ---------------------------------------------------------------------------
// Area: the first of the site's area names mentioned in the text, by position.
// "Sector 45", "sec 45", "sector-45", "Sec. 45", "सेक्टर 45"; named areas
// with flexible spacing and an optional "Phase": "DLF Phase 3", "DLF-3",
// "Sushant Lok 1", "sushant lok-1".
// ---------------------------------------------------------------------------
const SECTOR_RE = /(?:\bsec(?:tor)?\.?|सेक्टर)[\s-]*(\d{1,3})(?!\d)/giu;
const areaCache = new WeakMap();
function areaMatchers(areas) {
  let m = areaCache.get(areas);
  if (m) return m;
  m = [];
  for (const name of areas) {
    if (/^Sector \d+$/i.test(name)) continue;
    const tail = /^(.*?)\s+(\d+)$/.exec(name);
    let body;
    if (tail) {
      const words = tail[1].split(/\s+/).map((w) => (/^phase$/i.test(w) ? "(?:phase|ph\\.?)?" : escapeRe(w)));
      body = words.join("[\\s-]*") + "[\\s-]*" + tail[2] + "(?!\\d)";
    } else body = escapeRe(name).replace(/\s+/g, "[\\s-]+") + TRAIL;
    m.push({ name, re: new RegExp(LEAD + body, "iu") });
  }
  areaCache.set(areas, m);
  return m;
}

export function extractArea(input, areas) {
  const s = String(input || "");
  if (!s) return null;
  const list = Array.isArray(areas) ? areas : taxonomy().areas;
  const known = new Set(list.map((a) => a.toLowerCase()));
  let best = null;
  const consider = (idx, name) => { if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, name }; };
  SECTOR_RE.lastIndex = 0;
  let m;
  while ((m = SECTOR_RE.exec(s))) {
    const name = `Sector ${parseInt(m[1], 10)}`;
    if (known.has(name.toLowerCase())) { consider(m.index, name); break; }
  }
  for (const { name, re } of areaMatchers(list)) {
    const r = re.exec(s);
    if (r) consider(r.index + (r[0].length - r[0].trimStart().length), name);
  }
  return best ? best.name : null;
}

// ---------------------------------------------------------------------------
// Fetchers. Each tolerates a refused or failed request by returning [].
// ---------------------------------------------------------------------------
async function getText(url, fetchImpl, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { method: "GET", redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: ctrl.signal });
    if (!r || !r.ok) return null;
    return typeof r.text === "function" ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const isoOf = (v) => { const t = typeof v === "number" ? v * 1000 : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
export const sha1 = (s) => createHash("sha1").update(String(s)).digest("hex");

// Reddit's public listing of r/gurgaon and r/gurugram. Only the post's own
// public text is kept: no author, no flair, no avatar. A 429 or 403 (rate
// limit or block) yields [] and the cron notes 0 for the day.
export async function fetchReddit(fetchImpl, { areas } = {}) {
  const out = [];
  const seen = new Set();
  for (const url of REDDIT_URLS) {
    const body = await getText(url, fetchImpl, "application/json");
    if (!body) continue;
    let j;
    try { j = JSON.parse(body); } catch { continue; }
    const children = Array.isArray(j?.data?.children) ? j.data.children : [];
    for (const c of children) {
      const d = c && c.data;
      if (!d || !d.id || !d.title || seen.has(d.id)) continue;
      const selftext = typeof d.selftext === "string" ? d.selftext.replace(/\s+/g, " ").trim() : "";
      const text = `${d.title} ${selftext}`;
      const { issue_type, score: hits } = classify(text);
      const score = (Number(d.ups ?? d.score) || 0) + (Number(d.num_comments) || 0);
      if (issue_type === "other" && !hits && score < REDDIT_KEEP_SCORE) continue;
      seen.add(d.id);
      out.push({
        source: "reddit",
        external_id: String(d.id),
        title: String(d.title).slice(0, 300),
        snippet: selftext ? selftext.slice(0, SNIPPET_MAX) : null,
        url: "https://www.reddit.com" + (typeof d.permalink === "string" ? d.permalink : `/r/${d.subreddit || "gurgaon"}/comments/${d.id}/`),
        posted_at: isoOf(d.created_utc) || new Date().toISOString(),
        issue_type,
        area: extractArea(text, areas),
        ward: null,
        score,
        lang: detectLang(text)
      });
    }
  }
  return out;
}

export const newsSearchUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

// Google News RSS searches, one per query, deduped by article URL.
export async function fetchGoogleNews(fetchImpl, { areas, queries = NEWS_QUERIES } = {}) {
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const url = newsSearchUrl(q);
    const xml = await getText(url, fetchImpl, "application/rss+xml, application/xml, text/xml, */*");
    if (!xml) continue;
    for (const item of parseRss(xml, url)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const { issue_type } = classify(item.title);
      out.push({
        source: "news",
        external_id: sha1(item.url),
        title: item.title,
        snippet: item.title,
        url: item.url,
        posted_at: item.published_at || new Date().toISOString(),
        issue_type,
        area: extractArea(item.title, areas),
        ward: null,
        score: NEWS_SCORE,
        lang: detectLang(item.title)
      });
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// The pulse: topics over the last `days` days against the `prev` days before.
// ---------------------------------------------------------------------------
const DAY = 86400000;
const when = (s) => Date.parse(s.posted_at || s.fetched_at || 0) || 0;

export function trendOf(count, before) {
  if (count >= before + 2 && count > before * 1.25) return "up";
  if (count <= before - 2 && count < before * 0.8) return "down";
  return "flat";
}

export function computePulse(signals, { days = 7, prev = 7, now = Date.now(), sources = SOURCES } = {}) {
  const to = typeof now === "number" ? now : Date.parse(now);
  const from = to - days * DAY;
  const prevFrom = from - prev * DAY;
  const list = Array.isArray(signals) ? signals : [];
  const current = list.filter((s) => { const t = when(s); return t >= from && t <= to; });
  const before = list.filter((s) => { const t = when(s); return t >= prevFrom && t < from; });
  const prevCounts = {};
  for (const s of before) prevCounts[s.issue_type || "other"] = (prevCounts[s.issue_type || "other"] || 0) + 1;
  const groups = new Map();
  for (const s of current) {
    const k = s.issue_type || "other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const topics = [...groups.entries()].map(([issue_type, rows]) => {
    const by_source = { reddit: 0, news: 0 };
    const areaCounts = new Map();
    for (const s of rows) {
      if (s.source in by_source) by_source[s.source]++;
      if (s.area) areaCounts.set(s.area, (areaCounts.get(s.area) || 0) + 1);
    }
    const areas = [...areaCounts.entries()].map(([area, n]) => ({ area, n })).sort((a, b) => b.n - a.n || a.area.localeCompare(b.area)).slice(0, AREAS_PER_TOPIC);
    const examples = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || when(b) - when(a)).slice(0, EXAMPLES_PER_TOPIC)
      .map((s) => ({ title: s.title, url: s.url || null, source: s.source, posted_at: s.posted_at || null }));
    const { label, hl } = labelOf(issue_type);
    return { issue_type, label, label_hi: hl, count: rows.length, by_source, areas, examples, trend: trendOf(rows.length, prevCounts[issue_type] || 0), previous: prevCounts[issue_type] || 0 };
  // "Something else" (unclassified) always ranks last: it is a bucket, not a topic.
  }).sort((a, b) => (a.issue_type === "other") - (b.issue_type === "other") || b.count - a.count || a.issue_type.localeCompare(b.issue_type));
  return {
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    topics,
    total: current.length,
    previous_total: before.length,
    sources_checked: sources.slice()
  };
}

// ---------------------------------------------------------------------------
// Rule-based actions for the top topics: what the team can organise and with
// whom. Non-partisan by construction: agencies, not people.
// ---------------------------------------------------------------------------
export const ACTIONS = {
  waste: { action: "Sector cleaning drive with MCG's sanitation wing", who: "MCG sanitation wing, sector RWA" },
  drains: { action: "Pre-monsoon drain walk and townhall with GMDA/MCG engineers", who: "GMDA and MCG engineering wings" },
  roads: { action: "Pothole mapping drive; hand the list to the GMDA/MCG engineer", who: "GMDA/MCG executive engineer" },
  lights: { action: "Night audit walk; pole numbers to the MCG electrical wing", who: "MCG electrical wing" },
  traffic: { action: "Meeting with the DCP Traffic for the worst junctions", who: "DCP Traffic, Gurugram Police" },
  power: { action: "DHBVN consumer camp with the SDO", who: "DHBVN sub-divisional officer" },
  pollution: { action: "GRAP awareness and anti-burning watch with HSPCB", who: "HSPCB regional office, RWAs" },
  animals: { action: "Sterilisation and vaccination camp with the MCG veterinary wing", who: "MCG veterinary wing" },
  water: { action: "Water supply camp with GMDA; tanker schedule clarity", who: "GMDA water supply division" },
  parks: { action: "Park adoption drive with RWAs", who: "MCG horticulture wing, RWAs" },
  safety: { action: "Beat-level police meeting; cyber-fraud awareness session", who: "Station house officer, cyber cell" },
  construction: { action: "Complaint clinic with DTCP/MCG town planning", who: "DTCP enforcement, MCG town planning" },
  property: { action: "Property tax help desk", who: "MCG property tax branch" },
  housing: { action: "RERA and RWA clinic", who: "HRERA Gurugram, district registrar of societies" },
  consumer: { action: "Consumer rights clinic", who: "District consumer commission" },
  rti: { action: "RTI drafting workshop", who: "Forum volunteers, SPIO of the department concerned" },
  other: { action: "Listening session in the most-mentioned area", who: "Forum volunteers, local RWA" }
};

const topArea = (t) => (t.areas && t.areas[0] ? t.areas[0].area : null);
const whyOf = (t) => {
  const trend = t.trend === "up" ? "rising" : t.trend === "down" ? "falling" : "steady";
  const area = topArea(t);
  return `${t.count} ${t.count === 1 ? "mention" : "mentions"} this week, ${trend}${area ? `; most about ${area}` : ""}`;
};
const whenOf = (t) => (t.trend === "up" ? "this week" : "within two weeks");

export function suggestActions(topics) {
  const live = (Array.isArray(topics) ? topics : []).filter((t) => t && t.count > 0);
  // The unclassified bucket only earns an action when nothing else was said.
  const named = live.filter((t) => t.issue_type !== "other");
  return (named.length ? named : live).slice(0, ACTIONS_MAX).map((t) => {
    const a = ACTIONS[t.issue_type] || ACTIONS.other;
    return { issue_type: t.issue_type, action: a.action, why: whyOf(t), who: a.who, when: whenOf(t) };
  });
}

// ---------------------------------------------------------------------------
// The brief: an optional AI narration of the pulse, falling back to the
// rule-based actions and a generic summary when no provider is configured
// or the call fails. Never names a person: the data holds none.
// ---------------------------------------------------------------------------
const SYSTEM = [
  "You write a short weekly civic brief for the Gurugram Vision Forum, a non-partisan residents' group in Gurugram, India.",
  "Use only the data given: counts, areas, trends and example titles. State only what the data says; never guess causes or add facts.",
  "Never mention a political party, candidate, official or any person by name. Refer to agencies (MCG, GMDA, DHBVN, HSPCB, DTCP, Gurugram Police) only.",
  "Suggest concrete, local, lawful actions the Forum's volunteers can organise: cleaning drives, drain walks, townhalls, camps, clinics, audits.",
  "Reply with one JSON object only: {\"headline_en\",\"headline_hi\",\"summary_en\",\"summary_hi\",\"actions\":[{\"title\",\"why\",\"where\",\"when\",\"issue_type\"}]}.",
  "headline: at most 12 words. summary: two or three plain sentences. actions: at most 5, issue_type one of the given topic ids, where an area from the data or \"across Gurugram\", when a short phrase like \"this week\".",
  "Hindi fields are natural Hindi in Devanagari, not transliteration."
].join(" ");

const joinList = (parts) => (parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]);
const joinListHi = (parts) => (parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " और " + parts[parts.length - 1]);

export function fallbackBrief(pulse) {
  const topics = Array.isArray(pulse?.topics) ? pulse.topics.filter((t) => t.count > 0) : [];
  const named = topics.filter((t) => t.issue_type !== "other");
  const top = (named.length ? named : topics).slice(0, 3);
  const en = top.map((t) => `${t.label.toLowerCase()} (${t.count})`);
  const hi = top.map((t) => `${t.label_hi} (${t.count})`);
  const summary_en = top.length ? `This week residents talked most about ${joinList(en)}, across ${pulse.total} public posts and news items.` : "No civic discussion was picked up this week.";
  const summary_hi = top.length ? `इस हफ़्ते निवासियों ने सबसे ज़्यादा ${joinListHi(hi)} की बात की, कुल ${pulse.total} सार्वजनिक पोस्ट और ख़बरों में।` : "इस हफ़्ते कोई नागरिक चर्चा दर्ज नहीं हुई।";
  const headline_en = top.length ? `${top[0].label} top the week's civic talk` : "A quiet week";
  const headline_hi = top.length ? `इस हफ़्ते सबसे ज़्यादा चर्चा: ${top[0].label_hi}` : "शांत हफ़्ता";
  const actions = suggestActions(topics).map((a) => {
    const t = topics.find((x) => x.issue_type === a.issue_type);
    return { title: a.action, why: a.why, where: (t && topArea(t)) || "across Gurugram", when: a.when, issue_type: a.issue_type, who: a.who };
  });
  return { headline_en, headline_hi, summary_en, summary_hi, actions, ai: false, provider: null };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function cleanBrief(obj, pulse) {
  if (!obj) return null;
  const ids = new Set((pulse.topics || []).map((t) => t.issue_type));
  const out = { headline_en: str(obj.headline_en, 160), headline_hi: str(obj.headline_hi, 160), summary_en: str(obj.summary_en, 1200), summary_hi: str(obj.summary_hi, 1200) };
  if (!out.headline_en || !out.summary_en) return null;
  out.actions = (Array.isArray(obj.actions) ? obj.actions : []).map((a) => ({
    title: str(a?.title, 200), why: str(a?.why, 400), where: str(a?.where, 120) || "across Gurugram", when: str(a?.when, 60) || "this month",
    issue_type: ids.has(a?.issue_type) ? a.issue_type : "other"
  })).filter((a) => a.title).slice(0, ACTIONS_MAX);
  if (!out.actions.length) return null;
  return out;
}

export async function narrate(env = process.env, pulse, fetchImpl = globalThis.fetch) {
  const fallback = fallbackBrief(pulse);
  if (!pickProvider(env) || !fetchImpl || !pulse || !pulse.total) return fallback;
  const compact = {
    period: pulse.period,
    total: pulse.total,
    topics: (pulse.topics || []).slice(0, 8).map((t) => ({ issue_type: t.issue_type, label: t.label, count: t.count, previous: t.previous, trend: t.trend, by_source: t.by_source, areas: t.areas, examples: (t.examples || []).map((e) => e.title) })),
    rule_based_actions: suggestActions(pulse.topics)
  };
  try {
    const r = await aiComplete(env, { system: SYSTEM, user: JSON.stringify(compact), json: true, maxTokens: 1200 }, fetchImpl);
    if (!r.ok) return fallback;
    const brief = cleanBrief(extractJson(r.text), pulse);
    if (!brief) return fallback;
    return { ...brief, ai: true, provider: r.provider || null };
  } catch (e) {
    console.error("narrate failed", e);
    return fallback;
  }
}

// What the cron stores in insights.data and GET /api/pulse returns.
export const insightData = (pulse, brief) => ({
  period: pulse.period,
  total: pulse.total,
  previous_total: pulse.previous_total,
  sources_checked: pulse.sources_checked,
  topics: pulse.topics,
  headline_en: brief.headline_en,
  headline_hi: brief.headline_hi,
  summary_en: brief.summary_en,
  summary_hi: brief.summary_hi,
  actions: brief.actions,
  ai: !!brief.ai,
  provider: brief.provider || null
});
