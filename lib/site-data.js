// The site's own content (site/data.js, window.GVF) loaded once on the
// server in a bare vm context, the way lib/signals.js loads the taxonomy.
// Used by the server-rendered pages (lib/seo) so that guides, wards and
// posts come from the same source of truth as the app.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const DATA_URL = new URL("../site/data.js", import.meta.url);

const cache = new Map();

export function loadGvf(url = DATA_URL) {
  const key = String(url);
  if (cache.has(key)) return cache.get(key);
  const src = readFileSync(url, "utf8");
  const window = {};
  const ctx = vm.createContext({ window, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(src, ctx, { filename: "data.js" });
  const G = window.GVF || {};
  cache.set(key, G);
  return G;
}

// The whole GVF object (CATS, FILING, CHARTERS, ROLES, WARDS, BLOG, HS, HI...).
export function gvf() {
  return loadGvf();
}

// English -> Hindi through GVF.HS, falling back to the English string.
// Mirrors hs() in site/app.js: values sent to the API stay English.
export function hs(s, lang = "hi") {
  if (lang !== "hi") return s == null ? "" : String(s);
  if (s == null) return "";
  const str = String(s);
  const HS = gvf().HS || {};
  const hit = HS[str];
  return typeof hit === "string" && hit ? hit : str;
}

// Static UI strings by key (GVF.HI), English fallback supplied by the caller.
export function hi(key, fallback = "") {
  const HI = gvf().HI || {};
  const v = HI[key];
  return typeof v === "string" && v ? v : fallback;
}

export const catById = (id) => (gvf().CATS || []).find((c) => c.id === id) || null;
