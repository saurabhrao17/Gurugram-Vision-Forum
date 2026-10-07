// The weekly round-up: one post a week built from the Forum's own data (the
// pulse in `insights`, the official notices in `news_items`, the public
// report counts and the week's published posts), drafted by the daily cron,
// held for the team's review and then published.
//
// Why this stays inside Google's spam policies (scaled content abuse,
// doorway abuse, people-first content): there is ONE post a week, it is
// built only from real data the site already shows, every number and link
// comes from that data (never from a model), the post carries a visible
// disclosure line and a byline, and a person can hold or edit it before it
// goes live. No keyword lists, no page farms.
//
// Hindi: with a provider key (GEMINI_API_KEY, GROQ_API_KEY, or the paid
// ANTHROPIC_API_KEY) one call writes the English and Hindi prose from the
// structured facts; the result is checked (links and numbers must all come
// from the facts) and falls back to the templates below on any doubt.
// Without a key both languages come from the templates.
import { aiComplete, extractJson, pickProvider } from "./ai.js";
import { sanitizeHtml, validatePost, LIMITS } from "./content.js";
import { labelOf } from "./signals.js";

export const AUTHOR = "Gurugram Vision Forum data desk";
export const CONTACT = "contact@gurugramvisionforum.org";
export const MIN_SIGNALS = 3;           // a pulse thinner than this says nothing
export const PUBLIC_MIN_REPORTS = 50;   // CLAUDE.md: publish no report numbers before 50
export const TOPICS_MAX = 8;
export const EXAMPLES_MAX = 2;
export const NEWS_MAX = 15;
export const POSTS_MAX = 10;
export const ACTIONS_MAX = 5;
export const AI_MAX_TOKENS = 4000;
export const AI_MIN_CHARS = 600;        // a body shorter than this is not a round-up

export const DISCLOSURE_EN = `This weekly round-up is compiled automatically from public posts, official notices and the Forum's own data, and checked by the Forum team before publication. Corrections: ${CONTACT}`;
export const DISCLOSURE_HI = `यह साप्ताहिक सार सार्वजनिक पोस्ट, आधिकारिक सूचनाओं और फ़ोरम के अपने आँकड़ों से अपने-आप तैयार होता है और प्रकाशन से पहले फ़ोरम की टीम इसे जाँचती है। सुधार के लिए लिखें: ${CONTACT}`;

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const STAGES_EN = ["Received", "Mapped", "Filed officially", "Escalated", "Resolved"];
const STAGES_HI = ["प्राप्त", "मैप किया गया", "आधिकारिक रूप से दर्ज", "आगे बढ़ाया गया", "हल हो गया"];
const TREND_EN = { up: "rising", down: "falling", flat: "steady" };
const TREND_HI = { up: "पिछले हफ़्ते से ज़्यादा", down: "पिछले हफ़्ते से कम", flat: "पिछले हफ़्ते जितना" };
const SOURCE_EN = { reddit: "Reddit", news: "news", reports: "Forum report" };
const SOURCE_HI = { reddit: "रेडिट", news: "समाचार", reports: "फ़ोरम रिपोर्ट" };
const KIND_HI = { story: "कहानी", news: "ख़बर", photo: "फ़ोटो", video: "वीडियो", social: "सोशल पोस्ट", testimonial: "अनुभव", popup: "सूचना" };
const DAY = 86400000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const joinEn = (parts) => (parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]);
const joinHi = (parts) => (parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " और " + parts[parts.length - 1]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dateOf = (v) => { const t = v instanceof Date ? v.getTime() : Date.parse(v); return Number.isFinite(t) ? new Date(t) : null; };

// ISO 8601 week of a date (UTC): { year, week }.
export function isoWeek(input) {
  const d = dateOf(input) || new Date();
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return { year: date.getUTCFullYear(), week: Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7) };
}
export const weekTag = ({ year, week }) => `${year}-W${String(week).padStart(2, "0")}`;

// The calendar days a period covers: the last day is the day before `to`
// when the window is a whole number of days (a Monday 03:30 to Monday 03:30
// window is "Monday to Sunday").
export function periodDays(period) {
  const to = dateOf(period && period.to) || new Date();
  const from = dateOf(period && period.from) || new Date(to.getTime() - 7 * DAY);
  const span = to.getTime() - from.getTime();
  const last = span >= 7 * DAY - 60000 ? new Date(to.getTime() - DAY) : to;
  return { from, to: last < from ? from : last, end: to };
}

export function formatRange(period, lang = "en") {
  const { from, to } = periodDays(period);
  const months = lang === "hi" ? MONTHS_HI : MONTHS_EN;
  const d1 = from.getUTCDate(), d2 = to.getUTCDate();
  const m1 = months[from.getUTCMonth()], m2 = months[to.getUTCMonth()];
  const y1 = from.getUTCFullYear(), y2 = to.getUTCFullYear();
  if (y1 !== y2) return `${d1} ${m1} ${y1}–${d2} ${m2} ${y2}`;
  if (m1 !== m2) return `${d1} ${m1}–${d2} ${m2} ${y2}`;
  if (d1 === d2) return `${d1} ${m1} ${y1}`;
  return `${d1}–${d2} ${m1} ${y1}`;
}

const shortDate = (v, lang) => {
  const d = dateOf(v);
  if (!d) return "";
  return `${d.getUTCDate()} ${(lang === "hi" ? MONTHS_HI : MONTHS_EN)[d.getUTCMonth()]}`;
};

const isPublicUrl = (u) => typeof u === "string" && (/^https:\/\//i.test(u) || u.startsWith("/"));

// ---------------------------------------------------------------------------
// Facts: everything the post may say, cleaned once. Nothing else reaches
// the templates or the model.
// ---------------------------------------------------------------------------
export function collectFacts({ pulse, news, reportStats, posts, actions, period, now } = {}) {
  const p = pulse && typeof pulse === "object" ? pulse : null;
  const end = dateOf(period && period.to) || dateOf(p && p.period && p.period.to) || (now ? new Date(now) : new Date());
  const start = dateOf(period && period.from) || dateOf(p && p.period && p.period.from) || new Date(end.getTime() - 7 * DAY);
  const topics = (Array.isArray(p && p.topics) ? p.topics : []).filter((t) => t && num(t.count) > 0).slice(0, TOPICS_MAX).map((t) => {
    const lab = labelOf(t.issue_type || "other");
    return {
      issue_type: str(t.issue_type, 40) || "other",
      label: str(t.label, 80) || lab.label,
      label_hi: str(t.label_hi, 80) || lab.hl,
      count: num(t.count),
      previous: num(t.previous),
      trend: ["up", "down", "flat"].includes(t.trend) ? t.trend : "flat",
      areas: (Array.isArray(t.areas) ? t.areas : []).filter((a) => a && a.area).slice(0, 3).map((a) => ({ area: str(a.area, 60), n: num(a.n) })),
      examples: (Array.isArray(t.examples) ? t.examples : []).filter((e) => e && e.title && isPublicUrl(e.url)).slice(0, EXAMPLES_MAX)
        .map((e) => ({ title: str(e.title, 160), url: str(e.url, 500), source: SOURCE_EN[e.source] ? e.source : "news" }))
    };
  });
  const total = p ? num(p.total) : 0;
  const newsList = (Array.isArray(news) ? news : []).filter((n) => n && n.title && /^https?:\/\//i.test(String(n.url || ""))).slice(0, NEWS_MAX)
    .map((n) => ({ title: str(n.title, 200), url: str(n.url, 500), source: str(n.source || (n.news_sources && n.news_sources.name) || n.source_id, 80), published_at: n.published_at || null }));
  const postList = (Array.isArray(posts) ? posts : []).filter((x) => x && x.title && x.slug).slice(0, POSTS_MAX)
    .map((x) => ({ title: str(x.title, 200), slug: str(x.slug, 120), kind: str(x.kind, 20) || "news" }));
  const rs = reportStats && typeof reportStats === "object" ? reportStats : null;
  const siteTotal = rs ? num(rs.total) : 0;
  let reports = null;
  if (rs && siteTotal >= PUBLIC_MIN_REPORTS) {
    const byStage = {};
    for (const [k, v] of Object.entries(rs.by_stage || {})) if (num(v) > 0) byStage[k] = num(v);
    const byIssue = {};
    for (const [k, v] of Object.entries(rs.by_issue || {})) if (num(v) > 0) byIssue[k] = num(v);
    reports = { total: siteTotal, week: num(rs.week), by_stage: byStage, by_issue: byIssue };
  }
  const actionList = (Array.isArray(actions) ? actions : Array.isArray(p && p.actions) ? p.actions : []).filter((a) => a && a.title).slice(0, ACTIONS_MAX)
    .map((a) => ({ title: str(a.title, 200), why: str(a.why, 400), where: str(a.where, 120) || "across Gurugram", when: str(a.when, 60) || "this month", issue_type: str(a.issue_type, 40) || "other" }));
  return {
    period: { from: start.toISOString(), to: end.toISOString() },
    week: isoWeek(end),
    topics,
    total,
    previous_total: p ? num(p.previous_total) : 0,
    headline_en: str(p && p.headline_en, 160),
    headline_hi: str(p && p.headline_hi, 160),
    summary_en: str(p && p.summary_en, LIMITS.summary),
    summary_hi: str(p && p.summary_hi, LIMITS.summary),
    news: newsList,
    posts: postList,
    reports,
    actions: actionList
  };
}

// Nothing to say is better than a thin page.
export const isThin = (f) => f.total < MIN_SIGNALS && !f.news.length && !f.posts.length;

// ---------------------------------------------------------------------------
// Headlines, titles and summaries
// ---------------------------------------------------------------------------
export function headlineFor(f, lang) {
  const top = f.topics[0];
  if (lang === "hi") {
    if (f.headline_hi) return f.headline_hi;
    return top ? `इस हफ़्ते सबसे ज़्यादा चर्चा: ${top.label_hi}` : "आधिकारिक सूचनाएँ और फ़ोरम की ख़बरें";
  }
  if (f.headline_en) return f.headline_en;
  return top ? `${top.label} top the week's civic talk` : "official notices and Forum updates";
}

export const titleFor = (f, headline, lang) => (lang === "hi"
  ? `गुरुग्राम नागरिक सप्ताह, ${formatRange(f.period, "hi")}: ${headline}`
  : `Gurugram civic week, ${formatRange(f.period, "en")}: ${headline}`).slice(0, LIMITS.title);

export function summaryFor(f, lang) {
  const top = f.topics.slice(0, 3);
  const parts = [];
  if (lang === "hi") {
    if (f.total) parts.push(`इस हफ़्ते ${f.topics.length} विषयों पर ${f.total} सार्वजनिक ज़िक्र${top.length ? `; सबसे ज़्यादा ${joinHi(top.map((t) => `${t.label_hi} (${t.count})`))}` : ""}।`);
    else parts.push(`${formatRange(f.period, "hi")} के हफ़्ते की आधिकारिक सूचनाएँ और फ़ोरम की ख़बरें।`);
    if (f.news.length) parts.push(`${f.news.length} आधिकारिक सूचनाएँ।`);
    if (f.reports) parts.push(`फ़ोरम को ${f.reports.week} रिपोर्टें मिलीं।`);
    if (f.posts.length) parts.push(`फ़ोरम की ${f.posts.length} नई पोस्ट।`);
  } else {
    if (f.total) parts.push(`${f.total} public mentions across ${plural(f.topics.length, "topic", "topics")} this week${top.length ? `; most about ${joinEn(top.map((t) => `${t.label.toLowerCase()} (${t.count})`))}` : ""}.`);
    else parts.push(`Official notices and Forum updates for the week of ${formatRange(f.period, "en")}.`);
    if (f.news.length) parts.push(`${plural(f.news.length, "official notice", "official notices")}.`);
    if (f.reports) parts.push(`${plural(f.reports.week, "report", "reports")} to the Forum.`);
    if (f.posts.length) parts.push(`${plural(f.posts.length, "new Forum post", "new Forum posts")}.`);
  }
  return parts.join(" ").slice(0, LIMITS.summary);
}

// ---------------------------------------------------------------------------
// Template bodies. Every link is a public one from the facts; the closing
// and the disclosure are appended by assemble() in both paths.
// ---------------------------------------------------------------------------
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;
const examplesEn = (t) => t.examples.map((e) => `${link(e.url, e.title)} (${SOURCE_EN[e.source]})`).join("; ");
const examplesHi = (t) => t.examples.map((e) => `${link(e.url, e.title)} (${SOURCE_HI[e.source]})`).join("; ");
const stageEn = (k) => STAGES_EN[Number(k)] || String(k);
const stageHi = (k) => STAGES_HI[Number(k)] || String(k);

export function templateBodyEn(f) {
  const out = [];
  const range = formatRange(f.period, "en");
  const intro = f.total
    ? `Every week the Forum reads public posts, official notices and its own reports to see what Gurugram's residents are talking about. Between ${range}, ${f.total} public mentions were counted across ${plural(f.topics.length, "topic", "topics")}${f.previous_total ? ` (${f.previous_total} the week before)` : ""}.`
    : `Every week the Forum reads public posts, official notices and its own reports to see what Gurugram's residents are talking about. The week of ${range} was quiet on public forums; here is what the official channels and the Forum published.`;
  out.push(`<p>${esc(intro)}${f.summary_en ? " " + esc(f.summary_en) : ""}</p>`);
  if (f.topics.length) {
    out.push("<h2>What residents talked about</h2><ul>");
    for (const t of f.topics) {
      const areas = t.areas.length ? ` Most mentions were about ${joinEn(t.areas.map((a) => a.area))}.` : "";
      const ex = t.examples.length ? ` For example: ${examplesEn(t)}.` : "";
      out.push(`<li><strong>${esc(t.label)}</strong>: ${plural(t.count, "mention", "mentions")}, ${TREND_EN[t.trend]} (${t.previous} the week before).${esc(areas)}${ex}</li>`);
    }
    out.push("</ul>");
  }
  if (f.news.length) {
    out.push("<h2>Official notices this week</h2><ul>");
    for (const n of f.news) out.push(`<li>${link(n.url, n.title)}${n.source ? ` — ${esc(n.source)}` : ""}${n.published_at ? `, ${esc(shortDate(n.published_at, "en"))}` : ""}</li>`);
    out.push("</ul>");
  }
  if (f.reports) {
    const r = f.reports;
    out.push("<h2>What the Forum received</h2>");
    out.push(`<p>Residents sent the Forum ${plural(r.week, "report", "reports")} this week; ${r.total} in all so far. Counts only: the Forum never publishes who reported what.</p>`);
    const stages = Object.entries(r.by_stage).map(([k, v]) => `${v} ${stageEn(k).toLowerCase()}`);
    const issues = Object.entries(r.by_issue).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ${labelOf(k).label.toLowerCase()}`);
    if (stages.length || issues.length) out.push(`<ul>${stages.length ? `<li>By stage: ${esc(joinEn(stages))}.</li>` : ""}${issues.length ? `<li>By issue: ${esc(joinEn(issues))}.</li>` : ""}</ul>`);
  }
  if (f.posts.length) {
    out.push("<h2>From the Forum this week</h2><ul>");
    for (const x of f.posts) out.push(`<li>${link(`/blog/${x.slug}`, x.title)} (${esc(x.kind)})</li>`);
    out.push("</ul>");
  }
  if (f.actions.length) {
    out.push("<h2>Suggested next steps</h2><ul>");
    for (const a of f.actions) out.push(`<li><strong>${esc(a.title)}</strong>${a.why ? `: ${esc(a.why)}` : ""}. Where: ${esc(a.where)}. When: ${esc(a.when)}.</li>`);
    out.push("</ul>");
  }
  return out.join("");
}

export function templateBodyHi(f) {
  const out = [];
  const range = formatRange(f.period, "hi");
  const intro = f.total
    ? `फ़ोरम हर हफ़्ते सार्वजनिक पोस्ट, आधिकारिक सूचनाएँ और अपनी रिपोर्टें पढ़कर देखता है कि गुरुग्राम के निवासी किस बारे में बात कर रहे हैं। ${range} के बीच ${f.topics.length} विषयों पर ${f.total} सार्वजनिक ज़िक्र गिने गए${f.previous_total ? ` (पिछले हफ़्ते ${f.previous_total})` : ""}।`
    : `फ़ोरम हर हफ़्ते सार्वजनिक पोस्ट, आधिकारिक सूचनाएँ और अपनी रिपोर्टें पढ़कर देखता है कि गुरुग्राम के निवासी किस बारे में बात कर रहे हैं। ${range} का हफ़्ता सार्वजनिक मंचों पर शांत रहा; आधिकारिक चैनलों और फ़ोरम ने जो प्रकाशित किया, वह यहाँ है।`;
  out.push(`<p>${esc(intro)}${f.summary_hi ? " " + esc(f.summary_hi) : ""}</p>`);
  if (f.topics.length) {
    out.push("<h2>इस हफ़्ते निवासियों ने किस बारे में बात की</h2><ul>");
    for (const t of f.topics) {
      const areas = t.areas.length ? ` सबसे ज़्यादा ज़िक्र ${joinHi(t.areas.map((a) => a.area))} के बारे में थे।` : "";
      const ex = t.examples.length ? ` उदाहरण: ${examplesHi(t)}।` : "";
      out.push(`<li><strong>${esc(t.label_hi)}</strong>: ${t.count} ज़िक्र, ${TREND_HI[t.trend]} (पिछले हफ़्ते ${t.previous})।${esc(areas)}${ex}</li>`);
    }
    out.push("</ul>");
  }
  if (f.news.length) {
    out.push("<h2>इस हफ़्ते की आधिकारिक सूचनाएँ</h2><ul>");
    for (const n of f.news) out.push(`<li>${link(n.url, n.title)}${n.source ? ` — ${esc(n.source)}` : ""}${n.published_at ? `, ${esc(shortDate(n.published_at, "hi"))}` : ""}</li>`);
    out.push("</ul>");
  }
  if (f.reports) {
    const r = f.reports;
    out.push("<h2>फ़ोरम को क्या मिला</h2>");
    out.push(`<p>इस हफ़्ते निवासियों ने फ़ोरम को ${r.week} रिपोर्टें भेजीं; अब तक कुल ${r.total}। सिर्फ़ गिनती: फ़ोरम कभी नहीं बताता कि किसने क्या रिपोर्ट किया।</p>`);
    const stages = Object.entries(r.by_stage).map(([k, v]) => `${v} ${stageHi(k)}`);
    const issues = Object.entries(r.by_issue).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ${labelOf(k).hl}`);
    if (stages.length || issues.length) out.push(`<ul>${stages.length ? `<li>चरण के अनुसार: ${esc(joinHi(stages))}।</li>` : ""}${issues.length ? `<li>विषय के अनुसार: ${esc(joinHi(issues))}।</li>` : ""}</ul>`);
  }
  if (f.posts.length) {
    out.push("<h2>इस हफ़्ते फ़ोरम से</h2><ul>");
    for (const x of f.posts) out.push(`<li>${link(`/hi/blog/${x.slug}`, x.title)} (${esc(KIND_HI[x.kind] || x.kind)})</li>`);
    out.push("</ul>");
  }
  if (f.actions.length) {
    out.push("<h2>सुझाए गए अगले कदम</h2><ul>");
    for (const a of f.actions) out.push(`<li><strong>${esc(a.title)}</strong>${a.why ? `: ${esc(a.why)}` : ""}। कहाँ: ${esc(a.where)}। कब: ${esc(a.when)}।</li>`);
    out.push("</ul>");
  }
  return out.join("");
}

export const CLOSING_EN = `<p>Seen a civic problem? <a href="/report">Report it to the Forum</a> and it reaches the right desk. New to the portals? <a href="/guides">Read the guides</a>.</p>`;
export const CLOSING_HI = `<p>कोई नागरिक समस्या दिखी? <a href="/report">फ़ोरम को रिपोर्ट करें</a>, वह सही डेस्क तक पहुँचेगी। पोर्टल नए हैं? <a href="/guides">गाइड पढ़ें</a>।</p>`;
const disclosure = (text) => `<p class="disclosure"><em>${esc(text)}</em></p>`;

// Body = sanitised sections + closing + disclosure. The disclosure is the
// Forum's own fixed text, added after sanitising so its class survives here;
// validatePost's sanitiser keeps the paragraph and the emphasis.
export const assemble = (sections, lang) => sanitizeHtml(sections) + (lang === "hi" ? CLOSING_HI : CLOSING_EN) + disclosure(lang === "hi" ? DISCLOSURE_HI : DISCLOSURE_EN);

// ---------------------------------------------------------------------------
// The AI path: one JSON call writing both languages from the facts, then a
// strict check that every link and every number in the prose is one we gave.
// ---------------------------------------------------------------------------
export const SYSTEM = [
  "You write the weekly civic round-up for the Gurugram Vision Forum, a non-partisan citizens' forum in Gurugram, India.",
  "Plain language, people-first: a resident should learn something useful. No keyword stuffing, no filler, no marketing.",
  "Use ONLY the facts given: the counts, areas, trends, example links, notices, report numbers and suggested actions. Do not invent anything, do not add numbers or links that are not in the data, do not guess causes.",
  "Never name a political party, candidate, official or any person. Refer to agencies only, and keep agency acronyms (GMDA, MCG, DHBVN, HRERA, HSPCB, DTCP, GRAP) in Latin script in both languages.",
  "Write both versions: body_en in English and body_hi in natural Hindi (Devanagari, not transliteration). Each 400 to 700 words.",
  "Each body is HTML using only <p>, <h2>, <ul>, <li>, <strong>, <em> and <a href=\"...\"> with hrefs copied exactly from the data. Sections in this order: an intro paragraph; <h2>What residents talked about</h2> (one <li> per topic with its count, trend, areas and one or two example links); <h2>Official notices this week</h2> (a list with source and link; omit the section when there are no notices); <h2>What the Forum received</h2> (only when report numbers are given); <h2>Suggested next steps</h2> (the actions given). Hindi headings for body_hi: इस हफ़्ते निवासियों ने किस बारे में बात की / इस हफ़्ते की आधिकारिक सूचनाएँ / फ़ोरम को क्या मिला / सुझाए गए अगले कदम.",
  "Do not write a closing line or a disclosure; they are added afterwards.",
  "Reply with one JSON object only: {\"headline_en\",\"headline_hi\",\"summary_en\",\"summary_hi\",\"body_en\",\"body_hi\"}. headline: at most 12 words, no date. summary: two plain sentences."
].join(" ");

export function allowedNumbers(f) {
  const set = new Set();
  for (let i = 0; i <= 12; i++) set.add(i);
  const add = (v) => { if (Number.isFinite(Number(v))) set.add(Number(v)); };
  add(f.total); add(f.previous_total); add(f.topics.length); add(f.news.length); add(f.posts.length); add(f.actions.length);
  for (const t of f.topics) { add(t.count); add(t.previous); for (const a of t.areas) { add(a.n); for (const m of String(a.area).match(/\d+/g) || []) add(m); } for (const e of t.examples) for (const m of e.title.match(/\d+/g) || []) add(m); }
  for (const n of f.news) { for (const m of n.title.match(/\d+/g) || []) add(m); const d = dateOf(n.published_at); if (d) { add(d.getUTCDate()); add(d.getUTCFullYear()); } }
  for (const x of f.posts) for (const m of x.title.match(/\d+/g) || []) add(m);
  for (const a of f.actions) for (const m of `${a.title} ${a.why} ${a.where} ${a.when}`.match(/\d+/g) || []) add(m);
  if (f.reports) { add(f.reports.total); add(f.reports.week); for (const v of Object.values(f.reports.by_stage)) add(v); for (const v of Object.values(f.reports.by_issue)) add(v); }
  const { from, to } = periodDays(f.period);
  for (const d of [from, to]) { add(d.getUTCDate()); add(d.getUTCMonth() + 1); add(d.getUTCFullYear()); }
  add(f.week.week); add(f.week.year);
  return set;
}

export function allowedLinks(f) {
  const set = new Set(["/report", "/guides", "/pulse", "/news", "/blog"]);
  for (const t of f.topics) for (const e of t.examples) set.add(e.url);
  for (const n of f.news) set.add(n.url);
  for (const x of f.posts) { set.add(`/blog/${x.slug}`); set.add(`/hi/blog/${x.slug}`); }
  return set;
}

const stripTags = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");

// A model body is accepted only when every href and every integer in it
// comes from the facts, it is a sensible length and (for Hindi) is Hindi.
export function checkAiBody(html, f, lang) {
  if (typeof html !== "string") return null;
  const clean = sanitizeHtml(html);
  if (clean.length < AI_MIN_CHARS || clean.length > LIMITS.body - 1200) return null;
  if (/<(script|style|iframe|img)\b/i.test(html)) return null;
  const links = allowedLinks(f);
  for (const m of clean.matchAll(/href="([^"]*)"/g)) if (!links.has(m[1].replace(/&amp;/g, "&"))) return null;
  const numbers = allowedNumbers(f);
  const text = stripTags(clean);
  for (const m of text.matchAll(/\d+/g)) if (!numbers.has(Number(m[0]))) return null;
  if (lang === "hi" && !/[ऀ-ॿ]/.test(text)) return null;
  if (/\b(sponsored|casino|crypto|loan offer)\b/i.test(text)) return null;
  return clean;
}

function compactFacts(f) {
  return {
    period: { from: f.period.from, to: f.period.to, label_en: formatRange(f.period, "en"), label_hi: formatRange(f.period, "hi") },
    total_mentions: f.total,
    previous_week_total: f.previous_total,
    topics: f.topics.map((t) => ({ issue_type: t.issue_type, label_en: t.label, label_hi: t.label_hi, count: t.count, previous_week: t.previous, trend: t.trend, areas: t.areas, examples: t.examples })),
    official_notices: f.news.map((n) => ({ title: n.title, url: n.url, source: n.source, date: n.published_at })),
    forum_reports: f.reports ? { this_week: f.reports.week, total_so_far: f.reports.total, by_stage: Object.fromEntries(Object.entries(f.reports.by_stage).map(([k, v]) => [stageEn(k), v])), by_issue: Object.fromEntries(Object.entries(f.reports.by_issue).map(([k, v]) => [labelOf(k).label, v])) } : null,
    forum_posts: f.posts.map((x) => ({ title: x.title, url: `/blog/${x.slug}`, url_hi: `/hi/blog/${x.slug}`, kind: x.kind })),
    suggested_actions: f.actions
  };
}

export async function aiDraft(f, env, fetchImpl) {
  if (!pickProvider(env) || !fetchImpl) return null;
  try {
    const r = await aiComplete(env, { system: SYSTEM, user: JSON.stringify(compactFacts(f)), json: true, maxTokens: AI_MAX_TOKENS }, fetchImpl);
    if (!r.ok || r.truncated) return null;
    const obj = extractJson(r.text);
    if (!obj) return null;
    const body = checkAiBody(obj.body_en, f, "en");
    const body_hi = checkAiBody(obj.body_hi, f, "hi");
    if (!body || !body_hi) return null;
    const headline = str(obj.headline_en, 100).replace(/[.:\s]+$/, "");
    const headline_hi = str(obj.headline_hi, 100).replace(/[.:\s]+$/, "");
    if (!headline || !headline_hi || !/[ऀ-ॿ]/.test(headline_hi)) return null;
    const numbers = allowedNumbers(f);
    for (const s of [headline, headline_hi, str(obj.summary_en, LIMITS.summary), str(obj.summary_hi, LIMITS.summary)]) for (const m of s.matchAll(/\d+/g)) if (!numbers.has(Number(m[0]))) return null;
    return {
      headline, headline_hi,
      summary: str(obj.summary_en, LIMITS.summary) || summaryFor(f, "en"),
      summary_hi: str(obj.summary_hi, LIMITS.summary) || summaryFor(f, "hi"),
      body, body_hi,
      provider: r.provider || null
    };
  } catch (e) {
    console.error("autopost ai failed", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildWeeklyPost: the post row (without id/slug uniqueness handling), or
// null when the week has nothing to say.
// ---------------------------------------------------------------------------
export async function buildWeeklyPost({ pulse, news, reportStats, posts, actions, period, lang = "both", env = process.env, fetchImpl = null, now } = {}) {
  const f = collectFacts({ pulse, news, reportStats, posts, actions, period, now });
  if (isThin(f)) return null;
  const tag = weekTag(f.week);
  const ai = await aiDraft(f, env || {}, fetchImpl);
  const headline = ai ? ai.headline : headlineFor(f, "en");
  const headline_hi = ai ? ai.headline_hi : headlineFor(f, "hi");
  const topIds = f.topics.slice(0, 3).map((t) => t.issue_type);
  const post = {
    kind: "news",
    title: titleFor(f, headline, "en"),
    title_hi: lang === "en" ? "" : titleFor(f, headline_hi, "hi"),
    summary: ai ? ai.summary : summaryFor(f, "en"),
    summary_hi: lang === "en" ? "" : (ai ? ai.summary_hi : summaryFor(f, "hi")),
    body: assemble(ai ? ai.body : templateBodyEn(f), "en"),
    body_hi: lang === "en" ? "" : assemble(ai ? ai.body_hi : templateBodyHi(f), "hi"),
    tags: ["auto", "weekly", ...topIds],
    slug: `civic-week-${tag}`,
    source: `auto:weekly:${tag}`,
    author: AUTHOR,
    published: false,
    ai: !!ai,
    provider: ai ? ai.provider : null,
    period: f.period,
    week: tag
  };
  const { errors } = validatePost(post);
  if (!errors.length) return post;
  if (ai) {
    // The model's text failed the content rules; the templates always pass.
    console.error("autopost: ai draft rejected by validatePost", errors);
    return buildWeeklyPost({ pulse, news, reportStats, posts, actions, period, lang, env: {}, fetchImpl: null, now });
  }
  console.error("autopost: template post rejected by validatePost", errors);
  return null;
}
