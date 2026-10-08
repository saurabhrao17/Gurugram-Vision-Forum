// Content clusters: one per issue type (GVF.CATS, 17 today). The pillar is
// the server-rendered guide /guide/:issue; the members are the published
// stories and news that belong to it, decided by their tags (an issue id in
// the tags; a static GVF.BLOG entry names its issue in `k`) and, failing
// that, by the keyword classifier the pulse uses on the title and summary
// when it finds at least two of an issue's keywords. Pages link inside their cluster automatically:
// the guide lists its members, each post links back to its pillar guide and
// to up to three siblings. The desk's SEO tab reads clusterHealth() for
// coverage, freshness and demand (public mentions in the last fortnight),
// with the next action for each cluster. Built only from the site's own
// data; nothing about any report is read here.
import { gvf } from "../site-data.js";
import { classify } from "../signals.js";

const DAY = 86400000;
export const MAX_CLUSTERS_PER_POST = 2;
export const SIBLINGS = 3;
export const STALE_DAYS = 90;
export const MIN_CLASSIFY = 2;

const catIds = (cats) => new Set((cats || []).map((c) => c.id));

// The clusters one post belongs to: issue ids from its tags first, then the
// classifier's pick from the title and summary when no tag names an issue.
export function clustersOf(post, cats = gvf().CATS || []) {
  if (!post) return [];
  const ids = catIds(cats);
  const out = [];
  for (const t of Array.isArray(post.tags) ? post.tags : []) {
    const id = String(t || "").toLowerCase().trim();
    if (ids.has(id) && !out.includes(id)) out.push(id);
  }
  if (!out.length) {
    // Only on strong evidence (two or more of the issue's keywords): general
    // explainers stay outside every cluster rather than land in the wrong one.
    const { issue_type, score } = classify(`${post.title || ""}. ${post.summary || ""}`);
    if (score >= MIN_CLASSIFY && ids.has(issue_type)) out.push(issue_type);
  }
  return out.slice(0, MAX_CLUSTERS_PER_POST);
}

// The members of one cluster, newest first.
export function membersOf(id, posts, cats) {
  return (posts || []).filter((p) => clustersOf(p, cats).includes(id));
}

// For a post page: its pillar guides and up to SIBLINGS other posts that
// share a cluster, newest first, the post itself left out.
export function relatedFor(post, posts, cats = gvf().CATS || []) {
  const ids = clustersOf(post, cats);
  const byId = new Map((cats || []).map((c) => [c.id, c]));
  const pillars = ids.map((id) => byId.get(id)).filter(Boolean);
  const siblings = (posts || []).filter((p) => p && p.slug !== post.slug && clustersOf(p, cats).some((id) => ids.includes(id))).slice(0, SIBLINGS);
  return { pillars, siblings };
}

// Cluster health for the desk. signals: [{ issue_type, posted_at }] from the
// public pulse; pages: seo_pages rows (to read the pillar's audit score).
export function clusterHealth({ posts = [], signals = [], pages = [], cats = gvf().CATS || [], now = Date.now(), days = 14 } = {}) {
  const since = now - days * DAY;
  const demand = new Map();
  for (const s of signals || []) {
    const t = Date.parse(s.posted_at || 0) || 0;
    if (t >= since && s.issue_type) demand.set(s.issue_type, (demand.get(s.issue_type) || 0) + 1);
  }
  const pageBy = new Map((pages || []).map((p) => [p.path, p]));
  return (cats || []).map((c) => {
    const members = membersOf(c.id, posts, cats);
    const latest = members.reduce((m, p) => { const t = p.date ? new Date(p.date).getTime() : 0; return t > m ? t : m; }, 0);
    const ageDays = latest ? Math.floor((now - latest) / DAY) : null;
    const pillar = pageBy.get(`/guide/${c.id}`);
    // "Something else" is the classifier's catch-all, not a topic: its
    // mentions are noise for content planning.
    const want = c.id === "other" ? 0 : (demand.get(c.id) || 0);
    let status = "ok", action = "Nothing to do; the cluster is covered and fresh.";
    if (!members.length && want) { status = "gap"; action = `Write the first post: ${want} public mentions in ${days} days and nothing published yet.`; }
    else if (!members.length) { status = "thin"; action = "Only the guide so far; one explainer or local story would start the cluster."; }
    else if (ageDays != null && ageDays > STALE_DAYS && want) { status = "stale"; action = `Refresh: the newest post is ${ageDays} days old and residents are still talking about it.`; }
    else if (ageDays != null && ageDays > STALE_DAYS) { status = "stale"; action = `The newest post is ${ageDays} days old; a short update keeps the cluster fresh.`; }
    return {
      id: c.id, label: c.label, pillar: `/guide/${c.id}`,
      pillar_score: pillar && Number.isFinite(pillar.score) ? pillar.score : null,
      members: members.length, latest: latest ? new Date(latest).toISOString() : null, age_days: ageDays,
      demand: want, status, action,
      posts: members.slice(0, 5).map((p) => ({ slug: p.slug, title: p.title, date: p.date ? new Date(p.date).toISOString() : null }))
    };
  }).sort((a, b) => ({ gap: 0, stale: 1, thin: 2, ok: 3 }[a.status] - { gap: 0, stale: 1, thin: 2, ok: 3 }[b.status]) || b.demand - a.demand);
}
