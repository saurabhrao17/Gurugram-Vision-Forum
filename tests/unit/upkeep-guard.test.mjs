import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge, addedLines, MAX_FILES, MAX_LINES } from "../../scripts/upkeep-guard.mjs";

test("upkeep guard: an ordinary SEO template fix may go live without the owner", () => {
  const r = judge(["lib/seo/guides.js", "tests/unit/seo.test.mjs"], { "lib/seo/guides.js": ["  return t(\"{label} in Gurugram\", lang);"], "tests/unit/seo.test.mjs": ["assert.equal(x, \"owner@example.com\");"] });
  assert.deepEqual(r, { verdict: "auto", reasons: [], files: 2, lines: 2 });
});

test("upkeep guard: protected areas always go to the owner, in plain words", () => {
  for (const [f, word] of [["supabase/migrations/2026_x.sql", "database"], ["lib/auth.js", "sign in"], ["vercel.json", "security headers"], [".github/workflows/qa.yml", "automatic jobs"], ["package.json", "third-party software"], ["lib/handlers/report.js", "reports"], ["lib/handlers/triage/reports.js", "volunteer desk"], ["lib/outbox.js", "mail"], ["docs/upkeep-agent.md", "own rules"], ["scripts/upkeep-guard.mjs", "own safety check"], ["CLAUDE.md", "standing rules"]]) {
    const r = judge([f], { [f]: ["x"] });
    assert.equal(r.verdict, "owner", f);
    assert.ok(r.reasons[0].includes(word), `${f}: ${r.reasons[0]}`);
  }
  assert.equal(judge(["lib/handlers/triage/seo.js"], {}).verdict, "auto", "the SEO desk view is not protected");
});

test("upkeep guard: added lines with secrets, contact details, party names, CSP, http links, consent or deletion go to the owner", () => {
  const cases = [
    ["const k = \"sk-ant-abcdefghijklmnop\";", "secret"],
    ["<p>Write to help@gurugramvisionforum.org</p>", "email"],
    ["Call 9876543210", "phone"],
    ["The BJP councillor", "political party"],
    ["<meta http-equiv=\"Content-Security-Policy\" content=\"x\">", "Content-Security-Policy"],
    ["<a href=\"http://mcg.gov.in\">", "not https"],
    ["GATE: { mode: \"hard\" }", "consent"],
    ["await sb.from(\"reports\").delete().eq(\"id\", 1);", "deletes"]
  ];
  for (const [line, word] of cases) {
    const r = judge(["lib/seo/blog.js"], { "lib/seo/blog.js": [line] });
    assert.equal(r.verdict, "owner", line);
    assert.ok(r.reasons.some((x) => x.includes(word)), `${line}: ${r.reasons}`);
  }
  assert.equal(judge(["tests/unit/a.test.mjs"], { "tests/unit/a.test.mjs": ["const k = \"sk-ant-abcdefghijklmnop\";"] }).verdict, "owner", "secrets are refused even in tests");
});

test("upkeep guard: size limits, and the diff parser", () => {
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => `lib/seo/f${i}.js`);
  assert.equal(judge(many, {}).verdict, "owner");
  assert.equal(judge(["lib/seo/a.js"], { "lib/seo/a.js": Array(MAX_LINES + 1).fill("x") }).verdict, "owner");
  const diff = ["diff --git a/lib/seo/a.js b/lib/seo/a.js", "--- a/lib/seo/a.js", "+++ b/lib/seo/a.js", "@@ -1 +1,2 @@", "-old", "+new one", "+new two", "diff --git a/x b/x", "--- a/x", "+++ /dev/null", "-gone"].join("\n");
  assert.deepEqual(addedLines(diff), { "lib/seo/a.js": ["new one", "new two"] });
});

test("upkeep guard: QA runs it for every upkeep/ branch, including the team's upkeep/note- branches", () => {
  const qa = readFileSync(new URL("../../.github/workflows/qa.yml", import.meta.url), "utf8");
  const m = /startsWith\(github\.head_ref, '([^']+)'\)/.exec(qa);
  assert.ok(m, "the Upkeep guard job selects branches by prefix");
  for (const b of ["upkeep/note-2026-10-10-weekly-upkeep", "upkeep/2026-10-09-fix-title"]) assert.ok(b.startsWith(m[1]), b);
  assert.ok(!"feature/x".startsWith(m[1]));
});
