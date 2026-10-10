// Generative Engine Optimization (GEO): making the Forum's public pages the
// source AI answer engines (Google AI Overviews, ChatGPT search,
// Perplexity, Copilot, Claude) read and cite when residents ask who fixes a
// civic problem in Gurugram. Three parts, all automatic:
//   - /llms.txt and /llms-full.txt (buildLlms, buildLlmsFull): a plain
//     Markdown map of the site and the full text of every guide, the
//     emerging convention for giving language models a clean copy; built on
//     request from site/data.js and the published posts.
//   - site/robots.txt names the AI crawlers and lets them read every public
//     page (the desk and /api stay closed); the audit checks it nightly.
//   - geoStep (cron step `geo`): a handful of the questions residents ask
//     each night, put to Groq's gpt-oss with its browser search (engine
//     "groq-browser"; GROQ_API_KEY; it reads the open web through Exa),
//     recording whether the answer cites gurugramvisionforum.org (table
//     seo_geo). Groq only (owner's decision, 10 Oct 2026): Google's AI is no
//     longer asked; old "gemini-search" rows stay in the table, unread.
// The per-page GEO readiness score lives in audit.js (geoChecks).
import { gvf } from "../site-data.js";
import { siteUrl, WARD_COUNT } from "./site.js";
import { faqFor } from "./guides.js";
import { clustersOf } from "./clusters.js";
import { discoverGroqModel } from "../ai.js";

export const GEO_PER_RUN = 3;
export const GEO_TIMEOUT_MS = 25000;
export const GEO_GROQ_MODEL = "openai/gpt-oss-120b";
// The step stops asking after this long so its call stays inside Vercel's
// 60 seconds; the rest wait for the next run.
export const GEO_BUDGET_MS = 38000;
const DAY = 86400000;

// The AI crawlers robots.txt names (search, answer and training bots).
export const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "Meta-ExternalAgent", "Amazonbot", "DuckAssistBot"];

const one = (s) => String(s || "").replace(/\s+/g, " ").trim();
const stop = (s) => { const t = one(s); return !t || /[.!?]$/.test(t) ? t : t + "."; };
const firstSentence = (s) => { const t = one(s); const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t); return stop(m ? m[1] : t.slice(0, 200)); };

// ---------------------------------------------------------------------------
// /llms.txt: the map. Title, one-paragraph summary, then sections of links
// with a one-line description each (llmstxt.org).
// ---------------------------------------------------------------------------
export function buildLlms({ posts = [], env = process.env } = {}) {
  const G = gvf();
  const site = siteUrl(env);
  const cats = G.CATS || [];
  const lines = [];
  lines.push("# Gurugram Vision Forum", "");
  lines.push("> A non-partisan citizens' platform for Gurugram (Gurgaon), Haryana, India. For every civic problem it says which government desk is responsible, the official portal or helpline to file on, the details and documents that portal asks for, the deadlines set in law and the escalation ladder when nothing happens. It also lists the councillor of each of the 36 Municipal Corporation of Gurugram wards and counts the problems residents report through it.", "");
  lines.push(`Facts on these pages come from official government sources, linked on each page, and were last checked on ${G.VERIFIED || "the date shown on the page"}. What residents report to the Forum is confidential: only counts per ward, issue and stage are public. Every page is also available in Hindi under /hi/.`, "");
  lines.push("## Guides: who fixes what in Gurugram", "");
  for (const c of cats) lines.push(`- [${c.label}](${site}/guide/${c.id}): ${firstSentence(c.agency)} ${firstSentence(c.owns)}`.trimEnd());
  lines.push(`- [All issue guides](${site}/guides): the ${cats.length} guides in one list.`, "");
  lines.push("## Wards and councillors", "");
  lines.push(`- [All ${WARD_COUNT} wards](${site}/wards): find your ward by sector or colony.`);
  for (const w of G.WARDS || []) if (Array.isArray(w) && w[0]) lines.push(`- [Ward ${w[0]}](${site}/ward/${w[0]}): councillor ${one(w[1])}, the sectors and colonies it covers, and report counts.`);
  lines.push("");
  const recent = (posts || []).slice(0, 15);
  if (recent.length) {
    lines.push("## Explainers and updates", "");
    for (const p of recent) {
      const pillars = clustersOf(p, cats).map((id) => (cats.find((c) => c.id === id) || {}).label).filter(Boolean);
      lines.push(`- [${one(p.title)}](${site}/blog/${p.slug}): ${one(p.summary).slice(0, 220)}${pillars.length ? ` (topic: ${pillars.join(", ")})` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Tools", "");
  lines.push(`- [Report a problem](${site}/report): the Forum files it with the right desk and tracks it.`);
  lines.push(`- [Your rights](${site}/rights): the deadlines government set for itself and how to use them.`);
  lines.push(`- [Directory](${site}/directory): every official portal and helpline that creates a record.`);
  lines.push(`- [Gurugram pulse](${site}/pulse): what residents discussed publicly this week, by issue and area.`);
  lines.push(`- [Official news](${site}/news): notices from MCG, GMDA, HSVP and other bodies, collected daily.`, "");
  lines.push("## Optional", "");
  lines.push(`- [Full text of every guide](${site}/llms-full.txt): the guides above as one Markdown file.`);
  lines.push(`- [Hindi guides](${site}/hi/guides): the same guides in Hindi.`);
  lines.push(`- [Sitemap](${site}/sitemap.xml)`);
  return lines.join("\n") + "\n";
}

// /llms-full.txt: every guide's content in Markdown (English).
export function buildLlmsFull({ env = process.env } = {}) {
  const G = gvf();
  const site = siteUrl(env);
  const out = [`# Gurugram Vision Forum: civic issue guides for Gurugram (Gurgaon), Haryana`, "", `Source: ${site}/guides. Facts last checked on ${G.VERIFIED || "the date on each page"}. Official links are given with each step.`, ""];
  for (const c of G.CATS || []) {
    const filing = (G.FILING || {})[c.id] || {};
    out.push(`## ${c.label}`, "", `Page: ${site}/guide/${c.id}`, "");
    out.push(`**Who is responsible:** ${stop(c.agency)} ${one(c.owns)}`, "");
    const ch = (c.channels || []).map((x) => `- ${one(x.k)}: ${one(x.v)}${/^https?:/.test(x.href || "") ? ` (${x.href})` : ""}`);
    if (ch.length) out.push("**How to complain:**", ...ch, "");
    if (filing.portal) {
      out.push(`**What the portal asks for (${one(filing.portal)}${filing.url ? `, ${filing.url}` : ""}):** ${one(filing.note || "")}`);
      for (const f of filing.fields || []) out.push(`- ${one(f.l || f.k)}${f.r ? " (required)" : ""}`);
      for (const f of filing.docs || []) out.push(`- Document: ${one(f.l || f.k)}${f.r ? " (required)" : ""}`);
      out.push("");
    }
    if (Array.isArray(c.ladder) && c.ladder.length) out.push("**If nothing happens:**", ...c.ladder.map((s, i) => `${i + 1}. ${one(s)}`), "");
    const faq = faqFor(c, "en");
    if (faq.length) { out.push("**Common questions:**", ""); for (const f of faq) out.push(`Q: ${one(f.q)}`, `A: ${one(f.a)}`, ""); }
  }
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// The questions residents ask an AI assistant, one per issue plus general
// ones. The nightly step rotates through them.
// ---------------------------------------------------------------------------
export function geoQuestions(cats = gvf().CATS || []) {
  const q = cats.map((c) => ({ key: `issue:${c.id}`, issue: c.id, text: `Who is responsible for ${c.label.toLowerCase()} problems in Gurugram, and how do I file a complaint that gets acted on?` }));
  q.push({ key: "general:complaint", issue: null, text: "How do I file a civic complaint in Gurugram so that it actually gets resolved?" });
  q.push({ key: "general:councillor", issue: null, text: "How do I find my ward councillor in Gurugram and what can they do for me?" });
  q.push({ key: "general:escalate", issue: null, text: "What can I do if MCG or GMDA in Gurugram closes my complaint without fixing it?" });
  return q;
}

// Groq's browser search: the answer text ends the message (the page
// snippets it read come first) and the pages it opened sit in the message's
// executed tools; every https URL in either is a source, in order.
const URL_RE = /https?:\/\/[^\s"'<>()\]\[【】]+/g;
export function parseBrowsed(json, host) {
  const m = json && Array.isArray(json.choices) && json.choices[0] ? json.choices[0].message : null;
  if (!m) return null;
  const text = String(m.content || "").replace(/【[^】]*】/g, "");
  const raw = JSON.stringify(m.executed_tools || []) + "\n" + text;
  const seen = new Set();
  const sources = [];
  for (const u of raw.match(URL_RE) || []) {
    const uri = u.replace(/[.,;:!?]+$/, "").replace(/\\+$/, "");
    let title = "";
    try { title = new URL(uri).hostname.replace(/^www\./, ""); } catch { continue; }
    if (seen.has(title)) continue;
    seen.add(title);
    sources.push({ title, uri: uri.slice(0, 500) });
  }
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const idx = h ? sources.findIndex((x) => x.title === h || x.title.endsWith("." + h)) : -1;
  const answer = one(text);
  const mentioned = !!h && (answer.toLowerCase().includes(h) || /gurugram vision forum/i.test(answer));
  return { answer: answer.length > 600 ? "…" + answer.slice(-599) : answer, sources: sources.slice(0, 10), cited: idx >= 0, position: idx >= 0 ? idx + 1 : null, mentioned };
}

export async function askGroq(env, question, fetchImpl, host) {
  const key = env.GROQ_API_KEY;
  let model = env.GEO_GROQ_MODEL || GEO_GROQ_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    try {
      const r = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, signal: ctrl.signal,
        body: JSON.stringify({ model, messages: [{ role: "user", content: question }], tools: [{ type: "browser_search" }], tool_choice: "required", reasoning_effort: "low", temperature: 0.2, max_completion_tokens: 2048 })
      });
      const j = await r.json().catch(() => null);
      const gone = r.status === 404 || (r.status === 400 && /decommission|model_not_found|does not exist/i.test(JSON.stringify((j && j.error) || "")));
      if (gone && attempt === 0) {
        const next = await discoverGroqModel(key, fetchImpl);
        if (next && next !== model) { model = next; continue; }
      }
      if (!r.ok) {
        const why = j && j.error && j.error.message ? `: ${one(j.error.message).slice(0, 160)}` : "";
        return { error: `groq_http_${r.status}${j && j.error && j.error.code ? `_${j.error.code}` : ""}${why}`, status: r.status, model };
      }
      const p = parseBrowsed(j, host);
      return p ? { ...p, model: (j && j.model) || model } : { error: "groq_empty", model };
    } catch (e) {
      return { error: String(e && e.name === "AbortError" ? "groq_timeout" : (e && e.message) || e).slice(0, 80), model };
    } finally { clearTimeout(timer); }
  }
  return { error: "groq_no_model", model };
}

export async function geoStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), limit = GEO_PER_RUN, budgetMs = GEO_BUDGET_MS, clock = Date.now } = {}) {
  const out = { asked: 0, cited: 0, failed: 0 };
  if (!env.GROQ_API_KEY) { out.skipped = "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  let host = ""; try { host = new URL(siteUrl(env)).host; } catch { host = ""; }
  const qs = geoQuestions();
  const { data, error } = await sb.from("seo_geo").select("question_key, engine, error, checked_at").order("checked_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`seo_geo select: ${error.message || error}`);
  const when = new Map();
  for (const r of data || []) {
    const t = Date.parse(r.checked_at) || 0;
    // Only a real Groq answer counts as asked, so a failed question goes first next time.
    if (r.engine === "groq-browser" && !r.error && !when.has(r.question_key)) when.set(r.question_key, t);
  }
  const tasks = qs.slice().sort((a, b) => (when.get(a.key) || 0) - (when.get(b.key) || 0)).slice(0, limit);
  const started = clock();
  let done = 0;
  for (const q of tasks) {
    if (done > 0 && clock() - started > budgetMs) { out.deferred = tasks.length - done; break; }
    done++;
    const engine = "groq-browser";
    const r = await askGroq(env, q.text, fetchImpl, host);
    // Groq's free plan allows about 8,000 tokens a minute and a web-search
    // answer uses most of them: a rate limit is not stored as a failure, the
    // rest of the questions wait for the next call (the workflow spaces its
    // calls a minute apart).
    if (r.status === 429) { out.stopped = "groq_rate_limit"; out.deferred = tasks.length - done; break; }
    const row = { question_key: q.key, question: q.text, issue: q.issue, engine, model: r.model || null, checked_at: new Date(now).toISOString() };
    if (r.error) { out.failed++; out.reason = r.error; Object.assign(row, { cited: null, error: r.error.slice(0, 240) }); }
    else { out.asked++; if (r.cited) out.cited++; Object.assign(row, { cited: r.cited, mentioned: r.mentioned, position: r.position, sources: r.sources, answer: r.answer }); }
    out.engine = engine;
    const { error: ie } = await sb.from("seo_geo").insert(row);
    if (ie) throw new Error(`seo_geo insert: ${ie.message || ie}`);
  }
  const { error: de } = await sb.from("seo_geo").delete().lt("checked_at", new Date(now - 180 * DAY).toISOString());
  if (de) console.error("seo_geo cleanup failed", de);
  return out;
}
