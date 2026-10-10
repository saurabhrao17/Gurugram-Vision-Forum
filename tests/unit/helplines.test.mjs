// Phone numbers on the public site: only official government helplines.
// OFFICIAL are the numbers recorded in GVF.VERIFIED_HELPLINES (owner's decision, 10 Oct 2026).
// LEGACY were on the site before that decision; they stay allowed so nothing regresses but
// each still needs its own check against the government source. Anything else fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../site/data.js", import.meta.url), "utf8");
const ctx = { window: {}, self: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const G = ctx.window.GVF || ctx.GVF || ctx.self.GVF;

const OFFICIAL = ["112", "1930"];
const LEGACY = ["181", "1033", "1912", "1915", "18001801817"];

test("every recorded helpline has a government source URL and a check state (not checked yet, or a real date)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(G.VERIFIED_HELPLINES.map((h) => h.n).sort())), [...OFFICIAL].sort());
  for (const h of G.VERIFIED_HELPLINES) {
    assert.match(h.url, /^https:\/\/([a-z0-9-]+\.)*(gov\.in|nic\.in)\//, h.n);
    assert.match(h.checked, /^(not checked yet|\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})$/, h.n);
  }
});

test("tel: links in the guides are only official or legacy helplines, never a private number", () => {
  const allowed = new Set([...OFFICIAL, ...LEGACY]);
  const tels = [...src.matchAll(/tel:([+\d]+)/g)].map((m) => m[1]);
  assert.ok(tels.length > 0);
  for (const t of tels) assert.ok(allowed.has(t), `tel:${t} is not on the helpline allow-list`);
});

test("no ten-digit mobile number in the guide channels", () => {
  for (const c of Object.values(G.CATS || {}).concat(G.CATS || [])) {
    for (const ch of (c && c.channels) || []) assert.doesNotMatch(String(ch.v) + String(ch.href), /(?<!\d)(?:\+91)?[6-9]\d{9}(?!\d)/, c.id);
  }
});
