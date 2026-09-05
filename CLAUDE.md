# SitePounce, notes for Claude Code

SitePounce finds local businesses without a website, builds an AI mockup or full site, and runs SMS / email / call outreach. Vanilla JS SPA (`public/`), one file per endpoint (`api/`), shared code in `lib/`, Neon Postgres via `@vercel/postgres` plus Vercel Blob for JSON documents, deployed on Vercel (Node 20). No framework, no build step. Hard-refresh after a deploy (no cache-buster on `app.js`).

House rules: no em dashes anywhere (code, copy, templates, commits); outreach is signed by one persona, "Sophie", for the local-business SMS module; secrets live only in Vercel env vars, never in code or Blob; never fire-and-forget after `res.json()` on Vercel; Blob JSON has no transactions.

## Video Outreach module (spec: `docs/video-outreach/SITEPOUNCE_VIDEO_OUTREACH_SPEC_v4.md`)

Finds ecommerce brands that advertise on Meta, scores them out of 100 with a fixed rule set, picks the product for a sample video, drafts the LinkedIn messages and tracks the outreach. Admin-only (owner plus the `VIDEO_OUTREACH_EMAILS` allow-list; others get 404). Everything is edited in-app as table rows; the v12 tracker CSV is a one-time seed. Sidebar button **🎬 Video Outreach**.

**Phase 1 (built):** data model, scoring engine, tracker import, campaigns and prospects screens, prospect detail with messages, connection-state and stage tracking. No sourcing, no AI, no email sending yet.

### Entities (all `vo_` tables, `lib/vo-db.js`, lazy `ensure()` like `lib/smsdb.js`)
- `vo_campaigns`: the saved criteria and schedule (section 2.1 fields, JSON for lists and the service profile). Phase 1 runs One-off only.
- `vo_prospects`: one brand per row, unique on (account, normalised domain). Meta signals, company, fit, contact, score columns (`score_a`..`score_d`, `score_total`, `tier`, `priority`, `priority_number`, `score_breakdown`, `score_version`), LinkedIn state, product pick, `video_url`, the three messages, `outreach_stage`, `outcome`.
- `vo_runs`: one execution of a campaign (Phase 1: imports), with counts, cost and errors.
- `vo_outreach_events`: every stage or state change and note (mirrored into `activity_log`).
- `vo_industry_presets`: keyword sets (used from Phase 3).
- `vo_config`: `scoring` (Appendix A weights, seeded from `docs/video-outreach/scoring-v1.json`) and `service_profile` (service name, sender first name, sign-off, offer and pilot lines; defaults "Shekipro.com" and "AJ").

Enums and the two state machines are pinned in `lib/vo-db.js` (`ENUM`, `stageAllowed`, `connAllowed`) exactly as spec Appendix B. Setting a stage or connection state always writes an event.

### Code map
- `lib/vo-score.js`: pure scoring, `score(prospect, config)`; band arrays mean "from this value upwards".
- `lib/vo-messages.js`: section 4.7 templates with blank-line paragraphs and the Appendix C5 post-checks in code (`postCheck`, `generate`). Message A carries `[insert URL here]` until a video URL is pasted.
- `lib/vo-import.js`: dependency-free CSV parser and the tracker column map.
- `api/vo.js`: one endpoint, `body.action` switch (`campaigns`, `saveCampaign`, `importCsv`, `prospects`, `prospect`, `updateProspect`, `setVideoUrl`, `setStage`, `setConnectionState`, `setOutcome`, `addNote`, `runs`, `config`, `saveProfile`).
- `public/vo.js` + the `view-vo` block in `public/index.html`: Campaigns, Campaign edit, Prospects (sorted by `priority_number` then score, disqualified hidden by default), Prospect detail (full width).
- Gate: `canVideoOutreach` in `lib/access.js`, exposed as `videoOutreach` by `api/me.js`.

### Tests
`npm test` (runs `node --test tests/`). `tests/vo-scoring.test.js` scores every row of `docs/video-outreach/video_outreach_fixtures_v12.csv` and asserts A, B, C, D, SCORE, Tier, PRIORITY and Priority Number exactly; `tests/vo-messages.test.js` applies the C5 checks to the first 20 rows; `tests/vo-import.test.js` covers the parser. The fixtures test must pass before any scoring change ships.

### Later phases (not built)
Phase 2 Apollo sourcing and enrichment, Shopify products, product selection, email sends. Phase 3 Apify Meta Ad Library sourcing, ad analysis (reuse OpenAI `gpt-4o-mini`, the house AI), cost estimate, keyword suggester, scheduled campaigns via Vercel Cron. Phase 4 weight tuning, multi-country, per-campaign profiles, Apex gating. Phase 5 LinkedIn automation through a provider behind a feature flag.
