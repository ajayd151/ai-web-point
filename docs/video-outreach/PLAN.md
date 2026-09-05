# Video Outreach, build plan (spec v4)

Codebase conventions win where they differ from the spec (see DISCOVERY.md section 8). All new module code carries a `vo` prefix so it never collides with the local-business SMS module.

## Per spec section: what is extended, what is new, where

| Spec section | Extend (existing) | New (file) |
|---|---|---|
| 2 Campaigns | Follows `lib/smsdb.js` lazy `ensure()` pattern and the `activity_log` account scoping | `lib/vo-db.js`: tables `vo_campaigns`, `vo_prospects`, `vo_runs`, `vo_outreach_events`, `vo_industry_presets`, `vo_config`. Phase 1: One-off campaigns only, no scheduler. |
| 3 Data model | `activity_log` gets a mirror row for every OutreachEvent so Admin > Activity sees it | Entities above. `vo_prospects` unique on (normalised domain). Enums stored as the exact Appendix B strings, validated in `lib/vo-db.js`. |
| 4.5 Score | none (pure function) | `docs/video-outreach/scoring-v1.json` (Appendix A verbatim), `lib/vo-score.js` `score(prospect, config)` returning A, B, C, D, total, tier, priority, priority_number, per-signal breakdown, config version. `vo_config` seeded from the JSON on first `ensure()`. Null `active_meta_ads` returns null (Unscored). |
| 4.7 Messages | `humaniseBusinessName` not used (brands, not local trades); sign-off name follows the `SMS_SENDER`-style setting pattern | `lib/vo-messages.js`: the four templates as constants with `\n\n` paragraph breaks, `render(templateSet, ctx)`, `postCheck(text, {videoUrl})` implementing Appendix C5 in code. Phase 1 uses the imported Creative style and a placeholder observation field. |
| 4.8 Outreach tracking (Phase 1 manual part) | none | `vo_outreach_events` written by every stage or state change; state machines enforced in `lib/vo-db.js` (`setStage`, `setConnectionState`) exactly per Appendix B. |
| 5.1 Campaigns screen | Sidebar (`public/index.html` nav, `showView`) gains a **Video Outreach** button, same `data-view` mechanism | `public/index.html` new `view-vo` block; `public/vo.js` (new file loaded after app.js) with panes Campaigns, Campaign edit, Prospects, Prospect detail; styles appended to `public/styles.css`. |
| 5.2 Campaign edit | Reuses the modal/form styling classes already in `styles.css` | Phase 1 subset of the 2.1 form (Basics, industry, keywords as plain list, country, min score, service profile, template set, default variant). Keyword suggester and cost estimate are Phase 3. Runs tab lists `vo_runs`. |
| 5.3 Prospects table | Reuses `cust-table` / card styling and the status-chip pattern from the SMS call list | Columns in the exact spec order, default sort `priority_number, score desc`, filters for run, priority, connection state, creative style, stage. Global All prospects view = same table without the campaign filter. |
| 5.3b Prospect detail | Reuses `showMetricModal` or a full pane (decision below) | Left: score breakdown per signal + sample ads (empty in Phase 1). Right: product link, photo check, video URL field, three messages with Copy, LinkedIn and Instagram buttons, editable inputs that call `update` and rescore. |
| 5.4 Settings | Follows Blob-settings pattern (`settings/*.json`) | Phase 1 only needs service name, sign-off, offer and pilot lines: stored in `vo_config` with spec defaults ("Shekipro.com", "AJ"); the Settings screen itself is Phase 4. |
| 6 Integrations | Apollo, Hunter, SendGrid, OpenAI: reused in Phases 2 and 3 | Apify service + dry run: Phase 3. Not touched in Phase 1. |
| 7 Gating | `lib/access.js` allow-list pattern (`canDeepDossier`) | `canVideoOutreach(email)`: owner always, plus `VIDEO_OUTREACH_USERS` env allow-list; `api/vo.js` rejects others; the nav button hides for others (`acc.videoOutreach` from `api/me.js`). Apex tier gating is Phase 4. |
| 8, App. D Tests | none exist | `tests/vo-scoring.test.js` (loads the CSV, scores every row, asserts A, B, C, D, SCORE, Tier, PRIORITY, Priority Number exactly), `tests/vo-messages.test.js` (C5 post-checks on the first 20 rows), `tests/vo-import.test.js` (CSV parser on the fixtures). `package.json` gains `"scripts": {"test": "node --test tests/"}`. |
| App. D Import | none | `lib/vo-import.js`: dependency-free CSV parser (quoted commas handled), header-to-field map, normalises domain, stores `product_photo_check` verbatim; `api/vo.js` action `importCsv` creates or targets a campaign and writes one `vo_runs` row for the import. |
| CLAUDE.md | does not exist yet | New `CLAUDE.md` at repo root: module description, entities, settings, how to run tests, the no-em-dash rule. |

API: one endpoint `api/vo.js` with a `body.action` switch (the codebase style, see `api/sms-campaign.js`): `campaigns`, `saveCampaign`, `importCsv`, `prospects`, `prospect`, `updateProspect` (rescore), `setStage`, `setConnectionState`, `runs`. Listed in `vercel.json` `functions` with `maxDuration: 60`.

## Appendix E answers

1. Prospect: **new table `vo_prospects`**. The existing lead is a Blob list plus a notes file, a different shape and not a table.
2. Campaign: the name is **already taken** by `sms_campaigns` (SMS local-business outreach). Video Outreach gets `vo_campaigns`; a Run is `vo_runs`.
3. Scheduler: **Vercel Cron in `vercel.json`**, handler guarded by `isCron()`. Phase 1 needs none; Phase 3 adds `/api/vo-worker`.
4. Keys: **Vercel env only** for secrets. Non-secret settings in Blob JSON or a table. Apify token will be `APIFY_TOKEN` env; the Settings screen will show set or not set, never the value.
5. Claude API: **not wired**. The house standard is OpenAI `gpt-4o-mini` with JSON output, used in 13 places. Phase 1 needs no AI. Question below.
6. Gating: **no tier gating exists**. Recommend the internal allow-list flag now (DeepDossier precedent); Apex gating in Phase 4 would be the first tier-gated feature.
7. Apify actor id and Unipile endpoints: **not in the codebase**; will be confirmed from Apify's store and Unipile's docs before Phases 3 and 5, not assumed.

## Questions the codebase cannot answer

Q1. AI vendor for Phases 3+: reuse OpenAI `gpt-4o-mini` (already wired, JSON mode) for the Appendix C prompts, or add an Anthropic client and key for Claude specifically?
Q2. Default view count: the CSV has 60 qualified plus 15 disqualified rows, not 69 plus 6. Import all 75. Should the default Prospects view show all 75 (Skip rows sorted last as priority 6) or hide Disqualified by default?
Q3. Sign-off "AJ" and service name "Shekipro.com" as the Phase 1 defaults, correct? (They become editable settings in Phase 4.)
Q4. Placement: a top-level **Video Outreach** button in the left sidebar (Main group), visible only to allowed users, rather than inside Admin. OK?
Q5. Prospect detail as a full-width pane (more room for the score breakdown and messages) rather than the small modal used elsewhere. OK?
Q6. The import has no "observation" column; Phase 1 messages will use a short generic observation built from Category and Creative style (e.g. "your creatine gummies video ads"). Acceptable until Phase 3's ad analysis supplies the real one?
