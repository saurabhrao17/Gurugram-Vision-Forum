// Single entry point for every /api/* route. The Hobby plan allows 12
// serverless functions per deployment; one router keeps us well inside it
// and makes adding routes a one-line change. Handlers live in lib/handlers.
// vercel.json rewrites /api/<anything> to /api/index?path=<anything>; a
// bracketed catch-all file only matched one segment on Vercel.
import report from "../lib/handlers/report.js";
import status from "../lib/handlers/status.js";
import join from "../lib/handlers/join.js";
import dashboard from "../lib/handlers/dashboard.js";
import ward from "../lib/handlers/ward.js";
import geocode from "../lib/handlers/geocode.js";
import reportUpload from "../lib/handlers/report-upload.js";
import reportAttach from "../lib/handlers/report-attach.js";
import triageLogin from "../lib/handlers/triage/login.js";
import triageRefresh from "../lib/handlers/triage/refresh.js";
import triageMe from "../lib/handlers/triage/me.js";
import triageStaff from "../lib/handlers/triage/staff.js";
import triageWards from "../lib/handlers/triage/wards.js";
import triageReports from "../lib/handlers/triage/reports.js";
import triageReport from "../lib/handlers/triage/report.js";
import triagePassword from "../lib/handlers/triage/password.js";
import cron from "../lib/handlers/cron.js";
import hooksWhatsapp from "../lib/handlers/hooks/whatsapp.js";
import hooksExotel from "../lib/handlers/hooks/exotel.js";
import content from "../lib/handlers/content.js";
import triageContent from "../lib/handlers/triage/content.js";
import triageContentUpload from "../lib/handlers/triage/content-upload.js";
import triageDraft from "../lib/handlers/triage/draft.js";
import visitor from "../lib/handlers/visitor.js";
import news from "../lib/handlers/news.js";
import health from "../lib/handlers/health.js";
import triageVisitors from "../lib/handlers/triage/visitors.js";
import triageJoins from "../lib/handlers/triage/joins.js";
import triageTeam from "../lib/handlers/triage/team.js";
import triageMetrics from "../lib/handlers/triage/metrics.js";
import triageInbox from "../lib/handlers/triage/inbox.js";
import triageSubscribers from "../lib/handlers/triage/subscribers.js";
import triageNewsletter from "../lib/handlers/triage/newsletter.js";
import triageAsk from "../lib/handlers/triage/ask.js";
import triageExtract from "../lib/handlers/triage/extract.js";
import triageSocial from "../lib/handlers/triage/social.js";
import hookEmail from "../lib/handlers/hooks/email.js";
import triageTranslate from "../lib/handlers/triage/translate.js";
import pulse from "../lib/handlers/pulse.js";
import triageInsights from "../lib/handlers/triage/insights.js";
import triageSeo from "../lib/handlers/triage/seo.js";
import page from "../lib/handlers/page.js";
import sitemap from "../lib/handlers/sitemap.js";
import indexnowKey from "../lib/handlers/indexnow-key.js";
import gsc from "../lib/handlers/gsc.js";
import llms, { full as llmsFull } from "../lib/handlers/llms.js";
import subscribe from "../lib/handlers/subscribe.js";
import { send } from "../lib/http.js";

const ROUTES = {
  "report": report, "report/upload-url": reportUpload, "report/attach": reportAttach, "status": status, "join": join, "dashboard": dashboard, "ward": ward, "geocode": geocode,
  "triage/login": triageLogin, "triage/refresh": triageRefresh, "triage/me": triageMe,
  "triage/staff": triageStaff, "triage/wards": triageWards, "triage/reports": triageReports, "triage/password": triagePassword,
  "cron/daily": cron,
  "hooks/whatsapp": hooksWhatsapp, "hooks/exotel": hooksExotel,
  "content": content, "triage/content": triageContent, "triage/content/upload-url": triageContentUpload, "triage/draft": triageDraft,
  "visitor": visitor, "news": news, "health": health, "triage/visitors": triageVisitors, "triage/joins": triageJoins, "triage/team": triageTeam, "triage/metrics": triageMetrics, "triage/inbox": triageInbox, "triage/subscribers": triageSubscribers, "triage/newsletter": triageNewsletter, "hooks/email": hookEmail, "triage/translate": triageTranslate, "triage/social": triageSocial, "pulse": pulse, "triage/insights": triageInsights, "triage/seo": triageSeo,
  "sitemap": sitemap, "indexnow": indexnowKey, "gsc": gsc, "llms": llms, "llms-full": llmsFull, "subscribe": subscribe
};

export function resolve(parts) {
  const path = (parts || []).join("/");
  if (ROUTES[path]) return { handler: ROUTES[path], params: {} };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "reports") return { handler: triageReport, params: { ref: parts[2] } };
  if (parts && parts.length === 4 && parts[0] === "triage" && parts[1] === "reports" && parts[3] === "ask") return { handler: triageAsk, params: { ref: parts[2] } };
  if (parts && parts.length === 4 && parts[0] === "triage" && parts[1] === "reports" && parts[3] === "extract") return { handler: triageExtract, params: { ref: parts[2] } };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "joins") return { handler: triageJoins, params: { id: parts[2] } };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "inbox") return { handler: triageInbox, params: { id: parts[2] } };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "subscribers") return { handler: triageSubscribers, params: { id: parts[2] } };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "newsletter") return { handler: triageNewsletter, params: { id: parts[2] } };
  if (parts && parts.length === 2 && parts[0] === "cron" && (parts[1] === "fetch" || parts[1] === "analyse" || parts[1] === "seo")) return { handler: cron, params: { group: parts[1] } };
  // Server-rendered pages (/guides, /guide/:issue, /ward/:n, /blog/:slug, with a /hi prefix) are a prefix route.
  if (parts && parts.length >= 2 && parts[0] === "page") return { handler: page, params: { page: parts.slice(1).join("/") } };
  return null;
}

// Path segments from the request URL, independent of how the platform fills req.query.
export function pathParts(url) {
  const pathname = new URL(url || "/", "http://local").pathname;
  return pathname.replace(/^\/api\/?/, "").split("/").map(decodeURIComponent).filter(Boolean);
}

// The rewrite passes the original path as ?path=; fall back to the URL itself
// (direct calls to /api/index/... or local servers without the rewrite).
export function partsFrom(req) {
  const raw = req.query?.path;
  const fromQuery = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("/") : []).filter(Boolean);
  if (fromQuery.length) return fromQuery;
  const fromUrl = pathParts(req.url);
  return fromUrl[0] === "index" ? fromUrl.slice(1) : fromUrl;
}

export default async function handler(req, res) {
  const parts = partsFrom(req);
  const match = resolve(parts);
  if (!match) return send(res, 404, { ok: false, error: "not_found", path: parts.join("/") });
  req.query = { ...(req.query || {}), ...match.params };
  delete req.query.path;
  return match.handler(req, res);
}
