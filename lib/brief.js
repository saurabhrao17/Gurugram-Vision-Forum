// The daily ward-wise brief for owners and coordinators: built from the
// ward_ageing() and staff_activity() rows. `text` is the full brief (email,
// the desk's Performance tab); `line` is the one-line version a WhatsApp
// template parameter allows (no line breaks, no tabs, under 1000 chars).
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function totalsOf(wards) {
  const t = { open: 0, unmapped: 0, overdue: 0, received_7d: 0, resolved_7d: 0, a22p: 0 };
  for (const w of wards || []) for (const k of Object.keys(t)) t[k] += num(w[k]);
  return t;
}

export function idlePeople(people) {
  return (people || []).filter((p) => p && p.active !== false && Array.isArray(p.wards) && p.wards.length && num(p.actions_7d) === 0);
}

function who(w, people) {
  const byId = new Map((people || []).map((p) => [p.user_id, p]));
  const names = [];
  for (const [role, label] of [["coordinator", "coord"], ["lead", "lead"], ["support", "support"]]) {
    const p = (people || []).find((x) => Array.isArray(x.wards) && x.wards.some((v) => Number(v.ward) === Number(w.ward) && v.role === role));
    if (p) names.push(`${label} ${p.name || p.email || "?"}`);
  }
  void byId;
  return names.join(", ");
}

export function buildBrief({ wards = [], people = [], now = Date.now(), siteUrl = "https://gurugramvisionforum.org" } = {}) {
  const date = new Date(now).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const t = totalsOf(wards);
  const active = (wards || []).filter((w) => num(w.open) > 0)
    .sort((a, b) => num(b.overdue) - num(a.overdue) || num(b.a22p) - num(a.a22p) || num(b.open) - num(a.open));
  const idle = idlePeople(people);
  const lines = [`Gurugram Vision Forum, daily brief for ${date}`, ""];
  lines.push(`Open ${t.open} · not yet mapped ${t.unmapped} · overdue ${t.overdue} · older than 21 days ${t.a22p}`);
  lines.push(`Last 7 days: ${plural(t.received_7d, "new report", "new reports")}, ${t.resolved_7d} resolved`);
  lines.push("");
  if (active.length) {
    lines.push(`Wards with open reports (${active.length}):`);
    for (const w of active) {
      const bits = [`${w.open} open`];
      if (num(w.overdue)) bits.push(`${w.overdue} overdue`);
      if (num(w.a22p)) bits.push(`${w.a22p} older than 21 d`);
      if (num(w.oldest_open_days)) bits.push(`oldest ${w.oldest_open_days} d`);
      const team = who(w, people);
      lines.push(`- Ward ${w.ward}${w.councillor ? ` (${w.councillor})` : ""}: ${bits.join(", ")}${team ? ` · ${team}` : " · nobody assigned"}`);
    }
  } else lines.push("No open reports in any ward.");
  lines.push("");
  if (idle.length) {
    lines.push(`No desk activity in 7 days (${idle.length}): ${idle.map((p) => `${p.name || p.email} (wards ${p.wards.map((v) => v.ward).join(", ")})`).join("; ")}`);
  } else lines.push("Every volunteer with a ward acted on the desk this week.");
  lines.push("");
  lines.push(`Full tracker: ${siteUrl}/#/desk (Performance tab).`);
  const text = lines.join("\n");

  const top = active.slice(0, 5).map((w) => `W${w.ward} ${w.open} open${num(w.overdue) ? `/${w.overdue} overdue` : ""}`).join(", ");
  let line = `GVF ${date}: open ${t.open}, unmapped ${t.unmapped}, overdue ${t.overdue}, 21d+ ${t.a22p}; 7 days: ${t.received_7d} new, ${t.resolved_7d} resolved.` +
    (top ? ` Wards: ${top}${active.length > 5 ? ` and ${active.length - 5} more` : ""}.` : " No open reports.") +
    (idle.length ? ` Idle 7 d: ${idle.map((p) => p.name || p.email).join(", ")}.` : "");
  line = line.replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (line.length > 1000) line = line.slice(0, 997) + "…";
  return { text, line, totals: t, idle: idle.map((p) => p.user_id), date };
}
