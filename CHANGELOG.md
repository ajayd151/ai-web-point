# SitePounce changelog

The live version shows bottom-left in the app sidebar and is clickable there. `public/changelog.json` is the same list, rendered in-app. Bump `lib/version.js` and add an entry here and in the JSON on every deploy that changes behaviour.

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
