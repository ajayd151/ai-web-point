# SitePounce changelog

The live version shows bottom-left in the app sidebar and is clickable there. `public/changelog.json` is the same list, rendered in-app. Bump `lib/version.js` and add an entry here and in the JSON on every deploy that changes behaviour.

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
