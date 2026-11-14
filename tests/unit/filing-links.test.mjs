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

test("pollution: the one filing address is the GMDA integrated grievance portal (CAQM takes no resident's complaint directly); Sameer stays in the note", () => {
  const f = G.FILING.pollution;
  assert.equal(f.portal, "GMDA integrated grievance portal (air, noise, water)");
  assert.equal(G.HS[f.portal], "GMDA एकीकृत शिकायत पोर्टल (हवा, शोर, पानी)");
  assert.equal(f.url, G.L.gmdaPortal);
  assert.equal(host(f.url), "services.gmda.gov.in");
  assert.ok(!/CAQM/.test(f.portal));
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
  assert.equal(byId.pollution.state, "link check ok");
  assert.equal(byId.pollution.url, G.FILING.pollution.url);
  assert.equal(host(byId.pollution.url), "services.gmda.gov.in");
  assert.match(byId.pollution.note, /Nobody on the team has opened these pages\.$/);
  assert.equal(byId.traffic.state, "not opened");
  assert.equal(byId.traffic.url, G.FILING.traffic.url);
  assert.match(byId.traffic.note, /not checked/);
  for (const n of G.VERIFIED_NOTES) assert.match(n.url, /^https:\/\//);
});

test("no link on the site points at cpcb.nic.in, which failed the nightly check; complaints go to the GMDA portal, CAQM is listed for the air rules", () => {
  const links = JSON.stringify([G.L, G.CATS, G.PORTALS, G.CHARTERS, G.ROLES, G.CIVIC, G.FILING, G.VERIFIED_NOTES.map((n) => n.url)]);
  assert.doesNotMatch(links, /cpcb\.nic\.in/);
  assert.ok(!("cpcb" in G.L) && !("hspcb" in G.L), "the unused cpcb and hspcb link keys are gone");
  const ch = G.CATS.find((c) => c.id === "pollution").channels;
  assert.equal(JSON.stringify(ch.map((c) => [c.k, c.v, c.href])), JSON.stringify([
    ["Portal", "GMDA integrated grievance portal (air, noise, water)", "https://services.gmda.gov.in/"],
    ["Air rules (GRAP)", "Commission for Air Quality Management (CAQM)", "https://caqm.nic.in/"],
    ["Toll-free", "1800 180 1817", "tel:18001801817"],
  ]));
  assert.equal(ch[0].href, G.L.gmdaPortal);
  assert.equal(ch[1].href, G.L.caqm);
  assert.equal(G.HS["Portal"], "पोर्टल");
  assert.equal(G.HS["GMDA integrated grievance portal (air, noise, water)"], "GMDA एकीकृत शिकायत पोर्टल (हवा, शोर, पानी)");
  assert.equal(G.HS["Air rules (GRAP)"], "हवा के नियम (GRAP)");
  assert.equal(G.HS["Commission for Air Quality Management (CAQM)"], "वायु गुणवत्ता प्रबंधन आयोग (CAQM)");
  for (const c of ch) assert.match(G.HS[c.v] || c.v, /[ऀ-ॿ]|^[0-9 ]+$/, `Hindi for: ${c.v}`);
});

test("the HSPCB role has one complaints link, the GMDA portal; the directory row for noise and water is the same portal", () => {
  assert.equal(JSON.stringify(G.ROLES.hspcb.links), JSON.stringify([["Complaints: GMDA integrated grievance portal", G.L.gmdaPortal]]));
  assert.equal(G.HS["Complaints: GMDA integrated grievance portal"], "शिकायतें: GMDA एकीकृत शिकायत पोर्टल");
  const p = G.PORTALS.find((x) => x.n === "GMDA integrated grievance portal: noise and water pollution");
  assert.ok(p, "the noise-and-water row");
  assert.equal(p.h, G.L.gmdaPortal);
  assert.equal(p.how, "The same portal as for civic complaints");
  assert.equal(p.f, "Noise, water discharge or dumping");
  assert.equal(G.HS[p.n], "GMDA एकीकृत शिकायत पोर्टल: शोर और जल प्रदूषण");
  assert.equal(G.HS[p.how], "वही पोर्टल जो नागरिक शिकायतों के लिए है");
});
