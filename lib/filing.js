// What the official portal needs versus what the report holds.
// filing: { portal, url, note, fields:[{k,l,t,r,o,h}], docs:[{k,l,t,r}] }
export const MAX_EXTRA_KEYS = 40;
export const MAX_EXTRA_LEN = 1000;

// Keeps only plausible keys and trims values; unknown keys are allowed so the
// desk can add details the schema does not list yet.
export function cleanExtra(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    if (v == null) continue;
    const s = String(v).trim().slice(0, MAX_EXTRA_LEN);
    if (s) out[k] = s;
    if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
  }
  return out;
}

export function checklist(filing, extra, attachments) {
  const f = filing || {};
  const ex = extra || {};
  const att = Array.isArray(attachments) ? attachments : [];
  const kinds = new Set(att.map((a) => a && a.kind).filter(Boolean));
  const fields = (f.fields || []).map((x) => ({ key: x.k, label: x.l, required: !!x.r, value: ex[x.k] || "", missing: !!x.r && !ex[x.k] }));
  const docs = (f.docs || []).map((d) => {
    const files = att.filter((a) => a && a.kind === d.k);
    const anyFile = att.length > 0 && !kinds.size; // older uploads without a kind count for any slot
    return { key: d.k, label: d.l, required: !!d.r, files, have: files.length > 0 || anyFile, missing: !!d.r && files.length === 0 && !anyFile };
  });
  const missing = fields.filter((x) => x.missing).map((x) => x.label).concat(docs.filter((d) => d.missing).map((d) => d.label));
  return { portal: f.portal || "", url: f.url || "", note: f.note || "", fields, docs, missing, complete: missing.length === 0 };
}

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 8;

export function safeName(name) {
  return String(name || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "file";
}
