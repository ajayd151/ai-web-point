# Site Pounce, Phase 1 Build Tracker

Launch a payable, multi-user subscription. Auth = **Clerk**, billing = **Stripe**, kept on the current Vercel + Neon + Blob stack (no rewrite). Tick off as we go. Items marked **[Ajay]** are yours (credentials), everything else is mine.

## A. Brand refresh (do first, safe + visible, no backend risk)
- [ ] New **pin + bolt** logo as SVG + favicon (teal `#0FB6A8`, coral `#FF6B6B`)
- [ ] New palette across the app (teal / coral / amber `#FFC233` / ink `#15233B`), flat, no gradients
- [ ] **Light theme by default** + a light/dark toggle (remembered per user)
- [ ] New **light homepage** with the 3-field search hero (business type, location, "no website / has phone")
- [ ] Public **pricing page** with the tier comparison table

## B. Accounts + auth (Clerk)
- [ ] **[Ajay]** Create the "Site Pounce" Clerk app, enable Email + Google (mirror ScrollyVid), paste keys into Vercel env
- [ ] Front-end sign-up / sign-in via Clerk JS (replace the current login gate)
- [ ] Verify the Clerk session in every API function (replace `lib/auth.js` HMAC cookie)
- [ ] `users` table in Neon (clerk_user_id, email, plan, founding flag, created)

## C. Billing (Stripe)
- [ ] **[Ajay]** Stripe account keys into Vercel env
- [ ] Stripe products + prices for Scout / Hunter / Apex (£ and $)
- [ ] Checkout (pick a plan) + Customer Portal (self-serve manage / cancel)
- [ ] Webhook to set the customer's plan on their user record
- [ ] Founding-member offer (locked price honoured)

## D. Multi-tenant data separation
- [ ] Scope leads / mockups / sites / searches / call list / notes to the user id (Blob prefixes + Postgres `user_id`)
- [ ] Migrate the existing single-user data onto your owner account

## E. Feature gating + credits
- [ ] Gate **AI mockups** to Hunter+, the **live website builder** to Apex
- [ ] Fair-use allowances per tier + cheap top-up credits
- [ ] Show customers **"credits remaining"** (hide the raw API cost; keep the £ meter for Super Admin)

## F. Minimal Super Admin
- [ ] Customers list with tier, basic usage counts, suspend / change tier

## Out of scope for Phase 1 (Phase 2/3)
Usage analytics (PostHog), per-tier hard limits + upgrade prompts, annual billing, referrals, email enrichment, Facebook source, full white-label, team seats, integrations.
