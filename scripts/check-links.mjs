#!/usr/bin/env node
// Checks every external URL the site publishes (collected from site/data.js)
// with real HTTP requests, prints a table and exits 1 when any link is broken.
// Run: node scripts/check-links.mjs [--concurrency=5] [--timeout=10000] [--json]
import { collectLinks, checkLinks } from "../lib/link-check.js";

const arg = (name, def) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : def;
};
const concurrency = Math.max(1, parseInt(arg("concurrency", "5"), 10) || 5);
const timeoutMs = Math.max(1000, parseInt(arg("timeout", "10000"), 10) || 10000);
const asJson = process.argv.includes("--json");

const links = await collectLinks();
console.error(`Checking ${links.length} links (concurrency ${concurrency}, timeout ${timeoutMs} ms)...`);
const results = await checkLinks(links, fetch, { concurrency, timeoutMs });
results.sort((a, b) => Number(a.ok) - Number(b.ok) || a.url.localeCompare(b.url));
const broken = results.filter((r) => !r.ok);

if (asJson) {
  console.log(JSON.stringify({ checked: results.length, broken: broken.length, results }, null, 2));
} else {
  const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  const w = Math.min(90, Math.max(...results.map((r) => r.url.length), 10));
  console.log(`${pad("STATUS", 7)} ${pad("URL", w)} WHERE USED`);
  for (const r of results) {
    const status = r.ok ? `ok ${r.status}` : (r.status ? `FAIL ${r.status}` : `FAIL ${r.error || "?"}`);
    console.log(`${pad(status, 7)} ${pad(r.url, w)} ${r.where_used || ""}`);
  }
  console.log("");
  console.log(`${results.length} checked, ${broken.length} broken`);
  if (broken.length) {
    console.log("");
    console.log("Broken links:");
    for (const r of broken) console.log(`- ${r.url} (${r.status ? `HTTP ${r.status}` : r.error || "no response"}), used in ${r.where_used || "?"}`);
  }
}
process.exit(broken.length ? 1 : 0);
