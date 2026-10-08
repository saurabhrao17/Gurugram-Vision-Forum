import test from "node:test";
import assert from "node:assert/strict";
import { runDaily, parseSteps, STEP_GROUPS, STEP_NAMES } from "../../lib/handlers/cron.js";
import { fetchSources } from "../../lib/news-fetch.js";

// Minimal fake Supabase: every query resolves to an empty result.
function fakeSb() {
  const chain = () => {
    const c = { then(r) { r({ data: [], error: null, count: 0 }); } };
    for (const m of ["select", "eq", "in", "gte", "lte", "lt", "not", "is", "or", "order", "limit", "range", "insert", "upsert", "update", "delete", "contains", "like"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: null, error: null });
    c.single = async () => ({ data: { id: 1 }, error: null });
    return c;
  };
  return { from: () => chain(), rpc: async () => ({ data: null, error: null }), storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) } };
}

test("parseSteps keeps known step names and rejects the rest", () => {
  assert.deepEqual(parseSteps("news, links,bogus"), ["news", "links"]);
  assert.equal(parseSteps("bogus"), null);
  assert.equal(parseSteps(""), null);
  assert.deepEqual([...new Set([...STEP_GROUPS.fetch, ...STEP_GROUPS.analyse, ...STEP_GROUPS.seo])].sort(), [...STEP_NAMES].sort());
  assert.deepEqual(STEP_GROUPS.fetch, ["news", "links", "seo", "mentions"], "the quick SEO steps ride the midnight fetch run");
  assert.ok(!STEP_GROUPS.analyse.includes("vitals") && !STEP_GROUPS.fetch.includes("vitals"), "PageSpeed only runs from the workflow");
});

test("runDaily with `only` runs those steps and marks the rest as not in the run", async () => {
  const r = await runDaily(fakeSb(), {}, {}, { only: ["retention"] });
  assert.deepEqual(r.steps, ["retention"]);
  assert.equal(r.news.skipped, "not_in_run");
  assert.equal(r.signals.skipped, "not_in_run");
  assert.ok("deleted" in r.retention, "retention ran");
});

test("fetchSources fetches every source at once, not one after another", async () => {
  const started = [];
  const fetchImpl = () => new Promise((resolve) => {
    started.push(Date.now());
    setTimeout(() => resolve({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "<ul><li><a href='/a'>Notice about water supply schedule</a></li></ul>" }), 40);
  });
  const sources = [1, 2, 3].map((n) => ({ id: "s" + n, url: "https://x.gov.in/" + n, type: "html", selector: "ul li a" }));
  const t0 = Date.now();
  const out = await fetchSources(sources, fetchImpl);
  assert.equal(out.length, 3);
  assert.ok(Date.now() - t0 < 110, "three 40 ms fetches finished in parallel");
  assert.ok(Math.max(...started) - Math.min(...started) < 30, "all three started together");
});
