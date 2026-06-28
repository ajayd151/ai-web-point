# Site Pounce, Subscription Rollout Proposal

A phased plan to turn Site Pounce from a single-user tool into a simple, paid subscription product for the UK and US. Read this, then we adjust anything before we build. Nothing has been built yet.

---

## 1. Why we win (the wedge)

Make these the heart of the product and the marketing:

1. **We build their actual website, not a report.** LeadsGorilla emails a PDF audit. SiteSwan builds sites but is not lead-led. We do both: find the lead, show them a website we already built, then make it live.
2. **One flat price, no surprise Google bills.** Rivals make you eat the API costs. We bundle a fair-use allowance and show "credits", not raw compute.
3. **The whole journey in one tool:** find, mockup, send (call/SMS/WhatsApp), track, build the live site, collect the enquiry.
4. **Simple, honest pricing** versus the funnel and lifetime confusion rivals use.

One line: *"Find local businesses with no website, show them one you have already built, and turn them into a paying client, all in one tool."*

Market size is real: roughly **24% of UK and 27% of US small businesses still have no website** (verified, declining about 1 to 2 points a year). That is millions of targets.

---

## 2. Recommended platform stack

Keep what already works, add only three new pieces. Simple by design.

| Need | Platform | Keep or new | Why |
|---|---|---|---|
| Hosting | **Vercel** | Keep | Already live, push to deploy, serverless + static. |
| Sign-up + login (Email + Google) | **Clerk** | New | Drop-in auth, Email + Google in minutes, prebuilt sign-in screens + a user dashboard, generous free tier, bolts onto the current app with least disruption. |
| Database | **Neon Postgres** | Keep | Already holds tracking + applications, add users + subscriptions tables. |
| File storage | **Vercel Blob** | Keep | Mockups, live sites, dossiers, leads. |
| Billing + subscriptions | **Stripe** | New | Checkout (sign-up), Customer Portal (self-serve manage/cancel), Billing for tiers + top-up credits, handles £ and $. |
| Transactional email | **SendGrid** | Keep | Verification, receipts, enquiry alerts (finish SPF/DKIM). |
| Product analytics | **PostHog** | New (Phase 2) | Tracks what customers search for, funnels, usage. Powers the Super Admin view. Free tier. |
| DNS + client domains | **Cloudflare** | Keep | Wildcard subdomains for live client sites. |

**Alternative to Clerk:** **Supabase** (auth + Postgres + storage in one), the platform you used on ScrollyVid. Good if we want to consolidate the whole backend onto one provider. Trade-off: more migration now versus Clerk which just adds auth to the working stack. **My recommendation: Clerk for speed and least disruption; revisit Supabase only if we want everything under one roof.**

---

## 3. The packages (your gating: mockups mid, website builder top)

| Tier | Who it is for | Unlocks | Founding (locked for life) | Standard |
|---|---|---|---|---|
| 🐾 **Scout** | Solo / just starting outreach | Find leads, Call List, CRM, outreach (call/SMS/WhatsApp), tracking | £29 / $39 | £49 / $59 |
| 🐆 **Hunter** (most popular) | Active agencies | Everything in Scout, plus **AI mockups** and **Prowl** call intelligence | £59 / $79 | £99 / $129 |
| 🦁 **Apex** | Serious closers | Everything in Hunter, plus the **live website builder** (Pounce), custom domains, white-label | £129 / $169 | £199 / $249 |

Why it is a no-brainer: **Scout undercuts LeadsGorilla's entry ($57).** **Apex sits in SiteSwan's builder range ($149 to $300) but also includes the lead-gen and outreach**, so it replaces buying SiteSwan and LeadsGorilla separately.

Pricing is proposed, not final. We lock it once you are happy.

---

## 4. Billing model (simple, hybrid)

- **Flat monthly fee per tier** (above), billed by Stripe.
- **A fair-use AI allowance per tier** (a number of mockups / live sites per month), so heavy users do not drain costs. Beyond it, cheap **top-up credits** (for example £12 for 50 extra mockups).
- **Customers see "credits remaining", never raw API cost.** The £ cost meter we built stays, but for you and Super Admin only.
- **Annual option** with two months free (improves cash flow, cuts churn).
- **Founding members:** the first 20 to 50 keep their rate **for life** in exchange for being case studies. Honour it permanently.

---

## 5. Phase 1, Launch (get it out there, start charging, learn)

Goal: ship a payable product fast, prove people pay, see how they use it.

- **Accounts:** sign-up + login with **Email and Google** (Clerk).
- **Payments:** **Stripe** subscriptions for the 3 tiers, in £ and $, plus a **free trial** (for example 7 days, or "25 leads + 3 mockups free") so they feel the website magic before paying.
- **Per-customer data separation:** each account only sees its own leads, mockups, sites, searches.
- **Feature gating by plan:** mockups locked to Hunter+, the live website builder locked to Apex.
- **Credits, not raw cost,** shown to customers.
- **New light homepage + rebrand + new logo** (see section 8).
- **Minimal Super Admin:** list customers, their tier, basic usage counts, suspend or change tier by hand.
- **Founding-member offer** wired to the existing apply funnel, with the lifetime grandfather.

---

## 6. Phase 2, Grow (monetise deeper, understand customers)

- **Super Admin analytics (PostHog + dashboards):** what customers search for, their funnel (messaged to viewed to won), most-used features, churn and upsell signals.
- **Usage limits enforced per tier + "upgrade to unlock"** prompts.
- **Top-up credits + annual billing + referrals.**
- **Close feature gaps versus rivals:** email enrichment (find an email), and a **Facebook lead source** (LeadsGorilla has it, we do not yet).
- Tighten the founding cohort into testimonials and case studies.

---

## 7. Phase 3, Scale (build the moat)

- **Full white-label:** per-account branding, the customer's own agency name and colours everywhere, custom domains for previews and live sites.
- **Team seats + roles** (agencies with staff).
- **Integrations:** GoHighLevel, Zapier, a public API / webhooks.
- **Done-for-you / marketplace** add-ons for extra revenue (for example paid lead packs or managed campaigns).
- Advanced AI: auto-outreach sequences, smarter follow-ups.

---

## 8. Phase 1 brand + homepage refresh

### New homepage (simpler, lighter, ScrollyVid style)
- A clean, **light** hero with the **search front and centre and emphasised**, three simple fields:
  1. **I am looking for** (business type, for example electricians)
  2. **Location**
  3. **Quick targeting toggles:** "has a phone", "no website"
  4. A big **Find leads** button
- Below the hero: the value proposition (find no-website businesses, show them a website you built), a few proof points, the pricing, and sign-up. Logged-out visitors get a teaser then a prompt to start a free trial.

### Branding
- **Default theme switches to LIGHT** (today it is dark navy + gradients): bright, clean, professional.
- Add a **light / dark toggle**, default **light**, the choice is remembered per user.
- A fresh, **flat accent colour** (not the blue to mauve gradient).

### New logo
- A **flat, distinctive mark, not the typical gradient AI logo.**
- Direction options to choose from (I will mock these up):
  - A) A clean geometric **pounce** mark (a stylised paw or a downward pounce into a location pin).
  - B) A confident **wordmark** with one distinctive accent (for example a paw or pin replacing a letter).
  - C) A **pin + paw fusion** (lead-gen meets pounce).
- Must work in light and dark and shrink to a favicon.

---

## 9. Feature map by phase

| Capability | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Email + Google sign-up and login | Yes | | |
| Stripe subscriptions (3 tiers, £/$) | Yes | | |
| Free trial + founding-member offer | Yes | | |
| Per-customer data separation | Yes | | |
| Plan-based feature gating | Yes | | |
| Fair-use AI allowance + credits shown | Yes | | |
| New light homepage + 3-field hero | Yes | | |
| Light/dark theme (light default) | Yes | | |
| New logo + rebrand | Yes | | |
| Minimal Super Admin (users, tier, usage) | Yes | | |
| Super Admin analytics (searches, funnels, churn) | | Yes | |
| Usage limits + upgrade-to-unlock prompts | | Yes | |
| Top-up credits + annual billing + referrals | | Yes | |
| Email enrichment (find an email) | | Yes | |
| Facebook lead source | | Yes | |
| Full white-label (branding + custom domains) | | | Yes |
| Team seats + roles | | | Yes |
| Integrations (GHL, Zapier, API) | | | Yes |
| Done-for-you / marketplace | | | Yes |

---

## 10. Decisions I need from you before we build

1. **Auth platform:** Clerk (my pick, least disruption) or Supabase (one backend, like ScrollyVid)?
2. **Prices:** happy with the proposed tiers, or adjust?
3. **Trial:** time-based (7 days) or usage-based ("25 leads + 3 mockups free")?
4. **Logo direction:** A, B or C above (I will mock options once you pick a lean).
5. **Theme accent colour:** any preference, or shall I propose a couple?

When you have read this and are happy, say go and I will (1) create the build tracker, then (2) start Phase 1. The tracker is deliberately not created yet, since you may want changes.
