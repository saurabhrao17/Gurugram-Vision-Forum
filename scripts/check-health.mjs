// Production upkeep check: GET /api/health on the live site and fail when the
// database is down, the nightly cron has not run for 36 hours, or the last link
// run found broken official links. Run by the nightly QA workflow after the
// 00:00 IST cron; usage: node scripts/check-health.mjs https://gurugramvisionforum.org
const base = (process.argv[2] || "https://gurugramvisionforum.org").replace(/\/$/, "");
const url = `${base}/api/health`;
let res, body;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    res = await fetch(url, { headers: { "User-Agent": "GurugramVisionForumBot/1.0 (+https://gurugramvisionforum.org)" }, signal: AbortSignal.timeout(20000) });
    body = await res.json();
    break;
  } catch (e) {
    console.log(`attempt ${attempt}: ${e && e.message ? e.message : e}`);
    if (attempt === 3) { console.log(`FAIL: ${url} unreachable`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}
const c = body && body.checks ? body.checks : {};
const problems = [];
if (!c.db || !c.db.ok) problems.push("database check failed");
if (c.cron && c.cron.stale) problems.push(`daily cron stale (last run ${c.cron.last_run || "never"})`);
if (c.links && Array.isArray(c.links.broken) && c.links.broken.length) problems.push(`${c.links.broken.length} broken official link(s): ` + c.links.broken.map((l) => `${l.url} (${l.status || "no response"}${l.where_used ? ", " + l.where_used : ""})`).join("; "));
if (c.outbox && c.outbox.failed) problems.push(`${c.outbox.failed} failed mail(s) in the outbox`);
console.log(`health ${res.status}: db=${c.db && c.db.ok ? "ok" : "down"} cron=${c.cron ? (c.cron.stale ? "stale" : "fresh") : "?"} links=${c.links ? `${c.links.checked} checked, ${(c.links.broken || []).length} broken` : "?"} outbox=${c.outbox ? `${c.outbox.pending} pending, ${c.outbox.failed} failed` : "?"} version=${body && body.version || "?"}`);
if (problems.length) { console.log("FAIL:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("OK: the site, the database, the nightly cron and every official link are fine.");
