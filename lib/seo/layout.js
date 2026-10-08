// Common page shell for the server-rendered pages: head (title, description,
// canonical, hreflang, Open Graph, JSON-LD), header, footer and share row.
// Reuses the app's stylesheet and tokens; the little inline CSS below only
// covers what the hash-routed app never needed (an always-visible nav, a
// definition list for the portal checklist).
import { ORG, SITE_URL } from "./site.js";
import { t } from "./i18n.js";

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const escAttr = esc;

// JSON inside <script type="application/ld+json">: closing tags must not end
// the script; U+2028/2029 are fine in JSON but not in all parsers.
export function jsonLd(obj) {
  const json = JSON.stringify(obj).replace(/<\//g, "<\\/").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => "\\u" + c.charCodeAt(0).toString(16));
  return `<script type="application/ld+json">${json}</script>`;
}

// Meta description: one line, at most 160 characters, cut at a word.
export function describe(s, max = 160) {
  const one = String(s || "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "") + "…";
}

export const abs = (path, base = SITE_URL) => base + (path.startsWith("/") ? path : "/" + path);

// English path -> Hindi path and back.
export const hiPath = (p) => (p === "/" ? "/hi" : "/hi" + p);
export const enPath = (p) => (p === "/hi" ? "/" : p.replace(/^\/hi(?=\/)/, ""));
export const langPath = (p, lang) => (lang === "hi" && p !== "/" ? hiPath(p) : p);

const FONTS = "https://fonts.googleapis.com/css2?family=Anek+Latin:wght@500;600;700&family=Anek+Devanagari:wght@600;700&family=Noto+Sans:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&display=swap";

const MARK = '<svg viewBox="0 0 48 48" aria-hidden="true" width="34" height="34"><circle cx="24" cy="24" r="20" fill="none" stroke="#FF9933" stroke-width="3" stroke-dasharray="2.6 .9"/><g fill="currentColor"><rect x="15" y="24" width="4" height="10"/><rect x="21" y="17" width="4" height="17"/><rect x="27" y="20" width="4" height="14"/><rect x="13" y="34" width="22" height="1.5"/></g></svg>';

const CSS = `
.sx-nav{display:flex;flex-wrap:wrap;gap:.25rem;list-style:none;margin:0;padding:0}
.sx-nav a{display:inline-block;padding:.45rem .6rem;min-height:44px;line-height:1.9;border-radius:6px;color:var(--text);text-decoration:none;font-family:var(--head);font-weight:600;white-space:nowrap}
.sx-nav a:hover{background:var(--surface-2);color:var(--ink)}
.sx-hdr .wrap{height:auto;min-height:var(--hdr);flex-wrap:wrap;padding:.5rem 0}
.sx-lang{display:inline-flex;align-items:center;min-height:44px;padding:0 .8rem;border:1.5px solid var(--line);border-radius:var(--r-pill);text-decoration:none;color:var(--ink);font-family:var(--head);font-weight:700}
.sx-lang:hover{border-color:var(--ink)}
.sx-main{padding:clamp(1.5rem,4vw,3rem) 0 clamp(3rem,6vw,5rem)}
.sx-main h1{margin-top:0}
.sx-main h2{margin-top:2rem}
.sx-main h3{margin-top:1.25rem}
.sx-crumbs{list-style:none;margin:0 0 1rem;padding:0;display:flex;flex-wrap:wrap;gap:.35rem;font-size:.95rem;color:var(--muted)}
.sx-crumbs li+li::before{content:"›";margin-right:.35rem}
.sx-grid{display:grid;grid-template-columns:1fr;gap:1.25rem}
@media (min-width:900px){.sx-grid{grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start}}
.sx-box{padding:1.1rem 1.2rem;border:1px solid var(--line);border-radius:var(--r-card);background:var(--surface)}
.sx-box h2,.sx-box h3{margin-top:0}
.sx-box p:last-child{margin-bottom:0}
.sx-share{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:1.5rem 0}
.sx-share .btn{min-height:44px}
.sx-share code{font-family:var(--body);font-size:.9rem;color:var(--muted);word-break:break-all}
.sx-cta{margin:2rem 0 0;padding:1.25rem;border-radius:var(--r-card);background:var(--navy);color:#E6EAF0}
.sx-cta h2{color:#fff;margin:0 0 .4rem}
.sx-cta p{color:#B7C3D1;margin:0 0 .9rem}
.sx-faq details{border-top:1px solid var(--line);padding:.6rem 0}
.sx-faq summary{cursor:pointer;font-family:var(--head);font-weight:600;color:var(--ink);min-height:44px;display:flex;align-items:center}
.sx-faq p{margin:.4rem 0 0}
.sx-dl{margin:0;padding:0}
.sx-dl div{display:grid;grid-template-columns:1fr;gap:.1rem .75rem;padding:.55rem 0;border-bottom:1px solid var(--line)}
.sx-dl dt{font-family:var(--head);font-weight:600;color:var(--ink)}
.sx-dl dd{margin:0;color:var(--muted);font-size:.95rem}
.sx-post img{max-width:100%;height:auto;border-radius:8px}
.sx-post .hero{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:var(--r-card);margin:0 0 1.25rem}
.sx-wards{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;margin:0;padding:0}
.sx-wards a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 .6rem;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--ink);font-family:var(--head);font-weight:600}
.sx-wards a:hover{border-color:var(--ink)}
.sx-main a:not(.btn){color:var(--blue)}
.sx-main .card h3 a,.sx-main .sx-wards a,.sx-main .sx-crumbs a{color:var(--ink)}
.sx-main ol.steps li{font-size:1.02rem}
.sx-main ul.ch{margin:.5rem 0 0}
.sx-main .tbl{margin:.75rem 0 0}
.sx-main .tbl th,.sx-main .tbl td{font-size:.98rem}
@media (max-width:639px){.sx-main .tbl td[data-l]::before{content:attr(data-l) ": ";color:var(--muted)}}
`;

export function orgLd(social) {
  const sameAs = Object.values(social || {}).map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => /^https?:\/\//.test(v));
  const o = { "@context": "https://schema.org", "@type": "Organization", name: ORG.name, url: SITE_URL + "/", logo: SITE_URL + "/og.png",
    address: { "@type": "PostalAddress", addressLocality: "Gurugram", addressRegion: "Haryana", addressCountry: "IN" } };
  if (sameAs.length) o.sameAs = sameAs;
  return o;
}

export function websiteLd(lang) {
  return { "@context": "https://schema.org", "@type": "WebSite", name: ORG.name, url: SITE_URL + "/", inLanguage: lang === "hi" ? "hi-IN" : "en-IN" };
}

export function breadcrumbLd(items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })) };
}

// opts: { lang, path (English path of this page), title, description, body (HTML), ld (array), ogType, image, social, crumbs:[{name,path}], share:{title} }
export function page(o) {
  const lang = o.lang === "hi" ? "hi" : "en";
  const enP = o.path;
  const hiP = hiPath(o.path);
  const here = lang === "hi" ? hiP : enP;
  const canonical = abs(here);
  const other = lang === "hi" ? enP : hiP;
  const title = o.title;
  const fullTitle = o.titleSuffix === false ? title : `${title} | ${t("Gurugram Vision Forum", lang)}`;
  const desc = describe(o.description);
  const image = o.image || SITE_URL + "/og.png";
  const ld = [orgLd(o.social), websiteLd(lang), ...(o.ld || [])];
  const nav = [["/report", t("Report", lang)], ["/guides", t("Guides", lang)], ["/wards", t("Wards", lang)], ["/blog", t("Blog", lang)], ["/pulse", t("Pulse", lang)]];
  const navHtml = nav.map(([p, label]) => {
    const isApp = p === "/report" || p === "/wards" || p === "/pulse";
    const href = isApp ? p : langPath(p, lang);
    return `<li><a href="${esc(href)}">${esc(label)}</a></li>`;
  }).join("");
  const crumbs = o.crumbs && o.crumbs.length ? `<ol class="sx-crumbs">${o.crumbs.map((c, i) => (i === o.crumbs.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${esc(langPath(c.path, lang))}">${esc(c.name)}</a></li>`)).join("")}</ol>` : "";
  const share = o.share ? shareRow(o.share.title || title, canonical, lang) : "";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="en-IN" href="${esc(abs(enP))}">
<link rel="alternate" hreflang="hi-IN" href="${esc(abs(hiP))}">
<link rel="alternate" hreflang="x-default" href="${esc(abs(enP))}">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta name="theme-color" content="#0B2545">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${o.ogType === "article" ? "article" : "website"}">
<meta property="og:site_name" content="${esc(ORG.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:locale" content="${lang === "hi" ? "hi_IN" : "en_IN"}">
<meta property="og:locale:alternate" content="${lang === "hi" ? "en_IN" : "hi_IN"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<style>${CSS}</style>
${ld.map(jsonLd).join("\n")}
</head>
<body>
<a class="sr" href="#main">${lang === "hi" ? "मुख्य सामग्री पर जाएँ" : "Skip to content"}</a>
<header class="hdr sx-hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="${esc(t("Gurugram Vision Forum", lang))}">${MARK}<span>${esc(t("Gurugram Vision Forum", lang))}</span></a>
    <ul class="sx-nav">${navHtml}</ul>
    <a class="sx-lang" href="${esc(other)}" lang="${lang === "hi" ? "en" : "hi"}" hreflang="${lang === "hi" ? "en" : "hi"}">${lang === "hi" ? "English" : "हिंदी"}</a>
  </div>
</header>
<main id="main" class="sx-main">
  <div class="wrap">
    ${crumbs}
    ${o.body}
    ${share}
  </div>
</main>
<footer class="ftr">
  <div class="wrap">
    <div class="fgrid">
      <div><a class="brand" href="/">${MARK}<span>${esc(t("Gurugram Vision Forum", lang))}</span></a><p><a href="/report">${esc(t("Report a problem", lang))}</a><br><a href="/join">${esc(t("Join the Forum", lang))}</a><br>${esc(lang === "hi" ? "सेक्टर 29, गुरुग्राम" : ORG.address)}</p></div>
      <div><h4>${esc(t("Guides", lang))}</h4><ul><li><a href="${langPath("/guides", lang)}">${esc(t("All guides", lang))}</a></li><li><a href="${langPath("/ward/1", lang)}">${esc(t("Wards", lang))}</a></li><li><a href="${langPath("/blog", lang)}">${esc(t("Blog", lang))}</a></li></ul></div>
      <div><h4>${esc(t("Report", lang))}</h4><ul><li><a href="/report">${esc(t("Report", lang))}</a></li><li><a href="/dashboard">${esc(t("Dashboard", lang))}</a></li><li><a href="/pulse">${esc(t("Pulse", lang))}</a></li></ul></div>
      <div><h4>${esc(t("About", lang))}</h4><ul><li><a href="/about">${esc(t("About", lang))}</a></li><li><a href="/privacy">${esc(t("Privacy notice", lang))}</a></li></ul></div>
    </div>
    <div class="fnote"><span>${esc(t("Not a government website. Emergencies: 112.", lang))}</span></div>
  </div>
</footer>
</body>
</html>`;
}

export function shareRow(title, url, lang) {
  const text = encodeURIComponent(title + " " + url);
  const wa = "https://wa.me/?text=" + text;
  const x = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(url);
  return `<div class="sx-share" aria-label="${esc(t("Share", lang))}"><span class="small muted">${esc(t("Share", lang))}:</span> <a class="btn btn-line btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a> <a class="btn btn-line btn-sm" href="${esc(x)}" target="_blank" rel="noopener">X</a> <code>${esc(url)}</code></div>`;
}

export function notFound(lang, path = "/404") {
  const body = `<h1>${esc(t("Page not found", lang))}</h1><p class="lead">${esc(t("There is no page at this address. Try the guides, the wards or the home page.", lang))}</p><p><a class="btn btn-ink" href="${langPath("/guides", lang)}">${esc(t("All guides", lang))}</a> <a class="btn btn-line" href="/">${esc(t("Back to the home page", lang))}</a></p>`;
  return page({ lang, path, title: t("Page not found", lang), description: t("There is no page at this address. Try the guides, the wards or the home page.", lang), body, noindex: true });
}

export const CACHE = "public, s-maxage=600, stale-while-revalidate=86400";

export function sendHtml(res, status, html, cache = CACHE) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? cache : "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}
