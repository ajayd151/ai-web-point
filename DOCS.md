# SitePounce — Technical & Product Documentation

_Last updated: 2026-06-05_

SitePounce is a lead-generation + outreach tool for a web-design agency. It finds
local businesses that **don't have a website**, generates a **professional AI
website mockup** of what their homepage could look like, and lets you send that
mockup to them (currently via WhatsApp) to win the work.

- **Product brand (the tool):** **Site Pounce** — `sitepounce.com`
- **Agency brand (shown to prospects):** **Ai Web Point** — `aiwebpoint.com`
- The split is deliberate: *Site Pounce* is the tool you log into; *Ai Web Point*
  is the agency name the prospect sees on their mockup ("Designed by Ai Web Point").

---

## 1. The big picture (how it works)

```
   YOU (logged in at sitepounce.com)
        │
        │  1. Search: industry + location + filters
        ▼
   Google Places API ──► finds businesses, filters to "no website + mobile" etc.
        │
        │  2. Click "Generate website mockup" on a result
        ▼
   OpenAI gpt-image-1 ──► photoreal hero image (no text)
        │
        ▼
   sharp + canvas ──► composite the photo + crisp branded text into one PNG
        │
        ▼
   Vercel Blob ──► stores the PNG + a small JSON metadata file
        │
        │  3. You get: image URL, a short shareable link, WhatsApp/Download buttons
        ▼
   Prospect opens preview link  (preview.aiwebpoint.com/v/<slug>)
        │
        ▼
   /api/track beacon ──► Neon Postgres ──► "Opened ✓" badge appears in your dashboard
```

### The end-to-end user journey
1. **Sign in** at `sitepounce.com` (full-screen branded login gate; protects your API credits).
2. **Search** for a trade + town (e.g. "plumbers" / "Birmingham") with filters
   (no website, mobile only, etc.). If the town is thin, it **auto-expands to
   nearby areas** to find more leads.
3. **Review result cards** — each shows phone, ratings, address, map link.
4. **Generate a mockup** — optionally add a contact name and art-direction notes.
   ~15–25s later you get a polished PNG + a shareable preview page.
5. **Send it** — WhatsApp button (mobiles only, you press send manually) or copy
   the image/link into an email.
6. **Track engagement** — when the prospect opens the link, the mockup's row in
   **Recent mockups** flips to "✓ Opened" (and "🔥 Demo clicked" if they hit the CTA).

---

## 2. Features

### Search & lead-finding
- **Google Places (New) Text Search** for real businesses.
- **Filters:** website (any / none / has), phone (any / has / **mobile only** /
  landline / none), email, **ratings count range** (from–to), and **star buckets**
  (≤1★ / 2★ / 3★ / 4★ / 5★).
- **Server-side filtering + deep paging:** scans *all* of Google's results
  (~60 max per query), not just the top 10, applying filters as it goes.
- **Auto-expand to nearby areas:** if your town doesn't yield enough matches, an
  AI call (gpt-4o-mini) suggests the nearest towns/suburbs and searches those too
  (up to 5), so "Birmingham had 1" becomes "21 across nearby areas".
- **UK mobile detection:** regex `^07[1-57-9]` (excludes 070 personal & 076 pagers).
- **Recent searches** table (saved on device) with one-click **Run again**.

### Mockup generation
- **AI hero photo** via OpenAI **gpt-image-1** — trade-specific scene, no text baked in.
- **Art direction:** free-text notes steer the photo (e.g. "a female plumber",
  "bright, modern"). Cannot place text on the image (that's intentional).
- **Crisp branded overlay** composited on top: the business's own logo (initials),
  headline, tagline, **prominent phone number pill**, "Request a demo" button,
  service chips, a closing-line CTA button, and a small "Designed by Ai Web Point".
- **Person's name field:** if set, the shareable preview page greets them by name
  in a highlight colour ("A website preview for **James** · …").
- Output: a single **1200×880 PNG**, hosted publicly.

### Sending & sharing
- **Shareable preview page** at a short, clean URL: `preview.aiwebpoint.com/v/<slug>`.
  Shows the mockup, a brand-coloured "Request a demo" button, and an agency sign-off.
- **WhatsApp + SMS click-to-send** (mobiles only): opens WhatsApp (`wa.me`) or your
  Messages app (`sms:`) with a pre-filled, editable message + link — **you press
  send** (manual = compliant for cold outreach). Each send tags the link with the
  channel (`?c=w/s/e`).
- **Editable message templates** (saved per device): a **first message** and a
  separate **follow-up message**, with placeholders `{name}` `{business}`
  `{category}` `{location}` `{link}`.
- **Branded image URL** for email embedding (`/i/<slug>.png` on the agency domain)
  + **Download PNG**.

### Dashboard / history
- **Recent mockups** table: thumbnail, date, company, location, **engagement**
  (Opened / Demo clicked / Not opened yet), and **Open ↗** to reopen the
  Send/Download tools without regenerating. Loads from the **server**, so every
  mockup you've ever made appears on any device.
- **Recent searches** table: re-run past searches in one click.

### Engagement tracking (Phase 1)
- Logs when a prospect **opens** the preview link and when they **click the demo CTA**,
  plus **which channel** they came from (`?c=w/s/e`).
- Recent mockups show an **Engagement** column (🔥 Demo clicked / ✓ Opened ×N + UK
  date-time / Not opened yet) and a **↩ Follow up** button that opens the right
  channel — priority: how they *opened* → how you *sent* → default WhatsApp.
- Powers the "they didn't open it → send a screenshot/nudge" follow-up workflow.

### Security & cost protection
- **Login gate** (full-screen) hides the whole interface until signed in.
- **Server-side auth** on every paid endpoint (search/generate) — credits are safe
  even if someone saw the UI.
- **Usage caps:** 20 searches + 20 generations per 12 hours (configurable).
- **Error alerts:** failed generations email you via SendGrid + show a Retry button
  (45s countdown).

---

## 3. Architecture

**Hosting:** [Vercel](https://vercel.com) (Hobby plan) — static frontend + Node
serverless functions. Auto-deploys on every `git push` to `main`.

```
Frontend (static, /public)          Backend (/api, serverless)        Data stores
─────────────────────────           ──────────────────────────        ───────────
index.html  — markup & gate         login.js    — auth                Vercel Blob   (PNGs + JSON metadata)
app.js      — all UI logic          search.js   — Google Places       Neon Postgres (link_events tracking)
styles.css  — styling               generate.js — gpt-image-1 + PNG    (localStorage — recent lists, settings)
data.js     — client helpers        view.js     — preview page
                                    track.js    — open/click beacon
                                    mockups.js  — list all mockups + stats
                                    download.js — force-download PNG
                                    report.js   — SendGrid error email
Shared libs (/lib)
─────────────────
auth.js     — HMAC signed-cookie sign/verify
ratelimit.js— 12h usage caps (counts blobs)
filters.js  — server-side lead filtering + UK mobile test
db.js       — Neon Postgres pool + event recording/stats
```

### Frontend
- **Plain static HTML/CSS/JS** — no framework, no build step. Served from `/public`.
- `app.js` holds everything: login gate, search, render, generate modal, preview
  modal, WhatsApp builder, recent searches/mockups, settings, tracking merge.
- **State persistence via `localStorage`:**
  - `aiwp_settings` — message + CTA wording
  - `aiwp_recent` — recent mockups (per device)
  - `aiwp_searches` — recent searches (per device)
- Server-stored history (`/api/mockups`) is merged with local so mockups appear
  across devices; local entries keep the phone number so WhatsApp can be rebuilt.

### Backend (Vercel serverless, CommonJS, Node 20)
Every paid endpoint checks the auth cookie first, then the 12h rate limit, then does its work.

### Image pipeline (important, do not regress)
- gpt-image-1 returns a JPEG (base64). **`@napi-rs/canvas`'s `loadImage` cannot
  decode it** ("Invalid SVG image"). So: **canvas renders only the transparent
  text/branding overlay**, and **`sharp` decodes the photo and composites** the
  overlay on top. Fonts (Montserrat) are bundled in `/fonts`.

---

## 4. API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/login` | — | Validate `APP_USERNAME`/`APP_PASSWORD`, set signed `aiwp` cookie. `GET` returns `{authed, configured}`. |
| `POST /api/search` | ✅ | Google Places search + server-side filter + nearby-area auto-expand. |
| `POST /api/generate` | ✅ | gpt-image-1 → sharp/canvas composite → Blob. Returns `{imageUrl, viewUrl, id, slug}`. |
| `GET /api/view?slug=` | — | Renders the prospect preview page (also wired via `/v/:slug` rewrite). Injects tracking beacon. |
| `GET /api/img?slug=` | — (public) | Streams a mockup PNG from our domain (`/i/:slug.png` rewrite). Hides the blob host. `?download=1` forces a file save. Immutable-cached. |
| `GET /api/track?slug=&e=&c=` | — (public) | Records `view` / `cta` events to Postgres with the channel (`c=w/s/e`; legacy `p=` accepted). Bot-filtered. Returns 204. |
| `GET /api/mockups` | ✅ | Lists all stored mockups (newest 40) + merges open/click stats + last-open channel. |
| `GET /api/download?img=` | ✅ | (Legacy) proxies a Blob PNG as attachment. Superseded by `/i/:slug.png?download=1`. |
| `POST /api/report` | ✅ | Emails an error report via SendGrid (no-op if not configured). |

`vercel.json` sets per-function limits: `generate` (1024 MB, 60 s, bundles fonts),
`search` (30 s), `mockups` (30 s), and rewrites `/v/:slug → /api/view?slug=:slug`.

---

## 5. Data model

### Vercel Blob (object storage)
- `mockups/<slug>.png` — the final mockup image.
- `mockups/<slug>.json` — metadata: `{ name, loc, who, cta, img, phone, category }`.
- `usage/...` — rate-limit counters (one blob per use, pruned after 12h).
- `<slug>` = `<business-name-slug>-<8charid>`.

### Neon Postgres
```sql
link_events (
  id       BIGSERIAL PRIMARY KEY,
  slug     TEXT NOT NULL,       -- which mockup
  event    TEXT NOT NULL,       -- 'view' (opened) | 'cta' (clicked demo)
  ts       TIMESTAMPTZ DEFAULT now(),
  ua       TEXT,                -- user agent (bots filtered before insert)
  platform TEXT                 -- channel it was sent on: 'w' | 's' | 'e'
);
```
Created lazily (`CREATE TABLE IF NOT EXISTS`). Read via `statsBySlug()` →
`{ slug: { view:{n,last}, cta:{n,last}, platform } }` (platform = the most recent open's channel).

---

## 6. External services & environment variables

| Service | Env var(s) | Notes |
|---|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_IMAGE_QUALITY` (opt) | gpt-image-1 (mockups) + gpt-4o-mini (nearby areas). |
| Google Places (New) | `GOOGLE_PLACES_API_KEY` | Restricted to Places API. |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` (+ auto-added) | Public store for PNGs/metadata. |
| Neon Postgres | `POSTGRES_DATABASE_URL` (+ POSTGRES_* set) | Tracking events. **NB:** no plain `POSTGRES_URL` — `lib/db.js` falls back through the names. |
| SendGrid | `SENDGRID_API_KEY`, `ERROR_EMAIL_FROM`, `ERROR_EMAIL_TO` | Error alerts ("SitePounce Error — …"). |
| Auth | `APP_USERNAME`, `APP_PASSWORD` | Login. Cookie HMAC is keyed by the password itself. |
| Branding/links | `AGENCY_NAME` (default "Ai Web Point"), `DEMO_URL`, `LINK_DOMAIN` | `DEMO_URL`=booking link; `LINK_DOMAIN`=`preview.aiwebpoint.com`. |
| Rate limits | `LIMIT_SEARCH`, `LIMIT_GENERATE` (default 20) | Per 12 hours. |

**Domains:**
- `sitepounce.com` — the app (product brand). Also `ai-web-point.vercel.app` (original).
- `preview.aiwebpoint.com` — prospect preview links + branded image URLs (a subdomain of the agency site).
- `aiwebpoint.com` — the agency's main site (on Lovable, separate from this app).

### Domain & branding strategy (decision — 2026-06-05)
Two audiences, two brands — keep them split:

| Surface | Domain | Why |
|---|---|---|
| **The app** (you log in) | **sitepounce.com** | Your product/SaaS brand — the thing you may sell on subscription. |
| **Prospect-facing links** (preview page + image URLs) | **aiwebpoint.com** (`preview.` / `/i/`) | The **agency** brand. |

**Why prospect links live on `aiwebpoint.com`, NOT `sitepounce.com`:**
1. It matches the mockup's "Designed by Ai Web Point" signature — a consistent story for the prospect.
2. It reads as a genuine web-design agency, which builds trust on a cold approach.
3. "Site Pounce" reveals the tool's nature (lead-finding/outreach). A prospect who googled it would see it's an outreach tool — exactly what you don't want a cold lead to realise. **Keep the tool brand invisible to prospects.**

**Image hosting is also branded:** mockup PNGs are served via `preview.aiwebpoint.com/i/<slug>.png` (the `/api/img` proxy), so the underlying `*.public.blob.vercel-storage.com` host is never exposed in emails or to prospects.

**Future (Phase 3 / white-label SaaS):** when sold to *other* agencies, the prospect-link domain should be a **per-account setting** (each customer's own domain), not aiwebpoint.com or sitepounce.com. The `LINK_DOMAIN` env var is the single switch for this today.

---

## 7. Security, privacy & compliance notes

- **Auth:** HttpOnly signed cookie (HMAC, 12h TTL), validated server-side on every
  paid call. The login gate is a UX deterrent; real protection is server-side.
- **WhatsApp:** uses manual `wa.me` click-to-send — **compliant for cold outreach**
  because *you* press send. Only shown for mobile numbers.
- **Tracking honesty:** the open-beacon fires via JS so link-preview crawlers
  (WhatsApp/iMessage) don't create fake "opened" hits; bot user-agents are also filtered.
- **Privacy:** prospect phone numbers are never placed on the public preview page.
- **Search engines:** preview pages (`/api/view`) and mockup images (`/api/img`) send
  `noindex` (meta tag + `X-Robots-Tag`) so prospect names/mockups never appear in Google.
  This matters because `aiwebpoint.com` (incl. the `preview.` subdomain) is verified in
  Google Search Console — the verification itself was for the agency's main site (on Lovable).
- **Cold-outreach law (UK, not legal advice):** B2B to limited companies is broadly
  OK with clear sender ID + opt-out; sole traders/individuals are stricter. Build
  opt-out/STOP handling before scaling automated SMS/email (Phase 2/3).

---

## 8. Roadmap

### ✅ Phase 1 — Engagement tracking (DONE, 2026-06-05)
- Link-open + demo-click tracking via JS beacon → Neon Postgres.
- "Opened ✓ / Demo clicked 🔥 / Not opened yet" badges in Recent mockups.
- Database foundation (Neon) for everything that follows.
- **Why first:** cheap, compliant, immediately useful, and the single signal
  ("did they click the link?") works across *every* channel.

### 🔜 Phase 2 — Multi-channel send + delivery receipts
- **Channel picker:** WhatsApp (manual, as now) **+ SMS (Twilio) + Email (SendGrid)**.
- **WhatsApp → SMS fallback:** when a number isn't on WhatsApp, one click switches
  to SMS (there's no reliable, compliant way to *detect* WhatsApp presence without
  the official API, which forbids cold outreach — so we offer fallbacks instead).
- **Real delivery receipts:** SMS delivered (Twilio DLR), email delivered/clicked
  (SendGrid webhooks). All channels share the same link-click tracking from Phase 1.
- Smart suggestion of the best channel based on the lead's available data.

### 🔮 Phase 3 — The SaaS layer (subscription product)
- **Delivery-report dashboard:** filterable table of every send — recipient,
  keyword, location, channel, delivered (y/n), opened (y/n), clicked (y/n),
  timestamps — with CSV export.
- **Follow-up action buttons** in the report: e.g. for leads who didn't open,
  a one-click "send a screenshot / nudge" (manual = compliant) — your idea, and
  the reason the open-tracking matters.
- **Multi-user accounts / multi-tenancy:** scope leads, mockups, sends, and reports
  per user → ready to sell as a subscription.
- **Compliance built in:** opt-out/STOP handling, sender identity, consent records
  (a selling point, not just safety).
- **Billing:** subscription tiers (e.g. Stripe), usage limits per plan.

> Phases 2–3 build *on top of* Phase 1's database and tracking — additive, not a rewrite.

---

## 9. Deploying / making changes

- **No Node/Homebrew on the dev machine**, and the iCloud project folder is
  sandboxed from preview subprocesses — so changes are shipped via Git, not run locally.
- **To ship:** edit files → `git commit` → `git push` → Vercel auto-builds (~1–2 min;
  installs `@napi-rs/canvas`, `sharp`, `@vercel/blob`, `@vercel/postgres`).
- **Env vars** are set in the Vercel dashboard (never committed).
- **Inspect the database:** Vercel → Storage → `neon-green-ladder` → Query tab.

---

## 10. Known limitations

- Google Text Search caps at ~60 results per query → narrow areas / nearby-expand
  to find more no-website leads.
- Google doesn't expose email addresses (email is always "not found").
- gpt-image-1 is ~90% accurate to art-direction notes — occasionally regenerate.
- Recent lists are per-device (localStorage); the mockup *library* itself is
  server-backed and cross-device.
- Email "open" tracking (Phase 2) is unreliable post-Apple Mail Privacy; **click**
  tracking is the dependable signal.
- WhatsApp delivered/read receipts are not available with the manual `wa.me` method.

---

## 11. Quick reference — file map

```
/public
  index.html   gate (Site Pounce landing) + app shell + modals
  app.js       login, search, render, generate, preview, WhatsApp, recent lists, tracking merge
  styles.css   all styles
  data.js      client-side BizData helpers (isUkMobile, phone chips)
/api
  login.js     auth (set/verify cookie)
  search.js    Google Places + filters + nearby auto-expand
  generate.js  gpt-image-1 + sharp/canvas composite + Blob + metadata
  view.js      /v/<slug> prospect preview page + tracking beacon
  img.js       /i/<slug>.png — branded image proxy (hides blob host)
  track.js     public open/click beacon (+ channel) → Postgres
  mockups.js   list all mockups + merge engagement stats + last-open channel
  download.js  force-download proxy (legacy; superseded by /i/<slug>.png?download=1)
  report.js    SendGrid error email
/lib
  auth.js      HMAC sign/verify/cookie
  ratelimit.js 12h usage caps
  filters.js   server-side lead filtering + UK mobile test
  db.js        Neon Postgres pool + recordEvent/statsBySlug
/fonts         Montserrat weights (bundled into generate fn)
vercel.json    function configs + /v/:slug rewrite
package.json   deps: @napi-rs/canvas, sharp, @vercel/blob, @vercel/postgres
```
