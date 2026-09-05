# SitePounce feature spec: "Video Outreach" (ecommerce video-outreach module, previously "Ad Prospector")

Version 4.0, 5 September 2026. Adds: discovery report before coding, pinned enums and state machines, scoring as a config file with exact boundaries, Claude prompt contracts, fixtures file with expected results, definition of done per phase, and the kickoff prompt (Appendix F). Owner: Ajay Dhunna. For: Claude Code, working in the SitePounce codebase.

## 0. How to use this spec

You are adding a new module to SitePounce. Before writing any code:

1. Read the existing codebase and write a DISCOVERY REPORT (docs/video-outreach/DISCOVERY.md) before any code: stack and versions; how leads, campaigns and outreach events are stored today (table or model names, key fields); the job scheduler in use and how a recurring job is registered; how the Apollo, Hunter and email services are called (file paths, function names); how settings and secrets are stored; how plan gating works; test framework and how to run it; anything in this spec that conflicts with the codebase. Keep it under two pages.
2. Produce a short plan that says, for each section below, which existing component you will extend and which parts are new, with file paths. Show me the discovery report and the plan before building. Ask me the questions in Appendix E if the codebase does not answer them.
3. Build in the phases in section 9. Each phase must be usable on its own.
4. Before Phase 1, write a CLAUDE.md note (or extend the existing one) describing this module, its entities and its settings, so later sessions in this repo know it exists.

Where this spec and the codebase conventions disagree, follow the codebase conventions and tell me.

The end state the owner wants, in one sentence: the module finds the leads automatically, sends the LinkedIn connection request, waits and detects acceptance, drafts the personalised message, and the owner only pastes the video URL and clicks Send inside SitePounce.

## 1. What the module does (one paragraph)

SitePounce today finds local businesses without websites, makes an AI mockup, and runs outreach. Video Outreach does the same loop for a different target: ecommerce brands that advertise on Meta. It finds brands by product keyword and country, measures how much and what kind of advertising they run, enriches them (headcount, contacts, store products), scores them out of 100 with a fixed rule set, picks the one product a sample video should be made for, writes a short personalised outreach message, and tracks the outreach. The video itself is made outside the app for now; the app stores the link.

First market: United States, vitamins and supplements, small and medium DTC brands. The module must be industry-agnostic in its data model (industry and country are inputs), even though Run 1 is supplements only.

## 2. Campaigns (the unit everything hangs off)

Everything runs inside a Campaign. A campaign is a saved set of criteria plus a schedule, so the same module can run "US face creams, daily, 20 new prospects a day" and "UK supplements, one-off, 100 prospects" side by side without re-entering anything. The old "New run" form becomes "New campaign"; a Run is one execution of a campaign.

### 2.1 Campaign fields (the form, in this order, grouped)

Basics
- Name (e.g. "US Face Creams Sep 26")
- Status: Draft / Active / Paused / Finished
- Owner (user), notes

Who to find
- Industry (free text, e.g. "Face creams"). On blur, Claude suggests 10 to 20 search keywords for it (e.g. retinol cream, moisturiser, night cream, SPF moisturiser, collagen cream, anti-ageing serum) which the user can edit. Keywords, not the industry label, drive the sourcing. Save the final list as an Industry preset for reuse.
- Search keywords (multi-value, editable, from the step above)
- Country (multi-select, default US). Ad Library and Apollo are queried per country. For non-English countries, Claude also produces translated keywords.
- Language of outreach (default English)
- Company size band (multi-select: 1-10, 11-50, 51-100, 101-200; default 1-10 and 11-50)
- Store platform: Any / Shopify only (default Shopify only, because product and photo checks depend on products.json)
- Meta advertisers only (default Yes); minimum active Meta ads (default 10)
- Video advertisers only (default No); when Yes, minimum video share (default 20%)
- Exclusions: exclusion list (household names, editable), plus "exclude brands already in any campaign" (default Yes), plus "exclude my current clients and competitors" (free list of domains)
- Optional seed brands: up to 10 domains; the sourcing adds "brands whose ads look like these" by using their product keywords (Claude extracts them from the seeds' ad copy)

How many and how often
- Target prospects per run: number of NEW QUALIFIED prospects (score >= minimum) the run should produce (default 20). This is what the user means by "records"; raw candidates are not counted.
- Raw candidate cap per run (default 400) and cost cap per run in £ (default 10). The run stops at whichever is hit first: target reached, raw cap, or cost cap. Show the estimate before saving.
- Minimum prospect score to keep (default 55). Below this the brand is stored as "Park" but not shown by default.
- Schedule: One-off / Daily / Weekly (choose days) / Monthly, plus run time (default 06:00 in the owner's time zone) and an end condition: run until a date, until N total prospects, or until paused. Daily runs must dedupe against everything already found, so each run only adds new brands.
- Re-check cadence: re-pull ad counts and re-score existing prospects every N days (default 30) so stale rows fall down the list automatically.

Who to contact
- Target role rule: Founder/CEO if employees below N (default 20), else Growth / Performance / Paid Social lead first with founder as second contact. Editable list of accepted titles.
- Channels enabled: LinkedIn, Email, Instagram (checkboxes)
- Fetch emails for: All / priority_number <= 3 only (default, saves credits)

What to say (service profile, per campaign, so different campaigns can pitch different things)
- Service profile: agency or brand name to say "I run X" with, sender first name, sign-off, offer line (e.g. "20 to 30 product videos a month from £1,000"), pilot line, what the free sample is (product video / mockup / audit)
- Message template set: default templates from section 4.7, editable per campaign, with the paragraph rule enforced
- Default variant: A video sent / B permission-led / Split test 50:50

Automation (Phase 5, hidden until the LinkedIn provider is connected)
- Auto-send connection requests: On / Off (default Off)
- Auto-send only for priority_number <= N (default 2)
- Daily caps for this campaign (requests, messages) within the global caps
- Notify me when: a request is accepted, a reply arrives, a run finishes (email and in-app)

### 2.2 Campaign behaviour

- Saving a campaign with schedule One-off and status Active starts a run immediately. Scheduled campaigns run through the existing job scheduler; the next run time is shown on the campaign card.
- A run writes a ProspectRun row (inputs snapshot, counts per stage, actual cost, duration, errors). Prospects link to the campaign that found them; a brand can only belong to one campaign (first come), so campaigns do not compete for the same person.
- Pausing stops future runs and all automation for that campaign; it does not delete data.
- Duplicate a campaign to reuse criteria for another industry or country.
- Cost estimate is calculated from the raw candidate cap (Apify rows), the expected enrichment count (Apollo credits) and the Claude steps, and shown before save and on each run.

### 2.3 What the user does day to day

Open the campaign, see the Prospects table sorted by priority_number then score, filter to Connected (or, before Phase 5, mark connections by hand), open a prospect, paste the video URL, click Send (or Copy). Outcomes are recorded so the score can be tuned later.

## 3. Data model

Create a `Prospect` entity (or extend the existing lead entity with a `type = ad_prospect` if that is how the codebase works). Fields, grouped as they appear in the manual tracker (ShekiPro_Prospect_Scoring_Tracker_v12.xlsx, which is the reference):

Identity: brand, website, country, category, source, date_researched, run_id, campaign_id (a brand belongs to one campaign; unique on normalised domain across all campaigns).

Meta signals: active_meta_ads (int), video_ads (int), new_ads_30d (int), other_paid_channels (0-3), creative_style (Video-led / Mixed / Static), ad_samples (JSON: up to 10 ads with start date, is_video, duration, page name, copy excerpt, thumbnail URL).

Company: skus (int), employees (int), monthly_visits (int, nullable), amazon_reviews_hero (int, nullable), shopify_plus (bool, nullable), growth_signals (0-3), pays_for_creative (bool), video_sourcing (UGC creators / AI tools / In-house / Unknown).

Fit: creative_gap (0, 4, 8), trigger_event (bool), trigger_note.

Contact: dm_name, dm_title, dm_linkedin, dm_active_90d (Y / N / Not found), dm_email, second_contact_name, second_contact_email, gatekeeper (bool).

Status: disqualified_reason (text, empty if none), score_a, score_b, score_c, score_d, score_total, tier (A / B / Park / Disqualified), priority (Must target / Strong / Possible / Later / Unlikely / Skip), priority_number (1 = Must target, 2 = Strong, 3 = Possible, 4 = Later, 5 = Unlikely, 6 = Skip; the default sort key).

Contact, additional: brand_instagram (URL, second channel if LinkedIn goes quiet), linkedin_connection_state (blank / Applied / Pending / Connected; Applied = request sent, Pending = no answer after 7 days, Connected = accepted), linkedin_request_sent_at, linkedin_connected_at.

Sample: suggested_product_url, suggested_product_name, product_photo_check (Pass / Weak pass / FAIL, with count), why_this_product, video_url (nullable, pasted by the user).

Outreach: connection_note, message_a, message_b, variant_used (A video sent / B permission), outreach_stage (Not contacted / Request sent / Accepted / Msg 1 / Follow-up 1 / Follow-up 2 / Replied / Call booked / Pilot / Client / Dead), outcome (Won / Lost / No reply / Not a fit / Later), notes.

Also a `Campaign` entity with every field in section 2.1 (keywords and exclusions as JSON arrays, the service profile and template set as JSON or as linked rows if the codebase already has template entities), `IndustryPreset` (name, keywords, translations), a `ProspectRun` entity (campaign_id, inputs snapshot, started_at, finished_at, counts per stage, estimated and actual cost, errors) and an `OutreachEvent` log (date, prospect, channel, step, template, sample_sent, response, next_action, next_action_date), reusing the existing outreach event tracking if there is one.

## 4. Pipeline stages

### 4.1 Source

Two sources, both must be supported.

a) Meta Ad Library via Apify. Lesson from the manual runs: searching by product keyword (e.g. "creatine gummies", "colostrum", "beef organ") with the video filter surfaces small heavy advertisers far better than brand-name lists; make keyword search the default and brand-name search the exception. Use the Apify "Facebook Ads Library Scraper" actor (confirm the exact actor id in Apify's store; do not assume). Inputs: search terms = industry keywords, country, active status = active, media type = video when "Video advertisers only" is on. Output: one row per ad with page name, page id, start date, media type, ad copy, link URL and thumbnail. Group by page id to produce candidate brands with counts. Apify token comes from an environment variable and is entered in the admin settings screen, never hard-coded.

b) Apollo company search. Use the existing Apollo integration. Filters: country, industry keywords, employee ranges from the size band, technology includes shopify. Output: candidate brands with domain, headcount, Apollo organisation id.

Merge the two lists on domain (normalise: strip www, lowercase). A brand from Apollo with no Meta ads is kept only if "Meta advertisers only" is off.

### 4.2 Hard filter (deterministic, no AI)

Set disqualified_reason and stop processing the brand when any of these is true: employees > 200; no active Meta ads in the last 90 days (when Meta-only is on); domain is on the exclusion list (household names and holding-group brands, an admin-editable list seeded with: Unilever, Nestlé, P&G, Church & Dwight, Bayer, Nature's Bounty group brands); no DTC store detected (no products feed and no cart); no identifiable person after enrichment.

### 4.3 Meta ad analysis

From the grouped Apify rows compute: active_meta_ads, video_ads, new_ads_30d (start date within 30 days), creative_style (Video-led if video share > 60%, Mixed if 20-60%, Static otherwise), and pays_for_creative = true if any ad's page name matches the pattern "<person> with <brand>" or the copy contains #ad, #partner, "partner" or "UGC". Keep up to 10 sample ads in ad_samples.

AI step (Claude API, structured JSON output): given the ad samples, return creative_gap (8 = stale, repetitive or mostly static while spending; 4 = some gap; 0 = polished in-house output), video_sourcing (UGC creators / AI tools / In-house / Unknown), a one-line observation about the ads for the message (max 25 words, must name a real product or line from the ads, must not say "Meta library"), and the hero product name mentioned most in the ads.

### 4.4 Enrich

Reuse the existing Apollo and Hunter services. Fetch: employees, monthly_visits if the existing enrichment provides it (otherwise leave null), job postings for marketing roles (adds a growth signal), and people: founder or CEO, and Head of Growth / Performance Marketing / Paid Social. Decision-maker rule: founder if employees < 20, otherwise the growth or paid-social lead first and founder as second contact. Fetch emails only for prospects that pass the score threshold, to save credits.

Store products: fetch `https://<domain>/products.json?limit=50` (Shopify). If it returns JSON, set skus = product count and keep the product list with handle, title, price, image list (src and alt). If it is not Shopify, set skus from a page count heuristic and mark products_source = "unknown".

### 4.5 Score (deterministic; copy exactly)

A. Need for video volume (40): active_meta_ads 0 = 0 / 1-9 = 5 / 10-29 = 10 / 30 or more = 15; video share (video_ads divided by active_meta_ads; 0 when active_meta_ads is 0) below 0.20 = 0 / 0.20 to 0.50 inclusive = 4 / above 0.50 = 8; new_ads_30d none 0 / 1-5 = 4 / 6+ = 7; other_paid_channels 0 = 0 / 1 = 3 / 2+ = 5; skus 1-2 = 0 / 3-9 = 3 / 10+ = 5.

B. Ability to pay (25): employees 1-2 = 2 / 3-10 = 5 / 11-50 = 8 / 51-100 = 5 / over 100 = 0 (exactly 100 scores 5, exactly 50 scores 8, exactly 10 scores 5, blank scores 0); traffic proxy = 2 if monthly_visits >= 30,000 plus 2 if amazon_reviews_hero >= 1,000 plus 3 if shopify_plus, capped at 7; growth = min(5, growth_signals x 2); pays_for_creative = 5.

C. Opportunity fit (20): creative_gap (0, 4, 8); video_sourcing UGC creators = 6 / AI tools = 3 / else 0; trigger_event = 6.

D. Accessibility (15): dm_active_90d Y = 8 / N = 4 / Not found = 0; second contact with email = 4; gatekeeper false = 3.

Total = A + B + C + D, forced to 0 if disqualified_reason is set. Tier: A >= 75, B 55-74, Park < 55, Disqualified. Priority: Must target >= 75, Strong 65-74, Possible 55-64, Later 45-54, Unlikely < 45, Skip if disqualified.

Weights live in a config file (Appendix A is the exact v1 content) loaded into a config table so they can be changed without a deploy. Log the weight version on each prospect. If active_meta_ads is null (never checked) the score is null, not 0, and the prospect shows as "Unscored". The fixtures in Appendix D must pass before Phase 1 is called done.

### 4.6 Product selection

From the stored product list, choose the product for the sample video by this rule, in order:

1. Must have 3 or more REAL product photos. Count images whose alt text or filename does not indicate an infographic (exclude matches for: facts, ingredients, benefits, certif, testimonial, review, chart, compare, badge, label, slide, how-to, sfp, nfp) and, when the Claude vision step is enabled, confirm by classifying the images as product photo vs infographic. Fewer than 3 = FAIL; try the next candidate product.
2. Prefer the product named most in the ad samples (hero product).
3. Then a product featured on the homepage hero or first product row (fetch the homepage and ask Claude to list featured products).
4. Then a product tagged or titled as new, launch or seasonal.
5. Tie-break: most reviews if available, else the cleanest URL (no special characters).

Store suggested_product_url, suggested_product_name, product_photo_check ("Pass (n)", "Weak pass" when all photos are the same angle or only 2 are clean, "FAIL (n)") and why_this_product.

### 4.7 Messages (Claude API, with fixed templates)

Generate three messages per prospect from the templates below. Rules: say "Meta", never "Meta Ad Library"; about 50 words; one personal observation from the ads; sign off "Thanks, AJ" (the sign-off name is an admin setting); video-led and mixed brands get an observation about their product and angle, static brands get the "video would work harder" hook. Formatting rule: every message is written as short separate paragraphs with an empty line between them, never one block. The "/" in the templates below marks a paragraph break (blank line). No em-dashes anywhere.

Connection note (max 300 characters, no link):
"Hey {first}, I run Shekipro.com (AI product videos). Came across {short observation} and made you a free sample video for {product}. OK to send it over?"

Message A (video sent):
"Hey {first} / I run Shekipro.com. Came across {observation}. / So I made you a free sample for {product}: {video_url or [insert URL here]} / If you like it, let's have a chat about doing these on an ongoing basis. / Thanks, / AJ"

Message B (permission-led):
"Hey {first} / I run Shekipro.com. Came across {observation}. / Happy to make you a free sample for {product}, no strings. Want me to? / Thanks, / AJ"

Follow-up 1 (3 to 4 days): "Quick one, {first}. In case the sample got buried: {video_url}. If the angle is wrong, tell me what you'd test instead and I'll redo it, it takes me about 30 minutes."

Follow-up 2 (7 days): "Last note from me, {first}. If creative volume ever becomes the bottleneck, we do 20 to 30 product videos a month for supplement brands from £1,000, and can start with a 10-video pilot. Otherwise, good luck with {seasonal event}."

The brand name in "I run Shekipro.com" and the pricing line are admin settings so the module can be reused for other services.

### 4.8 Outreach and tracking

Email goes through the existing SitePounce email sending and tracking (opens, clicks). Follow-ups are scheduled with the existing campaign scheduler using the timings above. Every send writes an OutreachEvent with variant_used.

LinkedIn, Phases 1-4 (manual): the UI shows the message with a "Copy" button and buttons to open the decision maker's LinkedIn profile and the brand Instagram; the user sets linkedin_connection_state by hand.

LinkedIn, Phase 5 (automated via a provider, see 4.9): connection request, acceptance detection and message send go through the provider. Sending the personalised message is always human-in-the-loop: the app never sends Message A without the user pasting the video URL and clicking Send.

### 4.9 LinkedIn automation (Phase 5)

LinkedIn has no official API for connection requests or messaging, so use a provider built for embedding LinkedIn in SaaS. First choice: Unipile (hosted auth for the owner's LinkedIn account, endpoints for send invitation, list relations/invitations, send message, read inbox, webhooks for new messages). Confirm the current API in Unipile's docs before coding; do not assume endpoint names. Put the provider behind an interface (LinkedInProvider) with a dry-run implementation for tests, so it can be swapped.

Flow, per prospect with priority_number <= 3 and dm_linkedin set:

1. Queue: a daily job picks up to N prospects (N is a setting, default 20, hard cap 25) in priority_number then score order and sends the connection request with connection_note. Space sends by a random 3 to 8 minutes, only between 8am and 6pm in the prospect's US time zone, weekdays. Set linkedin_connection_state = Applied and linkedin_request_sent_at.
2. Wait: a daily job checks accepted invitations through the provider. On acceptance set Connected, linkedin_connected_at, outreach_stage = Accepted, and move the prospect into the "Ready to send" queue. If 7 days pass with no acceptance set Pending; after 21 days withdraw the request (if the provider supports it) and set outreach_stage = Dead unless email or Instagram has been used.
3. Draft: on acceptance, regenerate Message A with the latest ad observation (ads may have changed since the run) and store it as the draft.
4. Send: the "Ready to send" screen lists connected prospects with the draft. The user pastes the video URL (validated: https, reachable), can edit the text, and clicks Send. The app sends through the provider, writes an OutreachEvent, sets outreach_stage = Msg 1, and schedules Follow-up 1 and Follow-up 2 as draft tasks, not automatic sends.
5. Replies: provider webhook or a polling job every 30 minutes reads new messages from connected prospects, stores them on the prospect, sets outreach_stage = Replied and notifies the user (existing notification channel). Nothing is auto-replied.

Safety limits (settings, with defaults): 20 connection requests per day, 40 messages per day, weekly cap 100 requests, pause everything automatically if the provider reports an account restriction or a checkpoint, and show a warning banner. Log every provider call.

## 5. Screens

1. Video Outreach > Campaigns: cards or a table with name, industry, country, schedule and next run, status, prospects found, connected, replied, cost to date; buttons New campaign, Duplicate, Pause, Run now.
2. Campaign > Edit: the form in section 2.1 in its grouped order, with the keyword suggester, the cost estimate and a "Run now" button. Runs tab: list of ProspectRuns with counts, cost and errors.
3. Campaign > Prospects: a table with, in this order, Brand, Priority (colour-coded), Priority Number, Score, Tier, DM LinkedIn (link), Instagram (link), Connected?, Creative style, Product photo check, Suggested product (link), Decision maker, Outreach stage, Last event. Filters: run, priority, connection state, creative style, stage. Sort by priority_number then score by default. Row click opens the prospect. A global "All prospects" view across campaigns uses the same table.
3. Prospect detail: left column the score breakdown (A, B, C, D with each signal and its points) and the sample ads with thumbnails; right column the suggested product with photo check and the gallery thumbnails, the video URL field, and the three messages each with a Copy button and a Send by email button. Editable fields for anything the pipeline got wrong; an edit recalculates the score.
4. Settings (global): Apify token, LinkedIn provider keys, Claude model, default service profile, global exclusion list, score weights, industry presets, global LinkedIn caps.
5. Results: reply rate, call rate and pilot rate by priority band and by variant_used, so the weights and the A/B message choice can be adjusted from data.

## 6. Integrations and costs

Apify (new): one env var, one settings field, one service class with a dry-run mode that returns fixture data for tests. Apollo and Hunter (existing): reuse. Claude API (existing or new): use structured outputs; cache results per brand per run. Shopify products.json: plain HTTPS fetch with a 5 second timeout and polite rate limit (1 request per second per domain). Costs to show before a run: Apify roughly per 1,000 ad rows, Apollo 1 credit per company enrich and 1 per person, Claude a few pence per brand.

## 7. What not to build in v1

Video generation (the video is made outside the app and the URL pasted in). LinkedIn automation before Phase 5, and never auto-sending Message A or replies. SimilarWeb integration (leave monthly_visits null unless an existing enrichment already provides it). A public or customer-facing version; this is admin-only, gated to the Apex plan or an internal flag.

## 8. Acceptance tests

Seed the test suite with the 69 Run 1 and Run 2 brands from the v12 tracker as fixtures (brand, domain, Meta counts, employees, product URL, expected priority). The pipeline, run against the fixtures with Apify and Apollo in dry-run mode, must reproduce: Arrae and beam as Must target; Obvi and BUBS as Strong; Black Girl Vitamins and Thesis as Possible; Cowboy Colostrum, Create and Rho Nutrition as Must target; Nutrova and MuscleMax disqualified as not US; Micro Ingredients disqualified as too large; Wonderbelly disqualified (acquired by P&G, exclusion list); Vitafive, Rootine, Elm & Rye, Sunwink disqualified for no ads; Perelel and Legion product_photo_check FAIL. Score formulas must match the spreadsheet to the point. Messages must contain no em-dashes and must not contain the phrase "Meta library".

## 9. Phases

Phase 1 (usable in a week): data model including Campaign (one-off only, no scheduler yet), manual import of the v12 spreadsheet into a campaign, scoring engine, prospect list (sorted by priority_number) and detail screens, message generation with paragraph formatting, copy buttons, LinkedIn and Instagram buttons, connection-state and stage tracking. No sourcing yet.
Phase 2: Apollo sourcing and enrichment, Shopify products fetch, product selection with the photo rule, email sending through the existing outreach layer.
Phase 3: Apify Meta Ad Library sourcing, ad analysis with the Claude step, cost estimate, results screen, keyword suggester and industry presets, scheduled campaigns (daily, weekly, monthly) with dedupe and the re-check cadence.
Phase 4: weight tuning from outcomes, multi-country with translated keywords, per-campaign service profiles and template sets, plan gating.
Phase 5: LinkedIn automation through the provider (section 4.9): connection queue, acceptance detection, Ready to send screen, reply capture, safety limits. Ship behind a feature flag and test on one account for two weeks before offering it on any plan.

## 10. Reference files

The manual process this automates, with worked data, is in the Shekipro.com folder: ShekiPro_Client_Acquisition_Specification_v1.docx (rules and rationale) and ShekiPro_Prospect_Scoring_Tracker_v12.xlsx (the exact columns, formulas, Field Guide, and Run 1 and Run 2 data). When in doubt, the spreadsheet is the source of truth for scoring.


## Appendix A. Scoring config v1 (load as-is; the unit tests read this file)

```json
{
  "version": "v1-2026-09-05",
  "A_need": {
    "active_meta_ads": [[0, 0], [1, 5], [10, 10], [30, 15]],
    "video_share": [[0.0, 0], [0.2, 4], [0.5000001, 8]],
    "new_ads_30d": [[0, 0], [1, 4], [6, 7]],
    "other_paid_channels": [[0, 0], [1, 3], [2, 5]],
    "skus": [[0, 0], [3, 3], [10, 5]]
  },
  "B_afford": {
    "employees": [[0, 0], [1, 2], [3, 5], [11, 8], [51, 5], [101, 0]],
    "traffic_cap": 7,
    "monthly_visits_30k": 2,
    "amazon_reviews_1k": 2,
    "shopify_plus": 3,
    "growth_per_signal": 2,
    "growth_cap": 5,
    "pays_for_creative": 5
  },
  "C_fit": {
    "creative_gap": "as_is",
    "video_sourcing": {"UGC creators": 6, "AI tools": 3, "In-house": 0, "Unknown": 0},
    "trigger_event": 6
  },
  "D_access": {
    "dm_active_90d": {"Y": 8, "N": 4, "Not found": 0},
    "second_contact_with_email": 4,
    "no_gatekeeper": 3
  },
  "tiers": {"A": 75, "B": 55},
  "priority": {"Must target": 75, "Strong": 65, "Possible": 55, "Later": 45, "Unlikely": 0},
  "priority_number": {"Must target": 1, "Strong": 2, "Possible": 3, "Later": 4, "Unlikely": 5, "Skip": 6}
}
```

Band arrays mean "from this value upwards scores this many points"; pick the last band whose threshold is less than or equal to the value. Disqualified sets score to 0, tier Disqualified, priority Skip.

## Appendix B. Pinned enums and state machines

Enums (store exactly these strings; the UI shows them as-is):
- creative_style: Video-led | Mixed | Static
- video_sourcing: UGC creators | AI tools | In-house | Unknown
- dm_active_90d: Y | N | Not found
- product_photo_check: "Pass (n)" | "Weak pass (n)" | "FAIL (n)" | "Unverified" (n = count of real photos)
- tier: A | B | Park | Disqualified
- priority: Must target | Strong | Possible | Later | Unlikely | Skip
- linkedin_connection_state: null | Applied | Pending | Connected
- outreach_stage: Not contacted | Request sent | Accepted | Msg 1 | Follow-up 1 | Follow-up 2 | Replied | Call booked | Pilot | Client | Dead
- variant_used: A video sent | B permission
- outcome: null | Won | Lost | No reply | Not a fit | Later
- campaign.status: Draft | Active | Paused | Finished
- campaign.schedule: One-off | Daily | Weekly | Monthly
- run.status: Queued | Running | Done | Stopped (cap) | Failed

LinkedIn connection state machine: null -> Applied (request sent, set linkedin_request_sent_at) -> Pending (7 days, no acceptance) -> Connected (acceptance detected) ; Applied or Pending -> null with outreach_stage Dead after 21 days (request withdrawn if provider allows). Connected never goes back.

Outreach stage machine (allowed transitions only): Not contacted -> Request sent -> Accepted -> Msg 1 -> Follow-up 1 -> Follow-up 2 -> Dead; any stage -> Replied -> Call booked -> Pilot -> Client; any stage -> Dead. Replied is set by inbound message detection or by hand. Setting a stage writes an OutreachEvent.

Run stop rules, checked after every brand: stop with status Done when new qualified prospects >= target; stop with "Stopped (cap)" when raw candidates >= raw cap or actual cost >= cost cap; Failed on an unrecoverable provider error, keeping everything processed so far.

## Appendix C. Claude prompt contracts (structured output; validate the JSON, retry once on invalid)

C1 Keyword suggester. Input: industry text, country, language. Output: {"keywords": [10-20 strings, lower case, product terms a shopper would type, no brand names], "translated": {"<lang>": [...]} }.

C2 Ad analysis. Input: up to 10 ad samples (copy excerpt, is_video, start_date, page_name). Output: {"creative_gap": 0|4|8, "video_sourcing": enum, "hero_product": string, "observation": string (max 25 words, must name a product or a line from the ads, must not contain "Meta library" or an em-dash), "style_reason": string}.

C3 Homepage featured products. Input: homepage text and product titles. Output: {"featured": [product handles in order shown]}.

C4 Photo classification (optional, when enabled). Input: image URL list. Output: {"real_photo": [true/false per image]}. Real = pack shot, product in hand, in use, lifestyle with product visible. Infographic, facts panel, review screenshot, badge, text slide = false.

C5 Message generation. Input: service profile, template set, first name (or "[Name]" when unknown), observation, product name, creative_style, video_url or null. Output: {"connection_note": string <= 300 chars, no URL, "message_a": string, "message_b": string}. Post-check in code, not in the prompt: paragraphs separated by a blank line, no em-dash, contains the sign-off, contains "[insert URL here]" when video_url is null, no "Meta library".

All prompts get temperature 0 and are cached per brand per run.

## Appendix D. Fixtures and expected results

File: docs/video-outreach/video_outreach_fixtures_v12.csv (exported from the v12 tracker, 75 rows: 69 brands plus 6 disqualified). Columns are the input fields plus the expected A, B, C, D, SCORE, Tier, PRIORITY and Priority Number. The scoring test loads the CSV, runs the scoring engine on the input columns, and asserts every expected column matches exactly for every row. Empty Monthly visits, Amazon reviews and Shopify Plus are null and score 0. The message test asserts the Appendix C5 post-checks on every generated message for the first 20 rows.

## Appendix E. Questions to ask me if the codebase does not answer them

1. Which existing entity should Prospect extend, or is it a new table? 2. Is there an existing campaign entity I should reuse for Campaign, or is "campaign" already taken for local-business outreach? 3. Which job scheduler runs recurring work and where is it configured? 4. Where do API keys live (env, settings table, both)? 5. Is the Claude API already wired in, and with which model? 6. Which plan should gate this module (Apex, or an internal flag for now)? 7. Confirm the Apify actor id for the Facebook Ads Library scraper from Apify's store before coding, and the Unipile endpoints from their docs before Phase 5.

## Appendix F. Kickoff prompt (paste into Claude Code in the SitePounce repo)

Read docs/video-outreach/SITEPOUNCE_VIDEO_OUTREACH_SPEC_v4.md in full. Do section 0 step 1 first: write docs/video-outreach/DISCOVERY.md. Then give me the plan from step 2 with file paths, and any questions from Appendix E. Do not write code until I say go. When I say go, build Phase 1 only: the data model (Campaign, Prospect, ProspectRun, OutreachEvent, IndustryPreset), the scoring engine driven by the Appendix A config, the fixtures test from Appendix D (it must pass), the CSV import of the fixtures file into a campaign, and the screens in section 5 items 1 to 3 plus the prospect detail. Messages in Phase 1 come from the templates in 4.7 with the Appendix C5 post-checks, using the observation column from the import. Update CLAUDE.md with a short description of the module, its entities and how to run its tests. Finish by telling me what to click to see the 69 imported prospects sorted by Priority Number.

## Definition of done, per phase

Phase 1: fixtures test passes; 69 prospects visible sorted by priority_number then score; row click shows product link, photo check, LinkedIn and Instagram buttons, three messages with Copy; editing an input recalculates the score; CLAUDE.md updated; no em-dash anywhere in generated text.
Phase 2: a campaign with keywords "creatine gummies" and country US, Apollo and Shopify enabled, produces enriched prospects with product picks and photo checks; emails send through the existing layer and log events.
Phase 3: the same campaign scheduled Daily runs from the scheduler, adds only new brands, stops on target or cap, shows cost; the keyword suggester returns 10 to 20 keywords for "face creams".
Phase 4: two campaigns with different service profiles produce differently worded messages; plan gating works.
Phase 5: on a test account, a request is sent, acceptance flips Connected within a day, the Ready to send screen sends a message with a pasted URL, a reply is captured; caps and auto-pause verified with the dry-run provider.
