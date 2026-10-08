// Ward pages: councillor and party (a factual field, as elected), the areas
// the volunteers mapped to the ward, and report COUNTS (by stage and by
// issue). Reports are confidential: nothing that identifies one report is
// ever rendered here.
import { gvf, hs } from "../site-data.js";
import { STAGES } from "../inbound.js";
import { esc, page, breadcrumbLd, langPath, abs } from "./layout.js";
import { t } from "./i18n.js";
import { label as catLabel } from "./guides.js";
import { WARD_COUNT } from "./site.js";
import { fmtDate, factsChecked, isoDate } from "./data.js";

export function wardById(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > WARD_COUNT) return null;
  const row = (gvf().WARDS || []).find((w) => Array.isArray(w) && Number(w[0]) === num);
  return row ? { n: num, name: String(row[1] || ""), party: String(row[2] || "") } : null;
}

const stageName = (i, lang) => (STAGES[i] ? (lang === "hi" ? STAGES[i][1] : STAGES[i][0]) : "");

// Guides most wards ask about, shown as "neighbouring guides".
const COMMON_GUIDES = ["roads", "waste", "water", "drains", "lights", "parks", "animals", "construction"];

// opts: { lang, live: { areas, counts: { total, by_stage, by_issue } | null }, social }
export function renderWard(w, opts = {}) {
  const lang = opts.lang === "hi" ? "hi" : "en";
  const G = gvf();
  const path = `/ward/${w.n}`;
  const name = lang === "hi" ? hs(w.name, lang) : w.name;
  const party = lang === "hi" ? hs(w.party, lang) : w.party;
  const title = t("Ward {n}, Gurugram: councillor, sectors and report counts", lang, { n: w.n });
  const description = t("Ward {n} of the Municipal Corporation of Gurugram: councillor {name}, the sectors and colonies it covers, how many civic problems residents have reported there and how many are resolved.", lang, { n: w.n, name });
  const areas = (opts.live && Array.isArray(opts.live.areas)) ? opts.live.areas : [];
  const counts = (opts.live && opts.live.counts && typeof opts.live.counts === "object") ? opts.live.counts : null;
  const cats = G.CATS || [];
  const catOf = (id) => cats.find((c) => c.id === id);

  const areasHtml = areas.length
    ? `<ul class="sx-wards">${areas.map((a) => `<li>${esc(hs(a.area, lang))}</li>`).join("")}</ul>`
    : `<p class="muted">${esc(t("The sector-to-ward table is being checked by volunteers; areas appear here as they are confirmed.", lang))}</p>`;

  // Counts only. Stage 0 and 1 are shown together as "received" (with the
  // Forum, being mapped), as on the dashboard.
  let countsHtml = "";
  if (counts && counts.total > 0) {
    const bs = counts.by_stage || [0, 0, 0, 0, 0];
    const cells = [[bs[0] + bs[1], t("Received", lang)], [bs[2], stageName(2, lang)], [bs[3], stageName(3, lang)], [bs[4], stageName(4, lang)]];
    const issues = (counts.by_issue || []).filter((r) => r.total > 0);
    countsHtml = `<div class="glance"><a href="/dashboard"><b>${counts.total}</b><span>${esc(t("Reports so far", lang))}</span></a>${cells.map(([n, l]) => `<a href="/dashboard"><b>${n}</b><span>${esc(l)}</span></a>`).join("")}</div>`
      + (issues.length ? `<h3>${esc(t("By issue", lang))}</h3><table class="tbl"><thead><tr><th>${esc(t("Issue", lang))}</th><th>${esc(t("Reports", lang))}</th><th>${esc(t("Resolved", lang))}</th></tr></thead><tbody>${issues.map((r) => {
        const c = catOf(r.issue_type);
        const lb = c ? catLabel(c, lang) : hs(r.label || r.issue_type, lang);
        return `<tr><td data-l="${esc(t("Issue", lang))}">${c ? `<a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(lb)}</a>` : esc(lb)}</td><td data-l="${esc(t("Reports", lang))}">${r.total}</td><td data-l="${esc(t("Resolved", lang))}">${r.resolved}</td></tr>`;
      }).join("")}</tbody></table>` : "");
  } else {
    countsHtml = `<p class="muted">${esc(t("No reports from this ward yet.", lang))}</p>`;
  }

  const L = G.L || {};
  const checked = factsChecked();
  const prev = w.n > 1 ? w.n - 1 : null, next = w.n < WARD_COUNT ? w.n + 1 : null;
  const neighbours = [prev, next].filter(Boolean).map((n) => `<li><a href="${esc(langPath(`/ward/${n}`, lang))}">${esc(t("Ward {n}", lang, { n }))}</a></li>`).join("");
  const guides = COMMON_GUIDES.map((id) => catOf(id)).filter(Boolean).map((c) => `<li><a href="${esc(langPath(`/guide/${c.id}`, lang))}">${esc(catLabel(c, lang))}</a></li>`).join("");

  const body = `
<h1>${esc(title)}</h1>
<p class="lead">${esc(t("Ward {n} of the Municipal Corporation of Gurugram is represented by councillor {name}.", lang, { n: w.n, name }))} ${esc(t("A Forum volunteer covers this ward.", lang))}</p>
<div class="sx-grid">
<div>
  <section class="sx-box" aria-labelledby="cllr"><h2 id="cllr">${esc(t("Councillor", lang))}</h2><dl class="sx-dl"><div><dt>${esc(t("Councillor", lang))}</dt><dd>${esc(name)}</dd></div><div><dt>${esc(t("Party (as elected, March 2025)", lang))}</dt><dd>${esc(party)}</dd></div></dl></section>
  <section aria-labelledby="areas"><h2 id="areas">${esc(t("Areas in this ward", lang))}</h2>${areasHtml}</section>
  <section aria-labelledby="reports"><h2 id="reports">${esc(t("Reports from this ward", lang))}</h2><p class="small muted">${esc(t("Counts only. What a resident reports stays with the Forum team: no reference, place, date or detail of any report is published.", lang))}</p>${countsHtml}</section>
  <p class="small">${esc(t("Sources", lang))}: <a href="${esc(L.mcg)}" target="_blank" rel="noopener">${esc(t("Municipal Corporation of Gurugram", lang))}</a> · <a href="${esc(L.districtReps)}" target="_blank" rel="noopener">${esc(t("Gurugram district: elected representatives", lang))}</a></p>
  <p class="small muted"><time datetime="${esc(isoDate(checked))}">${esc(t("Facts and official links last checked on {d}.", lang, { d: fmtDate(checked, lang) }))}</time></p>
</div>
<aside>
  <div class="sx-cta"><h2>${esc(t("Report a problem in ward {n}", lang, { n: w.n }))}</h2><p>${esc(t("The Forum files it with the right desk, tracks the ticket and escalates when nothing moves. No names appear in public.", lang))}</p><a class="btn btn-primary" href="/report">${esc(t("Report", lang))}</a></div>
  <section class="sx-box" style="margin-top:1.25rem" aria-labelledby="gl"><h3 id="gl">${esc(t("Guides for common problems", lang))}</h3><ul class="linklist">${guides}</ul><p><a href="${esc(langPath("/guides", lang))}">${esc(t("All guides", lang))} ›</a></p></section>
  <section class="sx-box" style="margin-top:1.25rem" aria-labelledby="nb"><h3 id="nb">${esc(t("Neighbouring wards", lang))}</h3><ul class="linklist">${neighbours}</ul><p><a href="/wards">${esc(t("All 36 wards", lang))} ›</a></p></section>
</aside>
</div>`;

  const ld = [
    breadcrumbLd([{ name: t("Home", lang), path: langPath("/", lang) }, { name: t("Wards", lang), path: "/wards" }, { name: t("Ward {n}", lang, { n: w.n }), path: langPath(path, lang) }]),
    { "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: abs(langPath(path, lang)), inLanguage: lang === "hi" ? "hi-IN" : "en-IN", dateModified: isoDate(checked),
      about: { "@type": "AdministrativeArea", name: `Ward ${w.n}, Municipal Corporation of Gurugram`, containedInPlace: { "@type": "City", name: "Gurugram" } } }
  ];
  return page({ lang, path, title, description, body, ld, social: opts.social, share: { title },
    crumbs: [{ name: t("Home", lang), path: "/" }, { name: t("Wards", lang), path: "/wards" }, { name: t("Ward {n}", lang, { n: w.n }), path }] });
}
