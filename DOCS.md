# Site Pounce, Technical & Product Documentation

_Last updated: 2026-06-10_

Site Pounce is a lead-generation, outreach **and sales-intelligence** platform for a
web-design agency. It finds local businesses with **no website**, generates a
professional **AI mockup** of their homepage, lets you **send & track** it, surfaces
**warm leads**, and builds a **sales-intelligence dossier** (and, coming, a full live
website) for each prospect.

- **Product brand (the tool):** **Site Pounce**, `sitepounce.com`
- **Agency brand (shown to prospects):** **Ai Web Point**, `aiwebpoint.com`
- The split is deliberate: *Site Pounce* is the tool you log into; *Ai Web Point* is the
  agency name prospects see on mockups/sites. Keep the tool brand invisible to cold prospects.

---

## 1. Live URLs & hosting

- **App:** `https://sitepounce.com` (primary) and `https://ai-web-point.vercel.app` (original).
- **Prospect links & images:** `https://preview.aiwebpoint.com/v/<slug>` (preview pages) and
  `/i/<slug>.png` (mockup images), the agency domain, for trust. `noindex`ed.
- **Hosting:** **Vercel (Pro plan)**, static frontend in `/public` + Node serverless
  functions in `/api`. Auto-deploys on every `git push` to `main`.
- **Database:** **Neon Postgres** (serverless, free tier) via Vercel Storage.
- **Object storage:** **Vercel Blob** (mockup PNGs, metadata, dossiers).

---

## 2. The app, a top-nav SPA

After signing in (full-screen Site Pounce login gate), the app has a **top navigation**
with four views (`#view-*` divs toggled by `showView()` in `app.js`):

| Nav | What it is |
|---|---|
| **🔍 Search** | Find leads → results → generate mockups → recent searches/mockups |
| **💬 Templates** | Edit the first-message / follow-up / CTA wording (saved per device) + Blocked contacts |
| **📊 Performance** | Dashboard: stats, insights, charts, CSV, date-range (lazy-loads) |
| **🌡️ Warm Leads** | Prospects who requested a demo, with a live count badge + actions |
| **👤 All Leads** | Every business worked: searchable/filterable table (Prowled / Website built / Messaged / Blocked); each row opens the Lead Profile |

**Lead Profile popup:** click any business name (Leads, Warm Leads, dashboard activity, Recent
mockups) to open a profile with contact details + one-tap **Call / WhatsApp / Maps / View
preview**, engagement chips, **Prowl** status (view dossier or Prowl now), **Pounce** status
(open website or build), and Block/Unblock. Uses `peek` mode on `/api/prowl` + `/api/pounce`
(checks for an existing dossier/site without gathering, building or spending a credit).

The login gate doubles as a **Site Pounce landing page** (hero, founding-member offer,
application form). The whole interface is hidden behind it until signed in.

---

## 3. Features

### Search & lead-finding
- **Google Places (New)** text search for real businesses.
- **Filters:** website (any/none/has), phone (any/has/**mobile**/landline/none), email,
  ratings-count range, star buckets, and **"Already messaged"** (exclude ever / last 3 months).
- **Deep paging + server-side filtering** (scans ~60 results, not just top 10).
- **Auto-expand to nearby areas**, if a town is thin, an AI call (gpt-4o-mini) names the
  nearest towns/suburbs and searches those too, so "Birmingham had 1" → "21 across nearby areas".
- **Recent searches** table, one-click **Run again** + per-row delete.
- A **↻ Refresh** (no cost) re-checks messaged labels.

### Mockup generation
- **AI hero photo** via OpenAI **gpt-image-1** (no text in image).
- **AI scene + service chips per industry** (gpt-4o-mini), works for *any* business, not
  just trades (fixed a bug where "web designer" got a tradesperson photo).
- **Per-generation variety** (random angle/lighting/seed) so two businesses in the same
  trade never get identical photos.
- **Crisp branded overlay** (sharp + canvas): the business's own logo, headline, prominent
  phone pill, CTA button, service chips, "Designed by Ai Web Point".
- **Person's name** field → highlighted on the preview page.
- **Animated step-by-step progress** while generating; **🔄 Regenerate** reopens the popup
  pre-filled with an optional "what to change" note (1 credit).
- **Hardened:** auto-retries transient OpenAI image failures once; `maxDuration` 180s.

### Sending & messaged-tracking
- **Branded preview page** at `preview.aiwebpoint.com/v/<slug>`; **branded image URL**
  `/i/<slug>.png` (hides the blob host) for email embedding + Download PNG.
- **Preview CTA row:** a bold green, **personalised** "📞 Yes, I'd like a demo for <Business> →"
  button (fires the `cta`/demo event) beside a red **"No thanks"** button. "No thanks" opens a
  small panel ("No problem, we won't contact you again. Mind telling us why?") with optional
  reason chips + a feedback box → `POST /api/decline` → auto-sets the lead to **Not interested
  (via mockup)** and shows a thank-you. See the Lead-statuses table below.
- **WhatsApp + SMS** click-to-send (manual, mobiles only). Each send tags the link with the
  channel (`?c=w/s/e`).
- **Editable templates** (per device): first message + follow-up, placeholders `{name}`
  `{business}` `{category}` `{location}` `{link}`. Empty `{name}` collapses to "Hi,".
  `{category}` is title-cased with acronyms (Dog Groomers / MOT).
- **`{business}` is humanised in the message** (`humaniseBusinessName` in `app.js`), two passes:
  (1) **run-together names** are split on camelCase, e.g. "PerformanceCarValeting" →
  "Performance Car Valeting", "JJGHomeCarWash" → "JJG Home Car Wash" (acronyms like MOT and
  already-spaced names stay intact); (2) **keyword-stuffed overlong names** (>34 chars with
  `,`/`&`/`/`/`+`/"and" separators) are trimmed to their first one or two phrases, e.g.
  "JJG Home Car Wash, Mobile Valeting & Alloy Wheel Refurbishment" → "JJG Home Car Wash &
  Mobile Valeting". Short/normal names are left untouched. Message text only, the mockup
  image and preview page keep the full real name.
- **Messaged tracking** (per device, by Google place id): cards show "✓ You messaged them
  via WhatsApp (date·time) & SMS (…)", accumulates channels with timestamps. The
  "Already messaged" filter excludes them from new searches so you dig for fresh leads.
- **🚫 Block (do-not-contact):** a Block button on search-result cards, Warm Lead cards and
  Recent mockups rows (e.g. someone replied "No"). Blocked businesses **never appear in search
  results** (server `excludeIds` by place id + client filter by name+location) and their
  **outreach buttons are removed** (Blocked state + Unblock shown in Warm Leads / Recent).
  Managed in **Templates → 🚫 Blocked contacts** (list + Unblock). Per device (`aiwp_blocked`).

### Engagement tracking
- A JS beacon on the preview page logs **opens (`view`)** and **demo-CTA clicks (`cta`)** to
  Postgres, with the **channel** (`?c=`) and exact time. Sends are logged as **`sent`** events.
- Bot-filtered (JS-fired so link-preview crawlers don't create false opens).
- Recent mockups show an **Engagement** column (Opened ✓ / Demo clicked 🔥 / Not opened) +
  a **↩ Follow-up** button that opens the channel they engaged on.

### 📊 Performance dashboard
- Stat cards (mockups made / messaged / mockup-viewed+rate / demo clicks+rate / 🤑 sign-ups+rate
  / 🙅 Not interested (mockup)+rate-of-viewed, with a hover breakdown of *why* they declined),
  avg time-to-open, by-channel open rates, **opens-by-hour & opens-by-day** charts (UK time, peak
  highlighted), recent-activity table.
- **Funnel:** Messaged → Viewed → Demo → Sign-up, each % converting from the stage above, with a
  caption noting how many marked themselves not interested via the mockup.
- **Insights split**: "📊 Based on your data" (computed) vs "💡 General tips" (static).
- **Date range** (7 / 30 / all), **CSV export**, refresh.

### 🌡️ Warm Leads
- Prospects who clicked the demo CTA, enriched with phone/name/location.
- Per card: **📱 WhatsApp / 📞 Call / 📍 Maps / View ↗ / 🐾 Prowl / 🐆 Pounce**.
- **Nav count badge** + **animated tab-title alert**, `Site Pounce (N)` when looking,
  **flashes** "🌡️ (N) warm leads!" when you're on another tab; 3-min poll keeps it fresh.

### 🐾 Prowl, lead-intelligence dossier
- On-demand sales recon per lead. Sources: **Google Places** (live reviews/score, top-3
  competitors *with* websites → comparison table, recent reviews) + **OpenAI** synthesis →
  `services`, reputation, **🎯 ammunition** (specific lines to say), suggested opener +
  **Companies House** (established/director/type, when its key is set; degrades gracefully).
- Output: competitor comparison table (you vs rivals: website / reviews / score), what-they-do
  chips, ammunition, opener. **Cached** as `dossiers/<slug>.json` (↩ Re-run to refresh).
- Rate-limited (`LIMIT_PROWL`, default 20/12h).

### 🐆 Pounce, one-click website builder (LIVE)
- **Available from anywhere a business appears:** Warm Lead cards, the **Recent mockups** table
  (per-row 🐾 Prowl / 🐆 Pounce / Open / Regenerate), **search-result cards once a mockup
  exists**, and a CTA inside the Prowl dossier. Hot-lead status is **not** required.
- Clicking 🐆 Pounce opens an **optional pre-build questions** step (skippable): accent colour,
  services to highlight, standout selling point, a special-offer banner, an "add FAQ" toggle,
  **accreditations** (suggested by trade, you tick only the real ones, never fabricated), and a
  free-text **copy notes** box (steers the wording only, not photos/sections). Then it builds a
  real **1-page WOW website** and opens it inline (iframe) with **Open full site ↗ / Copy link /
  Edit & rebuild**.
- **Sources:** `api/pounce.js` → **Google Place Details** (real business **photos**, **4-5★
  reviews**, opening hours, address, phone) + the **Prowl dossier** + **gpt-4o-mini** copywriting
  (headline, trust badges, service cards, about, stats, areas-covered, FAQ, SEO meta).
- **Auto-runs Prowl:** if the lead has not been Prowled, Pounce **gathers the intel itself**
  (shared `lib/intel.js` `gatherDossier`), run **in parallel** with the photo work to save time;
  the dossier is stored so opening Prowl afterwards is instant. So a site always has intel
  (services, reputation, established year) behind it without a manual Prowl first.
- **Generated sections:** sticky header w/ click-to-call, **hero with a quote form**, an
  **accreditation strip**, services, about (with a branded highlight card when no good photo),
  a real-photo **gallery**, a **live Google rating widget** ("Read on Google"), reviews, optional
  **FAQ** accordion, a **service-area section with a keyless embedded map** + areas-covered chips,
  a contact form, footer, and a **sticky mobile call bar**. **Accent colour** theming + an
  optional **offer banner**.
- **Preview "Yes, sign me up" bar:** a sticky, AWP-branded sales bar shown **only in preview
  mode** (vanishes when `mode:'published'`) linking to `SUBSCRIBE_URL` (default
  `aiwebpoint.com/subscribe`) `+ ?source=<slug>`. The click fires a **`signup`** tracking event
  (the hottest signal) which is surfaced in Warm Leads (pinned, green badge, tab-title alert) and
  the Performance dashboard (🤑 Sign-ups stat + conversion rate + CSV).
- **Photo intelligence (don't regress):** GMB photos are often poor (logos, receipts, plain
  storefronts). `rankPhotos()` runs **gpt-4o-mini vision** over every Google photo (512px,
  `detail:'low'`) and scores each for **hero** and **gallery** suitability + a **junk** flag.
  Only a photo scoring ≥ `POUNCE_HERO_MIN` (default **7**) becomes the hero; gallery uses
  non-junk photos ≥ `POUNCE_GALLERY_MIN` (default **5**). **If nothing clears the bar,
  `generateHeroImage()` curates a clean, text-free, on-trade hero with gpt-image-1** (stored
  as `sites/<slug>-hero.jpg`). The chosen path (`heroSource`: their photo / AI-curated) is
  shown in the result bar.
- **Hosting:** **by us**, served at **`/s/<slug>`** (`api/site.js`) from `sites/<slug>.json`.
  Preview = the live page (identical when published). **GHL** later provides the Google review
  system + CRM behind it.
- **Photos** are served via **`api/photo.js`**, a proxy that fetches the Google photo
  server-side so `GOOGLE_PLACES_API_KEY` never appears in the page (validated name, cached,
  noindex).
- **Favicon:** every generated site gets a **per-business** inline-SVG favicon (initials badge).
- **No crawling in preview:** preview sites render `<meta robots noindex>` **and** an
  `X-Robots-Tag: noindex` header (the whole site only drops noindex when `mode:'published'`).
- **Preview registry / tidy-up:** every build writes `sites/<slug>.json` with `mode:'preview'`
  + `createdAt`. **`GET /api/sites`** (login-gated) lists them all (slug, name, mode, createdAt,
  url) so old previews can be reviewed/cleaned in a later tidy-up session.
- Rate-limited (`LIMIT_POUNCE`, default 30/12h). Footer: "Powered by
  aiwebpoint.com?source=<slug>".
- **Prototype reference:** `/prototype-solihull.html`; **built-in demo** at
  `/s/sample-pap-electrical` (renders through the real `render()`, stock photos, for design review).
- **Build-time UX:** animated progress steps (Researching, Studying their Google profile, Pulling
  photos, Reading reviews, Sizing up competitors, Writing copy, Curating hero, Designing,
  Publishing) so it never looks frozen; honest timing ("around a minute").
- **Planned next:** **client photo upload** (the business sends their own / before-and-after
  photos to use in the gallery, the right way to do real before/after) is the top item; then 3
  selectable templates, SEO-tier dropdown, AI-prompt editor for revisions, the publish flow
  (flip `mode`→`published`, custom domain) + GHL handoff (review system/CRM) at conversion.

### 👤 All Leads, CRM status & CSV exports
- **Lead Profile popup** (click any business name in Leads / Warm Leads / dashboard / Recent
  mockups): contact details + one-tap Call / WhatsApp / Maps / View, engagement chips, Prowl
  status (view dossier or Prowl now), Pounce status (open site or build), Block, and the CRM
  block below. Uses `peek` on Prowl/Pounce so it never spends a credit just to check status.
- **CRM status + notes:** a Status dropdown and a **timestamped notes log** (server-side in
  `notes/<slug>.json`, so it persists and is shared across devices, unlike the per-device
  messaged/blocked flags). Status shows as a colour chip in the Leads table, the dashboard
  activity table, and Warm Lead cards (which dim for not-interested / not-interested-via-mockup /
  lost / invalid-phone). A lightweight `notes/_index.json` maps slug→status for cheap lookups.
- **Lead statuses (what each means):**
  | Value (internal) | Label shown | Meaning |
  |---|---|---|
  | `` (empty) | New | Not actioned yet. |
  | `contacted` | Contacted | You've messaged them (manual). |
  | `no-answer` | Doesn't answer | Tried to reach them, no reply. |
  | `interested` | Interested | They've shown interest. |
  | `callback` | Call back | Asked to be called back later. |
  | `not-interested` | Not interested | **You** marked them not interested (manual, by Ajay). |
  | `declined` | Not interested (via mockup) | **Auto-set** when the prospect clicks "No thanks" on their mockup preview. Kept as a separate value so Performance can split mockup-triggered from manual, but the label reads the same ("Not interested") for consistency. Icon 🙅 (not 🚫, which is Blocked). Their reason/feedback is saved to the notes. |
  | `invalid-phone` | Invalid phone | Number doesn't work. |
  | `won` | Won, customer | Converted to a paying customer. |
  | `lost` | Lost | Was a prospect, didn't convert. |
  > **Blocked** is *not* a status — it's a separate per-device flag (🚫) that hides a business and removes its outreach buttons. A lead can be both (e.g. blocked + not-interested).
  > The decline flow is public (`POST /api/decline`, no auth, since the prospect isn't logged in): it records a `decline` event for Performance **and** sets the `declined` status with the reason. The authed `/api/note` whitelist also includes `declined`.
- **👤 All Leads view:** searchable, filterable table of every business worked (All / Prowled /
  Website built / Messaged / Not messaged / Opened / Blocked + a status dropdown). Each row opens
  the Lead Profile.
- **CSV export** on the Leads tab and the Search results, both rich: Search adds website Yes/No,
  address, phone(s), email, star rating, no. of ratings, plus pipeline fields (status, opened,
  demo/sign-up click, prowled, website built); Leads adds person name, status, engagement,
  prowled/pounced, blocked, preview URL. Exports respect the active filters.

### Founding-member landing & application
- The login gate is a landing page with a **Founding-Member** offer ("20 places, fixed fee
  for life") + an **application form** (`/api/apply`) that emails Ajay (SendGrid) **and**
  stores to Postgres `applications`. Demos are gated behind applying.

### Security & cost protection
- Full-screen **login gate** + server-side auth on every paid endpoint.
- **Usage caps** (`lib/ratelimit.js`): 30 searches / 30 generations / 30 prowls / 30 pounces per **20h**
  window (env `LIMIT_*` + `RATE_WINDOW_HOURS`). Caps generation/search COST, not WhatsApp sending.
  (env-overridable `LIMIT_*`).
- **Error alerts** email you via SendGrid + an on-screen Retry button (45s countdown).

---

## 4. Architecture

```
Frontend (static, /public)            Backend (/api, Vercel serverless)
─────────────────────────             ────────────────────────────────
index.html  views + gate + modals     login.js     auth (cookie)
app.js      all UI logic               search.js    Google Places + filters + nearby-expand
styles.css  styling                    generate.js  gpt-image-1 + sharp/canvas composite + Blob
data.js     client helpers             view.js      /v/<slug> preview page + tracking beacon
favicon.svg SP icon                    img.js       /i/<slug>.png branded image proxy
prototype-solihull.html (Pounce ref)   track.js     open/click/sent beacon → Postgres
                                       mockups.js   list mockups + merge engagement stats
Shared libs (/lib)                     apply.js     founding-member form → SendGrid + Postgres
─────────────────                      report.js    error-alert email (SendGrid)
auth.js     HMAC signed cookie         dashboard.js analytics aggregation + insights
ratelimit.js 12h usage caps            hotleads.js  demo-clickers + contact details
filters.js  server-side lead filtering prowl.js     lead-intelligence dossier (cached)
db.js       Neon Postgres pool+queries pounce.js    builds 1-page site → sites/<slug>.json
                                       site.js      renders /s/<slug> (noindex preview)
                                       photo.js     Google-photo proxy (hides API key)
                                       sites.js     lists preview sites (tidy-up registry)
```

- **Frontend:** plain static HTML/CSS/JS, no framework/build step. State persists in
  `localStorage` (`aiwp_settings`, `aiwp_recent`, `aiwp_searches`, `aiwp_messaged`).
  Server-stored history (`/api/mockups`) merges in so mockups appear across devices.
- **Image pipeline (don't regress):** gpt-image-1 returns a JPEG that `@napi-rs/canvas`'s
  `loadImage` **cannot** decode. So canvas renders only the transparent text overlay, and
  **`sharp`** decodes the photo and composites. Fonts (Montserrat) bundled in `/fonts`.

---

## 5. API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/login` |, | Validate `APP_USERNAME`/`APP_PASSWORD`, set signed `aiwp` cookie. |
| `POST /api/search` | ✅ | Google Places + filters + nearby auto-expand (`excludeIds` skips messaged). |
| `POST /api/generate` | ✅ | gpt-image-1 → composite → Blob. Returns `{imageUrl, viewUrl, id, slug}`. |
| `GET /api/view?slug=` |, | Preview page (`/v/:slug` rewrite) + tracking beacon. |
| `GET /api/img?slug=` |, | Branded image proxy (`/i/:slug.png`; `?download=1` to save). Immutable-cached. |
| `GET /api/track?slug=&e=&c=` |, | Records `view`/`cta`/`sent` + channel to Postgres. Bot-filtered. |
| `POST /api/decline` |, | **Public** (no auth). Prospect clicked "No thanks" on their mockup: records a `decline` event + sets the lead's status to `declined` (Not interested via mockup) with their reason/feedback in the notes. |
| `GET /api/mockups` | ✅ | All mockups + engagement stats + last-open channel. |
| `GET /api/dashboard?days=` | ✅ | Aggregated stats + insights (date-range filtered). |
| `GET /api/hotleads` | ✅ | Demo-clickers + contact details (from mockup metadata). |
| `POST /api/prowl` | ✅ | Lead-intelligence dossier (cached as blob; rate-limited). |
| `POST /api/pounce` | ✅ | Builds a 1-page site → `sites/<slug>.json`. Returns `{siteUrl, slug, cached}`. Rate-limited. |
| `GET /s/<slug>` |, | Renders the generated site (`/api/site`). Preview = `noindex` (meta + header). |
| `GET /api/photo?n=` |, | Proxies a Google place photo (key stays server-side; validated; cached; noindex). |
| `GET /api/sites` | ✅ | Lists all generated preview sites (the tidy-up registry). |
| `GET /api/leads` | ✅ | Which slugs are Prowled / Pounced + a slug→status map (for the Leads view). |
| `GET\|POST /api/note` | ✅ | Per-lead CRM: read / set status + append timestamped comments (`notes/<slug>.json` + `notes/_index.json`). |
| `POST /api/apply` |, | Founding-member application → SendGrid + Postgres. |
| `POST /api/report` | ✅ | Error-alert email (SendGrid). |

Both Prowl and Pounce also accept `{peek:true}` to report whether a dossier/site already exists
without gathering, building, or spending a credit (used by the Lead Profile popup).

`vercel.json`: per-function config (`generate` 1024MB/180s/fonts, `pounce` 1024MB/120s,
`search`/`mockups` 30s, `prowl` 60s); rewrites `/v/:slug`, `/i/:slug`, `/s/:slug`;
cache headers
(`must-revalidate` on the app shell so deploys show without a hard refresh). `api/download.js`
was removed (legacy).

---

## 6. Data model

### Vercel Blob
- `mockups/<slug>.png`, final mockup image.
- `mockups/<slug>.json`, `{ name, loc, searchLoc, who, cta, img, phone, category }` (`searchLoc` = the core location you typed; `loc` may be an auto-expanded nearby town).
- `dossiers/<slug>.json`, cached Prowl dossier.
- `sites/<slug>.json`, generated Pounce site content + `mode` (`preview`/`published`) +
  `createdAt`. **This prefix is the preview registry** (`GET /api/sites` lists it).
- `usage/...`, rate-limit counters (pruned after 12h).
- `<slug>` = `<business-name-slug>-<8charid>`.

### Neon Postgres
```sql
link_events (id BIGSERIAL, slug TEXT, event TEXT['view'|'cta'|'sent'|'signup'|'decline'],
             ts TIMESTAMPTZ, ua TEXT, platform TEXT['w'|'s'|'e'])   -- tracking
applications (id, created, name, email, phone, jobtitle, business,
              website, role, volume, channels, why)                 -- founding applicants
```
Created lazily (`CREATE TABLE IF NOT EXISTS`). To inspect: Vercel → Storage →
`neon-green-ladder` → Query (toggle read-only OFF to write, back ON after).

---

## 7. External services & environment variables

| Service | Env var(s) | Notes |
|---|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_IMAGE_QUALITY?` | gpt-image-1 (mockups) + gpt-4o-mini (scenes, nearby areas, Prowl synthesis). |
| Google Places (New) | `GOOGLE_PLACES_API_KEY` | Search + Place Details (reviews/photos for Prowl/Pounce). |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` (+ auto) | PNGs, metadata, dossiers. |
| Neon Postgres | `POSTGRES_DATABASE_URL` (+ POSTGRES_* set) | **No plain `POSTGRES_URL`**, `lib/db.js` falls back through the names. |
| SendGrid | `SENDGRID_API_KEY`, `ERROR_EMAIL_FROM`, `ERROR_EMAIL_TO`, `APPLY_EMAIL_TO?` | Error alerts + founding applications. `FROM` must be a verified sender. |
| Companies House | `COMPANIES_HOUSE_API_KEY` (**PENDING**) | Free; unlocks the established/director/type part of Prowl. Auth = HTTP Basic `base64(key:)`. |
| Auth | `APP_USERNAME`, `APP_PASSWORD` | Login; cookie HMAC keyed by the password. |
| Branding/links | `AGENCY_NAME?`, `DEMO_URL`, `LINK_DOMAIN` | `DEMO_URL`=booking; `LINK_DOMAIN`=`preview.aiwebpoint.com`. |
| Limits | `LIMIT_SEARCH`/`LIMIT_GENERATE`/`LIMIT_PROWL` (default 20) | Per 12h. |

---

## 8. Domain & branding strategy (decision)

| Surface | Domain | Why |
|---|---|---|
| The app | **sitepounce.com** | Product/SaaS brand. |
| Prospect pages + images | **aiwebpoint.com** (`preview.` / `/i/`) | Agency brand, matches the "Designed by Ai Web Point" signature; keeps the tool brand invisible to cold prospects. |

`aiwebpoint.com` apex is the agency's main site (on Lovable); Site Pounce uses the
`preview.` subdomain. For white-label SaaS later, the prospect-link domain becomes a
per-account setting (`LINK_DOMAIN`).

---

## 9. Security, privacy & compliance

- **Auth:** HttpOnly signed cookie (HMAC, 12h), checked server-side on every paid call.
- **Cold outreach:** WhatsApp/SMS are manual `wa.me`/`sms:` (compliant for cold; you press send).
- **Tracking honesty:** open-beacon fires via JS so link-preview crawlers don't fake opens.
- **Search engines:** preview pages + mockup images send `noindex` (prospect names/mockups
  stay out of Google). Note `aiwebpoint.com` is verified in Google Search Console.
- **Privacy:** prospect phone numbers never appear on the public preview page.
- **Intelligence (Prowl):** all public business data (Google, Companies House, public web),
  legitimate B2B research.
- **Not legal advice:** cold B2B to Ltd companies is broadly OK with sender ID + opt-out;
  sole traders are stricter. Build opt-out/STOP handling before scaling automated channels.

---

## 10. Hosting & deploying

- **Vercel Pro**, function limit ~100 (was 12 on Hobby; we hit it adding Prowl and removed
  the unused `download.js`). `maxDuration` up to 300s.
- **No Node/Homebrew on the dev machine**, iCloud folder sandboxed, ship via Git, not local.
- **To ship:** edit → `git commit` → `git push` → Vercel auto-builds (~1–2 min; installs
  `@napi-rs/canvas`, `sharp`, `@vercel/blob`, `@vercel/postgres`).
- **Env vars** set in the Vercel dashboard (never committed). Cache headers make app-shell
  changes appear on a normal reload (no hard refresh needed).

**Deploy gotchas (learned the hard way 2026-06-09):**
- A serverless function with **both a rewrite and a `functions` config entry** can break Vercel's
  function detection: build fails fast with *"The pattern api/X.js doesn't match any Serverless
  Functions"* (NOT a cache issue, a no-cache rebuild fails the same). `api/site.js` hit this (it
  has the `/s/:slug` rewrite). Fix: remove its `functions` entry, it works like `api/view.js` /
  `api/img.js` (rewrite, default config). Don't give a rewrite-target function a `functions` entry
  unless it genuinely needs non-default memory/maxDuration.
- **Verify deploys gently.** Do not curl-poll the live URL in a tight loop, Vercel's automatic
  **DDoS Mitigation** will challenge the IP (403 with `x-vercel-mitigated: challenge`) and blind
  you. Wait ~60-90s, do one or two spaced checks, or just confirm in a browser / the Deployments
  tab. (Bot Protection / Attack Challenge Mode stays Inactive, so real users are unaffected.)

---

## 11. Roadmap

- **✅ Done:** lead finder, AI mockups, WhatsApp+SMS send, branded links, messaged-tracking,
  engagement tracking, **Performance dashboard** (incl. 🤑 Sign-ups stat), **Warm Leads** + tab
  alert + signup-clicker surfacing, **🐾 Prowl**, **🐆 Pounce** (full 1-page website builder, live,
  pre-build questions, accreditations, FAQ, service-area map, Google rating widget, sticky mobile
  bar, preview-only "Yes, sign me up" bar + `signup` tracking, auto-runs Prowl, noindex previews +
  tidy-up registry). Prowl/Pounce reachable from Warm Leads, Recent mockups, and search results.
- **🔜 Pounce v2, client photo upload (top item):** let the business send their own photos
  (incl. **before / after** shots) to use in the gallery, the honest way to do real before/after
  rather than faking with stock. Then: 3 selectable templates, SEO-tier dropdown, AI-prompt
  editor for revisions, **publish flow** (flip `mode` → `published`, drop noindex, custom domain)
  + **GHL** handoff (review system/CRM) at conversion.
- **🔜 Payments:** subscribe/checkout page built in **Lovable** at `aiwebpoint.com/subscribe`
  (3 tiers, each = Stripe Payment Link combining one-off **setup** + **monthly**; `?source=<slug>`
  → `client_reference_id` for attribution; Stripe promotion codes for discounts). Bar already
  points there. Optional later: Stripe webhook → flag a lead as "paying customer" in Warm Leads.
- **🔜 Companies House**, add the free key to enrich Prowl (established/director/type).
- **🔮 Later:** Prowl Phase B (Trustpilot/Facebook/competitor-gap web search),
  tidy-up admin UI (bulk-delete stale previews), per-keyword dashboard breakdowns,
  multi-user accounts + billing (SaaS), Pounce FAQ/Book-a-Demo/"Not sure yet?" sections on the
  subscribe page.

---

## 12. Known limitations

- Google Text Search caps at ~60 results/query → narrow areas / nearby-expand for more.
- Google doesn't expose email (always "not found").
- gpt-image-1 ~90% accurate to art-direction notes, regenerate if off.
- Local lists (recent/messaged) are per-device; the mockup library + dashboard are server-backed.
- Email open-tracking (future) is unreliable post-Apple; **click** tracking is dependable.
- WhatsApp delivered/read receipts aren't available with manual `wa.me`.
- GHL's API can't faithfully auto-build styled pages → Pounce sites are hosted by us, GHL
  used only for reviews/CRM.
- Pounce's "copy notes" box steers the **wording only**; it can't add photos or new sections.
  Custom or **before/after** photos need the business's real images (the upcoming client photo
  upload), we never fake them with stock.
- Pounce previews use the business's vetted Google photos or an AI-curated hero; the demo at
  `/s/sample-pap-electrical` uses stock (loremflickr) placeholders and is not a real build.

**Writing style (hard rule):** **never use em dashes** anywhere: generated website copy, app
UI, emails, WhatsApp/SMS, commit messages. Use commas, full stops or brackets. All AI prompts
that produce user-facing text are instructed accordingly.

---

## 13. File map

```
/public
  index.html   gate/landing + top-nav views + modals
  app.js       all UI logic (search, generate, send, tracking, dashboard, warm leads, prowl, pounce)
  styles.css   all styles
  data.js      client BizData helpers (isUkMobile, phone chips)
  favicon.svg  SP gradient icon
  prototype-solihull.html  Pounce website prototype (design review)
/api  login, search, generate, view, img, track (view/cta/sent/signup), mockups, dashboard,
      hotleads, prowl, pounce, site (/s/:slug), photo (Google-photo proxy), sites (preview
      registry), leads (prowled/pounced/status map), note (CRM status + timestamped notes),
      apply, report
/lib  auth, ratelimit, filters, db, intel (shared Prowl gather, used by prowl + pounce),
      samples (built-in demo sites for /s/sample-*)
/fonts  Montserrat (bundled into generate)
vercel.json  function configs + rewrites + cache headers
package.json deps: @napi-rs/canvas, sharp, @vercel/blob, @vercel/postgres
```
