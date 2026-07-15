# Next App Blueprint

How to build your next app (video creation + customer area + admin area + multiple logins +
payments + emails) by reusing what Site Pounce and ScrollyVid already have. Read the two playbooks
first: SITEPOUNCE_PLAYBOOK.md and SCROLLYVID_PLAYBOOK.md. (No em dashes is a house style rule.)

---

## 1. The headline
You have already built, twice, almost every non-video piece your new app needs. The video engine
already exists in ScrollyVid. So the next app is mostly **assembly + one or two new pieces**, not a
from-scratch build.

---

## 2. Your reusable "house stack" (the same in both apps, keep it)
- Vanilla JS front end, no framework, no build step.
- Vercel serverless functions, one file per route, near zero npm deps.
- Neon Postgres + Vercel Blob.
- Clerk for real auth, bridged to your own signed HttpOnly cookie so the backend never changes.
- SendGrid for all email, called with raw fetch.
- GitHub push -> Vercel auto-deploy. Cloudflare DNS.
- House rules baked in: no em dashes, generic endpoint names (stack secrecy), fail-soft
  everywhere, never fire-and-forget on Vercel, lazy table creation, gentle deploy checks.

Decision: **do not change the stack.** It is proven twice and you move fast in it.

---

## 3. Need-by-need: what to reuse vs build
| New app needs | Best existing source | Effort |
|---|---|---|
| **Multiple logins** | ScrollyVid Clerk (Google + email) + cookie bridge | Reuse, low |
| **Customer area shell** | ScrollyVid `app/index.html` + history/projects | Reuse, low |
| **Admin area** | **Site Pounce is the stronger one** (left-menu sections: overview, customers, activity, notes, feedback, team) | Reuse SitePounce pattern, low |
| **Team members + granular permissions + usage caps + audit** | **Site Pounce only** (`lib/access.js`, `lib/tenant.js`, team RBAC, activity_log) | Reuse SitePounce, low |
| **Payments** | **Site Pounce Stripe is fully built** (subscriptions, checkout, portal, webhook, paywall) | Reuse SitePounce, medium |
| **Credits / metered usage** (likely for video) | ScrollyVid has the DB scaffold only (`credit_ledger` unused) | Build, medium |
| **Emails** | Both (`lib/email.js` SitePounce / `lib/notify.js` ScrollyVid) | Reuse, low |
| **Video creation** | **ScrollyVid pipeline is the asset** (scrape -> brief -> composite -> render, 3 engines, async cron, safety fallback) | Reuse/adapt, medium |
| **Error system with quotable refs + AI triage** | ScrollyVid `lib/errors.js` | Reuse, low |
| **Feedback widget + backoffice** | Both have it (SitePounce is richer: status, notify submitter, copy-for-Claude) | Reuse SitePounce, low |
| **Async long jobs (video render)** | ScrollyVid `submit-job` + `poll-jobs` cron | Reuse, low |

---

## 4. The one real gap: payments + credits for video
This is the only piece neither app has finished, and video needs it most (each render costs real
money at an engine).

Recommended path:
- Take **Site Pounce's Stripe** (subscriptions, checkout, portal, webhook, `lib/stripe.js`,
  paywall in `lib/access.js`) as the base. It is done and battle-tested.
- Add the **credit ledger** ScrollyVid only scaffolded: on subscription events grant monthly
  credits, and **deduct credits at render submit** (in `submit-job`, before the engine is called),
  writing every change to `credit_ledger`. Refund the credit if the job fails.
- Reuse ScrollyVid's client-side **cost estimator** so the user sees the credit cost before they
  spend.
- Top-ups = a one-off Stripe Checkout that writes a positive ledger row on webhook.

That is the single meaningful build. Everything else is wiring parts you own.

---

## 5. Recommended build order
1. **Scaffold** from the house stack (copy the two `lib/` folders, pick the best of each).
2. **Auth + tenancy** first (Clerk bridge + `lib/tenant.js` + `lib/access.js`). Everything hangs
   off this.
3. **Customer area shell** (ScrollyVid `app/` + projects/history).
4. **Video pipeline** ported from ScrollyVid (scrape/brief/composite/render + async cron + error
   system). Keep the safety fallback and the "nothing invented" rule.
5. **Payments + credits** (SitePounce Stripe + the new ledger/deduct logic). Gate render on credits.
6. **Admin area** (SitePounce sections) + **team RBAC + caps + audit** if teams are in scope.
7. **Emails** (welcome, video-ready, receipt, low-credit, alerts) from the two email libs.
8. **Feedback widget + backoffice** last (cheap, high value once users arrive).

---

## 6. Things to settle before you start (open questions)
- **Video engines:** reuse the same three (Creatify / Seedance / Veo) or a different set for this
  product? This drives cost and the resale/ToS work.
- **Resale/white-label rights:** confirm in writing for whichever engines you resell (this is the
  loud risk in both video plans). Do this before selling, not after.
- **Google quota vs credit:** for a real SaaS move Gemini/Veo to Vertex GA to avoid 429 quota walls.
- **Plan shape:** pure subscription, pure credits, or hybrid (subscription grants monthly credits +
  top-ups). Hybrid is what ScrollyVid planned and suits video best.
- **One codebase or fork:** start the next app as a fresh repo seeded from these parts (cleaner
  than bolting onto either existing app).

---

## 7. Bottom line
- Reuse: stack, auth, tenancy, admin, team RBAC, Stripe subscriptions, emails, feedback, the whole
  video pipeline, the error system, async jobs.
- Build once: the **credit ledger + deduct-on-render** layer (glue between SitePounce Stripe and
  ScrollyVid's video jobs).
- Confirm first: video-engine resale rights and Vertex quota.

You are assembling, not starting over.

---

## Appendix A: Credit ledger design (the one real build)

The only genuinely new piece. Goal: users buy/earn credits, each video render spends them, failed
renders refund them, and every movement is auditable. It must be race-safe and idempotent (Stripe
retries webhooks, users double-click render).

### A1. Data model
- **`profiles.credits`** (integer): the authoritative running balance. Fast to read, and it is what
  you deduct against atomically. Do NOT compute balance by summing the ledger on every read.
- **`credit_ledger`** (append-only audit): `id`, `account` (owner/user id), `delta` (int, + or -),
  `reason` ('grant' | 'render' | 'refund' | 'topup' | 'adjust'), `ref` (job id / Stripe invoice id
  / session id), `balance_after` (int, snapshot), `created_at`.
- **Idempotency guard:** a `UNIQUE (reason, ref)` index on the ledger. A retried webhook or a
  double-submit fails the insert instead of double-counting.
- Add `refunded boolean default false` to `video_jobs` so a job can only be refunded once.

### A2. The four movements
1. **Grant (subscription):** Stripe webhook `invoice.paid` -> add the plan's monthly allowance.
   Idempotent on the invoice id (ledger ref = invoice id). Decide rollover: simplest is "top up to
   allowance, no rollover"; friendlier is "add allowance, cap at N". Pick one and write it down.
2. **Deduct (render):** in `submit-job`, BEFORE the engine is called, run the atomic guard below.
   If it returns no row, the user is out of credits -> return 402 and do not call the engine.
3. **Refund (failure):** in `poll-jobs` when a job hits a terminal failure, if `refunded=false`
   add the cost back and set `refunded=true`. Idempotent via the job flag + `UNIQUE(reason,ref)`.
4. **Top-up (one-off):** a one-off Stripe Checkout -> webhook `checkout.session.completed` -> add
   the purchased credits. Idempotent on the session id.

### A3. The race-safe deduct (the important bit)
One atomic SQL statement does the check and the subtraction together, so two concurrent renders can
never overspend:

```sql
UPDATE profiles
   SET credits = credits - $cost
 WHERE account = $id AND credits >= $cost
RETURNING credits;
```
- Row returned -> deduction succeeded; then insert the ledger row (delta = -cost, ref = job id).
- No row -> insufficient credits; block the render. No locks, no transaction gymnastics needed.

### A4. Rules that keep it honest
- **Cost is computed server-side** at submit (style + length + quality), stored on
  `video_jobs.credits`. The client cost estimator is a preview only, never trusted.
- **Deduct before spending money** at the engine, refund only on terminal failure (not on retryable
  blips, which poll-jobs retries anyway).
- **Comped/owner accounts skip deduction** (reuse the `can()` / comped check from `lib/access.js`).
- **Show the user:** current balance (from `profiles.credits`) in the app header, plus a "Your
  credits" history page reading `credit_ledger` (mirrors the SitePounce activity-log pattern).
- **Low-balance email** (reuse `lib/notify.js`) when credits drop below a threshold after a deduct.

### A5. Where each piece lives
- `lib/credits.js` (new): `grant`, `deduct`, `refund`, `topup`, `balance`, `ledger` helpers.
- `api/submit-job.js`: call `deduct` before the engine; 402 on failure.
- `api/poll-jobs.js`: call `refund` on terminal failure.
- `api/stripe-webhook.js`: `grant` on `invoice.paid`, `topup` on `checkout.session.completed`.
- `api/credits.js` (new): GET balance + ledger for the "Your credits" page.

That is the whole build. Everything else is wiring parts you already own.

---

## Appendix B: How and when to use these playbooks (with commands)

### B1. When to reach for each doc
- **Starting the next app / deciding what to reuse** -> open NEXT_APP_BLUEPRINT.md (this file).
- **"How did we do auth / payments / emails / tenancy last time?"** -> SITEPOUNCE_PLAYBOOK.md.
- **"How does the video pipeline / engine split / async job work?"** -> SCROLLYVID_PLAYBOOK.md.
- **Onboarding a new dev or a new Claude session** -> have it read all three first, then work.

### B2. The one command that primes a new Claude Code session
Paste this as your first message in the new project so Claude works from what you already have:

```
Read these three files before doing anything:
- SITEPOUNCE_PLAYBOOK.md
- SCROLLYVID_PLAYBOOK.md
- NEXT_APP_BLUEPRINT.md
Then confirm you understand the house stack and the reuse-vs-build plan.
Do not start coding yet.
```

### B3. The build sequence, one prompt per step
Give these one at a time (wait for each to finish, per "one step at a time"):

1. `Scaffold a new Vercel + vanilla-JS repo called <name> using the house stack from the
   playbooks. No framework, no build step. Set up folders: public/, api/, lib/. Nothing else yet.`
2. `Port the auth + tenancy layer: the Clerk-to-cookie bridge and lib/tenant.js + lib/access.js
   from SitePounce/ScrollyVid. Email-and-Google login. Confirm a signed-in user resolves to a
   workspace.`
3. `Build the customer-area shell from the ScrollyVid app/ pattern: projects, history, light/dark.`
4. `Port the video pipeline from ScrollyVid: scrape -> brief -> composite -> render, the three
   engines, the poll-jobs cron, and the SV-XXXXXX error system. Keep the "nothing invented" rule.`
5. `Build payments: reuse SitePounce Stripe (checkout, portal, webhook, paywall) AND add the credit
   ledger from Appendix A of the blueprint (atomic deduct, refund on fail, idempotent grants).`
6. `Add the admin area from the SitePounce pattern (overview, customers, activity, feedback) and,
   if teams are in scope, the team RBAC + usage caps + audit log.`
7. `Wire emails from the two email libs: welcome, video-ready, receipt, low-credit, owner alerts.`
8. `Add the floating feedback widget + backoffice from SitePounce.`

### B4. Keeping the docs alive
- After a big change: `Update the relevant playbook and regenerate its .docx.`
- Regenerate a Word file by hand:
  `python3 scripts/md_to_docx.py NEXT_APP_BLUEPRINT.md NEXT_APP_BLUEPRINT.docx`
- The blueprint is the living plan; tick off Appendix B steps as you complete them.
