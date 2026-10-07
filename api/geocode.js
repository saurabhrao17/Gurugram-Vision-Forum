// GET /api/geocode?q=sector 29 -> { results: [{ name, lat, lng }] }
// Uses Google Geocoding when GOOGLE_MAPS_KEY is set, otherwise OpenStreetMap's
// Nominatim (free, 1 request/second, attribution required), bounded to Gurugram.
import { send, methodNotAllowed, text } from "../lib/http.js";

const BBOX = { west: 76.80, south: 28.30, east: 77.25, north: 28.60 }; // Gurugram district, roughly

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const q = text(req.query?.q, 120);
  if (q.length < 2) return send(res, 400, { ok: false, error: "invalid" });
  try {
    let results;
    if (process.env.GOOGLE_MAPS_KEY) {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", q + ", Gurugram, Haryana");
      u.searchParams.set("bounds", `${BBOX.south},${BBOX.west}|${BBOX.north},${BBOX.east}`);
      u.searchParams.set("region", "in");
      u.searchParams.set("key", process.env.GOOGLE_MAPS_KEY);
      const j = await (await fetch(u)).json();
      results = (j.results || []).slice(0, 5).map((r) => ({ name: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng }));
    } else {
      const u = new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("q", q + ", Gurugram");
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", "5");
      u.searchParams.set("viewbox", `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`);
      u.searchParams.set("bounded", "1");
      u.searchParams.set("countrycodes", "in");
      const r = await fetch(u, { headers: { "User-Agent": "GurugramVisionForum/1.0 (contact@gurugramvisionforum.org)", "Accept-Language": "en" } });
      const j = await r.json();
      results = (Array.isArray(j) ? j : []).map((x) => ({ name: x.display_name, lat: parseFloat(x.lat), lng: parseFloat(x.lon) }));
    }
    results = results.filter((x) => x.lat >= BBOX.south && x.lat <= BBOX.north && x.lng >= BBOX.west && x.lng <= BBOX.east);
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return send(res, 200, { ok: true, results, provider: process.env.GOOGLE_MAPS_KEY ? "google" : "osm" });
  } catch (e) {
    console.error("geocode failed", e);
    return send(res, 502, { ok: false, error: "geocoder_unavailable" });
  }
}
