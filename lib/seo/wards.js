// Ward pages: councillor and party (a factual field, as elected), the areas
// the volunteers mapped to the ward, and the public, anonymised reports.
import { gvf, hs } from "../site-data.js";
import { STAGES } from "../inbound.js";
import { esc, page, breadcrumbLd, langPath, abs } from "./layout.js";
import { t } from "./i18n.js";
import { fmtDate } from "./data.js";
import { label as catLabel } from "./guides.js";
import { WARD_COUNT } from "./site.js";

export function wardById(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > WARD_COUNT) return null;
  const row = (gvf().WARDS || []).find((w) => Array.isArray(w) && Number(w[0]) === num);
  return row ? { n: num, name: String(row[1] || ""), party: String(row[2] || "") } : null;
}

const STAGE_TAG = ["tag", "tag-blue", "tag-blue", "tag-saffron", "tag-green"];
const stageName = (i, lang) => (STAGES[i] ? (lang === "hi" ? STAGES[i][1] : STAGES[i][0]) : "");

// Guides most wards ask about, shown as "neighbouring guides".
const COMMON_GUIDES = ["roads", "waste", "water", "drains", "lights", "parks", "animals", "construction"];

// opts: { lang, live: { areas, reports: { total, counts, recent } }, social }
export function renderWard(w, opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const G = gvf();
  const path = `/ward/${w.n}`;
  const name = lang === "hi" ? hs(w.name, lang) : w.name;
  const party = lang === "hi" ? hs(w.party, lang) : w.party;
  const title = t("Ward {n}, Gurugram: councillor, sectors and public reports", lang, { n: w.n });
  const description = t("Ward {n} of the Municipal Corporation of Gurugram: councillor {name}, the sectors and colonies it covers, and the Forum's public reports from the ward.", lang, { n: w.n, name });
  const areas = (opts.live && Array.isArray(opts.live.areas)) ? opts.live.areas : [];
  const rep = (opts.live && opts.live.reports) || { total: null, counts: null, recent: [] };
  const recent = Array.isArray(rep.recent) ? rep.recent : [];
  const cats = G.CATS || [];
  const catOf = (id) => cats.find((c) => c.id === id);

  const areasHtml = areas.length
    ? `<ul class="sx-wards">${areas.map((a) => `<li><a href="/map?area=${encodeURIComponent(a.area)}" title="${esc(a.note || "")}">${esc(hs(a.area, lang))}</a></li>`).join("")}</ul>`
    : `<p class="muted">${esc(t("The sector-to-ward table is being checked by volunteers; areas appear here as they are confirmed.", lang))}</p>`;

  const countsHtml = Array.isArray(rep.counts)
    ? `<h3>${esc(t("Counts by stage", lang))}</h3><div class="glance">${rep.counts.map((n, i) => `<a href="/map"><b>${n}</b><span>${esc(stageName(i, lang))}</span></a>`).join("")}</div>`
    : "";

  const recentHtml = recent.length
    ? `<h3>${esc(t("Recent reports", lang))}</h3><table class="tbl"><thead><tr><th>${esc(t("Reference", lang))}</th><th>${esc(t("Issue", lang))}</th><th>${esc(t("Stage", lang))}</th><th>${esc(t("Date", lang))}</th></tr></thead><tbody>${recent.map((r) => {
      const c = catOf(r.issue_type);
      const lb = c ? catLabel(c, lang) : hs(r.issue_label || r.issue_type, lang);
      return `<tr><td data-l="${esc(t("Reference", lang))}"><a href="/r/${esc(r.ref)}">${esc(r.ref)}</a></td><td data-l="${esc(t("Issue", lang))}">${c ? `<a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(lb)}</a>` : esc(lb)}</td><td data-l="${esc(t("Stage", lang))}"><span class="tag ${STAGE_TAG[r.stage] || "tag"}">${esc(stageName(r.stage, lang))}</span></td><td data-l="${esc(t("Date", lang))}">${esc(r.created_at ? fmtDate(r.created_at, lang) : "")}</td></tr>`;
    }).join("")}</tbody></table>`
    : `<p class="muted">${esc(t("No public reports from this ward yet.", lang))}</p>`;

  const prev = w.n > 1 ? w.n - 1 : null, next = w.n < WARD_COUNT ? w.n + 1 : null;
  const neighbours = [prev, next].filter(Boolean).map((n) => `<li><a href="${esc(langPath(`/ward/${n}`, lang))}">${esc(t("Ward {n}", lang, { n }))}</a></li>`).join("");
  const guides = COMMON_GUIDES.map((id) => catOf(id)).filter(Boolean).map((c) => `<li><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(catLabel(c, lang))}</a></li>`).join("");

  const body = `
<h1>${esc(title)}</h1>
<p class="lead">${esc(t("A Forum volunteer covers this ward.", lang))}</p>
<div class="sx-grid">
<div>
  <section class="sx-box" aria-labelledby="cllr"><h2 id="cllr">${esc(t("Councillor", lang))}</h2><dl class="sx-dl"><div><dt>${esc(t("Councillor", lang))}</dt><dd>${esc(name)}</dd></div><div><dt>${esc(t("Party (as elected, March 2025)", lang))}</dt><dd>${esc(party)}</dd></div></dl></section>
  <section aria-labelledby="areas"><h2 id="areas">${esc(t("Areas in this ward", lang))}</h2>${areasHtml}</section>
  <section aria-labelledby="reports"><h2 id="reports">${esc(t("Public reports from the ward", lang))}</h2><p class="small muted">${esc(t("Public view: issue, place and stage only. No names, no contact details.", lang))}</p>${countsHtml}${recentHtml}</section>
</div>
<aside>
  <div class="sx-cta"><h2>${esc(t("Report a problem in ward {n}", lang, { n: w.n }))}</h2><p>${esc(t("The Forum files it with the right desk, tracks the ticket and escalates when nothing moves. No names appear in public.", lang))}</p><a class="btn btn-primary" href="/report">${esc(t("Report", lang))}</a></div>
  <section class="sx-box" style="margin-top:1.25rem" aria-labelledby="gl"><h3 id="gl">${esc(t("Guides for common problems", lang))}</h3><ul class="linklist">${guides}</ul><p><a href="${esc(langPath("/guides", lang))}">${esc(t("All guides", lang))} ›</a></p></section>
  <section class="sx-box" style="margin-top:1.25rem" aria-labelledby="nb"><h3 id="nb">${esc(t("Neighbouring wards", lang))}</h3><ul class="linklist">${neighbours}</ul><p><a href="/wards">${esc(t("All 36 wards", lang))} ›</a></p></section>
</aside>
</div>`;

  const ld = [
    breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Wards", lang), path: "/wards" }, { name: t("Ward {n}", lang, { n: w.n }), path: langPath(path, lang) }]),
    { "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: abs(langPath(path, lang)), inLanguage: lang === "hi" ? "hi-IN" : "en-IN",
      about: { "@type": "AdministrativeArea", name: `Ward ${w.n}, Municipal Corporation of Gurugram`, containedInPlace: { "@type": "City", name: "Gurugram" } } }
  ];
  return page({ lang, path, title, description, body, ld, social: opts.social, share: { title },
    crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Wards", lang), path: "/wards" }, { name: t("Ward {n}", lang, { n: w.n }), path }] });
}
