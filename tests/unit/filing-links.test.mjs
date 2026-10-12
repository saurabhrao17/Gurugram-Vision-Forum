import { test } from "node:test";
import assert from "node:assert/strict";
import { gvf } from "../../lib/site-data.js";

const G = gvf();
const host = (u) => new URL(u).hostname;

test("construction: the label names MCG and the link is the MCG site, not the GMDA complaint site", () => {
  const f = G.FILING.construction;
  assert.equal(f.portal, "Municipal Corporation of Gurugram (MCG), town planning wing; DTCP for licensed colonies");
  assert.equal(f.url, G.L.mcg);
  assert.equal(host(f.url), "www.mcg.gov.in");
});

test("traffic: the link is the Gurugram Police site on the Haryana Police domain", () => {
  const f = G.FILING.traffic;
  assert.equal(f.url, "https://gurgaon.haryanapolice.gov.in/");
  assert.ok(f.portal.startsWith("Gurugram Traffic Police"));
});

test("pollution: the label is the HSPCB regional office; Sameer moves to the note", () => {
  const f = G.FILING.pollution;
  assert.equal(f.portal, "Haryana State Pollution Control Board (HSPCB), Gurugram regional office");
  assert.equal(host(f.url), "hspcb.gov.in");
  assert.ok(!/Sameer/.test(f.portal));
  assert.ok(f.note.endsWith("For air, the CPCB Sameer app also takes complaints."));
});

test("every portal label that changed has its Hindi, and the Hindi has no Sameer in Latin letters", () => {
  for (const id of ["construction", "traffic", "pollution"]) {
    const f = G.FILING[id];
    for (const en of [f.portal, f.note]) assert.match(G.HS[en] || "", /[ऀ-ॿ]/, `Hindi for: ${en}`);
  }
  assert.doesNotMatch(G.HS[G.FILING.pollution.note], /Sameer/);
});

test("VERIFIED stays the 8 Oct pass; the later checks are recorded honestly, the unopened page as not opened", () => {
  assert.equal(G.VERIFIED, "8 Oct 2026");
  const byId = Object.fromEntries(G.VERIFIED_NOTES.map((n) => [n.id, n]));
  assert.equal(byId.construction.state, "opened");
  assert.equal(byId.construction.url, G.FILING.construction.url);
  assert.equal(byId.pollution.state, "opened");
  assert.equal(byId.traffic.state, "not opened");
  assert.equal(byId.traffic.url, G.FILING.traffic.url);
  assert.match(byId.traffic.note, /not checked/);
  for (const n of G.VERIFIED_NOTES) assert.match(n.url, /^https:\/\//);
});
