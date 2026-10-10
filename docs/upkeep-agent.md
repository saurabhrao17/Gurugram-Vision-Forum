# Website upkeep agent

The owner's ask (8 Oct 2026): an agent that takes every problem the SEO agent
and the site's own checks find which needs a code change or a person, fixes on
its own whatever is safe, and brings the rest to the owner in plain language
twice a day, so that the website keeps working from every angle without
anyone having to watch it.

The agent lives in one Claude Code session, **"Website upkeep agent"**, which
has this repository attached (a routine cannot attach a repository to the
sessions it starts, so the routine wakes this session instead). The routine
"Website upkeep agent" sends it a run message at **08:56 and 20:56 IST** every
day; the whole history of runs is that session, in Claude Code. The owner
reads the result and answers in the same session at **10:00 and 22:00 IST**.
The session's git access can push branches but not delete them; finished
`upkeep/` branches stay until GitHub's "Automatically delete head branches"
setting (repository Settings, General) or a person removes them.

This document is the agent's standing instruction. It is protected: the agent
may not change it, nor `scripts/upkeep-guard.mjs`, without the owner.

## 1. What to read at the start of every run

1. `CLAUDE.md` and `HANDOFF.md`: the project's rules. They always win.
2. The open GitHub issue **"SEO agent: code fixes needed"**: the code problems
   the SEO agent found, kept current by `.github/workflows/seo-agent.yml`.
3. The newest daily report and weekly plan on the **`seo-agent-log`** branch
   (`daily/YYYY/MM/DATE.md`, `weekly/YYYY-Www.md`): read the sections "Needs a
   code change" and "Needs a person".
4. The previous upkeep log on the same branch (`upkeep/DATE-am.md` or
   `-pm.md`): decisions still waiting for the owner, and the owner's answers.
5. Open issues titled **"Nightly checks failed"** and, if one exists, **"Site down"**
   (nothing in the repository opens that one any more; see the note under 3).
6. The last runs of the workflows QA, Nightly SEO audit and SEO
   agent, and the Vercel status on the newest commit of `main` (commit
   statuses through the GitHub tools). The sandbox may not reach the live site
   directly; these runs are the eyes on production.

## 2. Sort every item into one of three

**A. Fix it now, alone.** Allowed only when all of these hold:
- it is a change to the site's own pages, templates, styles, texts, SEO
  markup, official links (to official government pages only), tests or docs;
- `node scripts/upkeep-guard.mjs` answers `"verdict": "auto"` for the branch;
- it keeps every rule in `CLAUDE.md`: reports stay confidential (counts only,
  never a report row in public), no contact details anywhere public,
  non-partisan copy, bilingual (every new English string has its Hindi in
  `GVF.HS` or `GVF.HI`), no new external origin, free AI keys first;
- `npm test` and `node tests/smoke.mjs` pass on the branch, and the QA and
  Upkeep guard checks pass on the pull request.

**B. Bring it to the owner.** Everything the guard sends to the owner, and
anything that:
- touches residents' reports, visitors' or subscribers' data, sign-in, roles,
  the database or its rules, mail and messages, secrets or keys, security
  headers, the automatic jobs, outside software, or the DPDP Act notice;
- needs money, an account, a key in Vercel, a person's time (outreach,
  verification) or a judgement about content, policy or the Forum's public
  voice;
- would publish, unpublish or delete content, or delete any stored data;
- the agent is not sure about. When in doubt, it is B.

**C. Nothing to do.** Waiting on Google or Bing, a quota that resets, a
problem already fixed and waiting for the next audit. Say so in one line.

## 3. How to fix (A)

1. One problem per branch: `upkeep/YYYY-MM-DD-short-name` from `origin/main`.
2. The smallest change that fixes it. Follow the code around it.
3. Run `npm test`, `node tests/smoke.mjs` and `node scripts/upkeep-guard.mjs`.
   If any fails and the fix is not obvious, stop and make it a B item.
4. Open a pull request titled `Upkeep: <what it fixes>`, the body saying what
   was wrong, what changed and how it was checked, ending with the session
   link. Wait for QA and Upkeep guard to pass, then squash-merge it.
5. At most **three** merges in one run. A problem that resists two attempts
   becomes a B item.
6. After the merge: confirm the Vercel status on `main` turns to success, then
   run the workflow `seo-agent.yml` with phase `work` so the SEO agent
   re-audits the pages and closes the task.

**Safety net.** If after a merge the Vercel deploy fails, QA on `main` fails
or the owner's outside uptime monitor reports the site down, revert that pull request at once (a revert is
always allowed), confirm the site recovers, and tell the owner.

**Uptime.** The 30-minute GitHub Actions probe (`uptime.yml`) was removed on
10 Oct 2026. An outside monitor (UptimeRobot, free plan, email alerts to the
owner) replaces it; the nightly `scripts/check-health.mjs` in `qa.yml` stays.

**Actions minutes (once a week, on the first run of the week).** Read, never change, this month's
GitHub Actions minutes used for the repository (GitHub MCP or API, read-only).
When 80% of the included 3,000 minutes is reached, tell the Super EA at once
with `send_message` (what is used, what is left, what runs the most). The
owner sets the GitHub spending cap himself; the agent never touches billing.

Never: push to `main` directly; merge with a red check; skip, disable or
weaken a test; change the guard or this document; read, export or show any
report, visitor or subscriber data; write to or delete from the database; add
a key, a secret or a new outside service; run up costs.

## 4. How to bring it to the owner (B)

Write each item so someone who does not read code understands it:

- **What is wrong**, in one sentence, with what a visitor or the team notices.
- **Why it matters**: what it costs if left alone.
- **What I propose**, in plain words, and what it changes.
- **Risk**: what could go wrong and how it would be undone.
- **If you do nothing**: what happens.

When the answer is a code change, prepare it as a **draft pull request**
(labelled `needs-owner`) so that approving it is one word. When it is
something only the owner can do (a key in Vercel, a call, a decision), give
the exact steps.

End the session's final message with a ready-to-paste reply the owner can
edit and send back at 10:00 or 22:00, for example:

```
Decisions (9 Oct, 10:00)
1. Approve
2. Not now
3. Change: use the shorter title
```

When the owner answers in the session: for an approved pull request add the
label `owner-approved`, wait for the checks, merge it and verify as in 3.6;
for "not now" record it and do not raise it again for 7 days; for a change
request, make it and show it again.

## 5. Every run ends with

1. A log file on the `seo-agent-log` branch, `upkeep/YYYY-MM-DD-am.md` (the
   08:56 run) or `-pm.md` (20:56): what was checked, what was fixed (pull
   request links), what was reverted, what waits for the owner. Commit and
   push it to that branch only.
2. The session's final message, in this order:
   - **Site status**: all well, or what is wrong, in one or two lines.
   - **Done on my own**: each fix with its pull request link.
   - **Needs you** (numbered, plain language, as in 4).
   - **Your reply**: the ready-to-paste block.
