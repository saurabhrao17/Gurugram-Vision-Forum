// GET /api/ward?lat=&lng=&area= -> { ward, source } where source is "map"
// (ward boundary file) or "table" (sector-to-ward table), or nulls.
import { supabase } from "../lib/supabase.js";
import { send, methodNotAllowed, text } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const q = req.query || {};
  const lat = parseFloat(q.lat), lng = parseFloat(q.lng);
  const area = text(q.area, 160);
  const hasPt = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!hasPt && !area) return send(res, 400, { ok: false, error: "invalid" });
  const { data, error } = await supabase().rpc("detect_ward", { p_lat: hasPt ? lat : null, p_lng: hasPt ? lng : null, p_area: area || null });
  if (error) { console.error("detect_ward failed", error); return send(res, 500, { ok: false, error: "server_error" }); }
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return send(res, 200, { ok: true, ward: data?.ward ?? null, source: data?.source ?? null });
}
