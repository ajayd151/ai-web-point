# Site Pounce — Technical & Product Documentation

_Last updated: 2026-06-08_

Site Pounce is a lead-generation, outreach **and sales-intelligence** platform for a
web-design agency. It finds local businesses with **no website**, generates a
professional **AI mockup** of their homepage, lets you **send & track** it, surfaces
**hot leads**, and builds a **sales-intelligence dossier** (and — coming — a full live
website) for each prospect.

- **Product brand (the tool):** **Site Pounce** — `sitepounce.com`
- **Agency brand (shown to prospects):** **Ai Web Point** — `aiwebpoint.com`
- The split is deliberate: *Site Pounce* is the tool you log into; *Ai Web Point* is the
  agency name prospects see on mockups/sites. Keep the tool brand invisible to cold prospects.

---

## 1. Live URLs & hosting

- **App:** `https://sitepounce.com` (primary) and `https://ai-web-point.vercel.app` (original).
- **Prospect links & images:** `https://preview.aiwebpoint.com/v/<slug>` (preview pages) and
  `/i/<slug>.png` (mockup images) — the agency domain, for trust. `noindex`ed.
- **Hosting:** **Vercel (Pro plan)** — static frontend in `/public` + Node serverless
  functions in `/api`. Auto-deploys on every `git push` to `main`.
- **Database:** **Neon Postgres** (serverless, free tier) via Vercel Storage.
- **Object storage:** **Vercel Blob** (mockup PNGs, metadata, dossiers).

---

## 2. The app — a top-nav SPA

After signing in (full-screen Site Pounce login gate), the app has a **top navigation**
with four views (`#view-*` divs toggled by `showView()` in `app.js`):

| Nav | What it is |
|---|---|
| **🔍 Search** | Find leads → results → generate mockups → recent searches/mockups |
| **💬 Messages** | Edit the first-message / follow-up / CTA wording (saved per device) |
| **📊 Performance** | Dashboard: stats, insights, charts, CSV, date-range (lazy-loads) |
| **🔥 Hot Leads** | Prospects who requested a demo, with a live count badge + actions |

The login gate doubles as a **Site Pounce landing page** (hero, founding-member offer,
application form). The whole interface is hidden behind it until signed in.

---

## 3. Features

### Search & lead-finding
- **Google Places (New)** text search for real businesses.
- **Filters:** website (any/none/has), phone (any/has/**mobile**/landline/none), email,
  ratings-count range, star buckets, and **"Already messaged"** (exclude ever / last 3 months).
- **Deep paging + server-side filtering** (scans ~60 results, not just top 10).
- **Auto-expand to nearby areas** — if a town is thin, an AI call (gpt-4o-mini) names the
  nearest towns/suburbs and searches those too, so "Birmingham had 1" → "21 across nearby areas".
- **Recent searches** table — one-click **Run again** + per-row delete.
- A **↻ Refresh** (no cost) re-checks messaged labels.

### Mockup generation
- **AI hero photo** via OpenAI **gpt-image-1** (no text in image).
- **AI scene + service chips per industry** (gpt-4o-mini) — works for *any* business, not
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
- **WhatsApp + SMS** click-to-send (manual, mobiles only). Each send tags the link with the
  channel (`?c=w/s/e`).
- **Editable templates** (per device): first message + follow-up, placeholders `{name}`
  `{business}` `{category}` `{location}` `{link}`. Empty `{name}` collapses to "Hi,".
  `{category}` is title-cased with acronyms (Dog Groomers / MOT).
- **Messaged tracking** (per device, by Google place id): cards show "✓ You messaged them
  via WhatsApp (date·time) & SMS (…)" — accumulates channels with timestamps. The
  "Already messaged" filter excludes them from new searches so you dig for fresh leads.

### Engagement tracking
- A JS beacon on the preview page logs **opens (`view`)** and **demo-CTA clicks (`cta`)** to
  Postgres, with the **channel** (`?c=`) and exact time. Sends are logged as **`sent`** events.
- Bot-filtered (JS-fired so link-preview crawlers don't create false opens).
- Recent mockups show an **Engagement** column (Opened ✓ / Demo clicked 🔥 / Not opened) +
  a **↩ Follow-up** button that opens the channel they engaged on.

### 📊 Performance dashboard
- Stat cards (mockups made / messaged / opened+rate / demo clicks+rate), avg time-to-open,
  by-channel open rates, **opens-by-hour & opens-by-day** charts (UK time, peak highlighted),
  recent-activity table.
- **Insights split**: "📊 Based on your data" (computed) vs "💡 General tips" (static).
- **Date range** (7 / 30 / all), **CSV export**, refresh.

### 🔥 Hot Leads
- Prospects who clicked the demo CTA, enriched with phone/name/location.
- Per card: **📱 WhatsApp / 📞 Call / View ↗ / 🐾 Prowl**.
- **Nav count badge** + **animated tab-title alert** — `Site Pounce (N)` when looking,
  **flashes** "🔥 (N) hot leads!" when you're on another tab; 3-min poll keeps it fresh.

### 🐾 Prowl — lead-intelligence dossier
- On-demand sales recon per lead. Sources: **Google Places** (live reviews/score, top-3
  competitors *with* websites → comparison table, recent reviews) + **OpenAI** synthesis →
  `services`, reputation, **🎯 ammunition** (specific lines to say), suggested opener +
  **Companies House** (established/director/type — when its key is set; degrades gracefully).
- Output: competitor comparison table (you vs rivals: website / reviews / score), what-they-do
  chips, ammunition, opener. **Cached** as `dossiers/<slug>.json` (↩ Re-run to refresh).
- Rate-limited (`LIMIT_PROWL`, default 20/12h).

### 🐆 Pounce — full website builder (PLANNED; prototype live)
- Build a real **1-page WOW website** from the Prowl intel + Google Maps photos + 4-5★
  reviews + AI copy. **Hosted by us** (preview = live, identical); **GHL** provides the
  Google review system + CRM behind it (live form → GHL webhook).
- 3 templates, SEO tier dropdown (None/Basic/Intermediate/Advanced=schema), optional
  pre-build questions, AI-prompt editor for later edits, "Powered by aiwebpoint.com?source="
  footer.
- **Prototype:** `/prototype-solihull.html` (design under review).

### Founding-member landing & application
- The login gate is a landing page with a **Founding-Member** offer ("20 places, fixed fee
  for life") + an **application form** (`/api/apply`) that emails Ajay (SendGrid) **and**
  stores to Postgres `applications`. Demos are gated behind applying.

### Security & cost protection
- Full-screen **login gate** + server-side auth on every paid endpoint.
- **Usage caps** (`lib/ratelimit.js`): 20 searches / 20 generations / 20 prowls per 12h
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
prototype-solihull.html (Pounce demo)  track.js     open/click/sent beacon → Postgres
                                       mockups.js   list mockups + merge engagement stats
Shared libs (/lib)                     apply.js     founding-member form → SendGrid + Postgres
─────────────────                      report.js    error-alert email (SendGrid)
auth.js     HMAC signed cookie         dashboard.js analytics aggregation + insights
ratelimit.js 12h usage caps            hotleads.js  demo-clickers + contact details
filters.js  server-side lead filtering prowl.js     lead-intelligence dossier (cached)
db.js       Neon Postgres pool + queries
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
| `POST /api/login` | — | Validate `APP_USERNAME`/`APP_PASSWORD`, set signed `aiwp` cookie. |
| `POST /api/search` | ✅ | Google Places + filters + nearby auto-expand (`excludeIds` skips messaged). |
| `POST /api/generate` | ✅ | gpt-image-1 → composite → Blob. Returns `{imageUrl, viewUrl, id, slug}`. |
| `GET /api/view?slug=` | — | Preview page (`/v/:slug` rewrite) + tracking beacon. |
| `GET /api/img?slug=` | — | Branded image proxy (`/i/:slug.png`; `?download=1` to save). Immutable-cached. |
| `GET /api/track?slug=&e=&c=` | — | Records `view`/`cta`/`sent` + channel to Postgres. Bot-filtered. |
| `GET /api/mockups` | ✅ | All mockups + engagement stats + last-open channel. |
| `GET /api/dashboard?days=` | ✅ | Aggregated stats + insights (date-range filtered). |
| `GET /api/hotleads` | ✅ | Demo-clickers + contact details (from mockup metadata). |
| `POST /api/prowl` | ✅ | Lead-intelligence dossier (cached as blob; rate-limited). |
| `POST /api/apply` | — | Founding-member application → SendGrid + Postgres. |
| `POST /api/report` | ✅ | Error-alert email (SendGrid). |

`vercel.json`: per-function config (`generate` 1024MB/180s/fonts, `search`/`mockups` 30s,
`prowl` 60s); rewrites `/v/:slug`, `/i/:slug`; cache headers (`must-revalidate` on the app
shell so deploys show without a hard refresh). `api/download.js` was removed (legacy).

---

## 6. Data model

### Vercel Blob
- `mockups/<slug>.png` — final mockup image.
- `mockups/<slug>.json` — `{ name, loc, who, cta, img, phone, category }`.
- `dossiers/<slug>.json` — cached Prowl dossier.
- `usage/...` — rate-limit counters (pruned after 12h).
- `<slug>` = `<business-name-slug>-<8charid>`.

### Neon Postgres
```sql
link_events (id BIGSERIAL, slug TEXT, event TEXT['view'|'cta'|'sent'],
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
| Neon Postgres | `POSTGRES_DATABASE_URL` (+ POSTGRES_* set) | **No plain `POSTGRES_URL`** — `lib/db.js` falls back through the names. |
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
| Prospect pages + images | **aiwebpoint.com** (`preview.` / `/i/`) | Agency brand — matches the "Designed by Ai Web Point" signature; keeps the tool brand invisible to cold prospects. |

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
- **Intelligence (Prowl):** all public business data (Google, Companies House, public web) —
  legitimate B2B research.
- **Not legal advice:** cold B2B to Ltd companies is broadly OK with sender ID + opt-out;
  sole traders are stricter. Build opt-out/STOP handling before scaling automated channels.

---

## 10. Hosting & deploying

- **Vercel Pro** — function limit ~100 (was 12 on Hobby; we hit it adding Prowl and removed
  the unused `download.js`). `maxDuration` up to 300s.
- **No Node/Homebrew on the dev machine**, iCloud folder sandboxed — ship via Git, not local.
- **To ship:** edit → `git commit` → `git push` → Vercel auto-builds (~1–2 min; installs
  `@napi-rs/canvas`, `sharp`, `@vercel/blob`, `@vercel/postgres`).
- **Env vars** set in the Vercel dashboard (never committed). Cache headers make app-shell
  changes appear on a normal reload (no hard refresh needed).

---

## 11. Roadmap

- **✅ Done:** lead finder, AI mockups, WhatsApp+SMS send, branded links, messaged-tracking,
  engagement tracking, **Performance dashboard**, **Hot Leads** + tab alert, **🐾 Prowl**.
- **🔜 🐆 Pounce** — full 1-page website builder (prototype built; awaiting design sign-off),
  then publish + **GHL** handoff (review system/CRM) at conversion.
- **🔜 Companies House** — add the free key to enrich Prowl.
- **🔮 Later:** Prowl Phase B (Trustpilot/Facebook/competitor-gap web search), AI site editor,
  multi-template, per-keyword dashboard breakdowns, multi-user accounts + billing (SaaS).

---

## 12. Known limitations

- Google Text Search caps at ~60 results/query → narrow areas / nearby-expand for more.
- Google doesn't expose email (always "not found").
- gpt-image-1 ~90% accurate to art-direction notes — regenerate if off.
- Local lists (recent/messaged) are per-device; the mockup library + dashboard are server-backed.
- Email open-tracking (future) is unreliable post-Apple; **click** tracking is dependable.
- WhatsApp delivered/read receipts aren't available with manual `wa.me`.
- GHL's API can't faithfully auto-build styled pages → Pounce sites are hosted by us, GHL
  used only for reviews/CRM.

---

## 13. File map

```
/public
  index.html   gate/landing + top-nav views + modals
  app.js       all UI logic (search, generate, send, tracking, dashboard, hot leads, prowl)
  styles.css   all styles
  data.js      client BizData helpers (isUkMobile, phone chips)
  favicon.svg  SP gradient icon
  prototype-solihull.html  Pounce website prototype (design review)
/api  login, search, generate, view, img, track, mockups, dashboard, hotleads, prowl, apply, report
/lib  auth, ratelimit, filters, db
/fonts  Montserrat (bundled into generate)
vercel.json  function configs + rewrites + cache headers
package.json deps: @napi-rs/canvas, sharp, @vercel/blob, @vercel/postgres
```
