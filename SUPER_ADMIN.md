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
