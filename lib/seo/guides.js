// Issue guides: one page per GVF.CATS entry, built from the same data the
// app's "Who fixes it" panel uses, plus the live pulse and tagged posts.
import { gvf, hs } from "../site-data.js";
import { esc, page, breadcrumbLd, langPath, abs } from "./layout.js";
import { t } from "./i18n.js";
import { fmtDate, factsChecked, isoDate } from "./data.js";

export const label = (c, lang) => (lang === "hi" ? (c.hl || hs(c.label, "hi")) : c.label);

// Which charters a guide shows: by the offices in cat.roles, plus the issue's
// own rule. cmwindow is the ladder for every state or city office; rts covers
// notified services; rti closes every list as the tool to prove what was
// sanctioned. Order follows GVF.CHARTERS.
const ROLE_CHARTERS = {
  gmda: ["cmwindow"], mcg: ["cmwindow"], manesar: ["cmwindow"], councillor: ["cmwindow"], je: ["cmwindow"], ulb: ["cmwindow", "rts"],
  hsvp: ["cmwindow", "rts"], dtcp: ["cmwindow", "rts"], rts: ["rts"], cm: ["cmwindow"], dc: ["cmwindow"], sdm: ["cmwindow"],
  mohua: ["cpgrams"], nhai: ["cpgrams"], caqm: ["cpgrams", "air"], hspcb: ["air"], hrera: ["rera"], consumer: ["consumer"],
  police: ["police"], dhbvn: ["dhbvn"], rwa: ["swm"], chapter: ["cmwindow", "cpgrams"]
};
const CAT_CHARTERS = { waste: ["swm"], property: ["rts"], water: ["rts"], rti: ["rti"], other: ["cmwindow", "cpgrams"], pollution: ["air"], housing: ["rera"] };

export function chartersFor(cat) {
  const G = gvf();
  const want = new Set(["cmwindow"]);
  for (const r of cat.roles || []) for (const id of ROLE_CHARTERS[r] || []) want.add(id);
  for (const id of CAT_CHARTERS[cat.id] || []) want.add(id);
  want.add("rti");
  if (cat.id === "rti") want.delete("cmwindow");
  return (G.CHARTERS || []).filter((c) => want.has(c.id));
}

// The H1 keeps the full question; the <title> is the short form a result
// page can show whole.
export function guideHeading(cat, lang) {
  return t("Who fixes {label} in Gurugram (Gurgaon): how to complain, documents, deadlines", lang, { label: label(cat, lang) });
}
export function guideTitle(cat, lang) {
  return t("{label} in Gurugram: who fixes it, how to complain", lang, { label: label(cat, lang) });
}

const telOf = (href) => (typeof href === "string" && href.startsWith("tel:") ? href : null);
const linkOf = (href) => (typeof href === "string" && /^https?:\/\//.test(href) ? href : null);
const appHref = (href) => (typeof href === "string" && href.startsWith("#/") ? href.slice(1) : null);

function channelHtml(ch, lang) {
  const k = esc(hs(ch.k || "", lang));
  const v = esc(hs(ch.v || "", lang));
  const href = telOf(ch.href) || linkOf(ch.href) || appHref(ch.href);
  const body = href ? `<a href="${esc(href)}"${linkOf(ch.href) ? ' target="_blank" rel="noopener"' : ""}>${v}</a>` : v;
  return `<li><span><span class="k">${k}</span>${body}</span></li>`;
}

function fieldRow(f, lang) {
  const req = f.r ? `<span class="tag tag-saffron">${esc(t("Required", lang))}</span>` : `<span class="tag">${esc(t("Optional", lang))}</span>`;
  const opts = Array.isArray(f.o) && f.o.length ? `<dd>${esc(t("Options: {o}", lang, { o: f.o.map((o) => hs(o, lang)).join(", ") }))}</dd>` : "";
  return `<div><dt>${esc(hs(f.l || f.k, lang))} ${req}</dt>${opts}${f.h ? `<dd>${esc(hs(f.h, lang))}</dd>` : ""}</div>`;
}

export function faqFor(cat, lang) {
  const G = gvf();
  const lb = label(cat, lang);
  const chans = Array.isArray(cat.channels) ? cat.channels : [];
  const first = chans.find((c) => linkOf(c.href)) || chans[0];
  const filing = (G.FILING || {})[cat.id] || cat.filing || {};
  const charters = chartersFor(cat);
  const main = charters.find((c) => c.id === "cmwindow") || charters[0];
  const ladder = Array.isArray(cat.ladder) ? cat.ladder : [];
  return [
    { q: t("Who fixes {label} in Gurugram?", lang, { label: lb }), a: [hs(cat.agency || "", lang), hs(cat.owns || "", lang)].filter(Boolean).join(" ") },
    { q: t("How do I complain about {label}?", lang, { label: lb }), a: first ? t("Start with {channel}. {note}", lang, { channel: [hs(first.k, lang), hs(first.v, lang)].filter(Boolean).join(": "), note: hs(filing.note || "", lang) }).trim() : hs(filing.note || "", lang) },
    { q: t("How long should it take?", lang), a: main ? [main.dl ? `${hs(main.t, lang)}: ${hs(main.dl, lang)}.` : "", hs(main.right || "", lang)].filter(Boolean).join(" ") : t("Keep the ticket number; only you can close it.", lang) },
    { q: t("What if nothing happens?", lang), a: ladder.length ? t("Escalate step by step: {steps}", lang, { steps: ladder.map((s, i) => `${i + 1}. ${hs(s, lang)}`).join(" ") }) : hs(main && main.why ? main.why : "", lang) }
  ];
}

// opts: { lang, live: { topic, posts }, social }
export function renderGuide(cat, opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const G = gvf();
  const lb = label(cat, lang);
  const title = guideTitle(cat, lang);
  const path = `/guide/${cat.id}`;
  const filing = (G.FILING || {})[cat.id] || cat.filing || {};
  const charters = chartersFor(cat);
  const roles = (cat.roles || []).map((r) => ({ id: r, ...(G.ROLES || {})[r] })).filter((r) => r && r.b);
  const faq = faqFor(cat, lang);
  const ladder = Array.isArray(cat.ladder) ? cat.ladder : [];
  const topic = opts.live && opts.live.topic;
  const posts = (opts.live && Array.isArray(opts.live.posts)) ? opts.live.posts : [];
  const description = `${hs(cat.agency || "", lang)}. ${hs(cat.owns || "", lang)}`;
  const checked = factsChecked();

  const rolesHtml = roles.length ? `<h3>${esc(lang === "hi" ? "शामिल कार्यालय" : "Offices involved")}</h3><ul class="ch">${roles.map((r) => {
    const link = (r.links || []).map((l) => Array.isArray(l) ? l : null).find((l) => l && linkOf(l[1]));
    return `<li><span><span class="k">${esc(hs(r.b, lang))}</span>${esc(hs(r.owns || "", lang))}${link ? ` <a href="${esc(link[1])}" target="_blank" rel="noopener">${esc(hs(link[0], lang))}</a>` : ""}</span></li>`;
  }).join("")}</ul>` : "";

  const channels = (cat.channels || []).map((c) => channelHtml(c, lang)).join("");

  const filingHtml = `
    <p>${filing.url && linkOf(filing.url) ? `<a href="${esc(filing.url)}" target="_blank" rel="noopener"><b>${esc(hs(filing.portal || "", lang))}</b></a>` : `<b>${esc(hs(filing.portal || "", lang))}</b>`}${filing.note ? ` ${esc(hs(filing.note, lang))}` : ""}</p>
    ${Array.isArray(filing.fields) && filing.fields.length ? `<h3>${esc(t("Details", lang))}</h3><dl class="sx-dl">${filing.fields.map((f) => fieldRow(f, lang)).join("")}</dl>` : ""}
    ${Array.isArray(filing.docs) && filing.docs.length ? `<h3>${esc(t("Documents", lang))}</h3><dl class="sx-dl">${filing.docs.map((f) => fieldRow(f, lang)).join("")}</dl>` : ""}`;

  const charterHtml = charters.map((c) => `<div class="sx-box"><h3>${esc(hs(c.t, lang))}</h3><p><b>${esc(hs(c.right || "", lang))}</b></p>${c.dl ? `<p><span class="tag tag-blue">${esc(t("Deadline", lang))}: ${esc(hs(c.dl, lang))}</span></p>` : ""}${Array.isArray(c.how) && c.how.length ? `<ol class="steps">${c.how.map((h) => `<li>${esc(hs(h, lang))}</li>`).join("")}</ol>` : ""}${c.why ? `<p class="small muted">${esc(hs(c.why, lang))}</p>` : ""}${Array.isArray(c.src) && c.src.length ? `<p class="small">${esc(t("Sources", lang))}: ${c.src.filter((s) => Array.isArray(s) && linkOf(s[1])).map((s) => `<a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(hs(s[0], lang))}</a>`).join(" · ")}</p>` : ""}</div>`).join("");

  const trendWord = topic ? (topic.trend === "up" ? "rising" : topic.trend === "down" ? "falling" : "steady") : "";
  const weekHtml = (topic || posts.length) ? `<section class="sx-box" aria-labelledby="week"><h2 id="week">${esc(t("This week", lang))}</h2>
    ${topic ? `<p><b>${esc(t("{n} public mentions this week", lang, { n: topic.count }))}</b> · ${esc(t(trendWord, lang))}${topic.areas.length ? `<br><span class="small muted">${esc(t("Most about: {areas}", lang, { areas: topic.areas.map((a) => hs(a, lang)).join(", ") }))}</span>` : ""}</p>` : ""}
    ${posts.length ? `<h3>${esc(t("Related updates", lang))}</h3><ul class="linklist">${posts.map((p) => `<li><a href="${esc(langPath(`/blog/${p.slug}`, lang))}">${esc((lang === "hi" && p.title_hi) || p.title)}</a>${p.date ? ` <span class="small muted">${esc(fmtDate(p.date, lang))}</span>` : ""}</li>`).join("")}</ul>` : ""}
  </section>` : "";

  const others = (G.CATS || []).filter((c) => c.id !== cat.id);
  const body = `
<h1>${esc(guideHeading(cat, lang))}</h1>
<p class="lead">${esc(hs(cat.agency || "", lang))}</p>
<div class="sx-grid">
<div>
  <section aria-labelledby="who"><h2 id="who">${esc(t("Who is responsible", lang))}</h2><p>${esc(hs(cat.owns || "", lang))}</p>${rolesHtml}</section>
  <section aria-labelledby="how"><h2 id="how">${esc(t("How to complain", lang))}</h2><ul class="ch">${channels}</ul></section>
  <section aria-labelledby="portal"><h2 id="portal">${esc(t("What the portal asks for", lang))}</h2>${filingHtml}</section>
  <section aria-labelledby="ladder"><h2 id="ladder">${esc(t("If nothing happens: the escalation ladder", lang))}</h2><ol class="steps saffron">${ladder.map((s) => `<li>${esc(hs(s, lang))}</li>`).join("")}</ol></section>
  <section aria-labelledby="rights"><h2 id="rights">${esc(t("Your rights and deadlines", lang))}</h2><div class="cards" style="grid-template-columns:1fr">${charterHtml}</div></section>
  <section class="sx-faq" aria-labelledby="faq"><h2 id="faq">${esc(t("Common questions", lang))}</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>
  <p class="small muted"><time datetime="${esc(isoDate(checked))}">${esc(t("Facts and official links last checked on {d}.", lang, { d: fmtDate(checked, lang) }))}</time></p>
</div>
<aside>
  ${weekHtml}
  <div class="sx-cta"><h2>${esc(t("Report it through the Forum", lang))}</h2><p>${esc(t("The Forum files it with the right desk, tracks the ticket and escalates when nothing moves. No names appear in public.", lang))}</p><a class="btn btn-primary" href="/report/${esc(cat.id)}">${esc(t("Report it through the Forum", lang))}</a></div>
  <section class="sx-box" style="margin-top:1.25rem" aria-labelledby="others"><h3 id="others">${esc(t("Other guides", lang))}</h3><ul class="linklist">${others.map((c) => `<li><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(label(c, lang))}</a></li>`).join("")}</ul></section>
</aside>
</div>`;

  const ld = [
    breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Guides", lang), path: langPath("/guides", lang) }, { name: lb, path: langPath(path, lang) }]),
    { "@context": "https://schema.org", "@type": "HowTo", name: title, description: describeHowTo(cat, lang), inLanguage: lang === "hi" ? "hi-IN" : "en-IN", dateModified: isoDate(checked),
      step: ladder.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: `${i + 1}`, text: hs(s, lang) })) },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }
  ];
  return page({ lang, path, title, description, body, ld, ogType: "article", social: opts.social, share: { title },
    crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Guides", lang), path: "/guides" }, { name: lb, path }] });
}

const describeHowTo = (cat, lang) => `${hs(cat.agency || "", lang)}. ${hs(cat.owns || "", lang)}`.trim();

export function renderGuides(opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const G = gvf();
  const title = t("Issue guides for Gurugram (Gurgaon)", lang);
  const description = t("Who fixes what in Gurugram, how to complain, what the portal asks for, and how to escalate. One guide per issue type, from the Forum's own directory.", lang);
  const cards = (G.CATS || []).map((c) => `<article class="card"><h3><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(label(c, lang))}</a></h3><p>${esc(hs(c.agency || "", lang))}</p><p class="small muted">${esc(hs(c.owns || "", lang))}</p><p><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(t("Read the guide", lang))} ›</a></p></article>`).join("");
  const wards = (G.WARDS || []).map((w) => `<li><a href="${esc(langPath(`/ward/${w[0]}`, lang))}" aria-label="${esc(t("Ward {n}", lang, { n: w[0] }))}">${w[0]}</a></li>`).join("");
  const posts = (opts.posts || []).slice(0, 6).map((p) => `<li><a href="${esc(langPath(`/blog/${p.slug}`, lang))}">${esc((lang === "hi" && p.title_hi) || p.title)}</a></li>`).join("");
  const body = `
<h1>${esc(title)}</h1>
<p class="lead">${esc(description)}</p>
<div class="cards">${cards}</div>
<h2>${esc(t("Your ward", lang))}</h2>
<p>${esc(t("Councillor pages for all 36 wards of the Municipal Corporation of Gurugram.", lang))}</p>
<ul class="sx-wards">${wards}</ul>
${posts ? `<h2>${esc(t("From the blog", lang))}</h2><ul class="linklist">${posts}</ul><p><a href="${esc(langPath("/blog", lang))}">${esc(t("Blog", lang))} ›</a></p>` : ""}
<div class="sx-cta"><h2>${esc(t("Report it through the Forum", lang))}</h2><p>${esc(t("The Forum files it with the right desk, tracks the ticket and escalates when nothing moves. No names appear in public.", lang))}</p><a class="btn btn-primary" href="/report">${esc(t("Report", lang))}</a></div>`;
  const ld = [
    breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Guides", lang), path: langPath("/guides", lang) }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url: abs(langPath("/guides", lang)), inLanguage: lang === "hi" ? "hi-IN" : "en-IN", dateModified: isoDate(factsChecked()),
      hasPart: (G.CATS || []).map((c) => ({ "@type": "WebPage", name: guideTitle(c, lang), url: abs(langPath(`/guide/${c.id}`, lang)) })) }
  ];
  return page({ lang, path: "/guides", title, description, body, ld, social: opts.social, crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Guides", lang), path: "/guides" }] });
}
