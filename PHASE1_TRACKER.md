# Site Pounce, Phase 1 Build Tracker

Launch a payable, multi-user subscription. Auth = **Clerk**, billing = **Stripe**, kept on the current Vercel + Neon + Blob stack (no rewrite). Tick off as we go. Items marked **[Ajay]** are yours (credentials), everything else is mine.

## A. Brand refresh (do first, safe + visible, no backend risk)
- [x] New **pin + bolt** logo as SVG + favicon (teal `#0FB6A8`, coral `#FF6B6B`)
- [x] New palette + flat brand colours across the app (teal / coral / amber / ink), main gradients removed
- [x] App header (topbar) switched to light
- [x] **Light homepage** rebuilt: top nav (Features / How / Pricing / Sign in / Get started), impactful hero with the 3-field search, Features, How-it-works, Pricing tiers, footer
- [x] Founding-member / "launching soon" removed from the landing (apply modal kept but unlinked)
- [x] Terms + Privacy pages (linked in the footer)
- [x] Broader, LeadsGorilla-aware messaging (not just "no website")
- [ ] Light/dark toggle (remembered per user)
- [ ] Sweep remaining decorative gradients to flat
- [ ] Full tier comparison table on the pricing page (currently summary tiers)
- [ ] Wire Sign in / Get started to Clerk (Google + email) — section B

## B. Accounts + auth (Clerk)
- [x] Created the "Site Pounce" Clerk app (Development instance `major-cod-60.clerk.accounts.dev`), enabled Email + Google, added an `email` claim to the session token (for allow-listing)
- [x] Front-end sign-up / sign-in via Clerk JS, built **dormant** behind `window.AIWP_CLERK.enabled` (flip to `true` to turn on); `openSignin` / logout defer to Clerk's UI when enabled
- [x] Backend Clerk session verification via `lib/clerkauth.js` (zero-dep JWKS verify) + `api/clerk-session.js`, which exchanges the Clerk token for the existing `aiwp` cookie, so all 16 protected endpoints stay unchanged
- [ ] **[Ajay]** Paste `CLERK_SECRET_KEY` (from Clerk → API keys) + set `ALLOWED_EMAILS=ajay@aimpro.co.uk` in Vercel, then I flip `enabled:true` and we test sign-in
- [ ] Swap the dev instance for a **Production** instance + your own Google OAuth creds at launch (point sitepounce.com at it, use `pk_live_`/`sk_live_`)
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
