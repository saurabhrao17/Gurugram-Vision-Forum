#!/usr/bin/env node
// The website upkeep agent's guard: decides whether a change may go live
// without the owner. It reads the diff of the current branch against a base
// (default origin/main) and answers
//   { verdict: "auto" | "owner", reasons: [...], files, lines }
// and exits 0 for "auto", 2 for "owner". The agent runs it before merging,
// and QA runs it on every pull request from an upkeep/ branch: a change that
// needs the owner fails the check until the owner adds the label
// "owner-approved". The rules follow docs/upkeep-agent.md; the agent may not
// change this file or that document on its own (both are protected below).
//
// Usage: node scripts/upkeep-guard.mjs [base]   (prints JSON)
import { execFileSync } from "node:child_process";

export const MAX_FILES = 12;
export const MAX_LINES = 400;

// Paths a change may never touch without the owner, and why (plain words:
// these reasons are shown to the owner).
export const PROTECTED = [
  [/^supabase\//, "changes the database structure or its security rules"],
  [/^lib\/auth\.js$/, "changes who can sign in to the desk and what each role may see"],
  [/^lib\/supabase\.js$/, "changes how the site connects to the database"],
  [/^api\//, "changes the server's entry point"],
  [/^vercel\.json$/, "changes the site's security headers, addresses or schedules"],
  [/^\.github\/workflows\//, "changes the automatic jobs and how they use the site's secrets"],
  [/^package(-lock)?\.json$/, "adds or changes third-party software the site depends on"],
  [/^\.env/, "touches the list of secret keys"],
  [/^lib\/handlers\/(report|status|visitor|subscribe|join|hooks|cron|content|dashboard|ward|geocode)(\/|\.js$)/, "changes how residents' reports, registrations, subscriptions or scheduled jobs are handled"],
  [/^lib\/handlers\/triage\/(?!seo\.js$)/, "changes what the volunteer desk can read or change"],
  [/^lib\/(outbox|audience|newsletter|replies|inbound|social|brief|filing|notify)\.js$/, "changes how the site sends mail, messages or social posts, or handles replies from residents"],
  [/^docs\/upkeep-agent\.md$/, "changes the upkeep agent's own rules"],
  [/^scripts\/upkeep-guard\.mjs$/, "changes the upkeep agent's own safety check"],
  [/^CLAUDE\.md$/, "changes the project's standing rules"],
  [/^archive\//, "edits the archived builds, which are reference only"]
];

// Lines no change may add without the owner (tests may use fake data, so the
// personal-data checks skip tests/).
export const FORBIDDEN = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(ant|live|proj)-[A-Za-z0-9_-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}|service_role/, "adds something that looks like a secret key", false],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "adds an email address (the site shows no contact details)", true],
  [/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/, "adds a phone number (the site shows no contact details)", true],
  [/\b(BJP|Bharatiya Janata|Congress|INC|Aam Aadmi|AAP|JJP|INLD)\b/, "mentions a political party (public copy is non-partisan)", true],
  [/Content-Security-Policy/i, "changes the Content-Security-Policy", false],
  [/href="http:\/\//i, "adds a link that is not https", true],
  [/\bgate\b|GATE\s*[:=]|consent/i, "changes the visitor registration or consent wording (DPDP Act notice)", true],
  [/\bdelete\(\)|\.delete\(|drop table|truncate/i, "deletes stored data", true]
];

export function judge(files, addedByFile) {
  const reasons = [];
  const add = (r) => { if (!reasons.includes(r)) reasons.push(r); };
  for (const f of files) for (const [re, why] of PROTECTED) if (re.test(f)) add(`${f}: ${why}`);
  let lines = 0;
  for (const [f, added] of Object.entries(addedByFile)) {
    lines += added.length;
    const isTest = f.startsWith("tests/");
    for (const line of added) for (const [re, why, personal] of FORBIDDEN) if (!(personal && isTest) && re.test(line)) add(`${f}: ${why}`);
  }
  if (files.length > MAX_FILES) add(`${files.length} files changed; more than ${MAX_FILES} is too large to go live unseen`);
  if (lines > MAX_LINES) add(`${lines} lines added; more than ${MAX_LINES} is too large to go live unseen`);
  return { verdict: reasons.length ? "owner" : "auto", reasons, files: files.length, lines };
}

// Unified diff -> { file: [added lines] }
export function addedLines(diff) {
  const out = {};
  let cur = null;
  for (const line of String(diff || "").split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { cur = m[1]; out[cur] = out[cur] || []; continue; }
    if (line.startsWith("+++ /dev/null")) { cur = null; continue; }
    if (cur && line.startsWith("+") && !line.startsWith("+++")) out[cur].push(line.slice(1));
  }
  return out;
}

function main() {
  const base = process.argv[2] || "origin/main";
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const files = git("diff", "--name-only", mergeBase, "HEAD").split("\n").filter(Boolean);
  const result = judge(files, addedLines(git("diff", "--unified=0", mergeBase, "HEAD")));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "auto" ? 0 : 2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
