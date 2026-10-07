// Live data for the server-rendered pages, read with the service role and
// reduced to what the public may see (CLAUDE.md privacy rules). Every reader
// swallows its own failure and returns an empty shape, so a page renders
// from site/data.js alone when Supabase is slow or down.
import { sanitizeHtml, mediaUrl } from "../content.js";
import { gvf, hs } from "../site-data.js";

export const POST_COLS = "slug, kind, title, title_hi, summary, summary_hi, body, body_hi, media_path, tags, published, published_at, created_at, author, source";
export const PUBLIC_MIN = 50; // no counts before this many public reports site-wide

const quiet = async (label, fn, fallback) => {
  try {
    const out = await fn();
    return out == null ? fallback : out;
  } catch (e) {
    console.error(`seo ${label} failed`, e && e.message ? e.message : e);
    return fallback;
  }
};

// Social links from site_settings for Organization.sameAs.
export function social(sb) {
  return quiet("social", async () => {
    if (!sb) return {};
    const { data, error } = await sb.from("site_settings").select("value").eq("key", "social").maybeSingle();
    if (error) throw error;
    return (data && data.value && typeof data.value === "object") ? data.value : {};
  }, {});
}

// Latest published pulse topic for one issue type.
export function topicFor(sb, issue) {
  return quiet("insight", async () => {
    if (!sb) return null;
    const { data, error } = await sb.from("insights").select("generated_at, period_start, period_end, data").eq("published", true).order("generated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    const topics = data && data.data && Array.isArray(data.data.topics) ? data.data.topics : [];
    const tp = topics.find((x) => x && x.issue_type === issue);
    if (!tp) return null;
    return {
      count: Number(tp.count) || 0,
      trend: tp.trend === "up" || tp.trend === "down" ? tp.trend : "flat",
      areas: (Array.isArray(tp.areas) ? tp.areas : []).map((a) => (a && a.area ? String(a.area) : "")).filter(Boolean).slice(0, 5),
      generated_at: data.generated_at || null,
      period: data.data.period || { from: data.period_start, to: data.period_end }
    };
  }, null);
}

// Up to five published posts tagged with the issue id.
export function postsFor(sb, issue, env = process.env) {
  return quiet("posts-for", async () => {
    if (!sb) return [];
    const { data, error } = await sb.from("posts").select(POST_COLS).eq("published", true).contains("tags", [issue]).order("published_at", { ascending: false }).limit(5);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((r) => normalisePost(r, env)).filter(Boolean);
  }, []);
}

// Areas (sectors, colonies) mapped to a ward.
export function wardAreas(sb, n) {
  return quiet("area_wards", async () => {
    if (!sb) return [];
    const { data, error } = await sb.from("area_wards").select("area, note").eq("ward", n).order("area", { ascending: true });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((r) => ({ area: String(r.area || ""), note: r.note ? String(r.note) : "" })).filter((r) => r.area);
  }, []);
}

// Public reports in a ward: counts by stage (only when the site-wide total
// is at least PUBLIC_MIN) and the ten most recent, reduced to ref, issue,
// stage and date.
export function wardReports(sb, n) {
  return quiet("public_reports", async () => {
    if (!sb) return { total: null, counts: null, recent: [] };
    const [tot, inWard, recent] = await Promise.all([
      sb.from("public_reports").select("ref", { count: "exact", head: true }),
      sb.from("public_reports").select("stage").eq("ward", n),
      sb.from("public_reports").select("ref, issue_type, issue_label, stage, created_at").eq("ward", n).order("created_at", { ascending: false }).limit(10)
    ]);
    if (tot.error) throw tot.error;
    if (inWard.error) throw inWard.error;
    if (recent.error) throw recent.error;
    const total = Number(tot.count) || 0;
    let counts = null;
    if (total >= PUBLIC_MIN) {
      counts = [0, 0, 0, 0, 0];
      for (const r of Array.isArray(inWard.data) ? inWard.data : []) {
        const s = Number(r && r.stage);
        if (s >= 0 && s <= 4) counts[s] += 1;
      }
    }
    const rows = (Array.isArray(recent.data) ? recent.data : []).map((r) => ({
      ref: String(r.ref || ""), issue_type: String(r.issue_type || ""), issue_label: r.issue_label ? String(r.issue_label) : "",
      stage: Math.min(Math.max(Number(r.stage) || 0, 0), 4), created_at: r.created_at || null
    })).filter((r) => /^GVF-\d{4}-[A-Z2-9]{5}$/.test(r.ref));
    return { total, counts, recent: rows };
  }, { total: null, counts: null, recent: [] });
}

// Published stories and news with a slug, newest first.
export function blogPosts(sb, env = process.env, limit = 100) {
  return quiet("posts", async () => {
    if (!sb) return [];
    const { data, error } = await sb.from("posts").select(POST_COLS).eq("published", true).in("kind", ["story", "news"]).not("slug", "is", null).order("published_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((r) => normalisePost(r, env)).filter(Boolean);
  }, []);
}

export function blogPost(sb, slug, env = process.env) {
  return quiet("post", async () => {
    if (!sb) return null;
    const { data, error } = await sb.from("posts").select(POST_COLS).eq("published", true).eq("slug", slug).limit(1).maybeSingle();
    if (error) throw error;
    return data ? normalisePost(data, env) : null;
  }, null);
}

// --- Post shapes ------------------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// "25 Sep 2026" or an ISO string -> Date, or null.
export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo == null) return null;
    return new Date(Date.UTC(Number(m[3]), mo, Number(m[1])));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const isoDate = (d) => (d ? d.toISOString().slice(0, 10) : null);

export function fmtDate(d, lang) {
  const dt = parseDate(d);
  if (!dt) return "";
  try {
    return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(dt);
  } catch {
    return dt.toISOString().slice(0, 10);
  }
}

const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// A posts row -> the shape the blog pages render. Body HTML is sanitised
// again here even though it was sanitised on write.
export function normalisePost(row, env = process.env) {
  if (!row || typeof row !== "object") return null;
  const slug = str(row.slug, 120);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  const kind = row.kind === "news" ? "news" : "story";
  const date = parseDate(row.published_at) || parseDate(row.created_at);
  const supabaseUrl = env && env.SUPABASE_URL;
  const media = row.media_path && supabaseUrl ? mediaUrl(supabaseUrl, row.media_path) : null;
  return {
    slug, kind, source: str(row.source, 120), author: str(row.author, 120),
    title: str(row.title, 300), title_hi: str(row.title_hi, 300),
    summary: str(row.summary, 1000), summary_hi: str(row.summary_hi, 1000),
    body: sanitizeHtml(row.body || ""), body_hi: sanitizeHtml(row.body_hi || ""),
    media_url: media, tags: Array.isArray(row.tags) ? row.tags.map((x) => str(x, 40)).filter(Boolean) : [],
    date, tag: kind === "news" ? "News" : "Story", static: false
  };
}

// A static GVF.BLOG entry -> the same shape.
export function staticPost(b) {
  if (!b || !b.slug) return null;
  return {
    slug: String(b.slug), kind: "story", source: "", author: "",
    title: String(b.t || ""), title_hi: hs(b.t || "", "hi") === b.t ? "" : hs(b.t || "", "hi"),
    summary: String(b.x || ""), summary_hi: hs(b.x || "", "hi") === b.x ? "" : hs(b.x || "", "hi"),
    body: sanitizeHtml(b.b || ""), body_hi: sanitizeHtml(b.hb || ""),
    media_url: null, tags: [], date: parseDate(b.d), tag: String(b.tag || "Guide"), static: true
  };
}

export function staticPosts() {
  return (gvf().BLOG || []).map(staticPost).filter(Boolean);
}

// Static and live posts by slug; a live row with the same slug wins.
export function mergePosts(live) {
  const map = new Map();
  for (const p of staticPosts()) map.set(p.slug, p);
  for (const p of Array.isArray(live) ? live : []) if (p) map.set(p.slug, p);
  return [...map.values()].sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
}
