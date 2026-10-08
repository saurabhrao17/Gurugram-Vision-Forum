// Queue a mail in the outbox and, when a key is set, send it at once. The
// outbox stays the record: a mail that fails now stays pending and the cron's
// outbox step retries it. Used for the mails a person is waiting for (the
// subscription confirmation); everything else still goes with the cron.
import { sendMail } from "./handlers/cron.js";

export async function queueMail(sb, env, row, { send = sendMail } = {}) {
  const { data, error } = await sb.from("outbox").insert(row).select("id").maybeSingle();
  if (error) throw error;
  const id = data?.id ?? null;
  if (!env.RESEND_API_KEY || id === null) return { id, sent: false };
  try {
    await send(row, env);
    const { error: ue } = await sb.from("outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1, last_error: null }).eq("id", id);
    if (ue) console.error("outbox update failed", id, ue);
    return { id, sent: true };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    const { error: ue } = await sb.from("outbox").update({ attempts: 1, last_error: msg }).eq("id", id);
    if (ue) console.error("outbox update failed", id, ue);
    return { id, sent: false, error: msg };
  }
}
