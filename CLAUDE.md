# SitePounce, notes for Claude Code

SitePounce finds local businesses without a website, builds an AI mockup or full site, and runs SMS / email / call outreach. Vanilla JS SPA (`public/`), one file per endpoint (`api/`), shared code in `lib/`, Neon Postgres via `@vercel/postgres` plus Vercel Blob for JSON documents, deployed on Vercel (Node 20). No framework, no build step. App files are served with `no-cache` (vercel.json headers), so a normal refresh picks up a deploy.

House rules: no em dashes anywhere (code, copy, templates, commits); outreach is signed by one persona, "Sophie", for the local-business SMS module; secrets live only in Vercel env vars, never in code or Blob; never fire-and-forget after `res.json()` on Vercel; Blob JSON has no transactions. Env vars only reach a NEW deployment.

**Versioning:** `lib/version.js` APP_VERSION shows bottom-left in the sidebar (clickable history from `public/changelog.json`). Bump it and add an entry to BOTH `CHANGELOG.md` and `public/changelog.json` on every deploy that changes behaviour, and tell Ajay which version to look for.

## Video Outreach module (spec: `docs/video-outreach/SITEPOUNCE_VIDEO_OUTREACH_SPEC_v4.md`)

Finds ecommerce brands that advertise on Meta, scores them out of 100 with a fixed rule set, picks the product for a sample video, drafts the LinkedIn messages, sends the connection requests through a LinkedIn provider and tracks the outreach for ShekiPro.com. Admin-only (owner plus the `VIDEO_OUTREACH_EMAILS` allow-list, or an active plan in `VIDEO_OUTREACH_PLANS`; others get 404). Everything is edited in-app as table rows. Left menu: **🎬 Video Outreach**, with **🤖 Ask AI** and **📖 Help and guide** under it. User guide: `docs/video-outreach/USER_GUIDE.md` (+ .docx) and the in-app help page `public/help-video-outreach.html` (menu, click paths, times, FAQs, saved Ask AI questions, version history).

**Status: live since 6 Sep 2026 (v1.5.9).** All five spec phases plus the day-two additions: async Apify runs with a per-brand count pass, Apollo `api_search` + person match, product shortlist, reply sentiment, SMS and email alerts, daily report, Quick check table, Refresh ad counts, Reset outreach, demo record, Ask AI with FAQ suggestions, inline status line instead of alerts.

**Dry-run rule:** every provider answers from the v12 fixtures when its key is absent (`lib/vo-services.js dryRun()`), so the whole pipeline runs and is tested without keys. Settings shows set / not set per key, never the value.

**Env vars:** `APIFY_TOKEN` (+ optional `APIFY_ACTOR_ID`, default `curious_coder/facebook-ads-library-scraper`), `APOLLO_API_KEY`, `HUNTER_API_KEY` (optional), `OPENAI_API_KEY`, `SENDGRID_API_KEY` + `VO_EMAIL_FROM` (a verified sender), `VO_NOTIFY_EMAIL` (alerts and the daily report), `VO_LINKEDIN_PROVIDER` (`unipile` | `dryrun`) + `UNIPILE_DSN`, `UNIPILE_API_KEY`, `UNIPILE_ACCOUNT_ID`, `VIDEO_OUTREACH_EMAILS`, `VIDEO_OUTREACH_PLANS`, cost overrides `VO_COST_APIFY_1K`, `VO_COST_APOLLO_CREDIT`, `VO_COST_AI_BRAND`. SMS alert mobiles and the LinkedIn caps live in `vo_config` (edited in Settings), not env.

**Runs are resumable.** A Vercel function has 60 s, so `lib/vo-run.js stepRun()` works for a time budget, saves the cursor in `vo_runs.state`, and the UI polls `runStep` (1.2 s, 6 s while waiting on Apify). The cron worker `api/vo-worker.js` (every 10 minutes, 300 s) continues runs idle for 2+ minutes; `vo_runs.heartbeat` + `claimRun()` stop the UI and the worker stepping the same run. Live sourcing is two async Apify actor runs: the keyword pull (10 ad rows per raw-cap brand) then a per-page count (page URL `https://www.facebook.com/<page_id>`, newest 30, `scrapePageAds` must be a nested object). Stop rules per Appendix B after every brand.

### Entities (all `vo_` tables, `lib/vo-db.js`, lazy `ensure()` with ADD COLUMN IF NOT EXISTS)
- `vo_campaigns`: criteria, schedule (`schedule_days`, `timezone`, `end_condition`), `service_profile`, `template_set`, `automation` (`auto_connect`, `max_priority`, `auto_followups`, `notify_run_finished`), `keywords_translated`.
- `vo_prospects`: one brand per row, unique on (account, domain). Meta signals, company, fit, contact, score columns, LinkedIn state and provider ids, `meta_page_id`, `products` + `product_candidates` (ranked shortlist), `video_url`, the three messages, `outreach_stage`, `outcome`, `reply_sentiment`/`reply_summary`, email sent/opened. `source` is `import`, `meta_ads`, `apollo`, `meta_ads+apollo` or `demo` (the example record; queue and send ignore it).
- `vo_runs`: one execution with counts, cost, errors, `state` (candidates, cursor, Apify run ids, debug samples) and `heartbeat`.
- `vo_outreach_events`: every stage or state change, note and reply (mirrored into `activity_log`); follow-up tasks are events with `next_action_date` and `done`.
- `vo_industry_presets`, `vo_questions` (Ask AI history, FAQ suggestions, feature ideas).
- `vo_config`: `scoring`, `service_profile` (defaults: ShekiPro.com, Aj, signature "Aj / Co-founder, ShekiPro.com"), `exclusions`, `linkedin` (caps, paused, `next_request_at`, `last_gap_min`), `alerts` (mobiles with names), `report`, `faq_extra`.

Enums and the two state machines are pinned in `lib/vo-db.js` exactly as spec Appendix B. Setting a stage or connection state always writes an event; `Msg 1` schedules the two follow-up drafts, Replied / Dead cancel them.

### Code map
- `lib/vo-services.js`: Apollo (company search, `mixed_people/api_search`, `people/match`, org enrich, job postings), Apify (start run, status, dataset, page-count run, sync page ads), `groupAds`, Shopify `products.json`, `pickProduct` (+ shortlist), OpenAI JSON helper (keywords, ad analysis, featured products, `classifyReply`, `askAssistant`), `estimateRun`. All with dry-run fixtures.
- `lib/vo-run.js`: `sourceCandidates`, `processCandidate` (hard filters, analysis, store rule feed-or-cart, then `enrichmentCeiling()`: Apollo only when the free signals could still reach the priority cut-off (`enrichFloor`, campaign `automation.max_priority`, default 4), enrichment, DM match, score, product pick, messages), `stepRun` (Apify phases, page count only for brands passing the no-call filters, stop rules, `counts.enrich_skipped`).
- `lib/vo-jobs.js`: runs, `startScheduled`, `topUp` (under the daily cap: add up to 6 AI shopper keywords to `vo_campaigns.auto_keywords`, start one sourcing run a day; `automation.auto_topup` / `expand_keywords`, default on), `recheck` (cadence and forced recount), `refreshProducts`, `sendEmail`, follow-ups, `linkedinTick` (acceptance, Pending 7 d, withdraw 21 d, replies with sentiment, one request at a random 10 to 30 min gap inside the send window and caps, auto-pause; a failed profile lookup parks the brand with `linkedin_skip_reason` and the next one is tried), `linkedinSend` (human in the loop), connection note 50:50 test (`vo_config.linkedin.note_test`, `M.softNote`, `vo_prospects.linkedin_note_variant`, `db.noteVariantStats` on Results and in the report), alerts (`newLeadAlerts`, `replyAlerts`, `testAlerts`), `dailyReport`, `tick`.
- `lib/vo-linkedin.js`: provider interface, `dry` and `unipile`, `limits` (hard cap 25 a day), `inSendWindow`.
- `lib/vo-email.js`: SendGrid send with the open pixel (`api/vo-track.js`), `notifyOwner`.
- `lib/vo-score.js`, `lib/vo-messages.js` (templates, `proofLine`/`countsTrusted`, `shortProduct`, signature block, C5 `postCheck`), `lib/vo-import.js`.
- `api/vo.js`: one endpoint, `body.action` switch (campaigns, runs, prospects, email, LinkedIn, alerts, report, Ask AI, FAQ, demo, settings, scoring, results). `api/vo-worker.js` cron; `api/vo-track.js` pixel.
- `public/vo.js` + `view-vo` in `public/index.html`: Campaigns (funnel table), Campaign edit, Prospects (+ Quick check), Prospect detail, Ready to send (badge, deep link `#vo-ready-<id>`), Results (+ daily report block), Settings, Ask AI, Help (iframe). One inline status line (`voStatus`), no alerts or toasts.
- Gate: `canVideoOutreach(email, acct)` in `lib/access.js`, exposed by `api/me.js`.

### Tests
`npm test` (runs `node --test tests/*.test.js`). `tests/vo-scoring.test.js` scores every row of the v12 fixtures (74 rows: 59 qualified, 15 disqualified) and asserts every expected column; `tests/vo-messages.test.js` applies the C5 checks; `tests/vo-import.test.js` covers the parser; `tests/vo-pipeline.test.js` runs sourcing, the product rule, stop rules, resumability, the LinkedIn dry-run provider and template sets end to end with the dry-run providers. The fixtures test must pass before any scoring change ships. `@vercel/postgres` is not installed locally, so `lib/vo-db.js` is syntax-checked only.

### Not built, on purpose
Video generation (the URL is pasted in), auto-sending Message A or replies (never), SimilarWeb, the optional C4 vision photo check. Unipile list endpoints were taken from developer.unipile.com and are confirmed by Settings > Test connection and a clean automation tick on 6 Sep 2026.
