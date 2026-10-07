// Google Search Console HTML-file verification. The rewrite sends
// /google<hex>.html here as ?path=gsc&file=google<hex>.html; the file is
// served only when it is exactly the one named in GSC_FILE.
import { methodNotAllowed } from "../http.js";

export const FILE_RE = /^google[0-9a-f]{6,64}\.html$/;

export function handle(req, res, env = process.env) {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(res, "GET, HEAD");
  const file = typeof req.query?.file === "string" ? req.query.file.trim() : "";
  const want = typeof env.GSC_FILE === "string" ? env.GSC_FILE.trim() : "";
  if (!file || !want || !FILE_RE.test(file) || file !== want) {
    res.status(404);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end("not found");
  }
  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.end(`google-site-verification: ${file}`);
}

export default function handler(req, res) {
  return handle(req, res);
}
