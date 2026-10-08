// GET /api/shell?view=<name>: the app's page shell (site/index.html) with
// the head written for one view, so each app page in the sitemap has its own
// <title>, description, canonical, Open Graph tags and structured data
// instead of all of them claiming to be the home page. The body is the same
// single-page app; app.js routes on the real URL as before. vercel.json
// rewrites the bare view URLs (/about, /directory, ...) here; the home page
// stays the static index.html (its own JSON-LD is in the file) and every
// other app URL (/report/roads, /track, /desk, ...) keeps the static shell.
// Answers are cached on Vercel's CDN per deployment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { send } from "../http.js";
import { siteUrl } from "../seo/site.js";
import { orgLd, websiteLd, breadcrumbLd, withBrand, esc } from "../seo/layout.js";

// Titles follow the app's TITLES (app.js); descriptions are written for
// search results: 50-160 characters, unique, no contact details.
export const APP_META = {
  report: { title: "Report a civic problem in Gurugram", description: "Report a civic problem in Gurugram: the Forum maps it to the right office, files it on the official portal and follows the ticket until it is fixed." },
  directory: { title: "Official channels: Gurugram portals and helplines", description: "Every official portal and helpline for Gurugram's civic problems, from MCG and GMDA to DHBVN and the police, and the channel that creates a record." },
  rights: { title: "Your rights: deadlines the government set itself", description: "The deadlines the government set for itself: CM Window, Right to Service, RTI, power supply and more, and how to use them when nothing happens." },
  wards: { title: "Find your ward in Gurugram", description: "Find your Municipal Corporation of Gurugram ward by sector or colony, its councillor, and the counts of problems residents report there." },
  charter: { title: "The civic charter: what you owe the city", description: "The civic charter: what residents owe Gurugram and what the city owes them, with a score you keep on your own device." },
  dashboard: { title: "Accountability dashboard", description: "Every report to the Forum counted by cause and status, against the Forum's own commitments, with dates and sources. Counts only, never a report." },
  updates: { title: "Updates from the Forum", description: "Stories, photos, videos, press and weekly round-ups published by the Gurugram Vision Forum's team." },
  join: { title: "Join the Forum: volunteer in your ward", description: "Volunteer with the Gurugram Vision Forum: lead or support your ward, help file and follow up civic complaints, or help with content." },
  about: { title: "About the Forum", description: "A non-partisan citizens' platform that gets Gurugram's problems to the right desk and follows them to closure. How it works and what it stands for." },
  news: { title: "Official notices from Gurugram's authorities", description: "Official notices from MCG, GMDA, HSVP and other Gurugram authorities, collected every day with a link to each source." },
  pulse: { title: "What Gurugram is talking about this week", description: "Public posts on Gurugram's civic problems counted by issue and area each week, with the trend and suggested next steps. Counts and public links only." },
  privacy: { title: "Privacy notice", description: "How the Gurugram Vision Forum handles personal data under India's DPDP Act: what is collected, why, how long it is kept and how to ask for erasure." }
};
export const VIEWS = Object.keys(APP_META);

let SHELL = null;
export function loadShell() {
  if (SHELL) return SHELL;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(process.cwd(), "site", "index.html"), join(here, "..", "..", "site", "index.html")]) {
    try { SHELL = readFileSync(p, "utf8"); return SHELL; } catch { /* next */ }
  }
  throw new Error("site/index.html not found");
}

const attr = (s) => esc(s).replace(/'/g, "&#39;");
const LD_RE = /<script type="application\/ld\+json" id="ld-site">[\s\S]*?<\/script>\n?/;

// The shell with the head rewritten for one view; null for an unknown view.
export function shellFor(html, view, site) {
  const m = APP_META[view];
  if (!m) return null;
  const url = `${site}/${view}`;
  const title = withBrand(m.title, "en");
  const ld = [
    orgLd(),
    websiteLd("en"),
    { "@context": "https://schema.org", "@type": "WebPage", name: m.title, description: m.description, url, inLanguage: "en-IN", isPartOf: { "@type": "WebSite", name: "Gurugram Vision Forum", url: site + "/" } },
    breadcrumbLd([{ name: "Home", path: "/" }, { name: m.title, path: `/${view}` }])
  ];
  const ldHtml = `<script type="application/ld+json" id="ld-site">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n`;
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(m.description)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${attr(url)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(m.description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(url)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(m.description)}">`);
  out = LD_RE.test(out) ? out.replace(LD_RE, ldHtml) : out.replace("</head>", ldHtml + "</head>");
  return out;
}

export default async function handler(req, res) {
  const view = String((req.query && req.query.view) || "").toLowerCase();
  const site = siteUrl(process.env);
  let html;
  try { html = shellFor(loadShell(), view, site); } catch (e) { console.error("shell failed", e); html = null; }
  if (!html) return send(res, 404, { ok: false, error: "not_found" });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.statusCode = 200;
  res.end(html);
}
