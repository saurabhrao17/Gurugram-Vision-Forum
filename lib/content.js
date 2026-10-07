// Content the team publishes from the desk: validation, HTML sanitising and
// slugs, shared by the public and triage handlers.
import { text } from "./http.js";

export const KINDS = ["story", "news", "photo", "video", "social", "testimonial", "popup"];
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "application/pdf"];
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const EMBED_HOSTS = ["x.com", "twitter.com", "facebook.com", "instagram.com", "youtube.com", "youtu.be"];

// Everything the public site may see; created_by stays inside.
export const PUBLIC_COLUMNS = [
  "id", "kind", "slug", "title", "title_hi", "summary", "summary_hi", "body", "body_hi",
  "media_path", "media_type", "link_url", "embed_url", "source", "author", "quote_by", "tags",
  "published", "published_at", "pinned", "starts_at", "ends_at", "created_at", "updated_at"
];

export const LIMITS = { title: 200, summary: 500, body: 20000, tags: 10, tag: 30, short: 120, path: 300 };

// --- HTML sanitiser ---------------------------------------------------------
// Tag allowlist with the attributes each may keep. Anything else is dropped
// (the tag, not its text); script and style lose their contents too.
const ALLOWED = {
  p: [], br: [], b: [], strong: [], i: [], em: [], ul: [], ol: [], li: [], h2: [], h3: [], blockquote: [],
  a: ["href", "target", "rel"], img: ["src", "alt"]
};
const VOID = new Set(["br", "img"]);
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template"]);

const attrEscape = (v) => String(v).replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanUrl(raw, { httpsOnly } = {}) {
  const v = String(raw || "").replace(/[\u0000-\u001f\u007f\s]+/g, "").trim();
  if (!v) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (httpsOnly) return s === "https" ? v : null;
    if (s === "http" || s === "https" || s === "mailto" || s === "tel") return v;
    return null;
  }
  if (v.startsWith("//")) return null;
  return v.startsWith("/") || v.startsWith("#") || /^[\w.\-]/.test(v) ? v : null;
}

export const isExternalUrl = (v) => /^https?:\/\//i.test(String(v || ""));

function parseAttrs(s) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

export function sanitizeHtml(html) {
  const src = String(html || "");
  let out = "";
  let i = 0;
  let skipUntil = null; // tag name whose contents we are dropping
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const before = src.slice(i, m.index);
    if (!skipUntil) out += before;
    i = m.index + m[0].length;
    const whole = m[0];
    const name = (m[1] || "").toLowerCase();
    if (!name) continue; // comment or CDATA: dropped
    const closing = whole.startsWith("</");
    if (skipUntil) { if (closing && name === skipUntil) skipUntil = null; continue; }
    if (DROP_CONTENT.has(name)) { if (!closing && !whole.endsWith("/>")) skipUntil = name; continue; }
    if (!(name in ALLOWED)) continue;
    if (closing) { if (!VOID.has(name)) out += `</${name}>`; continue; }
    const attrs = parseAttrs(m[2] || "");
    const keep = [];
    if (name === "a") {
      const href = cleanUrl(attrs.href);
      if (href) {
        keep.push(`href="${attrEscape(href)}"`);
        if (isExternalUrl(href)) keep.push('target="_blank"', 'rel="noopener"');
      }
    } else if (name === "img") {
      const srcUrl = cleanUrl(attrs.src, { httpsOnly: true });
      if (!srcUrl) continue;
      keep.push(`src="${attrEscape(srcUrl)}"`);
      if (attrs.alt != null) keep.push(`alt="${attrEscape(attrs.alt)}"`);
    }
    out += `<${name}${keep.length ? " " + keep.join(" ") : ""}>`;
  }
  if (!skipUntil) out += src.slice(i);
  return out.trim();
}

// --- Slugs ------------------------------------------------------------------
export function slugify(title) {
  return String(title || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "post";
}

const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function slugFor(title, rand = Math.random) {
  let s = "";
  for (let i = 0; i < 5; i++) s += SUFFIX_ALPHABET[Math.floor(rand() * SUFFIX_ALPHABET.length)];
  return `${slugify(title)}-${s}`;
}

// --- Validation -------------------------------------------------------------
export function httpsUrl(v, max = 500) {
  const s = text(v, max);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname) return null;
    return u.toString();
  } catch { return null; }
}

export function embedHostOk(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EMBED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch { return false; }
}

export function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

// ISO date -> normalised ISO string, "" to clear, null when invalid.
export function isoDate(v) {
  if (v == null || v === "") return "";
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function cleanTags(v) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (!list) return null;
  const out = [];
  for (const t of list) {
    if (typeof t !== "string") return null;
    const s = t.trim().replace(/\s+/g, " ").slice(0, LIMITS.tag);
    if (s && !out.includes(s)) out.push(s);
    if (out.length > LIMITS.tags) return null;
  }
  return out;
}

// Returns { value, errors }. value holds only the fields present in input
// (all of the required ones when not partial), cleaned and ready to store.
export function validatePost(input, { partial = false } = {}) {
  const b = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const errors = [];
  const value = {};
  const has = (k) => k in b;

  if (has("kind") || !partial) {
    const kind = text(b.kind, 20).toLowerCase();
    if (KINDS.includes(kind)) value.kind = kind; else errors.push("kind");
  }
  if (has("title") || !partial) {
    const t = text(b.title, LIMITS.title + 1);
    if (t.length >= 1 && t.length <= LIMITS.title) value.title = t; else errors.push("title");
  }
  const bounded = (k, max) => {
    if (!has(k)) return;
    if (b[k] != null && typeof b[k] !== "string") { errors.push(k); return; }
    const s = text(b[k] || "", max + 1);
    if (s.length > max) errors.push(k); else value[k] = s;
  };
  bounded("title_hi", LIMITS.title);
  bounded("summary", LIMITS.summary);
  bounded("summary_hi", LIMITS.summary);
  bounded("source", LIMITS.short);
  bounded("author", LIMITS.short);
  bounded("quote_by", LIMITS.short);

  for (const k of ["body", "body_hi"]) {
    if (!has(k)) continue;
    if (b[k] != null && typeof b[k] !== "string") { errors.push(k); continue; }
    const clean = sanitizeHtml(b[k] || "");
    if (clean.length > LIMITS.body) errors.push(k); else value[k] = clean;
  }

  if (has("media_path")) {
    const p = text(b.media_path, LIMITS.path);
    if (!p) value.media_path = "";
    else if (/^posts\/[\w.\-\/]+$/.test(p) && !p.includes("..")) value.media_path = p;
    else errors.push("media_path");
  }
  if (has("media_type")) {
    const t = text(b.media_type, 60);
    if (!t || MEDIA_TYPES.includes(t)) value.media_type = t; else errors.push("media_type");
  }

  for (const k of ["link_url", "embed_url"]) {
    if (!has(k)) continue;
    const u = httpsUrl(b[k]);
    if (u === null) { errors.push(k); continue; }
    if (k === "embed_url" && u && !embedHostOk(u)) { errors.push(k); continue; }
    value[k] = u;
  }

  if (has("tags")) {
    const tags = cleanTags(b.tags);
    if (tags) value.tags = tags; else errors.push("tags");
  }
  if (has("published")) value.published = toBool(b.published);
  if (has("pinned")) value.pinned = toBool(b.pinned);

  for (const k of ["published_at", "starts_at", "ends_at"]) {
    if (!has(k)) continue;
    const d = isoDate(b[k]);
    if (d === null) errors.push(k); else value[k] = d || null;
  }
  if (value.starts_at && value.ends_at && value.ends_at <= value.starts_at) errors.push("ends_at");

  return { value, errors: [...new Set(errors)] };
}

export function publicPost(row, supabaseUrl) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const k of PUBLIC_COLUMNS) if (k in row) out[k] = row[k];
  out.media_url = row.media_path && supabaseUrl ? mediaUrl(supabaseUrl, row.media_path) : null;
  return out;
}

export const mediaUrl = (supabaseUrl, path) =>
  `${String(supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/public/media/${String(path).split("/").map(encodeURIComponent).join("/")}`;
