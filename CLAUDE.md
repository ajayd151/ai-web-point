# SitePounce, notes for Claude Code

SitePounce finds local businesses without a website, builds an AI mockup or full site, and runs SMS / email / call outreach. Vanilla JS SPA (`public/`), one file per endpoint (`api/`), shared code in `lib/`, Neon Postgres via `@vercel/postgres` plus Vercel Blob for JSON documents, deployed on Vercel (Node 20). No framework, no build step. Hard-refresh after a deploy (no cache-buster on `app.js`).

House rules: no em dashes anywhere (code, copy, templates, commits); outreach is signed by one persona, "Sophie", for the local-business SMS module; secrets live only in Vercel env vars, never in code or Blob; never fire-and-forget after `res.json()` on Vercel; Blob JSON has no transactions.

## Video Outreach module (spec: `docs/video-outreach/SITEPOUNCE_VIDEO_OUTREACH_SPEC_v4.md`)

Finds ecommerce brands that advertise on Meta, scores them out of 100 with a fixed rule set, picks the product for a sample video, drafts the LinkedIn messages and tracks the outreach. Admin-only (owner plus the `VIDEO_OUTREACH_EMAILS` allow-list; others get 404). Everything is edited in-app as table rows; the v12 tracker CSV is a one-time seed. Sidebar button **🎬 Video Outreach**.

**All five phases are built (5 Sep 2026).** Phase 1: data model, scoring, tracker import, screens, messages, manual tracking. Phase 2: Apollo sourcing and enrichment, Shopify products.json, the 4.6 product rule, email sends through SendGrid with our own open pixel. Phase 3: Apify Meta Ad Library sourcing, ad analysis (OpenAI gpt-4o-mini, JSON mode, temperature 0), cost estimate, Results screen, keyword suggester and industry presets, Daily/Weekly/Monthly campaigns on Vercel Cron with dedupe and the re-check cadence. Phase 4: weight tuning with fixture impact preview and re-score, multi-country with translated keywords, per-campaign service profiles and template sets, plan gating (`VIDEO_OUTREACH_PLANS`). Phase 5: LinkedIn automation behind `VO_LINKEDIN_PROVIDER` (`unipile` or `dryrun`): connection queue, acceptance detection, Ready to send screen, reply capture, caps and auto-pause.

**Dry-run rule:** every provider answers from the v12 fixtures when its key is absent (`lib/vo-services.js dryRun()`), so the whole pipeline runs and is tested without keys. Settings shows set / not set per key, never the value.

**Env vars:** `APIFY_TOKEN` (+ optional `APIFY_ACTOR_ID`, default `curious_coder/facebook-ads-library-scraper`), `APOLLO_API_KEY`, `HUNTER_API_KEY`, `OPENAI_API_KEY`, `SENDGRID_API_KEY` + `VO_EMAIL_FROM` (a verified sender), `VO_LINKEDIN_PROVIDER` + `UNIPILE_DSN`, `UNIPILE_API_KEY`, `UNIPILE_ACCOUNT_ID`, `VIDEO_OUTREACH_EMAILS`, `VIDEO_OUTREACH_PLANS`, `VO_NOTIFY_EMAIL`, cost overrides `VO_COST_APIFY_1K`, `VO_COST_APOLLO_CREDIT`, `VO_COST_AI_BRAND`.

**Runs are resumable.** A Vercel function has 60 s, so `lib/vo-run.js stepRun()` works for a time budget, saves the cursor in `vo_runs.state`, and the UI polls `runStep` (the cron worker `api/vo-worker.js`, every 10 minutes, 300 s, also continues Running runs). Stop rules per Appendix B after every brand. The raw cap counts brands; the Ad Library pull asks for ten ad rows per brand.

### Entities (all `vo_` tables, `lib/vo-db.js`, lazy `ensure()` like `lib/smsdb.js`)
- `vo_campaigns`: the saved criteria and schedule (section 2.1 fields, JSON for lists and the service profile). Phase 1 runs One-off only.
- `vo_prospects`: one brand per row, unique on (account, normalised domain). Meta signals, company, fit, contact, score columns (`score_a`..`score_d`, `score_total`, `tier`, `priority`, `priority_number`, `score_breakdown`, `score_version`), LinkedIn state, product pick, `video_url`, the three messages, `outreach_stage`, `outcome`.
- `vo_runs`: one execution of a campaign (Phase 1: imports), with counts, cost and errors.
- `vo_outreach_events`: every stage or state change and note (mirrored into `activity_log`).
- `vo_industry_presets`: keyword sets (used from Phase 3).
- `vo_config`: `scoring` (Appendix A weights, seeded from `docs/video-outreach/scoring-v1.json`) and `service_profile` (service name, sender first name, sign-off, offer and pilot lines; defaults "Shekipro.com" and "AJ").

Enums and the two state machines are pinned in `lib/vo-db.js` (`ENUM`, `stageAllowed`, `connAllowed`) exactly as spec Appendix B. Setting a stage or connection state always writes an event.

### Code map
- `lib/vo-services.js`: Apollo (`POST /api/v1/mixed_companies/search`, people, email match, org enrich), Apify run-sync, `groupAds` (4.3), Shopify `products.json`, `pickProduct` (4.6), OpenAI JSON helper with the C1 to C3 prompts, `estimateRun`. All with dry-run fixtures.
- `lib/vo-run.js`: `sourceCandidates` (merge Meta + Apollo on domain, exclusions, dedupe), `processCandidate` (hard filter, analysis, products, enrichment, score, emails for priority 1 to 3, product pick, messages), `stepRun` (resumable driver, stop rules). Store-injected, tested in memory.
- `lib/vo-jobs.js`: `startRun`/`stepRun`/`continueRuns`, `startScheduled` (schedule + end conditions), `recheck`, `sendEmail`, `sendFollowup`/`autoFollowups`, `linkedinTick` (acceptance, Pending after 7 d, withdraw after 21 d, replies, one queued request per tick inside the send window and caps, auto-pause on restriction), `linkedinSend` (human in the loop), `tick`.
- `lib/vo-linkedin.js`: provider interface, `dry` (in-memory, with simulate hooks) and `unipile` implementations, `limits` (hard cap 25 requests a day), `inSendWindow`.
- `lib/vo-email.js`: SendGrid send from the campaign sender with an open pixel (`api/vo-track.js`), `notifyOwner`.
- `lib/vo-score.js`: pure scoring, `score(prospect, config)`; band arrays mean "from this value upwards".
- `lib/vo-messages.js`: section 4.7 templates with blank-line paragraphs and the Appendix C5 post-checks in code (`postCheck`, `generate`). Message A carries `[insert URL here]` until a video URL is pasted.
- `lib/vo-import.js`: dependency-free CSV parser and the tracker column map.
- `api/vo.js`: one endpoint, `body.action` switch. Phase 1 actions plus `estimate`, `suggestKeywords`, presets, `runNow`/`runStep`/`runStatus`/`stopRun`, `workerTick`, `recheckNow`, `refreshProducts`, `sendEmail`, `dueFollowups`/`sendFollowup`/`skipFollowup`, `readyToSend`, `linkedinSend`/`linkedinTick`/`linkedinTest`/`linkedinResume`, `simulate` (dryrun only), `settings`, `saveProfile`, `saveExclusions`, `saveLinkedinSettings`, `scoringImpact`/`saveScoring`/`resetScoring`, `results`. `api/vo-worker.js` is the cron; `api/vo-track.js` the open pixel.
- `public/vo.js` + the `view-vo` block in `public/index.html`: Campaigns, Campaign edit (suggester, presets, schedule, estimate, Run now with progress tiles, template set, automation), Prospects, Prospect detail (score breakdown, ad samples, product gallery, video URL, messages with Copy / Send by email / Send on LinkedIn), Ready to send (+ due follow-ups), Results, Settings.
- Gate: `canVideoOutreach(email, acct)` in `lib/access.js` (owner, allow-list, comped, or an active plan listed in `VIDEO_OUTREACH_PLANS`), exposed as `videoOutreach` by `api/me.js`.

### Tests
`npm test` (runs `node --test tests/`). `tests/vo-scoring.test.js` scores every row of `docs/video-outreach/video_outreach_fixtures_v12.csv` and asserts A, B, C, D, SCORE, Tier, PRIORITY and Priority Number exactly; `tests/vo-messages.test.js` applies the C5 checks to the first 20 rows; `tests/vo-import.test.js` covers the parser; `tests/vo-pipeline.test.js` runs sourcing, the product rule, stop rules, resumability, the LinkedIn dry-run provider and template sets end to end with the dry-run providers. The fixtures test must pass before any scoring change ships. Note: the v12 CSV holds 74 rows (59 qualified, 15 disqualified), not the 75 or 69 quoted in the spec prose.

### Not built, on purpose
Video generation (the URL is pasted in), auto-sending Message A or replies (never), SimilarWeb (monthly_visits stays null unless typed), the optional C4 vision photo check (the photo rule uses alt text and filenames). Unipile endpoint paths were taken from developer.unipile.com on 5 Sep 2026 and must be confirmed with Settings > Test connection before trusting a live account.
