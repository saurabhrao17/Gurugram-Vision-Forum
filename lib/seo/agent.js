// The SEO agent: reads everything the nightly audit produced, keeps a task
// list from first seen to fixed, does the fixes it can do on its own during
// the day, and writes a timeline, a daily report and (on Mondays) the plan
// for the week. Cron step `agent`, called by .github/workflows/seo-agent.yml
// three times a day (IST): 09:00 plan, 13:00 work, 19:00 report. The
// workflow re-runs the steps the agent asks for, commits the reports to the
// seo-agent-log branch and keeps one GitHub issue listing the code fixes.
//
// Who acts on a task (owner):
//   auto   the agent does it: re-runs a failed step, re-audits the affected
//          pages to confirm a fix, pings IndexNow and resubmits the sitemap
//          for pages search engines do not know, and the topic pipeline
//          writes the content gaps;
//   wait   nothing to do but wait for Google, Bing or a quota; re-checked;
//   code   needs a change to the site's code or data; listed in the GitHub
//          issue "SEO agent: code fixes needed" and re-audited every day so
//          the fix is confirmed as soon as it is deployed;
//   person needs someone on the team (a key in Vercel, outreach, a held draft).
// Nothing about any report is ever read here.
import { ISSUE_TEXT, seoStep } from "./audit.js";
import { pingIndexNow } from "../indexnow.js";
import { readServiceAccount, gscSite, submitSitemap } from "./gsc.js";
import { siteUrl } from "./site.js";

export const OWNER_TEXT = { auto: "The agent handles it", wait: "Waiting on Google, Bing or a quota", code: "Needs a code change", person: "Needs a person" };
export const PHASES = ["plan", "work", "report"];
export const SCHEDULE_IST = { plan: "09:00", work: "13:00", report: "19:00" };
export const RETRY_STEPS = ["seo", "vitals", "mentions", "geo", "gsc", "bing", "topics", "news", "links", "signals", "insights"];
export const REAUDIT_MAX = 20;
export const INDEXNOW_MAX = 50;
export const REPO_URL = "https://github.com/saurabhrao17/Gurugram-Vision-Forum";
export const LOG_BRANCH = "seo-agent-log";
const DAY = 86400000;
const SEV = { error: "high", warn: "medium", info: "low" };
const RANK = { high: 0, medium: 1, low: 2 };

const IST_MS = 5.5 * 3600000;
export const istDay = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);
export const istTime = (iso) => new Date((Date.parse(iso) || 0) + IST_MS).toISOString().slice(11, 16);
export function isoWeekOf(dayStr) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const y = d.getUTCFullYear();
  const first = new Date(Date.UTC(y, 0, 4));
  const week = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}
const fmtDay = (dayStr) => new Date(`${dayStr}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const list = (xs, max = 6) => (xs.length > max ? xs.slice(0, max).join(", ") + ` and ${xs.length - max} more` : xs.join(", "));

// ---------------------------------------------------------------------------
// Findings: every problem the state shows, with who acts and what happens.
// state: loadSeoState() (lib/handlers/triage/seo.js).
// ---------------------------------------------------------------------------
const CODE_ACTION = "A change to the site's code or data. Listed in the GitHub issue \"SEO agent: code fixes needed\"; the agent re-audits these pages every day and closes the task as soon as the fix is live.";

export function findings(state) {
  const out = [];
  const add = (f) => out.push({ severity: "medium", owner: "auto", detail: "", action: "", data: {}, ...f });
  const s = state || {};

  // 1. On-page issues, grouped by kind.
  const groups = new Map();
  for (const p of s.pages || []) for (const i of p.issues || []) {
    const g = groups.get(i.code) || { code: i.code, level: i.level, paths: [] };
    if (RANK[SEV[i.level] || "low"] < RANK[SEV[g.level] || "low"]) g.level = i.level;
    if (!g.paths.includes(p.path)) g.paths.push(p.path);
    groups.set(i.code, g);
  }
  for (const g of groups.values()) {
    const status = g.code === "status";
    add({ key: `page:${g.code}`, area: "pages", severity: SEV[g.level] || "low", owner: status ? "auto" : "code",
      title: `${ISSUE_TEXT[g.code] || g.code} on ${plural(g.paths.length, "page")}`, detail: list(g.paths),
      action: status ? "Re-audit the pages today; a page still failing becomes a code fix." : CODE_ACTION, data: { paths: g.paths.slice(0, 200) } });
  }

  // 2. Internal links to missing pages, and orphans.
  for (const b of (s.crawl && s.crawl.broken) || []) {
    add({ key: `link:${b.url}`, area: "links", severity: "high", owner: "code", title: `Broken internal link: ${b.url} (HTTP ${b.status || "no answer"})`,
      detail: b.sources && b.sources.length ? `Linked from ${list(b.sources)}` : "No page links to it any more; it clears at the next crawl", action: b.sources && b.sources.length ? CODE_ACTION : "Nothing to fix: the link is gone; the next crawl clears it.", data: { paths: b.sources || [] } });
  }
  const orphans = (s.crawl && s.crawl.orphans) || [];
  if (orphans.length) add({ key: "link:orphans", area: "links", severity: "low", owner: "code", title: `${plural(orphans.length, "page")} no other page links to`, detail: list(orphans), action: CODE_ACTION, data: { paths: orphans } });

  // 3. Site-wide checks.
  for (const r of s.sitechecks || []) {
    if (r.key === "gsc_sitemap" && r.ok === false) add({ key: "site:gsc_sitemap", area: "index", severity: "medium", owner: "auto", title: "Google has not read the sitemap", detail: r.detail, action: "Resubmit the sitemap to Search Console today and check again tomorrow." });
    else if (r.key === "bing_crawl" && r.ok !== true) add({ key: "site:bing_crawl", area: "index", severity: "low", owner: "wait", title: r.ok === false ? "Bing reports crawl errors" : "Bing has not crawled the site yet", detail: r.detail, action: "IndexNow tells Bing about every new page; the agent re-checks Bing's crawl stats every night." });
    else if (r.ok === false) add({ key: `site:${r.key}`, area: "site", severity: "high", owner: "code", title: `Site check failing: ${r.key}`, detail: r.detail, action: CODE_ACTION });
  }

  // 4. Speed.
  const home = s.vitals && (s.vitals.latest || [])[0];
  for (const v of (s.vitals && s.vitals.latest) || []) {
    const slow = (v.performance != null && v.performance < 90) || (v.lcp_ms != null && v.lcp_ms > 2500);
    if (!slow) continue;
    let path = v.url; try { path = new URL(v.url).pathname; } catch { /* keep */ }
    add({ key: `speed:${path}`, area: "speed", severity: v.performance != null && v.performance < 50 ? "high" : "medium", owner: "code",
      title: `Mobile speed ${v.performance ?? "?"} on ${path}`, detail: `Largest paint ${v.lcp_ms != null ? (v.lcp_ms / 1000).toFixed(1) + " s" : "?"}, layout shift ${v.cls ?? "?"}, blocking ${v.tbt_ms ?? "?"} ms`, action: `${CODE_ACTION} PageSpeed re-measures it on its next turn in the rotation.`, data: { url: v.url } });
  }
  void home;

  // 5. Google's index.
  const idx = (s.index && s.index.rows) || [];
  const unknown = idx.filter((r) => r.verdict !== "PASS" && /unknown/i.test(r.coverage || ""));
  const notIndexed = idx.filter((r) => r.verdict !== "PASS" && !/unknown/i.test(r.coverage || ""));
  if (unknown.length) add({ key: "index:unknown", area: "index", severity: "medium", owner: "auto", title: `${plural(unknown.length, "page")} Google does not know yet`, detail: list(unknown.map((r) => pathOf(r.url))), action: "Ping IndexNow with these pages and resubmit the sitemap; Search Console re-inspects them in rotation.", data: { urls: unknown.map((r) => r.url) } });
  if (notIndexed.length) add({ key: "index:not_indexed", area: "index", severity: "medium", owner: "wait", title: `${plural(notIndexed.length, "page")} known to Google but not indexed`, detail: notIndexed.map((r) => `${pathOf(r.url)} (${r.coverage || r.verdict})`).slice(0, 6).join("; "), action: "Google decides; the pages stay linked from the guides and the sitemap, and are re-inspected in rotation.", data: { urls: notIndexed.map((r) => r.url) } });

  // 6. AI answers.
  const qs = (s.geo && s.geo.questions) || [];
  const errs = qs.filter((q) => q.error);
  if (errs.length) {
    const quota = errs.some((q) => /429|RESOURCE_EXHAUSTED|quota/i.test(q.error));
    add({ key: "geo:error", area: "geo", severity: "low", owner: quota ? "wait" : "code", title: `The AI answer check failed for ${plural(errs.length, "question")}`, detail: errs[0].error, action: quota ? "Google's free quota refused the call; the check runs again tonight. If it keeps failing, the key's free tier does not include Search grounding." : CODE_ACTION });
  }
  const notCited = qs.filter((q) => q.cited === false);
  if (notCited.length) add({ key: "geo:not_cited", area: "geo", severity: "low", owner: "auto", title: `Not cited by the AI engine for ${plural(notCited.length, "question")}`, detail: list(notCited.map((q) => q.issue || q.key)), action: "The topic pipeline adds fresh, sourced posts on these topics; the questions are asked again in rotation." });

  // 7. Content clusters (the topic pipeline).
  for (const c of s.clusters || []) {
    const a = c.auto || {};
    if (a.state === "queued") add({ key: `cluster:${c.id}`, area: "content", severity: c.demand >= 10 ? "medium" : "low", owner: "auto", title: `No post on ${c.label} (${plural(c.demand, "public post")} in 14 days)`, detail: `Queue position ${a.position}`, action: `The topic pipeline drafts it ${a.eta_days ? `in about ${a.eta_days} days` : "within the week"} and publishes it after the review window.` });
    else if (a.state === "draft") add({ key: `cluster:${c.id}`, area: "content", severity: "low", owner: "auto", title: `Post on ${c.label} drafted`, detail: a.publish_at ? `Publishes ${a.publish_at.slice(0, 16).replace("T", " ")} UTC` : "Waits to be published by hand", action: "Publishes itself after the review window unless someone holds it." });
    else if (a.state === "held") add({ key: `cluster:${c.id}`, area: "content", severity: "medium", owner: "person", title: `Post on ${c.label} is held`, detail: a.slug || "", action: "Someone on the team releases or edits the held draft in Content." });
    else if (a.state === "off") add({ key: `cluster:${c.id}`, area: "content", severity: "low", owner: "person", title: `No post on ${c.label}, and topic posts are switched off`, detail: "", action: "Turn topic posts on in Content, Settings." });
  }

  // 8. Cron steps that failed on their last run.
  for (const [step, e] of Object.entries(s.run_errors || {})) {
    const retry = RETRY_STEPS.includes(step);
    add({ key: `ops:${step}`, area: "ops", severity: "high", owner: retry ? "auto" : "code", title: `The ${step} step failed on its last run`, detail: e.error, action: retry ? "Re-run the step today; if it fails again it stays open with the error." : CODE_ACTION, data: { step } });
  }

  // 9. Connections a person adds in Vercel.
  const CONN = { gsc: "GSC_SERVICE_ACCOUNT", bing: "BING_WEBMASTER_API_KEY", gemini: "GEMINI_API_KEY", pagespeed: "PAGESPEED_API_KEY" };
  for (const [k, envName] of Object.entries(CONN)) if (s.connections && s.connections[k] === false) add({ key: `conn:${k}`, area: "setup", severity: "medium", owner: "person", title: `${envName} is not set`, detail: "", action: `Add ${envName} in Vercel (Settings, Environment Variables) and redeploy.` });

  // 10. Search data: queries on page two, and page-one results nobody clicks.
  const g = s.search && s.search.google;
  if (g) {
    const striking = (g.queries || []).filter((q) => q.position >= 8 && q.position <= 20 && q.impressions >= 10);
    if (striking.length) add({ key: "search:striking", area: "search", severity: "low", owner: "auto", title: `${plural(striking.length, "search")} just off page one`, detail: list(striking.map((q) => `"${q.key}" (#${Math.round(q.position)})`)), action: "The topic pipeline and the guides' fresh dates lift these; watched daily." });
    const lowCtr = (g.pages || []).filter((p) => p.position <= 5 && p.impressions >= 50 && p.ctr != null && p.ctr < 0.02);
    if (lowCtr.length) add({ key: "search:low_ctr", area: "search", severity: "medium", owner: "code", title: `${plural(lowCtr.length, "page")} on page one that few people click`, detail: list(lowCtr.map((p) => p.key)), action: `A sharper title and description for these pages. ${CODE_ACTION}`, data: { paths: lowCtr.map((p) => p.key) } });
  }

  // 11. Checklist items no finding above covers.
  const COVERED = new Set(["https", "mobile", "titles", "canonical", "hreflang", "schema", "og", "sitemap", "robots", "vitals", "thin", "headers", "one_address", "schema_complete", "internal_links", "orphans", "clusters", "llms", "ai_bots", "ai_cited", "indexed", "gsc_data", "bing_data"]);
  const PERSON = { gsc: "Verify the site in Google Search Console and tick it on the SEO tab.", bing: "Verify the site in Bing Webmaster Tools and tick it on the SEO tab.", content: "Turn the weekly round-up on in Content, Settings.", mentions: "Outreach: local newspapers and RWAs writing about the Forum; every mention is a link." };
  for (const c of s.checklist || []) {
    if (c.ok !== false || COVERED.has(c.key)) continue;
    const owner = PERSON[c.key] ? "person" : c.key === "indexnow" ? "person" : "code";
    add({ key: `check:${c.key}`, area: "site", severity: c.key === "mentions" ? "low" : "medium", owner, title: c.title, detail: c.detail || "", action: PERSON[c.key] || (c.key === "indexnow" ? "Set INDEXNOW_KEY in Vercel and keep IndexNow on in Content, Settings." : CODE_ACTION) });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.key.localeCompare(b.key));
}

function pathOf(u) { try { return new URL(u).pathname; } catch { return String(u || ""); } }

// ---------------------------------------------------------------------------
// Reconcile the findings with the stored tasks.
// ---------------------------------------------------------------------------
export function reconcile(current, tasks, nowIso) {
  const byKey = new Map((tasks || []).map((t) => [t.key, t]));
  const seen = new Set(current.map((f) => f.key));
  const upserts = [], opened = [], fixed = [], open = [];
  for (const f of current) {
    const t = byKey.get(f.key);
    const base = { key: f.key, area: f.area, severity: f.severity, owner: f.owner, title: f.title, detail: f.detail || null, action: f.action || null, data: f.data || {}, status: "open", last_seen: nowIso };
    if (!t || t.status === "fixed") { const row = { ...base, first_seen: nowIso, resolved_at: null, last_action_at: null, last_result: null }; upserts.push(row); opened.push(row); open.push(row); }
    else { const row = { ...base, first_seen: t.first_seen, resolved_at: null, last_action_at: t.last_action_at || null, last_result: t.last_result || null }; upserts.push(row); open.push(row); }
  }
  for (const t of tasks || []) if (t.status === "open" && !seen.has(t.key)) { const row = { ...t, status: "fixed", resolved_at: nowIso }; upserts.push(row); fixed.push(row); }
  return { upserts, opened, fixed, open };
}

export const countBy = (tasks) => tasks.reduce((m, t) => { m[t.owner] = (m[t.owner] || 0) + 1; return m; }, { auto: 0, wait: 0, code: 0, person: 0 });

// ---------------------------------------------------------------------------
// Reports (Markdown for GitHub; the desk renders the same text).
// ---------------------------------------------------------------------------
function taskLines(tasks) {
  return tasks.map((t) => `- **${t.title}**${t.detail ? ` — ${t.detail}` : ""}\n  ${t.action || ""}${t.last_result ? `\n  Last action: ${t.last_result}` : ""}`).join("\n");
}

export function headline(state) {
  const s = state || {};
  const sum = s.summary || {};
  const home = s.vitals && (s.vitals.latest || [])[0];
  const parts = [];
  if (sum.pages != null) parts.push(`${sum.audited ?? sum.pages} pages audited, average score ${sum.avg_score ?? "?"}`);
  if (s.index && s.index.total) parts.push(`${s.index.indexed} of ${s.index.total} inspected pages indexed by Google`);
  if (home && home.performance != null) parts.push(`mobile speed ${home.performance}`);
  const g = s.search && s.search.google;
  if (g && g.totals) parts.push(`${g.totals.clicks} Google clicks and ${g.totals.impressions} impressions in 28 days`);
  if (s.geo && s.geo.asked) parts.push(`cited in ${s.geo.cited} of ${s.geo.asked} AI answers`);
  return parts.join(" · ");
}

export function dailyMarkdown({ day, state, log, fixed, opened, open, issueUrl = null }) {
  const by = (o) => open.filter((t) => t.owner === o);
  const c = countBy(open);
  const lines = [
    `# SEO agent: daily report, ${fmtDay(day)}`, "",
    headline(state) || "No audit data yet.", "",
    `**Fixed today:** ${fixed.length} · **New today:** ${opened.length} · **Still open:** ${open.length} (${c.auto} the agent handles, ${c.wait} waiting on search engines, ${c.code} need code, ${c.person} need a person)`, "",
    "## Timeline (IST)", "",
    (log || []).length ? log.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).map((l) => `- ${istTime(l.at)} ${l.ok === false ? "⚠️ " : ""}${l.text}`).join("\n") : "- Nothing logged today.", "",
    `## Fixed today (${fixed.length})`, "",
    fixed.length ? fixed.map((t) => `- ${t.title}`).join("\n") : "- Nothing closed today.", "",
    `## New today (${opened.length})`, "",
    opened.length ? opened.map((t) => `- ${t.title}`).join("\n") : "- Nothing new.", "",
    `## Still open (${open.length})`, ""
  ];
  for (const o of ["auto", "wait", "code", "person"]) {
    const ts = by(o);
    if (!ts.length) continue;
    lines.push(`### ${OWNER_TEXT[o]} (${ts.length})${o === "code" && issueUrl ? ` · [GitHub issue](${issueUrl})` : ""}`, "", taskLines(ts), "");
  }
  lines.push("## Tomorrow", "", "- 00:00 IST: official links, news, page audit (40 pages) and mentions.", "- 03:00 IST: audit, speed, AI answers, Search Console, Bing, then the topic pipeline drafts the next topic.", "- 08:00 IST: pulse, round-up, publishing of due drafts, digest, IndexNow.", `- ${SCHEDULE_IST.plan}, ${SCHEDULE_IST.work} and ${SCHEDULE_IST.report} IST: the agent plans, works the open tasks and reports.`, "");
  return lines.join("\n");
}

export function weeklyMarkdown({ week, day, state, open, lastWeek = null }) {
  const by = (o) => open.filter((t) => t.owner === o);
  const queued = (state.clusters || []).filter((c) => c.auto && c.auto.state === "queued").sort((a, b) => a.auto.position - b.auto.position);
  const perWeek = (state.topics && state.topics.per_week) || 3;
  const lines = [
    `# SEO agent: plan for ${week} (from ${fmtDay(day)})`, "",
    headline(state) || "No audit data yet.", ""
  ];
  if (lastWeek) lines.push("## Last week", "", `- Fixed: ${lastWeek.fixed} · New: ${lastWeek.opened} · Open at the end: ${lastWeek.open}`, "");
  lines.push("## This week", "");
  lines.push(`### Content (topic pipeline, up to ${perWeek} posts)`, "", queued.length ? queued.slice(0, perWeek).map((c, i) => `${i + 1}. ${c.label}: ${plural(c.demand, "public post")} in 14 days`).join("\n") + (queued.length > perWeek ? `\n\nThen: ${queued.slice(perWeek).map((c) => c.label).join(", ")}.` : "") : "- Every topic people discuss is covered.", "");
  for (const o of ["auto", "wait", "code", "person"]) {
    const ts = by(o).filter((t) => !t.key.startsWith("cluster:"));
    if (!ts.length) continue;
    lines.push(`### ${OWNER_TEXT[o]} (${ts.length})`, "", ts.map((t) => `- **${t.title}** — ${t.action || ""}`).join("\n"), "");
  }
  lines.push("### Every day", "", "- Audit 40 pages a night (each page every few days), crawl internal links, check robots, sitemap, llms.txt, headers and redirects.", "- One PageSpeed run, three AI answer checks, Search Console and Bing data, ten URL inspections.", "- Re-audit the pages of every open code task to confirm fixes the day they deploy.", "");
  return lines.join("\n");
}

export function issueMarkdown(codeTasks, day) {
  if (!codeTasks.length) return "";
  return [`The SEO agent found these problems that need a change to the site's code or data (updated ${fmtDay(day)}). Each closes on its own once the agent's re-audit sees it fixed.`, "", ...codeTasks.map((t) => `- [ ] **${t.title}**${t.detail ? `\n  ${t.detail}` : ""}${t.data && t.data.paths && t.data.paths.length ? `\n  Pages: ${t.data.paths.slice(0, 10).join(", ")}` : ""}`), "", `Daily reports: ${REPO_URL}/tree/${LOG_BRANCH}`].join("\n");
}

// ---------------------------------------------------------------------------
// The step.
// deps: { fetch, now, phase, loadState } where loadState(sb, env) returns
// the SEO state (injected to keep this module free of the handler).
// ---------------------------------------------------------------------------
export async function agentStep(sb, env, { fetch: fetchImpl = null, now = Date.now(), phase = "work", loadState = null, posts = null } = {}) {
  const out = { phase, open: 0, opened: 0, fixed: 0, actions: 0, retry: [] };
  if (!PHASES.includes(phase)) phase = out.phase = "work";
  if (!loadState) { out.skipped = "no_state"; return out; }
  const day = istDay(now);
  const nowIso = new Date(now).toISOString();
  const logRows = [];
  const log = (kind, text, extra = {}) => logRows.push({ at: new Date(now + logRows.length).toISOString(), day, phase, kind, text, ok: extra.ok ?? null, task_key: extra.task || null, data: extra.data || {} });

  // 1. Read everything and reconcile.
  let state = await loadState(sb, env);
  const { data: taskRows, error: te } = await sb.from("seo_tasks").select("*").limit(2000);
  if (te) throw new Error(`seo_tasks select: ${te.message || te}`);
  let rec = reconcile(findings(state), taskRows || [], nowIso);

  // 2. Act (each task at most once a phase; the cheap fixes every phase).
  const acted = new Map();
  if (fetchImpl) {
    // Re-run failed steps (the workflow calls them after this answer).
    for (const t of rec.open.filter((x) => x.key.startsWith("ops:") && x.owner === "auto")) {
      out.retry.push(t.data.step);
      acted.set(t.key, `Re-running the ${t.data.step} step`);
      log("action", `Re-running the ${t.data.step} step that failed: ${t.detail || "error"}`, { task: t.key });
    }
    // Re-audit the pages behind open page, link and speed tasks.
    const paths = [...new Set(rec.open.filter((x) => (x.key.startsWith("page:") || x.key.startsWith("link:")) && x.data && x.data.paths).flatMap((x) => x.data.paths))].slice(0, REAUDIT_MAX);
    if (paths.length) {
      try {
        const r = await seoStep(sb, env, { fetch: fetchImpl, now, posts: posts || [], only: paths, limit: REAUDIT_MAX });
        log("action", `Re-audited ${plural(r.checked, "page")} behind the open tasks (average score ${r.avg_score ?? "?"})`, { ok: true, data: { paths } });
        state = await loadState(sb, env);
        rec = reconcile(findings(state), taskRows || [], nowIso);
      } catch (e) { log("action", `Re-audit failed: ${String(e.message || e).slice(0, 120)}`, { ok: false }); }
    }
    // IndexNow for pages Google does not know (once a day).
    const unknown = rec.open.find((x) => x.key === "index:unknown");
    const urls = unknown && unknown.data && unknown.data.urls ? unknown.data.urls.slice(0, INDEXNOW_MAX) : [];
    if (urls.length && !sameDay(unknown.last_action_at, now)) {
      const r = await pingIndexNow(env, urls, fetchImpl).catch((e) => ({ ok: false, skipped: String(e.message || e) }));
      const text = r.ok ? `Pinged IndexNow (Bing and others) with ${plural(r.count, "page")} Google does not know yet` : `IndexNow ping not sent (${r.skipped || "HTTP " + r.status})`;
      acted.set(unknown.key, text);
      log("action", text, { ok: !!r.ok, task: unknown.key });
    }
    // Resubmit the sitemap to Search Console (once a day while Google has not read it).
    const smTask = rec.open.find((x) => x.key === "site:gsc_sitemap");
    const sm = smTask ? (!sameDay(smTask.last_action_at, now) ? smTask : null) : (unknown && !sameDay(unknown.last_action_at, now) ? unknown : null);
    if (sm && readServiceAccount(env)) {
      const r = await submitSitemap(env, fetchImpl, now).catch((e) => ({ ok: false, error: String(e.message || e).slice(0, 160) }));
      const text = r.ok ? `Resubmitted ${r.sitemap} to Google Search Console` : `Sitemap resubmission failed: ${r.error}`;
      acted.set("site:gsc_sitemap", text);
      acted.set("sitemap", true);
      log("action", text, { ok: !!r.ok, task: "site:gsc_sitemap" });
    }
  }

  // 3. Store tasks.
  for (const row of rec.upserts) {
    const a = acted.get(row.key);
    if (typeof a === "string") { row.last_action_at = nowIso; row.last_result = a; }
  }
  if (rec.upserts.length) {
    const { error } = await sb.from("seo_tasks").upsert(rec.upserts, { onConflict: "key" });
    if (error) throw new Error(`seo_tasks upsert: ${error.message || error}`);
  }
  for (const t of rec.fixed) log("check", `Fixed: ${t.title}`, { ok: true, task: t.key });
  for (const t of rec.opened) log("check", `New: ${t.title} (${OWNER_TEXT[t.owner].toLowerCase()})`, { task: t.key });
  const c = countBy(rec.open);
  if (phase === "plan") log("plan", `Plan for today: ${plural(rec.open.length, "open task")}: ${c.auto} the agent handles, ${c.wait} waiting on search engines, ${c.code} need a code change, ${c.person} need a person`);
  else log("check", `${phase === "report" ? "End of day" : "Midday"} check: ${plural(rec.open.length, "open task")} (${c.auto} agent, ${c.wait} waiting, ${c.code} code, ${c.person} person)`);
  Object.assign(out, { open: rec.open.length, opened: rec.opened.length, fixed: rec.fixed.length, actions: [...acted.values()].filter((v) => typeof v === "string").length, by_owner: c });

  // 4. Reports.
  const codeTasks = rec.open.filter((t) => t.owner === "code");
  out.issue_md = issueMarkdown(codeTasks, day);
  out.issue_title = "SEO agent: code fixes needed";
  if (phase === "report" || phase === "plan") {
    const { data: todays } = await sb.from("seo_agent_log").select("at, kind, text, ok").eq("day", day).order("at", { ascending: true }).limit(500);
    const { data: allTasks } = await sb.from("seo_tasks").select("key, title, status, first_seen, resolved_at").limit(3000);
    const startIso = new Date(Date.parse(`${day}T00:00:00Z`) - 5.5 * 3600000).toISOString();
    const fixedToday = (allTasks || []).filter((t) => t.status === "fixed" && t.resolved_at && t.resolved_at >= startIso).concat(rec.fixed.filter((t) => !(allTasks || []).some((x) => x.key === t.key && x.status === "fixed")));
    const openedToday = rec.open.filter((t) => t.first_seen >= startIso);
    if (phase === "report") {
      const md = dailyMarkdown({ day, state, log: (todays || []).concat(logRows), fixed: fixedToday, opened: openedToday, open: rec.open });
      const summary = { headline: headline(state), fixed: fixedToday.length, opened: openedToday.length, open: rec.open.length, by_owner: c };
      const { error } = await sb.from("seo_agent_reports").upsert({ id: `daily:${day}`, kind: "daily", day, summary, markdown: md, created_at: nowIso }, { onConflict: "id" });
      if (error) throw new Error(`seo_agent_reports upsert: ${error.message || error}`);
      log("report", `Daily report written: ${fixedToday.length} fixed, ${openedToday.length} new, ${rec.open.length} open`);
      out.report = { id: `daily:${day}`, path: `daily/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.md` };
      out.report_md = md;
    }
    if (phase === "plan" && (new Date(now + 5.5 * 3600000).getUTCDay() === 1 || !(await hasWeekly(sb, isoWeekOf(day))))) {
      const week = isoWeekOf(day);
      const prevDay = new Date(Date.parse(`${day}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
      const { data: prevDaily } = await sb.from("seo_agent_reports").select("summary, day").eq("kind", "daily").gte("day", prevDay).lt("day", day).order("day", { ascending: false }).limit(7);
      const lastWeek = (prevDaily || []).length ? { fixed: prevDaily.reduce((n, r) => n + ((r.summary && r.summary.fixed) || 0), 0), opened: prevDaily.reduce((n, r) => n + ((r.summary && r.summary.opened) || 0), 0), open: (prevDaily[0].summary && prevDaily[0].summary.open) || 0 } : null;
      const md = weeklyMarkdown({ week, day, state, open: rec.open, lastWeek });
      const { error } = await sb.from("seo_agent_reports").upsert({ id: `weekly:${week}`, kind: "weekly", day, summary: { headline: headline(state), open: rec.open.length, by_owner: c, last_week: lastWeek }, markdown: md, created_at: nowIso }, { onConflict: "id" });
      if (error) throw new Error(`seo_agent_reports upsert: ${error.message || error}`);
      log("plan", `Weekly plan for ${week} written`);
      out.weekly = { id: `weekly:${week}`, path: `weekly/${week}.md` };
      out.weekly_md = md;
    }
  }

  // 5. Timeline: the plan first, then what was done, then what was found.
  const ORDER = { plan: 0, action: 1, check: 2, report: 3 };
  logRows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).forEach((r, i) => { r.at = new Date(now + i).toISOString(); });
  if (logRows.length) {
    const { error } = await sb.from("seo_agent_log").insert(logRows);
    if (error) throw new Error(`seo_agent_log insert: ${error.message || error}`);
  }
  const { error: ce } = await sb.from("seo_agent_log").delete().lt("day", new Date(now - 120 * DAY).toISOString().slice(0, 10));
  if (ce) console.error("seo_agent_log cleanup failed", ce);
  return out;
}

const sameDay = (iso, now) => !!iso && istDay(Date.parse(iso)) === istDay(now);
async function hasWeekly(sb, week) {
  const { data } = await sb.from("seo_agent_reports").select("id").eq("id", `weekly:${week}`).limit(1);
  return !!(data && data.length);
}

// What the desk shows: open tasks, those fixed in the last week, the last
// three days of the timeline and the reports of the last two weeks.
export async function agentView(sb, { now = Date.now() } = {}) {
  const since = new Date(now - 7 * DAY).toISOString();
  const [tasks, logRows, reports] = await Promise.all([
    sb.from("seo_tasks").select("key, area, severity, owner, title, detail, action, status, first_seen, last_seen, resolved_at, last_action_at, last_result").limit(2000),
    sb.from("seo_agent_log").select("at, day, phase, kind, task_key, text, ok").gte("day", new Date(now - 3 * DAY).toISOString().slice(0, 10)).order("at", { ascending: false }).limit(300),
    sb.from("seo_agent_reports").select("id, kind, day, summary, markdown, created_at").order("day", { ascending: false }).limit(20)
  ]);
  for (const r of [tasks, logRows, reports]) if (r.error) throw r.error;
  const all = tasks.data || [];
  return {
    open: all.filter((t) => t.status === "open").sort((a, b) => RANK[a.severity] - RANK[b.severity] || String(a.first_seen).localeCompare(String(b.first_seen))),
    fixed: all.filter((t) => t.status === "fixed" && t.resolved_at && t.resolved_at >= since).sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at))),
    log: logRows.data || [],
    reports: reports.data || [],
    schedule: SCHEDULE_IST,
    repo: `${REPO_URL}/tree/${LOG_BRANCH}`,
    last_run: (logRows.data || [])[0] ? (logRows.data || [])[0].at : null
  };
}
