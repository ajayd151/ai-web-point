# Video Outreach, user guide

SitePounce > Video Outreach finds ecommerce brands that advertise on Meta (Facebook and Instagram), scores them out of 100, picks the product a sample video should be made for, writes the LinkedIn and email messages, and tracks the outreach. You make the video outside SitePounce and paste the link in. Version 1.2.6, 6 September 2026. The same guide with a menu is in the app: the Help tab inside Video Outreach.

## 1. The whole loop in one picture

1. **Campaign**: you say what to look for (keywords, country, size, caps).
2. **Run**: SitePounce pulls live ads from the Meta Ad Library, adds company and contact data from Apollo, reads each brand's Shopify store, scores every brand and drafts the messages. A run takes 2 to 10 minutes.
3. **Prospects**: a list sorted by Priority Number (1 = Must target). Open one to see why it scored what it did, the product to film, and the messages.
4. **Connect**: send the LinkedIn connection request (by hand with Copy, or automatically once a LinkedIn provider is connected).
5. **Accepted**: the brand appears on **Ready to send** with the draft of Message A.
6. **Send**: you paste the video link, check the words, click Send (LinkedIn or email). Nothing is ever sent without that click.
7. **Follow-ups**: drafts appear 3 and 7 days later; you send them, or switch on auto follow-ups per campaign.
8. **Reply**: the stage moves to Replied, follow-ups are cancelled, you get an email. From there you set Call booked, Pilot, Client and the Outcome.

## 2. Creating a campaign

Click **Campaigns > New campaign**. The fields that matter most:

| Field | What to put |
|---|---|
| Name | Anything, for example "US Creatine Sep 26". |
| Industry + Suggest keywords | Type the product area, click the button. It writes 10 to 20 shopper search terms. Delete research phrases (review, dosage, vs powder) and keep buying phrases. These keywords drive the whole search. |
| Country | US by default. Comma separated for more. |
| Company size band | Leave 1-10 and 11-50 ticked. Over 200 is always thrown out. |
| Store platform | Leave Shopify only so products and photos can be read. |
| Meta advertisers only | Leave ticked. Minimum active ads 10. |
| Target prospects per run | How many new qualified brands you want from one run (20). |
| Raw candidate cap | How many brands the run may look at before stopping (100 for a first run). This is your spend control. |
| Cost cap (£) | Second spend control. The run stops when provider spend reaches it. |
| Minimum score to keep | 55. Below that a brand is parked, not deleted. |
| Schedule | One-off = runs when you click Run now. Daily, Weekly or Monthly = runs itself at the run time and only adds brands it has not seen. |
| Service profile | Your business name, sender name, sign-off, offer and pilot lines. These are written into every message. |
| Message template set | Leave blank to use the standard wording. Edit to change it for this campaign only. |
| Automation | Auto follow-ups, run-finished email, and (once a LinkedIn provider is connected) auto connection requests for priority 1 and 2. |

Hover any **?** for a plain-English explanation of a field. Click **Save**, then **Run now**.

## 3. What happens during a run

The tiles show raw candidates, processed, qualified, parked, disqualified and cost. The line under them says what it is doing. In order, for every brand:

1. Hard filters: not the target country, on the exclusion list, over 200 employees, no active Meta ads, no store. Any of these = disqualified with the reason shown.
2. Ad analysis: counts, video share, what is new in the last 30 days, whether they pay creators, and the AI writes the one personal line used in the message.
3. Store: reads the Shopify product list and photos, picks the product with 3 or more real photos, preferring the product named most in their ads.
4. Contacts: founder or CEO for small brands, the growth or paid-social lead for bigger ones, with a second contact. Emails are only revealed for priority 1 to 3 to save credits.
5. Score: A need for video (40), B ability to pay (25), C fit (20), D accessibility (15). The breakdown is on every prospect.
6. Messages: connection note, Message A (video sent), Message B (permission first), two follow-ups.

If Apify's monthly allowance runs out mid-run, the per-brand count is skipped (the Runs table says so) and counts read low. Upgrade the Apify plan, then click **Refresh ad counts** on the campaign page: it re-pulls each brand's newest 30 ads and re-scores without a new run.

Stop rules: target reached, raw cap reached, cost cap reached. Runs are safe to leave: if you close the page the worker finishes the run within 10 minutes.

## 3b. What a live run can and cannot score on its own

A live run reads everything it can from the ads, the store and Apollo: active ads, video share, new ads, products and photos, headcount, the decision maker with title and LinkedIn link, hiring, and a launch push. Four signals in the score still need a human look, exactly as in the tracker: whether the decision maker is active on LinkedIn (8 points), other paid channels such as Google or TikTok (up to 5), whether they already pay creators (5), and any trigger event the run could not see (6). Without them most brands land at 40 to 55, so a fresh run will show mostly Later and Possible.

Working method: open the top brands by score, spend a minute on each, fill those four fields in the editable list, click Save and recalculate. The best ones move into Strong and Must target and the messages stay as they are. Apollo's plan masks surnames in search, so each chosen contact is enriched once (1 credit) to get the full name and LinkedIn link.

## 4. Reading the prospects list

Sorted by Priority Number then score. Must target (1) and Strong (2) first. Disqualified brands are hidden unless you tick Show disqualified. Filters: campaign, run, priority, connection, creative style, stage, search.

Priority bands: Must target 75 or more, Strong 65 to 74, Possible 55 to 64, Later 45 to 54, Unlikely under 45, Skip = disqualified.

## 5. The prospect page

Left: the score breakdown (every signal and its points), the sample ads, Tracking (connection, stage, outcome, notes) and the event trail.

Right: the suggested product with its photo check and gallery, the **Video URL** box, the three messages with Copy and Send by email, the follow-ups, and every fact the run found (editable). Fix a wrong fact, click Save and recalculate, and the score and messages update.

Buttons at the top open the decision maker's LinkedIn profile and the brand Instagram.

## 6. Doing the outreach by hand (no LinkedIn provider)

1. Open the prospect, click **Copy** on the connection note, paste it into LinkedIn's connection request.
2. In Tracking set LinkedIn connection to **Applied**. The stage becomes Request sent.
3. When they accept, set it to **Connected**. The stage becomes Accepted and the brand appears on Ready to send.
4. Make the video, paste the link into Video URL, Save. Message A now carries the link.
5. On Ready to send click **Copy**, paste into LinkedIn, then **Mark Msg 1 sent**. Follow-up drafts are scheduled for 3 and 7 days later.
6. When they reply, set the stage to **Replied** (or Dead if it is a no). Follow-ups cancel themselves.

Email: if the prospect has an email and a sender address is set, **Send by email** sends Message A or B from your address and records opens.

## 7. Automatic LinkedIn (once a provider is connected)

Set `VO_LINKEDIN_PROVIDER` in Vercel to `unipile` with its three keys (or `dryrun` to rehearse with simulate buttons). Then, per campaign, tick **Auto-send connection requests** and choose up to which priority number.

What SitePounce then does on its own, every 10 minutes:

- Sends **one** connection request per check, weekdays 8am to 6pm US Eastern, never more than the daily cap (20, hard limit 25) or weekly cap (100). Requests go to the highest priority first.
- Checks for acceptances. Accepted = Connected, stage Accepted, draft refreshed, brand on Ready to send.
- Marks a request Pending after 7 days, withdraws it after 21 days.
- Reads new LinkedIn messages from your prospects. A reply sets Replied, cancels follow-ups and emails you the text.
- If LinkedIn or the provider reports a restriction, everything pauses and a red banner appears. Resume from Settings when you have checked the account.

What it never does: send Message A, send a follow-up unless auto follow-ups is on, or answer a reply.

## 8. Results and tuning

**Results** shows reply, call and pilot rates by priority band and by message variant. If Possible replies as often as Strong, lower the Strong threshold in Settings. If B out-replies A, lead with permission. Weight changes are previewed against the 74 tracker brands before saving and re-score every prospect.

## 9. Settings

Shows which provider keys are set (never the values), the default service profile, the global exclusion list, LinkedIn caps and state, the score weights, and saved keyword presets.

Keys live in Vercel > Settings > Environment Variables: `APIFY_TOKEN` (Meta Ad Library, about £0.60 per 1,000 ads), `APOLLO_API_KEY` (1 credit per company page, per company enrich and per email), `OPENAI_API_KEY` (a penny per brand), `SENDGRID_API_KEY` and `VO_EMAIL_FROM` (email), `VO_LINKEDIN_PROVIDER` plus `UNIPILE_DSN`, `UNIPILE_API_KEY`, `UNIPILE_ACCOUNT_ID`. Without a key the provider answers from the tracker data (dry run) and costs nothing.

## 10. Costs to expect

Measured on the first live runs (20 brands): about £1.60 in total, of which Apify £0.45 (the keyword pull plus a 30-ad count of each brand's own page), Apollo about 45 credits, AI under £0.20. A 100-brand run is roughly five times that. The estimate on the campaign page is calculated before you run and the cost cap stops a run that is spending more than expected. A run takes 3 to 8 minutes because the two Apify pulls run in the background.

## 11. If something looks wrong

- Run shows errors: open the Runs table on the campaign, the reason is in the last column. Clear prospects on a bad run and run again.
- A brand scored oddly: open it, fix the fact, Save and recalculate.
- Messages read oddly: edit the Observation line, or the message text, then Save edited message text.
- Which version am I on: bottom-left of the sidebar. Click it for the history of changes.
