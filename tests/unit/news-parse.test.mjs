import test from "node:test";
import assert from "node:assert/strict";
import { parseHtmlLinks, scopeHtml } from "../../lib/news-fetch.js";

test("a 'View (2 MB)' link takes its title from the table row", () => {
  const html = `<table><tr><td>12</td><td>Genset emission norms public notice of the Board</td><td>07/10/2026</td><td><a href="/files/a.pdf">View (2 MB)</a></td></tr>
  <tr><td>13</td><td>Monthly ambient air bulletin for September</td><td>01/10/2026</td><td><a href="/files/b.pdf">198.08 KB</a></td></tr></table>`;
  const items = parseHtmlLinks(html, "table td a", "https://cpcb.nic.in/x/");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Genset emission norms public notice of the Board");
  assert.equal(items[0].published_at.slice(0, 10), "2026-10-07");
  assert.equal(items[1].title, "Monthly ambient air bulletin for September");
});

test("'Click here ->' prefixes and surrounding quotes are stripped from titles", () => {
  const html = `<div class="box"><div><a href="/x.pdf">Click here -&gt; Selection for the post of Chairman in the HERC</a></div><div><a href="/y.docx">" Walkin Application for PM-KUSUM "</a></div></div>`;
  const items = parseHtmlLinks(html, ".box a", "https://dhbvn.org.in/");
  assert.deepEqual(items.map((i) => i.title), ["Selection for the post of Chairman in the HERC", "Walkin Application for PM-KUSUM"]);
});

test("scopeHtml collects every matching container, not only the first", () => {
  const html = `<div class="card"><a href="/1">First press release of the week</a></div><div class="card"><a href="/2">Second press release of the week</a></div><nav><a href="/n">Navigation item here</a></nav>`;
  assert.equal(scopeHtml(html, ".card").includes("/2"), true);
  const items = parseHtmlLinks(html, ".card a", "https://h.gov.in/");
  assert.equal(items.length, 2);
});

test("share buttons, logins and 'View all' are navigation", () => {
  const html = `<ul><li><a href="https://x.com/share?u=1">Share of X (formerly Twitter)</a></li><li><a href="/login">Citizen Login</a></li><li><a href="/all">View All Press Releases →</a></li><li><a href="/p/1">Interview schedule for the SPO telecom post</a></li></ul>`;
  const items = parseHtmlLinks(html, "ul li a", "https://police.gov.in/");
  assert.deepEqual(items.map((i) => i.title), ["Interview schedule for the SPO telecom post"]);
});
