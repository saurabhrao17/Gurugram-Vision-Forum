// The words of an app page, written into the HTML the server sends, so a
// crawler (or a visitor with scripts off) reads the page itself and not an
// empty shell that app.js fills in later. Built from site/data.js only: no
// database, no councillor names (ward cards link to the ward pages), no
// phone numbers or emails. app.js removes the block ([data-ssr]) on its
// first route(), so a visitor with scripts on sees the app, not this copy.
import { gvf } from "../site-data.js";
import { esc } from "./layout.js";

const li = (inner) => `<li>${inner}</li>`;
const ext = (h) => (/^https?:\/\//.test(h || "") ? h : null);

function listFor(view, G) {
  switch (view) {
    case "directory":
      return `<ul>${(G.PORTALS || []).map((p) => li(`${ext(p.h) ? `<a href="${esc(p.h)}" rel="noopener">${esc(p.n)}</a>` : esc(p.n)}: ${esc(p.f)}`)).join("")}</ul>`
        + `<p><a href="/guides">Step-by-step guides, one page per issue</a></p>`;
    case "rights":
      return `<ul>${(G.CHARTERS || []).map((c) => li(`<b>${esc(c.t)}</b>: ${esc(c.right)}`)).join("")}</ul>`;
    case "who":
      return `<ul>${Object.values(G.ROLES || {}).map((r) => li(`<b>${esc(r.b)}</b>: ${esc(r.owns)}`)).join("")}</ul>`;
    case "wards": {
      const n = (G.WARDS || []).length;
      return `<ul>${Array.from({ length: n }, (_, i) => li(`<a href="/ward/${i + 1}">Ward ${i + 1}</a>`)).join("")}</ul>`;
    }
    case "charter":
      return `<ul>${(G.CIVIC || []).map((s) => li(esc(s.t))).join("")}</ul>`;
    case "dashboard":
      return `<p><a href="/blog">Read the Forum's updates</a> · <a href="/guides">Guides</a></p>`;
    case "updates":
      return `<p><a href="/blog">All stories and round-ups</a></p>`;
    default:
      return "";
  }
}

// HTML block for one view, or "" when the page's own markup already carries
// its text (report, join, about, privacy, news, pulse).
export function snapshotFor(view, title, description, G = gvf()) {
  const list = listFor(view, G);
  if (!list) return "";
  return `<div class="sec" data-ssr><div class="wrap"><h1>${esc(title)}</h1><p>${esc(description)}</p>${list}</div></div>\n`;
}
