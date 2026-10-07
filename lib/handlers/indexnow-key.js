// GET /indexnow-key.txt (rewritten to /api/index?path=indexnow): the IndexNow
// key file, served only when INDEXNOW_KEY is set.
import { methodNotAllowed } from "../http.js";

export function handle(req, res, env = process.env) {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
  const key = typeof env.INDEXNOW_KEY === "string" ? env.INDEXNOW_KEY.trim() : "";
  if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    res.status(404);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end("not found");
  }
  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.end(key);
}

export default function handler(req, res) {
  return handle(req, res);
}
