# Video Outreach, Discovery report

Date 5 September 2026. Written before any code, per spec v4 section 0. Everything below was read from the repo, not assumed.

## 1. Stack and versions

- Runtime: Node **20.x** on Vercel serverless functions (`package.json` engines). Local machine runs Node 24.18. No TypeScript, no bundler, no build step.
- Frontend: a single vanilla JS SPA, `public/index.html` + `public/app.js` + `public/styles.css`. Views are `<div id="view-X" class="view hidden">` blocks switched by `showView()` from sidebar buttons `.navbtn[data-view]`. Rendering is string templates with `esc()`. No framework. No cache-buster on app.js (hard refresh after deploys).
- Backend: one file per endpoint under `api/*.js` (`module.exports = async (req, res)`), shared code in flat `lib/*.js`.
- Data: Neon Postgres via `@vercel/postgres` (`pool().sql\`\``), and Vercel Blob for JSON documents. Dependencies are tiny: `@vercel/blob`, `@vercel/postgres`, `@vercel/edge`, `sharp`, `@napi-rs/canvas`. No devDependencies.
- Hosting: `vercel.json` sets per-function `maxDuration` (default is 10 s, so any handler that runs longer must be listed) and the cron schedule.

## 2. How leads, campaigns and outreach events are stored today

Postgres (`lib/db.js`, lazy `ensure*()` with `CREATE TABLE / ALTER ... IF NOT EXISTS`, no migration tool): `users` (email, plan, status), `team_members`, `link_events` (slug, event, ts, ua, platform, tpl; events view/cta/signup/sent/siteview), `activity_log` (ts, actor, account, action, detail, subject, meta), `usage_daily` (email, day, kind, count, the cost and cap ledger), `rate_limits`, `notes_log`, `feedback`, `applications`, `deepdossier_runs`, `deepdossier_leads`.

Postgres (`lib/smsdb.js`, same pattern): `sms_campaigns`, `sms_items` (one row per recipient: key, name, phone, state, slug, view_url, reply, post_reply, sent_at, link_sent_at, nudged_at, funnel_* columns), `sms_inbound`, `sms_optout`, `sms_msg`. **The word "campaign" is already taken** by this local-business SMS module.

Blob JSON: `calls/_list.json` is the call list (the local-business leads), `notes/<key>.json` + `notes/_index.json` is the per-lead CRM (status, timestamped comments, contact person), `mockups/`, `sites/<slug>.json` (built websites), `settings/templates.json`, `sms/_*.json` (numbers, approvers, funnel toggle), `usage/` (rate-limit events).

Outreach events today are **not one table**: they are spread across `link_events`, `activity_log` (`message_sent`, `status_update`), the `sms_items` timestamps and the notes comments. There is no reusable OutreachEvent entity to extend.

Tenancy: `lib/tenant.js` (`accountEmailOf`, `tenantPrefix`, `tenantSlug`, `ownsSlug`) namespaces Blob keys per non-owner account; Postgres rows carry an `account` or `email` column.

## 3. Job scheduler and how a job is registered

Vercel Cron, declared in `vercel.json` `crons[]`: `/api/cron-digest` (`0 7-12 * * 1-5`) and `/api/sms-worker` (`*/5 * * * *`). To register a recurring job: add `{path, schedule}` to `crons[]`, add the function to `functions` with a `maxDuration` (the SMS worker uses 300 s), and have the handler reject anything that is not a cron call via `isCron(req)` (`api/sms-worker.js:53`, accepts the `vercel-cron` user agent or `Authorization: Bearer $CRON_SECRET`). Jobs keep their own state in Postgres or Blob and are idempotent per tick. There is no queue library.

## 4. How Apollo, Hunter and email are called

- Apollo: `lib/deepdossier.js` `apolloSearch(input, expandedTitles)` does a **people** search, `POST https://api.apollo.io/v1/mixed_people/search`, through `fetchRetry` from `lib/backoff.js` (retries, timeout). There is **no organisation search** yet (spec 4.1b needs one). Key from `process.env.APOLLO_API_KEY` (read via a getter). Has a MOCK mode (`mockRows`) when the key is absent, the precedent for dry-run.
- Hunter: `lib/deepdossier.js` `hunterVerify(email)`, `GET https://api.hunter.io/v2/email-verifier`. **Verify only**, no Email Finder yet (spec 4.4 "fetch emails" needs one).
- Email: `lib/email.js` `sgSend(msg)` (SendGrid REST) plus purpose-built senders (`sendNewCustomerEmails`, `sendFeedbackEmail`, `sendTeamInviteEmail`, `sendDailyDigestEmail`, ...). Opens and clicks are tracked through `/api/track` into `link_events`. There is no generic "send a prospect an email" function yet.
- `lib/enrich.js` is Companies House and news, not Apollo. SMS is `lib/sms.js` (Twilio).
- AI: **OpenAI only**. `gpt-4o-mini` via `api.openai.com/v1/chat/completions` in 13 places (prowl, pounce copy, sms-suggest, intel, digest, grammar, niche-intel, deepdossier title expansion) and `gpt-image-1` for images. **No Anthropic/Claude client exists.**

## 5. Settings and API keys

Secrets live only in Vercel environment variables (`OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `POSTGRES_URL`, `TWILIO_*`, SendGrid, `APOLLO_API_KEY`, `HUNTER_API_KEY`, `CRON_SECRET`, `SMS_SENDER`, allow-lists). They are never stored in Blob or Postgres and never echoed to the client. Non-secret, owner-editable settings are small Blob JSON files (`settings/templates.json`, `sms/_numbers.json`, `sms/_funnel.json`) or the `rate_limits` table (Admin > Limits). There is no general settings table or settings screen; each feature has its own panel under Admin.

## 6. Stripe and plan gating

`lib/access.js` `account(req)` resolves: `owner` (comped allow-list, `isComped`), `team` (member riding the owner's plan, with per-permission flags), else the Stripe-driven `users.plan` (scout / hunter / apex) with `users.status`. `requirePaid()` returns 402 to anyone not active. `lib/stripe.js` is a thin REST helper (`stripeReq`, `configured`); checkout, portal and webhook are `api/stripe-*.js`. **No feature is gated by tier today**, every paid plan gets everything. The only feature gate is the DeepDossier pattern: an allow-list env (`canDeepDossier` / `requireDeepDossier`) that also hides the tab client-side (`acc.deepdossier`).

## 7. Tests

**There is no test framework, no test file and no `scripts` block in `package.json`.** The only script is `scripts/md_to_docx.py`. Syntax has been checked ad hoc. Recommendation: Node's built-in `node:test` runner (zero dependencies, works on Node 20 and 24), files under `tests/`, run with `node --test tests/`, added as `npm test`.

## 8. Where the spec conflicts with this codebase (follow the codebase, per section 0)

1. **"Claude API"**: not wired. The codebase standard is OpenAI `gpt-4o-mini` with JSON output. Phase 1 needs no AI at all (templates plus the imported observation), so this only matters from Phase 3. Decision needed (Appendix E, question 5).
2. **"Campaign" entity**: taken by `sms_campaigns`. The module gets its own tables with a `vo_` prefix (`vo_campaigns`, `vo_prospects`, `vo_runs`, `vo_outreach_events`, `vo_industry_presets`, `vo_config`), created lazily like `smsdb.js`.
3. **"Extend the existing lead entity"**: local leads are a Blob list plus notes, a different shape. Prospect is a new table.
4. **"Reuse the existing outreach event tracking"**: none is reusable; `vo_outreach_events` is new, mirrored into `activity_log` so the Activity screen still sees it.
5. **"Config table" for weights**: there is no generic config table. `vo_config` holds the Appendix A JSON, seeded from `docs/video-outreach/scoring-v1.json`, version stamped on each prospect.
6. **Apollo is people search, Hunter is verify only**: organisation search and email finding are new service functions in Phase 2.
7. **Email**: a generic prospect send wrapper over `sgSend` is new in Phase 2.
8. **Tests**: none exist; `node:test` is introduced.
9. **Fixtures file vs spec counts**: Appendix D says "75 rows: 69 brands plus 6 disqualified". The actual v12 CSV has **75 rows of which 15 are disqualified** (Wonderbelly, Gruns, Truvani, Naked Nutrition, Vitafive, Rootine, Elm & Rye, Sunwink, Live Conscious, Nutrova, MuscleMax, TryAlveta, Nutral, Micro Ingredients, Beli) and 60 qualified. All 75 will be imported; which rows the default view shows needs a decision.
10. **`product_photo_check` in the CSV is free text** ("Pass (3, same angle)", "Pass (18) filenames", "FAIL / unverified (1)", "Unverified (Amazon)"), not the pinned enum in Appendix B. It is an input column, not scored, so the import stores it verbatim; the pipeline normalises to the enum from Phase 2.
11. **Scoring semantics confirmed against the CSV**: sub-scores A to D are computed even for disqualified rows (Wonderbelly shows A 28, B 13, C 10, D 8) and only the total is forced to 0 with tier Disqualified, priority Skip, number 6. Hand-checked Thesis, beam, Wonderbelly and Creatine Gummy: all four match the file exactly with the Appendix A bands.
12. Section 5 of the spec numbers two items "3" (Prospects table and Prospect detail); treated as 3 and 3b.
