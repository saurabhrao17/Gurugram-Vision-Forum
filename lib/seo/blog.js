// Blog index and post pages from the static GVF.BLOG and the published
// stories and news in the posts table.
import { ORG } from "./site.js";
import { esc, page, breadcrumbLd, langPath, abs } from "./layout.js";
import { t } from "./i18n.js";
import { fmtDate, isoDate } from "./data.js";
import { guideTitle } from "./guides.js";

const titleOf = (p, lang) => (lang === "hi" && p.title_hi) || p.title;
const summaryOf = (p, lang) => (lang === "hi" && p.summary_hi) || p.summary;
const tagOf = (p, lang) => (p.tag === "News" ? t("News", lang) : p.tag === "Story" ? t("Story", lang) : (lang === "hi" ? t(p.tag, lang) : p.tag));

export function renderBlogIndex(posts, opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const title = t("Updates and stories from the Forum", lang);
  const description = t("Guides, explainers and news from the Gurugram Vision Forum: how the city's civic machinery works and what the Forum is fixing.", lang);
  const cards = posts.map((p) => `<article class="card">${p.media_url ? `<a class="ph" href="${esc(langPath(`/blog/${p.slug}`, lang))}"><img src="${esc(p.media_url)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></a>` : ""}<div class="meta"><span class="tag">${esc(tagOf(p, lang))}</span>${p.date ? ` <time datetime="${esc(isoDate(p.date))}">${esc(fmtDate(p.date, lang))}</time>` : ""}</div><h3><a href="${esc(langPath(`/blog/${p.slug}`, lang))}">${esc(titleOf(p, lang))}</a></h3><p>${esc(summaryOf(p, lang))}</p><p><a href="${esc(langPath(`/blog/${p.slug}`, lang))}">${esc(t("Read more", lang))} ›</a></p></article>`).join("");
  const body = `<h1>${esc(title)}</h1><p class="lead">${esc(description)}</p><div class="cards">${cards}</div><p style="margin-top:2rem"><a class="btn btn-line" href="${esc(langPath("/guides", lang))}">${esc(t("All guides", lang))}</a></p>`;
  const ld = [
    breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Blog", lang), path: langPath("/blog", lang) }]),
    { "@context": "https://schema.org", "@type": "Blog", name: title, url: abs(langPath("/blog", lang)), inLanguage: lang === "hi" ? "hi-IN" : "en-IN",
      publisher: { "@type": "Organization", name: ORG.name, url: abs("/") },
      blogPost: posts.slice(0, 50).map((p) => ({ "@type": p.kind === "news" ? "NewsArticle" : "BlogPosting", headline: titleOf(p, lang), url: abs(langPath(`/blog/${p.slug}`, lang)), datePublished: isoDate(p.date) || undefined })) }
  ];
  return page({ lang, path: "/blog", title, description, body, ld, social: opts.social, crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Blog", lang), path: "/blog" }] });
}

export function renderBlogPost(p, opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const path = `/blog/${p.slug}`;
  const title = titleOf(p, lang);
  const summary = summaryOf(p, lang);
  const hasHi = !!p.body_hi;
  const bodyHtml = lang === "hi" ? (p.body_hi || p.body) : p.body;
  const fallbackNote = lang === "hi" && !hasHi ? `<p class="notice">${esc(t("This post is not yet available in Hindi; the English text follows.", lang))}</p>` : "";
  const auto = typeof p.source === "string" && p.source.startsWith("auto:");
  // Cluster links (lib/seo/clusters.js): the pillar guide(s) and siblings.
  const rel = opts.related || { pillars: [], siblings: [] };
  const relatedHtml = (rel.pillars.length || rel.siblings.length) ? `<section class="sx-box" style="margin-top:2rem" aria-labelledby="rel">
${rel.pillars.length ? `<h2 id="rel">${esc(t("Read the guide", lang))}</h2><ul class="linklist">${rel.pillars.map((c) => `<li><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(guideTitle(c, lang))}</a></li>`).join("")}</ul>` : ""}
${rel.siblings.length ? `<h${rel.pillars.length ? 3 : 2}${rel.pillars.length ? "" : ' id="rel"'}>${esc(t("More on this topic", lang))}</h${rel.pillars.length ? 3 : 2}><ul class="linklist">${rel.siblings.map((x) => `<li><a href="${esc(langPath(`/blog/${x.slug}`, lang))}">${esc(titleOf(x, lang))}</a></li>`).join("")}</ul>` : ""}
</section>` : "";
  const disclosure = auto ? `<p class="small muted">${esc(t("Compiled automatically from public sources and official notices.", lang))}</p>` : "";
  const body = `
<article class="post sx-post">
<p class="meta"><span class="tag">${esc(tagOf(p, lang))}</span>${p.date ? ` <time datetime="${esc(isoDate(p.date))}">${esc(t("Published {d}", lang, { d: fmtDate(p.date, lang) }))}</time>` : ""} · ${esc(t("Gurugram Vision Forum data desk", lang))}</p>
<h1>${esc(title)}</h1>
${summary ? `<p class="lead">${esc(summary)}</p>` : ""}
${p.media_url ? `<img class="hero" src="${esc(p.media_url)}" alt="">` : ""}
${disclosure}
${fallbackNote}
<div${lang === "hi" && !hasHi ? ' lang="en"' : ""}>${bodyHtml}</div>
</article>
${relatedHtml}
<p style="margin-top:2rem"><a class="btn btn-line" href="${esc(langPath("/blog", lang))}">‹ ${esc(t("Blog", lang))}</a> <a class="btn btn-primary" href="/report">${esc(t("Report it through the Forum", lang))}</a></p>`;
  const article = { "@context": "https://schema.org", "@type": p.kind === "news" ? "NewsArticle" : "BlogPosting", headline: title, description: summary || undefined,
    url: abs(langPath(path, lang)), mainEntityOfPage: abs(langPath(path, lang)), inLanguage: lang === "hi" ? "hi-IN" : "en-IN",
    author: { "@type": "Organization", name: ORG.name, url: abs("/") }, publisher: { "@type": "Organization", name: ORG.name, url: abs("/"), logo: { "@type": "ImageObject", url: abs("/og.png") } } };
  if (p.date) article.datePublished = p.date.toISOString();
  if (rel.pillars.length) article.about = rel.pillars.map((c) => ({ "@type": "Thing", name: c.label }));
  if (p.media_url) article.image = [p.media_url];
  const ld = [breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Blog", lang), path: langPath("/blog", lang) }, { name: title, path: langPath(path, lang) }]), article];
  return page({ lang, path, title, description: summary || title, body, ld, ogType: "article", image: p.media_url || undefined, social: opts.social, share: { title },
    crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Blog", lang), path: "/blog" }, { name: title, path }] });
}
