// Generative Engine Optimization (GEO): making the Forum's public pages the
// source AI answer engines (Google AI Overviews and Gemini, ChatGPT search,
// Perplexity, Copilot, Claude) read and cite when residents ask who fixes a
// civic problem in Gurugram. Three parts, all automatic:
//   - /llms.txt and /llms-full.txt (buildLlms, buildLlmsFull): a plain
//     Markdown map of the site and the full text of every guide, the
//     emerging convention for giving language models a clean copy; built on
//     request from site/data.js and the published posts.
//   - site/robots.txt names the AI crawlers and lets them read every public
//     page (the desk and /api stay closed); the audit checks it nightly.
//   - geoStep (cron step `geo`): a handful of the questions residents ask
//     each night, put to Gemini with Google Search grounding, recording
//     whether the answer cites gurugramvisionforum.org (table seo_geo). The
//     free Gemini key the desk already uses; skipped without it.
// The per-page GEO readiness score lives in audit.js (geoChecks).
import { gvf } from "../site-data.js";
import { siteUrl, WARD_COUNT } from "./site.js";
import { faqFor } from "./guides.js";
import { clustersOf } from "./clusters.js";
import { GEMINI_LATEST, discoverGeminiModel } from "../ai.js";

export const GEO_PER_RUN = 3;
export const GEO_MODEL = GEMINI_LATEST;
export const GEO_TIMEOUT_MS = 25000;
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

// Gemini with Google Search grounding: the answer and the web sources it
// used. groundingChunks carry a redirect URI and the source's domain as the
// title, so a citation is matched on either.
export function parseGrounded(json, host) {
  const c = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (!c) return null;
  const text = ((c.content && c.content.parts) || []).map((p) => p && p.text).filter(Boolean).join("\n");
  const chunks = ((c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).map((g) => g && g.web).filter(Boolean);
  const h = String(host || "").toLowerCase();
  const sources = chunks.map((w) => ({ title: one(w.title).slice(0, 120), uri: String(w.uri || "").slice(0, 500) }));
  const idx = sources.findIndex((s) => s.title.toLowerCase().includes(h) || s.uri.toLowerCase().includes(h));
  const mentioned = !!h && (text.toLowerCase().includes(h) || /gurugram vision forum/i.test(text));
  return { answer: one(text).slice(0, 600), sources: sources.slice(0, 10), cited: idx >= 0, position: idx >= 0 ? idx + 1 : null, mentioned };
}

export async function askGemini(env, question, fetchImpl, host) {
  const key = env.GEMINI_API_KEY;
  const models = [env.GEO_MODEL || GEO_MODEL, GEO_MODEL];
  let last = { error: "no_model" };
  for (let i = 0; i < models.length + 1; i++) {
    // After the configured names, the newest Flash model the key can see.
    const model = i < models.length ? models[i] : await discoverGeminiModel(key, fetchImpl);
    if (!model || models.slice(0, i).includes(model)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    try {
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: question }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 700 } })
      });
      const j = await r.json().catch(() => null);
      if (r.status === 404) { last = { error: `model_${model}_not_found` }; continue; }
      if (!r.ok) return { error: `http_${r.status}${j && j.error && j.error.status ? `_${j.error.status}` : ""}`, model };
      const p = parseGrounded(j, host);
      return p ? { ...p, model } : { error: "empty", model };
    } catch (e) {
      last = { error: String(e && e.name === "AbortError" ? "timeout" : (e && e.message) || e).slice(0, 80) };
    } finally { clearTimeout(timer); }
  }
  return last;
}

export async function geoStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), limit = GEO_PER_RUN } = {}) {
  const out = { asked: 0, cited: 0, failed: 0 };
  if (!env.GEMINI_API_KEY) { out.skipped = "no_key"; return out; }
  if (!fetchImpl) { out.skipped = "no_fetch"; return out; }
  let host = ""; try { host = new URL(siteUrl(env)).host; } catch { host = ""; }
  const qs = geoQuestions();
  const { data, error } = await sb.from("seo_geo").select("question_key, checked_at").order("checked_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`seo_geo select: ${error.message || error}`);
  const when = new Map();
  for (const r of data || []) if (!when.has(r.question_key)) when.set(r.question_key, Date.parse(r.checked_at) || 0);
  const queue = qs.slice().sort((a, b) => (when.get(a.key) || 0) - (when.get(b.key) || 0)).slice(0, limit);
  for (const q of queue) {
    const r = await askGemini(env, q.text, fetchImpl, host);
    const row = { question_key: q.key, question: q.text, issue: q.issue, engine: "gemini-search", model: r.model || null, checked_at: new Date(now).toISOString() };
    if (r.error) { out.failed++; out.reason = r.error; Object.assign(row, { cited: null, error: r.error }); }
    else { out.asked++; if (r.cited) out.cited++; Object.assign(row, { cited: r.cited, mentioned: r.mentioned, position: r.position, sources: r.sources, answer: r.answer }); }
    const { error: ie } = await sb.from("seo_geo").insert(row);
    if (ie) throw new Error(`seo_geo insert: ${ie.message || ie}`);
  }
  const { error: de } = await sb.from("seo_geo").delete().lt("checked_at", new Date(now - 180 * DAY).toISOString());
  if (de) console.error("seo_geo cleanup failed", de);
  return out;
}
