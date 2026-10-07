# SitePounce changelog

The live version shows bottom-left in the app sidebar and is clickable there. `public/changelog.json` is the same list, rendered in-app. Bump `lib/version.js` and add an entry here and in the JSON on every deploy that changes behaviour.

## 1.5.83 (7 Oct 2026)
- Reports: bold green / bold red traffic lights on weekdays against daily targets (requests 90% of every active sender's cap, red under half; acceptances 20% of that; brands found one day of sending, red at none; videos red when people are waiting and none went out; positive replies green; rate green at 20%+, red under 10%), and a Today scorecard (requests, accepted, waiting for a video, brands found).
- Top-ups keep two days of sending queued (2 x the active senders' daily caps, 12 to 80), up to 2 runs a day per campaign 4 hours apart (was: under 12 queued, 1 a day, 6 hours apart). While sends were stalled the queue never drained, so no brands were found from 23 Sep.
- Weekday 9am UK text to the alert mobiles listing the connections waiting for a video and how old the oldest is.

## 1.5.82 (7 Oct 2026)
- Reports table fits the page without sideways scrolling: shorter headings (Requests, Videos, Accepted, Waiting, Rate), tighter cells, day labels without the year.

## 1.5.81 (7 Oct 2026)
- Left menu: 📅 Reports under Video Outreach (above Ask AI) opens the daily report table straight away; #vo-reports deep link.

## 1.5.80 (7 Oct 2026)
- Several LinkedIn senders. Settings, LinkedIn senders lists the main account (UNIPILE_ACCOUNT_ID) and any added ones (vo_config.linkedin.senders) with live status, sent today and this week, caps, sign-off name and an On switch. Connect another LinkedIn makes a Unipile hosted sign-in link (POST /api/v1/hosted/accounts/link); api/vo-sender-hook.js adds the account when Unipile reports CREATION_SUCCESS (signed per key). Senders share one queue split so no person gets two requests, each with own caps and gap, run in parallel inside the tick and saved in one write. vo_prospects.linkedin_sender + sender_first: acceptance, status checks, replies, Message A and follow-ups use the account that sent the request, and the messages are signed with that sender's first name. L.provider(accountId).

## 1.5.79 (7 Oct 2026)
- Contact guards: a headline naming the brand through a board seat, investment, advisory role or a former job no longer counts as the decision maker, and anyone with more than 25,000 LinkedIn followers is parked with the reason before a request goes out (a fake 'Starbucks' Meta ad page led to a request to Marissa Mayer on 7 Oct; it was withdrawn automatically 7 minutes later).

## 1.5.78 (7 Oct 2026)
- Video Outreach Reports tab: one row per UK day, newest first, last 31 days with Show more back to the first day of outreach. What happened (found, requests, accepted, videos, follow-ups, replies, positive, withdrawn) and what became of that day's requests (accepted so far, awaiting, withdrawn, rate); click a day for the brand names; totals row; CSV download. `db.dailyLedger`, action dailyLedger.

## 1.5.77 (7 Oct 2026)
- Connection requests stalled from 1 to 7 Oct: requests withdrawn after 21 days put the person back in the queue, LinkedIn refused the repeat ("Should delay new invitation to this recipient") and the send step stopped at that refusal every tick. Now nobody is invited twice (the queue skips anyone with a Connection Applied or withdrawn event) and a refusal about one person parks them with the reason and the next one is tried; only account-wide errors stop the round.

## 1.5.76 (7 Oct 2026)
- Ready to send: a "Get contact details" button on each lead. On press it looks up the decision maker's verified email and phone from Apollo (founder/CEO first, then a marketing lead) and saves them onto the card. It only runs when you press it, so credits are spent on purpose. Mobiles can take a few minutes to arrive from Apollo.

## 1.5.75 (7 Oct 2026)
- Help flowchart: split "Run" into two real steps, "Find brands" (pulls from Meta) and "Analyse & draft" (scores, reads the site, picks the product, writes the messages).

## 1.5.74 (7 Oct 2026)
- Ready to send cards tidied: clear "Your video" and "The message" sections, more breathing room, a louder Send on LinkedIn button.
- Help and guide "The whole loop" is now a simple flowchart (numbered steps, teal = runs on its own, amber = you step in, with Meta / Instagram / LinkedIn / ScrollyVid tiles on the right steps). The fuller branching chart will come behind a "Show full chart" option later.

## 1.5.73 (7 Oct 2026)
- Ready to send: uploaded videos now show the WHOLE video upright and larger, never a cropped landscape slice (portrait videos were being chopped to 160x90).

## 1.5.72 (7 Oct 2026)
- Deep Dossier returns real people: Apollo mixed_people/api_search (keyword tags, titles or seniority incl. Owner / Founder, country, size) then people/bulk_match (name, LinkedIn, verified email, office line); qualifications read as surnames (MCIPP) are fixed from the LinkedIn slug.
- LinkedIn activity filter (Any, Quiet 6+ months, Quiet 12+ months, Active): each profile checked live through Unipile, empty profiles (under 50 connections) left out, a Checked and left out list says why; One person per company.
- Mobiles and direct lines: Apollo waterfall phone + email with a signed webhook (api/deepdossier/apollo-hook.js), read back by api/deepdossier/phones.js (also polls Apollo's result endpoint); the table fills in by itself, do-not-call numbers flagged, then saved to Our Leads. New columns: Office phone, Last LinkedIn activity, Connections; CSV and PDF include them.

## 1.5.71 (7 Oct 2026)
- Ready to send: a Not relevant button on every card (and on no-product cards in place of Not a fit) opens an inline reason picker; the lead goes to Dead (no messages, follow-ups cancelled) and the reason is kept in vo_prospects.not_relevant_reason. Analytics shows Marked not relevant, reasons counted with the brands.

## 1.5.70 (7 Oct 2026)
- LinkedIn activity reads posts AND comments and keeps the newest (comments were only read when someone had never posted), for the Video Outreach activity gate and activityCheck.

## 1.5.69 (7 Oct 2026)
- New owner-alert text endpoint (`/api/alert-sms`) so Ajay's other sites can text his alert mobile through the SitePounce Twilio number. Locked by a shared secret, recipients fixed server side, 320 characters max. First user: Automation Growth Lab's free-setup requests.

## 1.5.69 (7 Oct 2026)
- Owner-only action activityCheck in api/vo.js: for up to 15 LinkedIn profile links, the last post or comment date, days since, connections and followers (proof of concept for the payroll brief; no screen yet, the Deep Dossier filter is pending).

## 1.5.68 (5 Oct 2026)
- Product names are tidied to what a person would say, not an SEO page title: the tail after a dash, bar, colon or comma, "for/with ..." clauses, codes (SKU-12345, AB1234), counts, sizes and pack words go, SHOUTING CAPS become normal words (SPF, CBD stay), six words at most. Examples: "EKKOLYTE - Electrolytes and Minerals" reads Ekkolyte; "Organic Ashwagandha Gummies for Stress Relief, Sleep Support - 60 Count" reads Organic Ashwagandha Gummies.
- The Product in the video box shows the tidied name, so it matches the message word for word.

## 1.5.67 (5 Oct 2026)
- Product picker reads the whole Shopify catalogue (250 a page, 2 pages; was the first 50) and fetches up to 3 products their ads link to that the feed left out; EKKO's advertised Ekkolyte was product 51+ of 191, so a stringer was picked. The advertised product (hero, or linked from 2+ ads) now always wins, whatever its photo count; products linked from ads rank next.
- Ready to send: an Update message button beside Product in the video (click-away still works). Hand-edited text keeps its edits: only the changed wording is swapped in.

## 1.5.66 (5 Oct 2026)
- Ready to send: a Product in the video box on every card with a product, prefilled with the pick; editing it saves on blur and rebuilds Message A with that name (left alone if the text was edited by hand); Send and Mark sent wait for the save.
- Message A drops the false "so" when the video's product is not what their ads were about (EKKO: Ekkolyte ads, Revenge Stringer video): "I saw your Ekkolyte ads on Meta (17 new ones this month). My team made you a free sample video for the Revenge Stringer, attached below."

## 1.5.65 (4 Oct 2026)
- Ready to send: a cross next to the Video URL box takes the video off the message (OK deletes an uploaded file, Cancel keeps it). The video on the message is always listed under Uploaded videos even if the list call fails, and a failed list now says why on the status line instead of showing nothing.

## 1.5.64 (4 Oct 2026)
- Message A can never be sent twice: the lead page hides Send Message A once it has gone, and linkedinSend refuses any stage past Accepted.

## 1.5.63 (4 Oct 2026)
- The lead's own page (Open) lists its uploaded videos too, so a lead that has already been sent (and left Ready to send) can be tidied. The video sent with Message A cannot be deleted, server and screen, because Follow-up 1 links to it.

## 1.5.62 (4 Oct 2026)
- Ready to send cards list every uploaded video for that lead (player, size, time), mark the one on the message, and offer Use this one and a Delete cross. api/vo-upload.js steps list, use, delete (only blobs under vo/videos/<card id>- of this account's cards).

## 1.5.61 (3 Oct 2026)
- Product names in messages drop a store subtitle after a colon ("Daily Ultimate Essentials Pro: All-in-One Supplement" reads "Daily Ultimate Essentials Pro"), so the message never shows two colons.

## 1.5.60 (3 Oct 2026)
- Product picker skips extras: products the store hides (hidden, no-direct-access tags), welcome kits and add-ons (product_type), refills, upgrades, free gifts, scoops, replacements, clearance and discontinued lines, and anything priced at zero; multi-packs rank below the single product. IM8 Health now gets Daily Ultimate Essentials Pro instead of Double refills upgrade.

## 1.5.59 (3 Oct 2026)
- Message A says "a free sample video of it" when their ads already named the product, so the name is never repeated in one sentence.

## 1.5.58 (3 Oct 2026)
- Message A and B rewritten to read like a person typed them: "Thanks for connecting. I saw your X ads on Meta (N new ones this month), so my team made you a free sample video for the Y, attached below." then the daily or weekly offer and a day and time, signed "Aj" only. The title block is gone: every message goes out from Ajay's LinkedIn whoever presses Send (Aryan sent EHPlabs signed "Co-founder"), and LinkedIn already shows the sender.
- The AI summary tail on observations ("showcasing ... effectively") is dropped.

## 1.5.57 (3 Oct 2026)
- Feedback screenshot skips hidden screens and off-screen elements (about 300,000 hidden elements made it freeze the page 6 to 13 s; now about 1 s), and starts after the form has painted.

## 1.5.56 (3 Oct 2026)
- Feedback opens at once; the screen picture fills in while you type (it took about 6 s on a busy page), and the library preloads after sign-in.

## 1.5.55 (3 Oct 2026)
- Products: Shopify stores that redirect by country (buy.myzone.org) are read through /collections/all and the country prefix; a card with no shop says what the site describes itself as, with a Not a fit button; the shop check needs a real cart page (nomadcruise.com, a cruise, passed the old one).
- Video Outreach has a Sent tab (messages sent + scheduled follow-ups); Ready to send shows the last one sent at the top.
- Feedback button moved bottom-right (the left menu covered it), bounces 4 s after load then every 5 minutes, and each note carries a screenshot, the version and the browser's recent errors and failed calls; Admin Feedback shows them.
- The version shows as a clear "Version 1.5.55" label bottom-left.

## 1.5.54 (1 Oct 2026)
- Wording: the video link box, help bubble, help page and error messages say video link instead of naming the video tool.

## 1.5.53 (24 Sep 2026)
- Follow-up 3 season follows the brand's country: US gets Thanksgiving, 4th of July, Labor Day; UK and Ireland get Black Friday and Mothering Sunday (three weeks before Easter); Canada, Australia and New Zealand have their own dates; anywhere else only shared dates (Valentine's, Black Friday, Christmas, new year).
- Every contacted brand gets its missing follow-ups booked automatically (worker tick), a skipped one is never put back.
- Ready to send: Scheduled follow-ups list with the due date and the message as it reads today, Open and Skip.

## 1.5.52 (24 Sep 2026)
- Follow-up 3 seasonal hook from a US occasion calendar at send time: big shopping moments 14 to 75 days ahead first, smaller sale weekends 14 to 45 days, else neutral.

## 1.5.51 (24 Sep 2026)
- personFinder every other tick.

## 1.5.50 (24 Sep 2026)
- Person search accepts creative buyers; excludes editors and freelancers; re-search misses (v3).

## 1.5.49 (24 Sep 2026)
- Person search trace on a miss.

## 1.5.48 (24 Sep 2026)
- Follow-ups at day 4 and 12; Follow-up 3 (seasonal second sample) 30 days after Follow-up 2.

## 1.5.47 (24 Sep 2026)
- Warm-up like test (warm/cold arms, 20 h wait, 25 likes a day cap, stats on Analytics).

## 1.5.46 (24 Sep 2026)
- Switch to a second, active contact when the first is inactive (switchInactivePerson; prev_dm_* kept).

## 1.5.45 (24 Sep 2026)
- Person search v2: quoted brand plus title keywords, current-job check on the profile, re-search v1 misses.

## 1.5.44 (24 Sep 2026)
- Person search retry without the title filter; debug of the raw answer.

## 1.5.43 (24 Sep 2026)
- LinkedIn person search fallback (personFinder, 1 a tick; Find on LinkedIn button).

## 1.5.42 (24 Sep 2026)
- Auto follow-ups on, with stacking, spacing, window and cap rules; follow-up greeting fixed; offer line made category-neutral.

## 1.5.41 (24 Sep 2026)
- Funnel never blank: empty range falls back to 90 days, then all time.

## 1.5.40 (24 Sep 2026)
- Funnel date range (default last 30 days), funnel API action.

## 1.5.39 (24 Sep 2026)
- Funnel: Of all scanned column.

## 1.5.38 (24 Sep 2026)
- Analytics funnel table with percentages and Copy.

## 1.5.37 (24 Sep 2026)
- Daily graph day labels.

## 1.5.36 (24 Sep 2026)
- Send step runs first and alone in the worker; last_tick diagnostics; Results renamed Analytics with health block and 14-day daily bars.

## 1.5.35 (22 Sep 2026)
- Top-ups: one a day per campaign, only under 12 ready.

## 1.5.34 (21 Sep 2026)
- Watchdog texts on pause, failed sourcing run, and a quiet weekday.

## 1.5.33 (13 Sep 2026)
- Compressor reads the duration inside ffmpeg (no DOM video probe).

## 1.5.32 (13 Sep 2026)
- Compressor gets the wasm as bytes (wasmBinary).

## 1.5.31 (13 Sep 2026)
- Compressor drives the ffmpeg core from its own classic worker.

## 1.5.30 (13 Sep 2026)
- Compressor loads the ESM core (module worker).

## 1.5.29 (13 Sep 2026)
- Upload a video file on Ready to send; over 20 MB is compressed in the browser (ffmpeg.wasm) first; chunked upload to Vercel Blob (api/vo-upload.js).

## 1.5.28 (13 Sep 2026)
- Shorter Message A; example record last on Ready to send.

## 1.5.27 (13 Sep 2026)
- Leading region codes stripped from product names.

## 1.5.26 (13 Sep 2026)
- Message A closes with the daily or weekly supply and a chat; store tags stripped from product names; rebuild skips sent prospects.

## 1.5.25 (13 Sep 2026)
- Video Outreach team permissions: Ready to send only, whole module, Settings; off unless ticked; tabs and API gated.

## 1.5.24 (12 Sep 2026)
- Activity gate on the request queue (posts or comments in 90 days); alert texts logged and shown in Settings.

## 1.5.23 (12 Sep 2026)
- Acceptance detection: paged connections list plus a direct profile check (network distance) for open requests.

## 1.5.22 (12 Sep 2026)
- Test connection reports pending invitations and recent connections; example events excluded from caps.

## 1.5.21 (12 Sep 2026)
- Example record uses Klevaro's real products and photos.

## 1.5.20 (12 Sep 2026)
- Look again on a WooCommerce store: fixed a crash after the products were found.

## 1.5.19 (12 Sep 2026)
- Blocked website wording, product photo upload on the card (api/vo-photo.js, Vercel Blob), longer WooCommerce timeout.

## 1.5.18 (12 Sep 2026)
- Look again reports each store reader's answer.

## 1.5.17 (12 Sep 2026)
- WooCommerce store reader; browser user agent for store reads; Website link and tidier cards on Ready to send.

## 1.5.16 (12 Sep 2026)
- Video as a LinkedIn attachment (default) or a link; size checked on paste, 20 MB limit; setting plus per-card override.
- Ready to send: green lead strip per card; products from the ads' links when a store blocks readers; hand entry when nothing is found.

## 1.5.15 (8 Sep 2026)
- Top-up runs use fresh keywords only, widen to neighbouring categories when yield is low, up to three a day.
- Ready to send: link drops into the message as you type; example record marked as made up; Messages sent list.

## 1.5.14 (7 Sep 2026)
- Campaigns table columns trimmed so the buttons sit inside the card.

## 1.5.13 (7 Sep 2026)
- Note test arm C: no note. Three arms rotate evenly.

## 1.5.12 (7 Sep 2026)
- Connection note 50:50 test (A offer vs B soft), results per note on Results and in the daily report, toggle in Settings.

## 1.5.11 (7 Sep 2026)
- Campaigns table headers spaced and wrapped.

## 1.5.10 (7 Sep 2026)
- Campaigns table fits without horizontal scroll (country and schedule under the name).

## 1.5.9 (7 Sep 2026)
- Score first, spend second: Apollo lookup only for brands whose Meta signals can still reach the priority cut-off; the ad count skips excluded and off-country brands.

## 1.5.8 (7 Sep 2026)
- Campaigns table: status pill fixed (style clash), action buttons stacked in a narrow column.

## 1.5.7 (7 Sep 2026)
- Daily report tiles and the waiting brand names are clickable and open Ready to send (or the prospects list).

## 1.5.6 (7 Sep 2026)
- Auto top-up never adds research-intent keywords.

## 1.5.5 (7 Sep 2026)
- Automatic queue top-up: under the daily cap, the worker adds shopper keywords and starts one sourcing run a day. Ready-to-request count on Results and in the daily report.

## 1.5.4 (7 Sep 2026)
- The LinkedIn queue skips a brand whose link is a company page (reason on the prospect and in the daily report) and tries the next one, instead of stalling on it every tick. Editing the link clears the skip.

## 1.5.3 (6 Sep 2026)
- Message A leads with the product angle; the ad number is a short clause, only when it came from a full count.

## 1.5.2 (6 Sep 2026)
- Product names in messages and texts drop the store's spec parts.

## 1.5.1 (6 Sep 2026)
- Static-ad brands no longer get the video point twice in one message.

## 1.5.0 (6 Sep 2026)
- Messages carry a proof line from real numbers, and Message A closes with an easy-yes question offering the next product.

## 1.4.11 (6 Sep 2026)
- Red count on the Ready to send tab and the Video Outreach menu button.

## 1.4.10 (6 Sep 2026)
- A campaign that sets its own sender name signs with that name.

## 1.4.9 (6 Sep 2026)
- Signature block under "Thanks," (name, then Co-founder, ShekiPro.com), editable; brand written ShekiPro.com.

## 1.4.8 (6 Sep 2026)
- Messages sign off "Aj, Co-founder at Shekipro"; Rebuild all messages button in Settings.

## 1.4.7 (6 Sep 2026)
- A large photo of the product to film on the Ready to send card and the prospect page.

## 1.4.6 (6 Sep 2026)
- Ask AI in the left menu under Video Outreach and as its own tab.

## 1.4.5 (6 Sep 2026)
- Ready to send: with a provider connected only Send on LinkedIn shows; the manual buttons sit behind a small link.

## 1.4.4 (6 Sep 2026)
- Show me an example on Ready to send: a made-up accepted connection, sending off, one click removes it.

## 1.4.3 (6 Sep 2026)
- Ask AI on the Help and guide screen: answers from the guide and live campaigns, remembers questions, drafts FAQ entries you approve, logs feature ideas.

## 1.4.2 (6 Sep 2026)
- Film this, in order: a ranked shortlist of up to three products with reasons on the prospect page and the Ready to send card; the store is re-read at acceptance.

## 1.4.1 (6 Sep 2026)
- Acceptance texts and emails carry a link that opens that brand's Ready to send card.
- Daily report email every morning after 8am UK, and the same numbers on the Results tab.
- Help and guide in the left menu, with click paths, times of day and a step-by-step campaign setup.

## 1.4.0 (6 Sep 2026)
- Connection requests go out at a random 10 to 30 minute gap, never the same gap twice in a row.

## 1.3.9 (6 Sep 2026)
- Quick check on the Prospects list: the four hand-checked signals for every brand in one table, one Save re-scores the changed rows.

## 1.3.8 (6 Sep 2026)
- Acceptance alerts read "new ShekiPro connection".

## 1.3.7 (6 Sep 2026)
- Campaigns table reads as a funnel: Prospects, Requested, Connected, Videos sent, Positive replies, Other replies.

## 1.3.6 (6 Sep 2026)
- Campaigns table tidied: one row of buttons, alternating shading, Requested, Connected, Positive replies and Other replies columns.
- Help opens inside Video Outreach as its own tab, with the flow, where you step in, and FAQs.

## 1.3.5 (6 Sep 2026)
- Reset outreach button on a prospect: back to Not contacted after a test, keeping the event trail.

## 1.3.4 (6 Sep 2026)
- New-lead SMS and email when a connection is accepted, addressed by first name; Send a test text button in Settings.

## 1.3.3 (6 Sep 2026)
- Settings shows set or not set for each of the three Unipile variables and for the email sender.

## 1.3.2 (6 Sep 2026)
- SMS reply alerts: add mobiles in Settings and get a text on Positive and Question replies (or every reply).

## 1.3.1 (6 Sep 2026)
- Replies are read as Positive, Negative, Question or Neutral: a coloured chip on the prospect and in the list, the email alert subject says which, and a one-line summary.
- Record a reply box on the prospect page for replies you received yourself.

## 1.3.0 (6 Sep 2026)
- No more fading toasts or pop-up messages in Video Outreach: one bold status line under the tabs stays on screen until the next action. Confirm boxes remain only before spending credits, sending, or deleting.

## 1.2.9 (6 Sep 2026)
- Refresh ad counts ends with a clear pop-up, and says so when everything was already counted.

## 1.2.8 (6 Sep 2026)
- Help bubbles on the campaign page sections: Run now, Ad counts (Refresh), Import prospects and Runs.

## 1.2.7 (6 Sep 2026)
- Refresh ad counts shows progress from the first click: the brand it is on and its new ad count.

## 1.2.6 (6 Sep 2026)
- Refresh ad counts button on the campaign page: re-pulls each brand's own ads (newest 30) and re-scores.
- Prospects remember their Meta page id so recounts are exact.

## 1.2.5 (6 Sep 2026)
- Help page with a menu and sub-sections (the Help tab in Video Outreach).

## 1.2.4 (6 Sep 2026)
- Fixed: a run could fail to save when an ad's text was cut in the middle of an emoji. Text is cut on whole characters and broken characters are stripped before saving.

## 1.2.3 (6 Sep 2026)
- Trigger event is set automatically when a brand is hiring a marketing role or has launched 10 or more ads this month.

## 1.2.2 (6 Sep 2026)
- Apollo people search moved to the current endpoint, so contacts come back.
- Apify per-brand count pass sends the page URL and settings in the shape the actor expects.
- A run is stepped by one worker at a time (heartbeat), so the cron and the screen never process the same brands twice.
- Merchandise is never picked as the sample product while a real product exists.

## 1.2.1 (6 Sep 2026)
- Live runs count each brand's own ads (newest 30) after the keyword search, so ad counts are real, not a sample.
- Brand names come from the company record, not the ad page.
- The decision maker is enriched once per brand so the full name and LinkedIn link are present.
- A store that is not on Shopify is kept instead of disqualified, per the spec's feed-or-cart rule.
- Product picks prefer real products matching the campaign keywords over merchandise.

## 1.2.0 (6 Sep 2026)
- Live Meta Ad Library pulls run in the background on Apify and the run waits for them, so runs no longer hit the 60-second limit.
- Runs keep a sample of each provider's raw answer so field mapping can be checked.

## 1.1.10 (5 Sep 2026)
- Prospect filters sit side by side instead of stretching across the page.

## 1.1.9 (5 Sep 2026)
- Marking Msg 1 sent by hand now schedules Follow-up 1 (3 days) and Follow-up 2 (7 days) like the email and LinkedIn sends do; a reply or Dead cancels them.
- Prospects table condensed to 8 readable columns so headers no longer break letter by letter.

## 1.1.8 (5 Sep 2026)
- Prospect field help rewritten: each explains what the fact is, how to read the number and the points it earns. Labels renamed: Other paid channels (count), Growth signals (count), Creative gap (points).

## 1.1.7 (5 Sep 2026)
- Campaign, run, prospect and results tables fit the screen and wrap instead of scrolling left to right.

## 1.1.6 (5 Sep 2026)
- A small ? next to every field in the campaign form and the prospect page explains what it is and how to use it (hover or tap).
- App files are no longer cached by the browser, so a new version shows on a normal refresh.

## 1.1.5 (5 Sep 2026)
- Run now shows a Running state straight away: pulsing tiles, a spinner and a line saying which brand is being scored; the button is disabled until the run finishes.
- Run now is the first button on the Campaigns list and the buttons wrap instead of scrolling off the edge.

## 1.1.4 (5 Sep 2026)
- Version number bottom-left is clickable and shows this history in the app.

## 1.1.3 (5 Sep 2026)
- Clear prospects on a run reports what it really removed and falls back to the run's time window.

## 1.1.2 (5 Sep 2026)
- AI observations cleaned so messages never read "Came across Came across" or end with two full stops.
- Broken product or ad images show a grey "no image" tile.
- Traffic proxy row in the score breakdown reads in words.
- Version number pinned to the bottom-left corner.

## 1.1.1 (5 Sep 2026)
- Brands with no named contact are kept and flagged "find one by hand" (tracker rule) instead of disqualified.
- Delete a prospect from its page; Clear prospects on a finished run.

## 1.1.0 (5 Sep 2026)
- Video Outreach Phases 2 to 5 (sourcing, enrichment, product rule, email, scheduler, results, weight tuning, template sets, plan gating, LinkedIn automation).
- Fixed: sourced prospects failed to save (duplicate column).
- Version stamp added to the sidebar.

## 1.0.0 (5 Sep 2026)
- Video Outreach Phase 1: scoring engine, tracker import, campaigns and prospects screens, prospect detail with messages, tracking. 107 tests.
