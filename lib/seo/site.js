// Site-wide constants for the server-rendered pages and the sitemap.

// Bump when the page templates change so crawlers see a new lastmod on the
// guide and ward pages (posts carry their own published_at).
export const BUILD_DATE = "2026-10-08";

export const ORG = {
  name: "Gurugram Vision Forum",
  nameHi: "गुरुग्राम विज़न फ़ोरम",
  address: "Sector 29, Gurugram"
};

// Production origin: explicit SITE_URL, else the Vercel production URL, else
// the registered domain. No trailing slash.
export function siteUrl(env = process.env) {
  const explicit = env.SITE_URL && String(env.SITE_URL).trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL && String(env.VERCEL_PROJECT_PRODUCTION_URL).trim();
  if (vercel) return ("https://" + vercel.replace(/^https?:\/\//, "")).replace(/\/+$/, "");
  return "https://gurugramvisionforum.org";
}

export const SITE_URL = siteUrl();

// Hash routes of the app that the sitemap lists as real URLs.
export const APP_ROUTES = ["/", "/report", "/directory", "/rights", "/wards", "/charter", "/dashboard", "/updates", "/join", "/about", "/news", "/pulse", "/privacy"];

// Issue ids with a guide page: every GVF.CATS entry.
export const WARD_COUNT = 36;
