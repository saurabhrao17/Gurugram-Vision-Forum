// Single entry point for every /api/* route. The Hobby plan allows 12
// serverless functions per deployment; one router keeps us well inside it
// and makes adding routes a one-line change. Handlers live in lib/handlers.
import report from "../lib/handlers/report.js";
import status from "../lib/handlers/status.js";
import join from "../lib/handlers/join.js";
import dashboard from "../lib/handlers/dashboard.js";
import ward from "../lib/handlers/ward.js";
import geocode from "../lib/handlers/geocode.js";
import triageLogin from "../lib/handlers/triage/login.js";
import triageRefresh from "../lib/handlers/triage/refresh.js";
import triageMe from "../lib/handlers/triage/me.js";
import triageStaff from "../lib/handlers/triage/staff.js";
import triageWards from "../lib/handlers/triage/wards.js";
import triageReports from "../lib/handlers/triage/reports.js";
import triageReport from "../lib/handlers/triage/report.js";
import { send } from "../lib/http.js";

const ROUTES = {
  "report": report, "status": status, "join": join, "dashboard": dashboard, "ward": ward, "geocode": geocode,
  "triage/login": triageLogin, "triage/refresh": triageRefresh, "triage/me": triageMe,
  "triage/staff": triageStaff, "triage/wards": triageWards, "triage/reports": triageReports
};

export function resolve(parts) {
  const path = (parts || []).join("/");
  if (ROUTES[path]) return { handler: ROUTES[path], params: {} };
  if (parts && parts.length === 3 && parts[0] === "triage" && parts[1] === "reports") return { handler: triageReport, params: { ref: parts[2] } };
  return null;
}

export default async function handler(req, res) {
  const raw = req.query?.path;
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("/") : [];
  const match = resolve(parts.filter(Boolean));
  if (!match) return send(res, 404, { ok: false, error: "not_found" });
  req.query = { ...(req.query || {}), ...match.params };
  delete req.query.path;
  return match.handler(req, res);
}
