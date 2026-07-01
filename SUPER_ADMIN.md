# Site Pounce, Super Admin guide

Operator/owner runbook: where everything lives and how to do the common jobs.
(This is one of the three planned docs: Technical, User/Features, Super Admin. It will
be exported to its own Word file. Keep adding HOW-TOs here.)

---

## Where things live (the control panels)

| What | Where | URL |
|---|---|---|
| Payments, subscriptions, refunds | **Stripe** (live) | https://dashboard.stripe.com |
| Payments testing | **Stripe** sandbox | switch account -> "SitePounce.com sandbox" |
| Who signed up (accounts) | **Clerk** | https://dashboard.clerk.com |
| Hosting, env vars, deploys | **Vercel** (project `ai-web-point`) | https://vercel.com |
| Database (customers, events) | **Neon Postgres** | via Vercel -> Storage |
| Files (mockups, sites, leads) | **Vercel Blob** | via Vercel -> Storage |
| Email sending | **SendGrid** + Google Workspace (hello@sitepounce.com) | https://app.sendgrid.com |
| DNS | **Cloudflare** (sitepounce.com) | https://dash.cloudflare.com |

Owner login to the app itself is comped (free, full access): the owner email, the legacy
operator login, and anyone in the `ALLOWED_EMAILS` env var. Everyone else must subscribe.

---

## HOW-TO: see who has signed up / who is paying
- **Signed-up accounts:** Clerk -> **Users** (name, email, last active).
- **Paying customers:** Stripe -> **Customers** (and **Subscriptions** for plan + status).
- The Neon `users` table also stores each customer's `plan` + `status` (set by the Stripe
  webhook / checkout confirm). An in-app Super Admin screen to view all this is still TODO.

## HOW-TO: issue a refund
1. Stripe (live) -> **Customers** -> open the customer (e.g. by email).
2. Open the **payment** you want to refund (Payments tab, or the invoice).
3. Click **Refund** -> confirm the amount -> Refund.
- A refund returns the money but does **NOT** stop the subscription. To stop future
  charges you must also cancel the subscription (below).

## HOW-TO: cancel a subscription
1. Stripe (live) -> **Customers** -> open the customer -> their **Subscription**.
2. **Cancel subscription** (immediately, or at period end).
- Cancelling fires our webhook (`customer.subscription.deleted`), which flips that account
  back to the paywall automatically (revokes app access). Customers can also self-cancel
  via the in-app **Manage billing** button (Stripe Customer Portal).

## HOW-TO: give someone free (comped) access
- Add their email to the `ALLOWED_EMAILS` env var in Vercel (comma-separated), then redeploy.
  They then get full access without paying. Remove them to require a subscription again.
- Alternative (recommended for friends/testers): give them a **100% discount code** (see the
  discount-codes how-to) so they "subscribe" for £0. They then show up as a real customer you
  can see + cancel in Stripe, no redeploy needed.

## HOW-TO: give a teammate free access but CAP how much they can use
Free access alone (above) still lets them burn credit up to the global caps (~30 searches /
50 mockups / 30 prowls / 30 sites per 20h). To throttle ONE person lower:
1. Set the `USER_LIMITS` env var in Vercel to JSON keyed by their lowercase email, e.g.
   `{"mate@example.com":{"search":10,"generate":5,"prowl":5,"pounce":2}}`
   (only the kinds you list are capped; the rest use the global default). Add more people by
   adding more keys. Redeploy.
2. Give them access (allow-list or a 100% code). Their searches/mockups/etc. now stop at the
   per-person numbers you set, and are counted separately from yours.

## HOW-TO: create a discount code (for friends / testers / a free teammate)
1. Stripe (live) -> **Product catalogue -> Coupons** (or Payments -> Coupons) -> **New**.
2. Pick the discount: e.g. **100% off** (free), forever or for a set duration (e.g. 6 months).
3. On the coupon, add a **promotion code** = the shareable text code (e.g. `FEEDBACK100`).
4. Share the code. At checkout they click **"Add promotion code"** (already enabled on our
   checkout) and enter it. Deactivate the code in Stripe anytime to stop new redemptions.

## HOW-TO: open or close public sign-ups
- Env var `SIGNUP_OPEN` in Vercel: `1` = anyone can sign up (paid features still gated by a
  subscription); unset/`0` = allow-list only. Redeploy after changing.

## HOW-TO: change a plan's price
- Prices are **not** baked into the app. In Stripe (live) -> Product catalogue, create a new
  price on the product, then update the matching `STRIPE_PRICE_SCOUT/HUNTER/APEX` env var in
  Vercel to the new `price_...` id, and redeploy. (Existing subscribers keep their old price
  unless you migrate them.)

---

## Go-live env vars (reference)
`STRIPE_SECRET_KEY` = the live secret key value (starts `sk_live_`, NOT the `mk_` id).
`STRIPE_PRICE_SCOUT/HUNTER/APEX` = the live `price_...` ids.
`SIGNUP_OPEN=1`. Clerk keys, `ALLOWED_EMAILS`, SendGrid, Google/OpenAI keys, Postgres/Blob
are already set. Any env-var change needs a **Redeploy** to take effect.

## Gotchas worth knowing
- **Webhook URL must use `www`**: `https://www.sitepounce.com/api/stripe-webhook` (the apex
  redirects and Stripe doesn't follow redirects).
- **The `mk_...` on the Stripe keys page is the key ID, not the key.** Reveal the key to get
  the real `sk_live_...` value.
- **Refund != cancel.** Do both to fully stop a customer.
