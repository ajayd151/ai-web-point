# Site Pounce, Technical & Product Documentation

_Last updated: 2026-06-12_

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
(`#view-*` divs toggled by `showView()` in `app.js`):

| Nav | What it is |
|---|---|
| **🔍 Search** | Find leads → results → generate mockups → recent searches/mockups |
| **💬 Templates** | Edit the first-message / follow-up / CTA wording (saved per device) + Blocked contacts |
| **📊 Performance** | Dashboard: stats, insights, charts, CSV, date-range (lazy-loads) |
| **🌡️ Warm Leads** | Prospects who requested a demo, with a live count badge + actions |
| **📞 Call List** | Businesses queued for a phone call (the safe first touch): tap-to-dial, Prowl, unified CRM status + timestamped notes, filter chips, badge = leads waiting for a call |
| **👤 All Leads** | Every business worked: searchable/filterable table (Prowled / Website built / Messaged / Blocked); each row opens the Lead Profile |
| **🌐 Websites** | Every mockup (`/v/`) + Pounce site (`/s/`) in one table, filterable by Mockup / Draft site / Live site, with an Open button (the raw URL is intentionally not shown). Terminology: **Mockup** = image preview (`/v/`); **Draft site** = built but unpublished (`/s/`, `mode:preview`); **Live site** = published (`/s/`, `mode:published`). Draft and Live share the same `/s/<slug>` URL, "live" is just the `mode` flag, not a different path. (Make Live / AI editor are the next phases.) |

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
- **Results survive a reload (free restore):** each search is cached locally
  (`aiwp_last_results`: criteria + results + the stats banner + load-more state) and restored on
  page load for up to **48h**, with an amber banner ("Restored your last search… no credit used")
  and a "↻ Search again" button that re-runs the exact criteria incl. filters
  (`runRecentSearch`). Messaged/blocked/mockup chips recompute at render, so they stay current
  even on restored results. Older than 48h = not restored (nudges a fresh search).
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
- **Business names are humanised for display** by `humaniseBusinessName` (shared as
  `lib/names.js` on the server + a matching copy in `public/app.js`, keep in sync incl. the
  WORDS dictionary), in order: (1) **camelCase split** ("PerformanceCarValeting" → "Performance
  Car Valeting"); (2) **space out** `&` `/` `+` "and"; (3) **word-segment** an all-lowercase
  run-together token against a dictionary of common business words (`WORDS`, greedy longest-match
  with an optional short brand), e.g. "jjhomecarwash" → "JJ Home Car Wash", "m1plumbing" →
  "M1 Plumbing", "mobiledoggrooming" → "Mobile Dog Grooming"; (4) **Title-Case an all-lowercase
  name only** (MOT / Marks & Spencer left; a short all-consonant brand like "jj" upper-cases to
  "JJ"); (5) **strip filler words** (`stripFiller`): legal suffixes (Ltd/Limited/Co...) always,
  and fluff adjectives (Independent/Professional...) only if 2+ real words remain, e.g. "Turner's
  Independent Plumbing & Heating" → "Turner's Plumbing & Heating", "KWS Heating & Plumbing LTD" →
  "KWS Heating & Plumbing" (but "Reliable Roofing" stays); (6) **trim a keyword-stuffed overlong
  name** (>34 chars). Safe by design: only splits when
  the result is clean, else leaves the name as-is ("specialist" stays "Specialist"). So
  "m1plumbing&heating" → "M1 Plumbing & Heating", and
  "JJG Home Car Wash, Mobile Valeting & Alloy Wheel Refurbishment" → "JJG Home Car Wash &
  Mobile Valeting". Applied to the **sent message** `{business}`, the **mockup image** and the
  **preview page**. NOT applied to the **slug** or the **stored `name`** (those stay raw so
  tracking + name/location matching keep working).
- **Messaged tracking** (per device, by Google place id): cards show "✓ You messaged them
  via WhatsApp (date·time) & SMS (…)", accumulates channels with timestamps. The
  "Already messaged" filter excludes them from new searches so you dig for fresh leads.
- **🚫 Block (do-not-contact):** a Block button on search-result cards, Warm Lead cards and
  Recent mockups rows (e.g. someone replied "No"). Blocked businesses **never appear in search
  results** (server `excludeIds` by place id + client filter by name+location) and their
  **outreach buttons are removed** (Blocked state + Unblock shown in Warm Leads / Recent).
  Managed in **Templates → 🚫 Blocked contacts** (list + Unblock). Per device (`aiwp_blocked`).

### 📞 Call List & WhatsApp guardrails (added after the 2026-06-12 WhatsApp restriction)
- **⚠️ The hard lesson:** cold WhatsApp to people who never opted in violates WhatsApp policy and
  gets numbers restricted at volume, **manual sending or not** (it only avoids the automation
  signal). The user's number was restricted on 2026-06-12. WhatsApp is now positioned as a
  **follow-up channel** for people who replied/clicked; **first touch = phone call** (or SMS/email).
- **WhatsApp guardrails:** ALL wa.me clicks in the app pass one capture-phase guard
  (`waGuardAllow` in app.js, plus the follow-up `window.open` path): a once-a-day risk confirm on
  the first send, then a **hard daily cap** (default **10**, per device, resets at midnight, counter
  `aiwp_wa_log`). Cap is adjustable in **Templates → ⚠️ WhatsApp safety** (warns above 10), which
  also shows "Sends today: X of Y" and the policy explanation.
- **📞 Call List:** "📞 Add to call list" is the **primary** button on search-result cards (above
  Generate mockup) + in the Lead Profile. The Call List tab shows rows with tap-to-call phone
  (`tel:`), 🐾 Prowl per row, a **status dropdown** (the same unified CRM statuses, change here =
  changes everywhere), **expandable timestamped notes** (same `/api/note` CRM), filter chips
  (To call / Call back / Contacted / Interested / Not interested / All, with counts) and a nav
  badge counting leads still waiting for a call. The row's Prowl button shows its state: "🐾 Prowl"
  before gathering, a green "🐾 View intel ✓" once the dossier exists (list refreshes when the
  popup closes). The **Prowl popup itself has a "📝 Status & call notes" block** (same unified CRM)
  so you can read the intel and take date/time-stamped notes mid-call. **⬇ Export CSV** exports the
  visible rows (active filter + search) as a call sheet: business/location/category/phone/status/
  added/prowled (+date)/notes count/latest note/Maps link (notes fetched from the CRM at export time). Stored server-side (`calls/_list.json`) so the
  list built on desktop is on the phone when out calling. Status/notes key = the lead's mockup
  slug when one exists, else a `name-location` slug (note: if a mockup is generated later the two
  keys can diverge; edge case, accepted).

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
- **🔎 By Search Type table:** every mockup grouped by **niche + area**, then **grouped by niche**
  (busiest niche first, separator line between niches). Columns = Mockups / Messaged / Mockup viewed
  (% of messaged) / Demo clicks / Sign-up clicks / Not interested. The 🔥/🤑/🙅 counts **hover to show
  the business names**. Location shows the **core town you searched** with the lead's actual
  (auto-expanded) town in brackets, e.g. "Wolverhampton (Dudley)", from the stored `searchLoc`.
- **🎯 Daily activity table:** one row per day (UK time, newest first, last 30 days), columns =
  Mockups / Messaged / Mockup viewed / Demo clicks / Sign-up clicks / Not interested, **Today
  highlighted**. **Every number hovers to show the businesses behind it** (validation), and shows a
  **percentage** (Messaged vs that day's Mockups; the rest vs that day's Messaged). NB "Messaged" is
  counted when the WhatsApp/SMS **send flow is opened** (the app can't see if Send was actually
  pressed in WhatsApp). Built from a per-day `byDay` query (`lib/db.js`, distinct businesses per
  event, with slug→name) + mockups bucketed by blob date; independent of the 7/30/all range.
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
  `services`, reputation, `strengths`, severity-tagged `weaknesses`, `ammunition` (talking points),
  `objections` (brush-off + rebuttal), opener + **Companies House** (established/director/type,
  when its key is set; degrades gracefully).
- **The dossier popup is a live "call screen"** (`renderDossier`), in this order: contact +
  call/WhatsApp/Maps → Google rep → **☎️ Open with this** → **✅ Acknowledge first** (strengths) →
  **🎯 Where they're losing out** (colour-coded red/amber weak spots) → **💬 Personalised What to
  say** (talking points) → **🛡️ If they push back** (objection rebuttals) → competitor table
  (website / **review-gap bar** / score, + a "they rank #N of M" line) → what-they-do chips →
  Companies House → 📝 Status & call notes. **Cached** as `dossiers/<slug>.json` (↩ Re-run to
  refresh; old dossiers lack strengths/weaknesses/objections until re-run).
- Rate-limited (`LIMIT_PROWL`, default 30 per 20h).

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
- Rate-limited (`LIMIT_POUNCE`, default 30 per 20h). Footer: "Powered by
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
- **Usage caps** (`lib/ratelimit.js`): 30 searches / **50** generations / 30 prowls / 30 pounces per
  **20h** rolling window (env `LIMIT_*` + `RATE_WINDOW_HOURS`). Caps generation/search COST, not
  WhatsApp sending. **Generation records a usage slot only AFTER it succeeds** (`check()` up front,
  `record()` on success) so a failed/retried mockup never burns quota; `checkAndRecord()` (record on
  attempt) is still used by search/prowl/pounce. Counted via one tiny blob per event under `usage/`,
  pruned once older than the window.
- **Error alerts** email you via SendGrid + an on-screen Retry button (45s countdown).

---

## 4. Architecture

### 4a. Technical architecture, data flows at a glance

The app is a thin front-end + Vercel serverless back-end. The back-end **calls out** to a few
external services, **stores** in two databases, and **produces** outputs that reach the prospect.

```
                 EXTERNAL SERVICES  (the back-end calls these)
  Google Places       OpenAI          SendGrid              Vercel + Cloudflare
  businesses/reviews   image + copy    emails (alerts,       host / domains / DNS
                                       applications, ENQUIRIES)
        |                  |              |                          |
        +---------+--------+------+-------+--------------+-----------+
                              v  (pulls data / sends email)
  YOU   ----->  FRONT-END  ----->  BACK-END  ----->  OUTPUTS  ----->  PROSPECT
  agency        browser app        Vercel /api       mockup, site,    local business
                                                      dashboard
                              |                                          |
                  writes/reads v                          views/clicks   v  (tracked)
                     +---------+------------------------------+----------+
                     v                                        v
               VERCEL BLOB                               NEON POSTGRES
               mockups, sites, Prowl dossiers, LEADS,    every send / view /
               CRM notes, subdomain map, usage           click / decline event


  THE ENQUIRY LOOP  (a Pounce website earning its keep)
  ─────────────────────────────────────────────────────
  CUSTOMER  --fills quote form-->  /api/contact  --1-->  VERCEL BLOB  leads/<slug>/  (store-first)
  (visitor)                              |
                                         +--2a-->  SendGrid  -->  BUSINESS OWNER  (reply-to = customer)
                                         |                         + BCC you / LEAD_BCC_ALWAYS
                                         +--2b-->  SendGrid  -->  CUSTOMER  ("Thanks for contacting ...")
                                         |
  YOU  <--reads leads/ via /api/enquiries--+   the 📨 Enquiries inbox tab
```

**The main flow:** you **search** (Google Places) → **generate** a mockup (OpenAI image + copy,
composited and stored in Blob) → **send** the preview link by WhatsApp/SMS (manual) → the prospect
**views/clicks**, which the tracking beacon writes to Postgres → the **Performance** dashboard reads
those events. Alongside: **Prowl** builds an intelligence dossier (Google + OpenAI → Blob),
**Pounce** builds a 1-page website (Google Place Details + OpenAI → Blob, served at `/s/<slug>`), and
**Make live** publishes it to a subdomain (Vercel Domains API + a `domains/_index.json` map, routed
by `middleware.js`). CRM status + notes live in Blob; per-device flags (messaged, blocked) live in
the browser's `localStorage`.

**The enquiry loop:** once a Pounce site is live, a visitor's **quote form** posts to `/api/contact`,
which is **store-first** (the lead is written to Blob under `leads/<slug>/` so it is never lost and
costs nothing) and then sends two best-effort SendGrid emails: a **notification to the business owner**
(the email/name captured at build time, reply-to set to the customer so a reply reaches them, BCC to
you and to any `LEAD_BCC_ALWAYS` address) and a **confirmation back to the customer** styled as if from
the business. The **📨 Enquiries** tab reads every stored lead back via `/api/enquiries`, so nothing is
lost even if an email bounces. Anti-spam is a hidden **honeypot** field plus a check that the slug maps
to a real site.

### 4b. Code map

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
ratelimit.js 20h usage caps            hotleads.js  demo-clickers + contact details
filters.js  server-side lead filtering prowl.js     lead-intelligence dossier (cached)
db.js       Neon Postgres pool+queries pounce.js    builds 1-page site → sites/<slug>.json
names.js    humaniseBusinessName       site.js      renders /s/<slug> (+ ?sub= subdomain lookup)
vercel.js   add/remove project domain   photo.js     Google-photo proxy (hides API key)
                                       sites.js     lists every Pounce site (Websites tab)
                                       decline.js   "No thanks" → decline event + status
                                       publish.js   Make live/unpublish + subdomain (Vercel API)
                                       contact.js   PUBLIC quote-form intake: store lead + email
                                                    owner (BCC you) + confirm to customer (honeypot)
                                       enquiries.js Enquiries inbox: reads leads/ back for the app
                                       grammar.js   AI Grammar Fix for the first message (gpt-4o-mini)
middleware.js (root)  routes <sub>.aiwebpoint.com → /api/site?sub=
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
| `POST /api/contact` |, | **Public** (no auth). A Pounce site's quote form: stores the lead to `leads/<slug>/…` (store-first) + best-effort SendGrid notify. Honeypot + slug-must-exist anti-spam. |
| `GET\|POST /api/calls` | ✅ | Call List: list / add / remove queued businesses (`calls/_list.json`). Status + notes reuse `/api/note` keyed by the same key. |
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
- `calls/_list.json`, the 📞 Call List: map key → `{ key, name, location, category, phone, placeId, slug, mapsUrl, addedAt }` (status/notes live in the CRM under the same key).
- `leads/<slug>/<ts>.json`, a Pounce-site contact-form submission: `{ slug, business, name, phone, email, service, message, receivedAt, ua }`.
- `dossiers/<slug>.json`, cached Prowl dossier.
- `sites/<slug>.json`, generated Pounce site content + `mode` (`preview`/`published`) +
  `createdAt`. **This prefix is the preview registry** (`GET /api/sites` lists it).
- `usage/...`, rate-limit counters (pruned after the 20h window).
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
| Pounce enquiries | `LEAD_EMAIL_TO?`, `LEAD_BCC_ALWAYS?`, `CONTACT_IP_HOURLY?`, `CONTACT_SITE_DAILY?` | Quote-form intake (`api/contact.js`). `LEAD_EMAIL_TO` = where enquiries go when a site has no owner email set, and the BCC when it does (falls back to `APPLY_EMAIL_TO`/`ERROR_EMAIL_TO`). `LEAD_BCC_ALWAYS` = optional address copied on every enquiry (testing/oversight). `CONTACT_IP_HOURLY` (default 5) = per-IP submissions/hour before silent drop. `CONTACT_SITE_DAILY` (default 50) = per-site email-sending enquiries/day before leads are stored-only. `SUBDOMAIN_ROOT` (default `aiwebpoint.com`) = root used to build the business's live link in the customer email. |
| Companies House | `COMPANIES_HOUSE_API_KEY` (**PENDING**) | Free; unlocks the established/director/type part of Prowl. Auth = HTTP Basic `base64(key:)`. |
| Auth | `APP_USERNAME`, `APP_PASSWORD` | Login; cookie HMAC keyed by the password. |
| Branding/links | `AGENCY_NAME?`, `AGENCY_URL?`, `DEMO_URL`, `LINK_DOMAIN` | `AGENCY_NAME`/`AGENCY_URL` = the "Powered by Ai Web Point" email signature (defaulted if unset); `DEMO_URL`=booking; `LINK_DOMAIN`=`preview.aiwebpoint.com`. |
| Limits | `LIMIT_SEARCH`/`LIMIT_GENERATE`/`LIMIT_PROWL`/`LIMIT_GRAMMAR` (default 30, generate 50, grammar 300) | Per 20h (RATE_WINDOW_HOURS). Generation counts only on success. `LIMIT_GRAMMAR` caps the AI Grammar Fix pass (`api/grammar.js`). |
| Client subdomains | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | Let "Make live" register `<sub>.<domain>` on the Vercel project (auto SSL). `PROJECT_ID` = project name or `prj_…`; `TEAM_ID` = team slug or `team_…`. See §7b. |

---

## 7b. One-time setup: client subdomains (operator / white-label)

So **"Make live → choose a subdomain"** works (a Pounce site goes live at
`<name>.<your-domain>` with auto HTTPS), the operator does this **once**. (Done for
`aiwebpoint.com` on 2026-06-11.) For a public/white-label release, this is the per-operator setup
to hand users.

**A. Wildcard DNS + Vercel (provides routing for every subdomain):**
1. **Vercel** → **Domains** → your domain → **Connected Projects** → **Connect** → enter `*` (i.e.
   `*.yourdomain.com`) → pick the project. (Do NOT "Enable Vercel DNS" or change nameservers if your
   DNS is elsewhere, e.g. Cloudflare.)
2. **Your DNS** (e.g. Cloudflare) → add **CNAME, Name `*`, Target `cname.vercel-dns.com`** (or the
   project's `*.vercel-dns-NNN.com` target), **DNS only / proxy OFF**. Existing records (apex, www,
   MX/email) are safe, specific records beat the wildcard.
   - ⚠️ **Vercel will NOT auto-issue a `*` wildcard certificate on third-party nameservers.** That's
     expected and fine: the wildcard CNAME only provides DNS; each subdomain that goes live is added
     to the Vercel project individually by the app (step B), which gets its own cert (HTTP-01).

**B. Vercel API token + env vars (lets the app add each subdomain):**
3. **Vercel** → Account Settings → **Tokens** (`vercel.com/account/tokens`) → **Create Token**,
   scoped to your team. Copy it.
4. Project → **Settings → Environment Variables** → add (Production): `VERCEL_TOKEN` = the token,
   `VERCEL_PROJECT_ID` = the project name (or `prj_…`), `VERCEL_TEAM_ID` = the team slug (or `team_…`).
5. Redeploy (any push picks them up).

**How it then works at runtime:** `Make live` (api/publish.js) → `lib/vercel.js` calls the Vercel
API to add `<sub>.yourdomain.com` to the project → records `domains/_index.json` (sub→slug) →
`middleware.js` rewrites the subdomain's root to `/api/site?sub=…` which resolves the slug and
renders. Unpublish frees the subdomain. ⚠️ A Vercel token controls the whole team account (no
domains-only scope), stored encrypted in env, same as other secrets.

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

### ⏸️ Parked / on hold (quick reference, as of 2026-06-13)
Things we deliberately deferred, newest first. Details in the bullets below + the change log.
1. **Mockup IMAGE revamp** (the picture itself, via `generate.js`): brighter/positive hero photo,
   fake nav menu (Home / About / Contact), bigger/bolder service chips, and remove or sentence-ify
   the composited blue "Let me show you the full website over a call" button. (The preview *page*
   around the image, nudge + green CTA, is already polished; only the baked-in image is pending.)
2. **Phase 3, AI edit box + file upload** for live sites (the next build): type a change in plain
   English (+ upload photos) → AI returns a minimal patch → shows a diff → apply on confirm only →
   backs up the previous version. Needs no new setup (uses the existing OpenAI key).
3. **Phase 4, custom domains** (a client's own `theirbiz.co.uk` instead of a subdomain): Vercel
   Domains API + DNS records + a verification poll. Most ops, saved for last.
4. **Email enrichment ("Find email")** so email can be a fallback channel (Facebook/directories
   first, verify before send). Full spec below.
5. **Multi-user SaaS with membership tiers (planned 2026-06-12, future):** admin adds users, 3
   tiers gate features/limits. Build order: (1) real accounts + roles (users table in Postgres,
   hashed passwords, sessions, an Admin area: invite user, set tier, suspend, usage view); (2)
   **data separation per user** (owner on every mockup/site/dossier/note/call entry, per-user blob
   prefixes, user_id on link_events; move shared indexes to Postgres, also kills the blob races);
   (3) tier enforcement (per-user tier-driven rate limits + "Upgrade to unlock" UI); (4) Stripe
   subscriptions ↔ tiers via webhook (launch can set tiers manually in admin).
   **Pricing model (decided direction 2026-06-12): founding-member structure.** Standard list
   prices: Scout £49-59 / Hunter £99 / Apex £199-249. The **first 20 founding members** get ~40%
   off **locked for life**: Scout £29 / Hunter £59 / Apex £119. Rules: (a) the exchange is
   explicit, founding members agree to be case studies/testimonials (in the founding terms);
   (b) "for life" = for the life of a CONTINUOUS subscription (cancel + return = standard rates);
   (c) the PRICE is locked, not the future feature set (later add-ons can be chargeable);
   (d) the founding discount follows the MEMBER across tiers (upgrades stay at founding rates).
   Number them publicly ("Founding member #7 of 20") + a remaining counter on the landing page
   (the `/api/apply` funnel already exists).
   **Admin area requirements (user spec 2026-06-12):** Admin → Members table, one row per
   customer: account (name/email, tier + founding # + locked price, signup, last active,
   trial/active/suspended, MRR), **usage vs caps** (searches/mockups/Prowls/Pounces/live
   sites/WhatsApp sends against tier limits), **their funnel** (messaged → viewed → demo →
   sign-ups), **outcomes** (aggregated CRM statuses, esp. clients WON → case-study candidates;
   lost/interested), alerts (inactive 14d = churn risk, at 100% caps = upsell, WhatsApp-risky
   behaviour), platform totals (active members, MRR, mockups, est. API spend per member). ⚠️
   GDPR: admin visibility of customers' lead/CRM data must be stated in ToS/privacy policy.
   Suggested tiers:
   **🐾 Scout** (~£29/mo: 5 searches/day, 15 mockups/mo, Call List + CRM, basic dashboard, no
   Prowl/Pounce), **🐆 Hunter** (~£79/mo: 30/day, 60 mockups/mo, Prowl 30/mo, Pounce 10/mo, 1 live
   site, full dashboard), **🦁 Apex** (~£149-199/mo: fair-use unlimited searches/Prowl, 200
   mockups/mo, 50 Pounce, 25 live sites, custom domains, **white-label branding**, 3 team logins).
   WhatsApp guardrails always on for every tier. ⚠️ White-label makes the agency brand
   (AGENCY_NAME, LINK_DOMAIN, "Designed by" signature) per-account settings, avoid hard-wiring the
   brand deeper meanwhile. The biggest single build so far (~everything-Pounce-sized).
6. **Earlier parked:** Pounce v2 client photo upload (before/after), **Payments** (Stripe links),
   **Companies House** key for Prowl, **Prowl Phase B** (Trustpilot/Facebook web search),
   **WhatsApp image-vs-link** A/B test.
7. **SendGrid domain authentication (SPF/DKIM)** for the enquiry emails (`api/contact.js`).
   **What:** in SendGrid → Settings → Sender Authentication → Authenticate Your Domain, then add the
   CNAME records it gives you at the DNS host for the sending domain. **Why:** mail currently sends
   and arrives, but authenticating the domain improves long-term inbox placement (less spam-foldering)
   and lets the "from" be a proper branded address on the agency's own domain. **Effort:** one-time,
   a few DNS records + a verify click; no code change. Not urgent (delivery already works); a quality
   step. Flagged to the user 2026-06-13.


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
- **🔮 Future phase, Email enrichment ("Find email"):** find an email for a lead so email becomes
  a fallback channel alongside WhatsApp/SMS. Google Places never returns email, and the hard part
  is that our core targets (**no-website micro-businesses**) defeat most email-finder tools, which
  are **domain-centric** (Hunter/Snov/Apollo/Clearbit/RocketReach) and skewed to larger firms.
  - **Sources, ranked by yield for website-less UK sole traders:** (1) **Facebook / Instagram page**
    "About"/contact, the best source, since these businesses usually have a FB page instead of a
    site; (2) **directories** (Yell, FreeIndex, Cylex, Scoot, Thomson Local, Bark, Checkatrade,
    Trustpilot), patchy + often a contact form not a raw email; (3) **Companies House** (Ltd only,
    gives director name not email, but sharpens the FB/LinkedIn search); (4) **web-search + read
    pass** (agent-style, e.g. Manus, reads top results); (5) **paid B2B enrichment APIs**, low yield
    for this segment; (6) **website scrape + WHOIS** when a site exists.
  - **Spec, v1:** a per-lead **"Find email"** action (and a batch enrich), mirroring Prowl. Server
    pipeline, **cheapest-first** so expensive steps only run on misses: (a) if website exists →
    scrape `mailto:`/contact; (b) Facebook page lookup by name+location → read About; (c) a couple
    of directories; (d) fallback to an **agent (Manus) or paid API**; (e) **verify** every hit
    (MX + SMTP, or NeverBounce/ZeroBounce) before it's usable, to protect sender reputation; (f)
    cache in Blob (like dossiers), rate-limit + cost-cap like generate/prowl. Surface the found +
    verified email on the lead card/profile, CSV, and an email send template.
  - **Caveats to decide on first:** **deliverability**, send cold email from a **separate, warmed
    domain**, verify addresses, keep volume low (same discipline as the WhatsApp-ban risk).
    **UK compliance (not legal advice)**, PECR + UK GDPR: cold B2B email to a **limited company**
    with clear opt-out + identification is lower-risk, but **sole traders/partnerships are treated
    like individuals** (riskier), and scraping some sources breaches their ToS. Email is likely a
    **secondary** channel, phone/WhatsApp probably still out-converts cold email for this segment.
  - **Build vs buy:** an agent like **Manus** fed the lead list is likely less work than rebuilding
    multi-source scraping in-app (sites change and fight scrapers); in-app gives more control but a
    real maintenance burden. Recommend hybrid: cheap deterministic checks in-app, agent/API fallback.
- **🔮 Future phase, Publish / host / edit live websites (Pounce go-live):** turn a Pounce
  `/s/<slug>` preview into a real live site a paying client can use. Three parts:
  - **✅ Publish toggle (BUILT 2026-06-11):** gated `POST /api/publish {slug, publish}` flips
    `sites/<slug>.json` `mode` to `published`/`preview` (+ `publishedAt`); the Websites tab has a
    **🚀 Make live / Unpublish** button per draft/live row (with a confirm). Instant, no redeploy
    (the page renders from the JSON each request). Live site is at `/s/<slug>` on the current
    LINK_DOMAIN until subdomains are wired.
  - **Domain options (low→high effort):** (a) **subpath now**, `sitepounce.com/s/<slug>` (free,
    instant) or a tidier `aiwebpoint.com/s/<slug>`; (b) **per-client subdomain**
    `client.aiwebpoint.com` via a wildcard domain + host→slug routing; (c) **client's own custom
    domain** (`theirbiz.co.uk`), the real "live website", needs: client owns/buys the domain → add
    it to the Vercel project (dashboard or Vercel Domains API) → DNS A/CNAME at their registrar →
    a `host → slug` map (store `customDomain` on the site JSON or a `domains/<host>.json`) resolved
    by `middleware.js`/`api/site.js` from the Host header. SSL is automatic. Per-domain DNS/add is
    manual ops (scriptable via Vercel API at scale).
  - **Wildcard subdomain setup (the actual infra, recorded 2026-06-11):** DNS for `aiwebpoint.com`
    is on **Cloudflare** (nameservers `aida`/`amit.ns.cloudflare.com`, "Third Party" in Vercel — do
    NOT enable Vercel DNS or change nameservers). The apex `aiwebpoint.com` is on a different host
    (the agency's main site); leave it. `preview.aiwebpoint.com` is the existing model: a CNAME to
    Vercel, **DNS only / grey cloud** (Vercel auto-issued its cert). To enable `*.aiwebpoint.com`:
    **(1) Vercel** → domain `aiwebpoint.com` → Connected Projects → **Connect** `*.aiwebpoint.com`
    to the `ai-web-point` project (DONE 2026-06-11). **(2) Cloudflare** → aiwebpoint.com → DNS → add
    **CNAME, Name `*`, Target `7f856d7d334ceb4c.vercel-dns-017.com`** (the same target preview/
    sitepounce already use, to match proven records; `cname.vercel-dns.com` also works), **DNS only
    (grey cloud, proxy OFF)** (DONE). DNS now resolves. **BUT** `https://test.aiwebpoint.com` fails
    the TLS handshake: **Vercel does not auto-issue a `*` wildcard certificate on third-party
    nameservers (Cloudflare)** — wildcard certs need Vercel's own nameservers. Vercel DOES issue
    certs for *specific* subdomains (HTTP-01), which is why `preview` works. **So the resolved plan:**
    keep the wildcard CNAME (it provides DNS for every subdomain, no per-client Cloudflare edit), and
    **add each going-live client subdomain to the Vercel project individually** (gets its HTTPS),
    automated via the **Vercel REST API** + an API token when the user picks a subdomain in Make
    Live; `middleware.js` then maps host→slug. Moving nameservers to Vercel is rejected (apex on
    Lovable + email TXTs in Cloudflare). Existing records (apex, www, preview, MX) are safe, specific
    records beat the wildcard.
  - **Websites list (data already exists):** `GET /api/sites` already returns every site
    (slug, name, mode, createdAt, `/s/` url). Missing only an in-app **🌐 Websites** screen: a
    table with Status (Preview/Published), clickable URL, Created, and Open / Publish / Edit /
    Rebuild / Set-domain actions. This is the parked "tidy-up admin UI".
  - **Edit a live site (client change requests):** the whole page is structured JSON
    (`sites/<slug>.json`: hero, services, about, reviews, faq, accreditations, areas, phone…), so
    **any edit to the JSON is live immediately**. **User decision (2026-06-11): an AI edit box, not a
    field editor.** Flow that enforces "only change what was asked": (1) AI gets the current JSON +
    the instruction (+ optional uploaded files) and returns a **minimal patch** (only changed
    fields), never a full rebuild; (2) **show a diff and require Apply/confirm** before writing,
    never auto-apply; (3) **back up the previous JSON** each edit (one-click revert for live client
    sites); (4) the fixed template is a built-in guardrail, the AI can only touch content fields, not
    layout. **File upload:** 1+ images → Blob → added to `gallery`/hero in the same preview step
    (doubles as the planned client-photo-upload). The blunt existing **Rebuild** regenerates from
    scratch (loses tweaks) so it's not the edit path. Caveat: only Pounce `/s/` sites are editable;
    a `/v/` mockup is an image (regenerate, don't edit), so a lead needs a Pounce build first.
  - **UI (user decision 2026-06-11): a 🌐 Websites tab** with a **Mockups (`/v/`)** list and a
    **Websites (`/s/`)** list. Each site row has **Make Live** → choose a **subdomain**
    (`name.aiwebpoint.com`, easy/self-serve, the recommended first path) **or Add your own domain**
    (shows the DNS records + must add the domain to Vercel via the Domains API + a verification poll).
  - **Build order (agreed):** (1) Websites tab + lists; (2) Make Live via subdomain (publish flag +
    wildcard `*.aiwebpoint.com` + subdomain→slug map + middleware); (3) AI edit box + file upload
    (patch → diff → confirm → backup); (4) custom domains (Vercel API + DNS + verification, most ops).
- **🔮 Later:** Prowl Phase B (Trustpilot/Facebook/competitor-gap web search),
  tidy-up admin UI (bulk-delete stale previews), per-keyword dashboard breakdowns,
  multi-user accounts + billing (SaaS), Pounce FAQ/Book-a-Demo/"Not sure yet?" sections on the
  subscribe page.

---

## 11b. Change log (recent sessions)

Newest first. Reference sections above are the source of truth; this is a quick history.

**2026-06-20**
- **💬 Message direct from search (no mockup) + tidier cards:** search cards were rebuilt into a clean
  hierarchy (icon + label): a primary row (📞 Add to call list · 💬 Message), then 🖼️ Generate mockup
  marked **"1 credit"**, then a small ghost 🚫 Block. The new **Message** action opens a modal to send a
  first message **without generating a mockup** (saves a credit): pick a template version, then **📞 Call
  / 💬 SMS / 🟢 WhatsApp**. WhatsApp routes through the existing daily-cap guard. No mockup means no link,
  so it's a **no-link send**, recorded against a stable `dm-<bizkey>` slug so it appears in **Message
  template statistics** as a no-link send (excluded from the mockup-funnel tables via `slug NOT LIKE
  'dm-%'`). Grammar Fix applies to the message. **WhatsApp daily cap default lowered 10 → 3** (low by
  design for experimenting; the warning now triggers above 3).
- **Auto template versions (V1, V2…):** every template gets an automatic, incremental version number
  (no typing "V" yourself), shown as a badge in the editor and as a `V{n} · {name}` label in the edit
  dropdown, the send picker, and the By-template stats. Stored as `v` per template + a monotonic
  `tplSeq` counter (assigned/persisted on load via `ensureTemplateVersions`; never reused, even after a
  delete). **Duplicate** now keeps the same name and takes the **next** version (so "V2 · Plumbers" →
  "V3 · Plumbers" is a clean version history); **New** starts empty as the next version.
- **Per-template performance tracking (new):** every send and engagement is now attributed to the
  first-message template used. The preview link carries `&t=<templateId>` and the `sent` beacon includes
  it, so opens (`view`) and demo-clicks (`cta`) attribute back to the template (`link_events.tpl` column,
  added via `ALTER TABLE … IF NOT EXISTS`). `api/track.js` stores it, `dashboardData` aggregates a
  `byTemplate` breakdown (distinct businesses per stage), and Performance has an always-visible
  **🧪 Message template statistics** section (empty-state until data lands) with a table
  (Template version / **Link?** / Sent / Mockup viewed **%** / Demo **%** / Sign-up), resolving
  template names locally from this device. A **Link?** column flags whether each template contains
  `{link}`: a template with no link can't track opens/demo-clicks (nothing to click), so the table also
  shows a **with-link vs no-link** split so those are compared fairly (no-link judged on replies). Only
  the first-message send tags a template (follow-up sends don't). Data accumulates immediately; locking
  a template keeps its wording, and these numbers, stable.
- **Multiple first-message templates (new):** Templates now manages a LIST of first-message templates
  (add ➕ / rename / 🗑 delete, each with a name), instead of one fixed message. When you send from the
  post-generate row, a small picker lets you choose which template to send; it **defaults to the
  last-used one** and is hidden when there's only one. Stored per device as `waTemplates` (array of
  `{id,name,body}`) + `lastTemplateId`; the legacy single `waMsg` auto-migrates into a "Default"
  template. Settings persistence moved to a merge-based `patchSettings` so template edits and field
  edits don't clobber each other. Grammar Fix runs on whichever template is chosen. (Follow-up message
  stays a single template.) New templates start **empty** (placeholder prompts the wording).
  **Save & lock + Duplicate (for future per-template stats):** each template has a `locked` flag. A
  draft is editable; **Save & lock** makes the MESSAGE read-only (greyed, 🔒 in the list) so its wording
  is fixed and future performance stats stay attributable; you can still **rename** a locked template,
  and **📋 Duplicate** makes a fresh editable copy to create a variation. Stable template `id`s are the
  groundwork; recording which template each send used (for the actual stats) is the next step when wanted.
- **✨ AI Grammar Fix (new, default ON):** a checkbox in Templates. When the **first message** is sent,
  the filled text is passed through `POST /api/grammar` (gpt-4o-mini) which lightly fixes articles and
  singular/plural so the `{category}` substitution reads naturally (e.g. "looking for Electrician" →
  "looking for an electrician", "a Lawn Mowers" → "a lawn mower company"). Only grammar changes; meaning,
  tone, links and sign-off are preserved (URLs are masked before the AI sees them, so the tracking link
  is never altered). Applied in `setupWhatsApp` (the post-generate send row, the only surface using the
  `{category}` first message; warm-leads/lead-profile/dossier use the follow-up template, no category).
  Raw hrefs are set instantly and swapped for the cleaned version a moment later; cached per message; any
  failure or an unticked box falls back to the original. Generous cap `LIMIT_GRAMMAR` (default 300/20h).

**2026-06-13**
- **Founding-member application email:** subject changed to **"New SitePounce Lead from <Name>"** (was
  "Site Pounce, Founding Member Application: <Name>"). Storage + operator email already existed
  (`api/apply.js` → Postgres `applications` table + a single SendGrid email to you, no applicant
  confirmation); only the subject/intro wording changed. Recipient = `APPLY_EMAIL_TO` || `ERROR_EMAIL_TO`.
- **"AI" wording embedded as a selling point (operator + landing only, never prospect-facing):**
  ride the AI interest while it's genuinely true, but keep it off prospect-facing artifacts (mockups,
  outreach, live sites, emails) where the personal angle wins and "AI" can erode trust. Changes:
  Prowl dossier "💬 Personalised what to say" → **"💬 Personalised AI talking points"**, "☎️ Open with
  this" → **"☎️ Your AI opener"**, progress "Gathering AI intel…"; search-card tooltips "AI lead
  intelligence" / "Build them an AI website"; landing page subtitle "AI lead finder…", "uses AI to
  build…", "AI-generate a professional homepage mockup", "AI builds them a finished homepage", and the
  page title. All claims are true (OpenAI image + GPT copy/Prowl synthesis). Kept deliberately measured
  to avoid AI fatigue.
- **Pounce sites, personalised quote form + it now DELIVERS leads:** the form heading reads "Get a
  free quote from <business>" and a "What do you need help with?" dropdown is built from that
  business's own services (+ "Something else"). It now submits for real via **`POST /api/contact`**,
  which **stores every lead in Blob first** (`leads/<slug>/…`, durable + free) then sends a
  best-effort **SendGrid** notification. Anti-spam: a hidden honeypot + the slug must map to a real
  site. Renders from stored JSON, so live sites get it with no rebuild.
- **Enquiry delivery, signature + customer confirmation (new):** the Pounce build modal now captures
  **who enquiries go to** (the owner's email + contact name), stored on the site JSON and preserved
  on rebuild (a blank field never wipes an existing recipient). `api/contact.js` routes the
  notification **to the business owner** with **reply-to set to the customer** and a **BCC to you**
  (the `LEAD_EMAIL_TO` operator, plus an optional `LEAD_BCC_ALWAYS` address for testing/oversight),
  signs it **"Powered by Ai Web Point"** (`AGENCY_NAME`/`AGENCY_URL`, defaulted), and sends a separate
  **confirmation email to the customer** styled as if from the business. If no owner email is set the
  notification just comes to you.
- **📨 Enquiries inbox (new tab + `GET /api/enquiries`):** every stored form submission, newest first,
  searchable, with tap-to-call/tap-to-email. Store-first means leads show here even if an email fails.
- **Enquiry emails polished + delivery confirmed (new):** both emails are now **HTML** (with a
  plain-text fallback) so the signature is a clean clickable "Powered by Ai Web Point" link with no
  raw URL; SendGrid **click + open tracking is turned off** (`tracking_settings`) so links aren't
  rewritten to the phishing-looking `ct.sendgrid.net/ls/click...`; user fields are HTML-escaped; and
  the **customer confirmation has a contact footer** with the business's **phone** (a clickable
  `tel:` link) and its **own live site** ("Call us… / Visit us at `<sub>.aiwebpoint.com`"), both from
  trusted server data (`site.business.phone`, `site.subdomain`) never from visitor input; the website
  line shows only when the site is live. SendGrid was found maxed out (trial credits) and upgraded to
  Essentials 50K; delivery verified end to end. Optional next step: SendGrid domain authentication
  (SPF/DKIM) for best inbox placement.
- **Enquiry-form abuse caps (new):** `api/contact.js` now has a **per-IP throttle** (default 5/hour,
  `CONTACT_IP_HOURLY`) that silently drops bot floods, and a **per-site daily cap** (default 50/day,
  `CONTACT_SITE_DAILY`) on email-sending enquiries. Over the per-site cap the lead is **still stored**
  (shows in the inbox) but no email is sent, so no single site can run away with the SendGrid quota or
  the sender reputation. Both use the race-safe append-and-count blob pattern (one tiny event blob under
  `clrl/`, counted via `list()`, pruned at 24h); the visitor IP is sha256-hashed (no raw IP stored).
  Rationale captured for the user: transactional email is ~£0.0004 each (Free 100/day, Essentials 50K
  ~£20/mo), so cost was never the risk; abuse + sender reputation is, hence the caps.
- **🐾 Prowl is now a "call screen":** the AI synthesis also returns `strengths` (acknowledge first),
  severity-tagged `weaknesses` (colour-coded red/amber "where they're losing out") and `objections`
  (likely brush-offs + rebuttals). Dossier popup re-ordered for a live call: contact → Google rep →
  **☎️ Open with this** → ✅ strengths → 🎯 weak spots → **💬 Personalised What to say** (was "Your
  ammunition", bigger text) → 🛡️ If they push back → competitor table (now with **review-gap bars +
  a rank line**) → services → Companies House. Old dossiers degrade gracefully (↻ Re-run to populate
  the new blocks, 1 credit). All from a richer gpt-4o-mini prompt + CSS, no new Google cost.
- **📞 Call List CSV export** (a call sheet incl. latest note per lead).

**2026-06-12**
- **Fix: one click adds to the call list.** Blob reads can lag a put by a moment, so the post-add
  refresh sometimes got a stale list and flipped the just-added ✓ back to the button (looked like
  the click failed, invited 2-3 clicks). A session-local optimistic set (`callOptimistic`) now keeps
  a just-added business ticked regardless of read lag.
- **Fix: call-list adds raced each other.** /api/calls is read-modify-write on one blob, so rapid
  adds overwrote each other (6 ticked, 4 saved). All call-list writes are now serialized through a
  client promise chain, membership is verified against server entries by name+location, and search
  results re-render after the list loads so stale ticks self-correct. (Blob has no transactions,
  same pattern applies to any shared-json writer.)
- **Search results survive reloads:** cached locally + auto-restored for 48h with a banner and a
  "Search again" re-run, so a refresh no longer wipes results or burns a credit.
- **Call List polish:** Prowl button states ("🐾 Prowl" → green "🐾 View intel ✓" + a "Prowled
  12 Jun 2026" date stamp), and a "📝 Status & call notes" block inside the Prowl popup.
- **⚠️ WhatsApp restriction + response:** the user's WhatsApp number was restricted for cold-send
  volume. Built guardrails: a capture-phase guard on every wa.me click, once-a-day risk warning,
  **hard daily cap (default 10)** with a counter, a ⚠️ WhatsApp safety panel in Templates, and the
  strategy shift to **phone-first** outreach.
- **📞 Call List (new tab):** queue businesses for a call (primary button on search cards + Lead
  Profile), tap-to-dial rows with Prowl, unified CRM status dropdown + timestamped notes, filter
  chips with counts, nav badge, stored server-side so it syncs to the phone. `GET|POST /api/calls`.
- **Search results banner:** the deep-search summary is now an animated stats hero (big count-up
  numbers for leads / listings combed / areas searched, + area chips) instead of one paragraph.
- **humaniseBusinessName** upgraded: word-dictionary split for run-together names ("jjhomecarwash"
  → "JJ Home Car Wash"), and `stripFiller` drops legal suffixes (Ltd) + fluff adjectives so names
  read casually. Fixed the all-lowercase case ("m1plumbing&heating" → "M1 Plumbing & Heating").

**2026-06-11**
- **Make live on a subdomain (Phase 2b, ✅ DONE + verified live):** one-click publish to
  `<sub>.aiwebpoint.com`. First live site confirmed: `https://ashgardens.aiwebpoint.com` (HTTPS, 200).
  `middleware.js` routes the subdomain root to the site renderer, `api/publish.js` registers the
  domain on Vercel via the API (`lib/vercel.js`, auto SSL) and maps `domains/_index.json` (sub→slug).
  Needs env `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID` (one-time setup in §7b). Wildcard
  `*.aiwebpoint.com` provides DNS; per-subdomain add to Vercel provides the cert. Make-live popup has
  a clickable "🌐 Go to website" button.
- **🚀 Make live / Unpublish (new):** `POST /api/publish` flips a Pounce site `mode` between
  published/preview; button on the Websites tab. Publishing drops noindex + the preview bar so the
  `/s/<slug>` page is a clean public site (Phase 2a; subdomains still pending the wildcard setup).
- **🌐 Websites tab (new):** lists every mockup (`/v/`) + Pounce site (`/s/`) in one table,
  filter chips with counts (All / 🖼️ Mockups / 🛠️ Draft sites / 🟢 Live sites) + name search.
  Terminology fixed: Mockup / **Draft site** (built, unpublished) / **Live site** (published);
  draft & live share the same `/s/<slug>` URL (live = the `mode` flag, not a new path). The raw
  URL column was removed (Open button only) so prospects can't read the link off-screen.
  `/api/sites` now returns an absolute branded URL. (Phase 1 of the live-websites plan.)
- **🎯 Daily activity table (new)** on Performance, with hover-names + per-day percentages (see §3).
- **By Search Type:** grouped by niche, hover-names on 🔥/🤑/🙅, core-search town shown with the
  auto-expanded town in brackets via the new `searchLoc` field, "Not interested" column added.
- **Mockup limit bug fixed:** generation recorded a usage slot *before* the OpenAI call, so failed/
  retried mockups burned quota (hit the cap after ~6 real ones). Now `check()` up front +
  `record()` only on success; generate cap bumped 30→50; stale "12 hours" 429 text fixed everywhere.
- **Business-name humanising** extended to the mockup image + preview page (shared `lib/names.js`),
  and run-together names (`PerformanceCarValeting` → `Performance Car Valeting`) now split too.
- **Email enrichment** + **Publish/host/edit live websites** captured as future phases (see §11).

**2026-06-10**
- **"No thanks" decline flow** + **Not interested (via mockup)** status + Performance card/funnel.
- **Tab renames:** Messages→**Templates**, Hot Leads→**🌡️ Warm Leads**, Leads→**👤 All Leads**.
- **DOCS.docx** Word export added (generated from DOCS.md by `scripts/md_to_docx.py`, no deps).
- "Opened" renamed **"Mockup viewed"** everywhere; By-channel rows reworded to "% viewed (x of y)".

**2026-06-09**
- Search **Load more** + **sort order** + **follow-up** button; results-bar layout fix.
- Usage caps moved to **20h** window, generate/search **30**; markSent records sends from all surfaces.
- Deploy lessons (gentle verification; `vercel.json` rewrite+functions gotcha), see standing rules.

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
