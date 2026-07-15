# Site Pounce, Build Playbook

A reference of how Site Pounce is built: the stack, every third-party service, the reusable
patterns, and the full feature set. Use it to avoid reinventing the wheel on the next project.
Live at sitepounce.com. (No em dashes anywhere is a house style rule.)

---

## 1. What it is
A lead-generation SaaS for UK web-design agencies. In one tool you: find local businesses
(especially ones with no website), generate an AI website mockup or a live site to pitch with,
research each lead (AI call briefing), reach out (call list, SMS, WhatsApp, email) with tracking,
run a light CRM, and manage a team. Sold on 3 monthly subscription tiers.

---

## 2. The stack (deliberately lean, no framework, no build step)
- **Frontend:** plain vanilla JavaScript. One `public/index.html` + one big `public/app.js` +
  `public/styles.css`. No React, no bundler, no build. Ships as static files.
- **Backend:** Vercel serverless functions, one file per route in `api/*.js` (Node). Shared
  logic in `lib/*.js`. **Zero-dependency by design** (see gotchas), the only npm packages are
  `@vercel/postgres`, `@vercel/blob`, `@vercel/edge`.
- **Edge middleware:** `middleware.js` rewrites `<sub>.aiwebpoint.com` to the site renderer.
- **Data:** Neon Postgres (relational) + Vercel Blob (files/JSON docs) + a little browser
  localStorage for per-device UI cache.
- **Hosting/CI:** Vercel Pro. Push to `main` on GitHub auto-deploys. Domains: `sitepounce.com`
  (the app) and `*.aiwebpoint.com` (published client sites).

---

## 3. Third-party services and what each one does
| Service | Used for |
|---|---|
| **Clerk** | Auth (production, email-only). Session JWT verified via JWKS; Clerk Admin API creates/lists users. |
| **Stripe** | Subscriptions (3 tiers), Checkout, Customer Portal, webhook, coupons/promo codes. |
| **Google Places API (New)** | Business search (Text Search) and company look-up. |
| **OpenAI** | `gpt-4o-mini` for all text (mockup + site copy, Prowl briefing, grammar fix, notes analysis) and `gpt-image-1` for AI hero photography on mockups and live sites. |
| **SendGrid** | All transactional email (welcome, admin alerts, team invites, feedback, access requests, "done" notifications). |
| **Companies House API** | Verify Ltd company status; feeds Prowl and DeepDossier. |
| **MediaStack** | Recent news about a business, feeds the Prowl intel briefing. |
| **Apollo + Hunter** | Contact enrichment for the hidden owner-only "DeepDossier" module (runs in mock mode until keys added). |
| **Cloudflare** | DNS for sitepounce.com + Email Routing. |
| **Google Workspace** | hello@sitepounce.com sending alias. |
| **Vercel API** | Add custom subdomains to the project programmatically (auto SSL). |
| **Neon Postgres, Vercel Blob** | Data + file storage. |

---

## 4. Auth model (very reusable)
- Clerk drives sign-in on the client (vanilla ClerkJS). On sign-in the client posts the Clerk
  session token to `api/clerk-session`, which **verifies it with Clerk's public JWKS using
  Node crypto (no Clerk SDK)** and then issues the app's own **signed, HttpOnly `aiwp` cookie**
  (HMAC keyed on a secret). Every other protected endpoint just checks that cookie, so the whole
  backend stayed unchanged when Clerk was added. `lib/auth.js` = sign/verify/identity.
- **Multi-tenant** (`lib/tenant.js`): the workspace is scoped by the account email baked into the
  cookie. Owner = root namespace; every other account = `u/<hash>/` blob prefix + `<hex>--` slug
  prefix. One code path serves everyone.
- **Team accounts + RBAC** (`lib/access.js`): a team member logs in with their own email but
  shares the owner's workspace (the cookie carries the owner's "account" email). Two permission
  groups, **view perms** (which tabs they see) and **action perms** (what they can do), plus
  numeric **usage caps** (results per search, call-list records, CSV exports/day). Server-enforced
  on the real endpoints; UI hides what they lack. `requirePermission(req,res,key)` is the guard.
- **Onboarding:** adding a member creates their Clerk login via the Admin API with a
  system-generated starting password (emailed + shown once), forced to change on first login.

---

## 5. Payments (reusable)
- Stripe subscriptions, 3 tiers (Scout/Hunter/Apex) via `STRIPE_PRICE_*` env ids.
- `api/stripe-checkout` (Checkout Session, `allow_promotion_codes: true`), `api/stripe-confirm`,
  `api/stripe-portal` (Customer Portal self-serve), `api/stripe-webhook` (subscription lifecycle).
- Access decision is centralised in `lib/access.js` (`requirePaid`): owner + allow-list are comped,
  everyone else needs an active/trialing subscription, else the paywall. Fails closed.
- Zero-dep Stripe REST client in `lib/stripe.js` (form-encoded, bracket notation, `https`).
- **Gotcha:** the webhook URL must be the `www` host (the apex 308-redirects and Stripe does not
  follow redirects). The `mk_...` on the Stripe keys page is the key ID, not the secret.

---

## 6. Emails (reusable)
- `lib/email.js`: one zero-dep `sgSend` (fetch to SendGrid) + typed helpers per event
  (new customer, feedback, team invite, access request, feedback-done). From
  `SITEPOUNCE_FROM_EMAIL`; domain authenticated via Cloudflare DNS (SPF/DKIM/DMARC).
- **Gotcha:** on Vercel never fire-and-forget an email after `res.json()` (the function freezes),
  always `await` the send before responding, and fail soft so a mail hiccup never blocks the action.

---

## 7. Data layer (reusable)
- **Neon Postgres** via `@vercel/postgres` (`lib/db.js`, every function fails soft). Tables:
  `link_events` (open/click/send tracking), `users` (Stripe plan/status), `feedback`,
  `team_members` (perms + caps + must_change), `usage_daily` (per-member daily counters),
  `activity_log` (audit: actor/action/subject), `notes_log`, `applications`, DeepDossier tables.
  Tables are created lazily with `CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS`
  (no migration tool).
- **Vercel Blob** for documents: mockups, generated sites, the call list, per-lead notes, the
  subdomain index. **Gotcha (bit us):** Blob has no transactions, so a shared JSON that does
  list->fetch->modify->put loses writes under concurrency. Fix pattern: serialize the client's
  writes through a promise chain + keep a session-local optimistic set so stale reads never revert.

---

## 8. Feature inventory
**Find:** live business search (Google Places) with filters (no website, few reviews, mobile,
Ltd), company-name look-up, "new vs seen" flagging, batch-select + batch add-to-call-list + export.

**Pitch assets:** AI website **mockup** (`gpt-image-1` hero + real details composited), one-click
**live site** ("Pounce", published to an `aiwebpoint.com` subdomain, editable, live enquiry form),
**Prowl** (AI call-intel dossier: reputation, gaps, objections + handling, opener, competitor
snapshot, built from Google + Companies House + MediaStack + OpenAI).

**Outreach:** phone-first **Call List** (server-synced, tap-to-dial, statuses, notes, sort/filter,
prowled filter), SMS/WhatsApp/email via links + tracking, follow-ups, message templates + CTA
wording, open/click/sign-up tracking (`link_events`). **WhatsApp guardrails** (cold-send = ban risk;
hard daily cap + confirm).

**CRM:** per-lead statuses (incl. "Meeting booked"), attributed timestamped notes shared across
Call List / All Leads / Lead Profile, warm leads (demo/sign-up clickers), all leads, websites,
enquiries, performance dashboard (opens, clicks, best times, per-template stats).

**Admin (owner-only):** Overview (live **MRR/ARPU from Stripe** + counts), Customers (Clerk sign-ups
merged with plan/status, open in Stripe), Activity report (per-person: unique businesses, meetings
booked, avg gap between clients, per-action counts, date ranges), Notes (central + **AI analysis**:
themes/objections/targeting/follow-ups), Niche Intel (targeting playbook), Feedback (status,
"Done & notify" emails the submitter, "Copy for Claude" report), Team (RBAC + caps + audit).

**Other:** in-app floating feedback button; legal pages; Terms/Privacy; hidden DeepDossier module.

---

## 9. Key patterns and lessons (the reusable gold)
- **Zero-dep everything** (the dev machine cannot `npm install`): JWT/JWKS verify, Stripe, OpenAI,
  SendGrid, Clerk Admin all called with raw `fetch`/`https`. Keeps Vercel builds bulletproof.
- **Cookie-bridge auth**: verify the third-party (Clerk) token once at the edge, then run your own
  simple signed cookie everywhere. Swappable auth provider, unchanged app.
- **Tenant-by-cookie**: put the workspace id in the session, scope all storage by it. Team sharing
  and multi-account fall out of one code path.
- **Central access decision** (`lib/access.js`): one place answers "can this request do X", used by
  paywall, RBAC, and caps.
- **Never fire-and-forget on Vercel**; **Blob has no transactions**; **deploy checks gently** (tight
  curl polling trips Vercel's DDoS challenge); **lazy table creation** instead of migrations.
- **Audit + attribution baked in** (`activity_log`, note authorship) makes team oversight easy.
- **Human-facing copy rules** enforced in prompts (no em dashes; humanised business names).

---

## 10. Deployment + env
- Vercel Pro, GitHub push-to-deploy on `main`. `middleware.js` for subdomains.
- Key env vars: `CLERK_SECRET_KEY`/`CLERK_ISSUER`, `STRIPE_SECRET_KEY`/`STRIPE_PRICE_*`,
  `GOOGLE_PLACES_API_KEY`, `OPENAI_API_KEY`, `SENDGRID_API_KEY`/`SITEPOUNCE_FROM_EMAIL`,
  `POSTGRES_URL` (Neon), Blob token, `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` (subdomain API),
  `COMPANIES_HOUSE_API_KEY`, `MEDIASTACK_API_KEY`, `ALLOWED_EMAILS`, `SIGNUP_OPEN`, `USER_LIMITS`.

---

## 11. Reusable building blocks to lift into the next app
`lib/auth.js` (signed cookie), `lib/access.js` (paywall + RBAC + caps), `lib/tenant.js`
(multi-tenant scoping), `lib/stripe.js` (zero-dep Stripe), `lib/email.js` (SendGrid), `lib/db.js`
(lazy Postgres helpers), the `api/clerk-session.js` bridge, the whole **Admin area pattern**
(owner-gated left-menu sections: overview/customers/activity/notes/feedback/team), the
**audit log + per-person activity report**, the **feedback widget + backoffice**, and the
**team RBAC + usage caps + invite/onboarding** flow. See NEXT_APP_BLUEPRINT.md for how these map
to the new project.
