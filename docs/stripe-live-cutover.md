# Stripe Live Cutover — Test Data Removal Plan

**Status:** Plan / not yet executed
**Context:** The project currently runs against Stripe Account A in **test mode**. It is moving to Stripe Account B in **live mode** so the client can take real payments.

> Companion doc: `docs/stripe-payment-flow.md` describes how payments work in steady state. This doc covers only the one-time account cutover.

---

## 1. Why nothing can be "transferred"

Two independent facts, either one on its own is enough:

1. **Stripe objects are account-scoped.** A `cus_`, `sub_`, `pi_`, `cs_`, `prod_`, `price_`, `acct_`, `po_`, `tr_` or `re_` created on Account A does not exist on Account B. Calling Account B's key with an Account A ID returns `resource_missing`. There is no API and no dashboard action that moves them.
2. **Test mode and live mode are separate namespaces even inside one account.** Going test → live *always* starts from an empty data set. This would be true even if we stayed on Account A.

Stripe does operate a real migration service (`data-migrations@stripe.com`), but it is **live-mode only**, covers **only customers and saved payment methods**, requires written consent from both accounts, and takes weeks. It does not apply here.

**Conclusion:** every Stripe ID currently in the database is a test artifact that was always going to be dead on launch day. Nothing of value is lost by removing it.

---

## 2. What gets DELETED

Run in this order — the ordering is required by foreign keys, see §2.2.

### Transactions and orders

| Table | Note |
|---|---|
| `orders` | cascades → `order_items`, `refunds` |
| `guest_orders` | |
| `shop_orders` | cascades → `shop_refund_requests` |
| `talent_sessions` | paid bookings |
| `talent_issues` | disputes against test payments |
| `priority_message_payments` | + `priority_message_items` |
| `group_course_enrollments` | |
| `user_spends` | spend analytics fed by test charges |

### Subscriptions

| Table | Note |
|---|---|
| `user_subscriptions` | must be deleted **before** `subscription_plans` |
| `subscription_plans` | cascades → `subscription_features`. Deleted, not nulled — see §4.3 |
| `group_subscriptions` | |
| `subscription_audit_logs` | audit trail of test subscriptions |

### Payouts

| Table | Note |
|---|---|
| `talent_payouts` | |
| `organizer_payouts` | |
| `group_payouts` | |

### Stripe mapping tables

These two hold `NOT NULL UNIQUE` Stripe IDs. There is no valid "keep the row, blank the ID" state — they must be deleted.

| Table | Column |
|---|---|
| `stripe_customers` | `stripe_customer_id` — `britesidePlus.js:27` |
| `stripe_connect_accounts` | `stripe_account_id` — `stripeConnect.js:25` |

### Orphans created by the above

`order_items.purchased_ticket_id` and `purchased_merchandise_id` are plain UUIDs with **no foreign key**. `purchased_tickets` and `purchased_merchandise` cascade from `events`, not from `orders`. Deleting orders therefore leaves live, scannable test tickets behind.

| Table | Note |
|---|---|
| `purchased_tickets` | otherwise a test QR code still validates at a real event |
| `purchased_merchandise` | same |
| `event_attendees` | `order_id` is `ON DELETE SET NULL`, so rows **survive** the order delete and stay `registered` / `checked_in` on real events. Delete them too. |

`guest_orders` needs no companion entries — `guest_order_items` and `guest_purchased_tickets` both cascade from it.

### 2.1 Cascade collateral — content that disappears with the payment data

These are not Stripe rows, but they are cascade-deleted by the §2 deletes. Verify this is acceptable before running.

| Cascades away | Trigger | Impact |
|---|---|---|
| `talent_reviews` | `talent_sessions` delete — `talentReviews.js:64` is `onDelete: 'cascade'` | **All talent reviews and ratings are destroyed**, including anything from `scripts/seed-sophia-reviews.js`. Talent profiles lose their review history entirely. |

Set to null rather than deleted (rows survive, links break — acceptable):

| Table | Column | Rule |
|---|---|---|
| `event_reviews` | `ticket_id` → `purchased_tickets` | `set null` — event reviews survive, orphaned from their ticket |
| `talent_gift_codes` | `redeemed_session_id` → `talent_sessions` | `set null` — code stays `redeemed`, so it cannot be reused |
| `event_attendees` | `order_id` → `orders` | `set null` — see above, delete these rows explicitly |

### 2.2 FK ordering constraint

`user_subscriptions.plan_id` references `subscription_plans.id` with **no `onDelete`**, so it defaults to `NO ACTION`. Deleting plans first fails. Correct order:

```
user_subscriptions  →  subscription_audit_logs  →  subscription_plans
```

---

## 3. What gets NULLED / RESET (rows kept)

### 3.1 Catalog IDs — blocks live selling if missed

If these keep test IDs, the code reuses dead `prod_`/`price_` values and live checkout fails.

| Table | Columns |
|---|---|
| `group_subscription_tiers` | `stripe_product_id`, `stripe_price_id` |
| `group_courses` | `stripe_product_id`, `stripe_price_id` |

### 3.2 Connect pointer

| Table | Column |
|---|---|
| `organizers` | `stripe_account_id` → `NULL` |

### 3.3 Stored aggregates — the easiest thing to miss

These are denormalised counters maintained by the service layer, not computed from rows. Deleting the underlying rows does **not** update them, so each one is left asserting a number with nothing behind it.

| Table | Column | Left alone it shows |
|---|---|---|
| `event_tickets` | `quantity_sold` | fewer tickets available than actually exist |
| `talent_profiles` | `rating`, `review_count` | e.g. "4.8 ★ (12 reviews)" with zero reviews in the table — `talent_reviews` was cascaded away by §2.1 |
| `organizers` | `rating` | a rating with no reviews behind it |

```sql
UPDATE event_tickets  SET quantity_sold = 0;
UPDATE talent_profiles SET rating = '0.00', review_count = 0;
UPDATE organizers      SET rating = '0';
```

---

## 4. Impact analysis

### 4.1 What breaks if we DON'T clean up

| Left behind | Consequence |
|---|---|
| `stripe_connect_accounts` rows | **Sellers can never onboard.** `StripeConnectService.createAccount` throws `409 Stripe Connect account already exists for this user` when a row is present. The stale row permanently blocks live onboarding. |
| `stripe_connect_accounts.charges_enabled = true` | UI reports sellers as ready to trade. Shop checkout, talent bookings and the Connect banner all gate on this flag. Buyers hit failures at payment. |
| Dead `acct_` IDs | `syncStatus`, `getDashboardLink` and `getBalance` call `stripe.accounts.retrieve` / `createLoginLink` / `balance.retrieve` with **no `resource_missing` handling** → unhandled 500s. |
| `user_subscriptions.status = 'active'` | Test subs never renew and never expire. Those users keep BriteSide Plus **free forever**. |
| Test order rows | Earnings are computed on the fly from these rows (`organizerEarnings.service.js`, `groupEarnings.controller.js`). The client's dashboard opens showing fake revenue. |
| Payout rows | Cashed-out totals are derived from them, so users appear to have already withdrawn money they never earned. |
| Catalog `price_` IDs | Live checkout fails on `resource_missing`. |
| `purchased_tickets` | Test QR codes still scan as valid at real events. |
| `event_tickets.quantity_sold` | Real inventory understated. |

### 4.2 What is deliberately NOT touched

| Item | Reason |
|---|---|
| `users.providerAccountId` | Google/Facebook OAuth, not Stripe. Matches a naive `%account_id%` sweep — do not clear. |
| `user_payout_methods` | Our own AES-encrypted bank/PayPal records, not Stripe-scoped. Likely test entries, but a separate decision from this cutover. |
| `shop_products`, `group_courses` content, events, lessons, order snapshots | Content, not payment state. Only the Stripe columns on those rows are stale. |

### 4.3 Why `subscription_plans` is deleted rather than nulled

`scripts/seed-subscription-plans.js:35-39` bails out entirely if **any** row exists in `subscription_plans`:

```js
const existing = await db.query.subscriptionPlans.findMany();
if (existing.length > 0) {
  console.log('Subscription plans already exist, skipping seed');
  return;
}
```

Nulling the Stripe columns would leave plans that the seed refuses to repopulate and that have no live price behind them. The table must be empty for the seed to recreate plans with live Stripe products and prices.

### 4.4 Data loss accepted

All test transaction history, test subscription history, and the subscription audit trail are permanently removed. This is intended — none of it corresponds to real money.

---

## 5. How new IDs are created on the live account

Most of this is automatic. Broken down by object type:

### 5.1 Customer IDs — fully automatic, already self-healing

`SubscriptionService.getOrCreateStripeCustomer` (`subscription.service.js:371`) already handles a dead ID gracefully:

```js
const existing = await db.query.stripeCustomers.findFirst({
  where: eq(stripeCustomers.userId, userId),
});

if (existing) {
  try {
    await stripe.customers.retrieve(existing.stripeCustomerId);
    return existing.stripeCustomerId;
  } catch (err) {
    if (err?.statusCode === 404 || err?.code === 'resource_missing') {
      // Stale record — delete it and fall through to create a fresh customer
      await db.delete(stripeCustomers).where(eq(stripeCustomers.userId, userId));
    } else {
      throw err;
    }
  }
}

const customer = await stripe.customers.create({
  email: user.email,
  name: customerName,
  metadata: { userId },
});

await db.insert(stripeCustomers).values({ userId, stripeCustomerId: customer.id, ... });
```

**No backfill or migration script is needed.** On the new account every stored ID returns `resource_missing`, the stale row is dropped, and a fresh `cus_` is created lazily on that user's first payment action. Users are never prompted and notice nothing.

Deleting `stripe_customers` up front is therefore optional — it only saves one wasted Stripe round-trip per user. It is included in §2 for cleanliness.

### 5.2 Connect account IDs — automatic once rows are deleted

`sweepMissingConnectAccounts` (`cron/connectAccountSweep.js`) finds every talent and organizer with no `stripe_connect_accounts` row and creates one, then prefills known profile data so hosted onboarding only asks for `currently_due` fields:

```js
const account = await StripeConnectService.createAccount(t.userId);
await StripeConnectService.prefillAccount(account.stripeAccountId, { ... });
```

So once the stale rows are deleted, the cron recreates all `acct_` objects on the new platform automatically, with per-item `try/catch` so one failure doesn't stop the sweep.

**Two warnings:**

- **Connect must be approved in live mode before this cron runs.** Live mode requires a completed platform profile and Stripe review — this is a separate application from test mode and has real lead time. If the cron runs before approval, it fails for every talent and organizer and floods the logs.
- **Account creation is not onboarding.** The cron creates the account object; each seller must still complete hosted onboarding personally with real identity documents and bank details. `charges_enabled` / `payouts_enabled` stay `false` until each one clears KYC, and the code correctly blocks selling until then. Plan a staggered onboarding window before the client's first real sale.

### 5.3 Products and prices — mixed

| Source | Behaviour |
|---|---|
| `subscription_plans` | Re-run `scripts/seed-subscription-plans.js` against live. Requires the table to be empty (§4.3). Creates Stripe product + price via `SubscriptionService.createPlan`. |
| `group_subscription_tiers` | Recreated lazily by `groupSubscription.service.js` on next tier create/update, once the columns are null. |
| `group_courses` | Recreated lazily by `groupCourse.service.js` on next course create/update, once the columns are null. |

No hardcoded `price_` or `prod_` IDs exist anywhere in `src/` — verified.

### 5.4 Nothing to recreate

Payment intents, checkout sessions, charges, refunds, transfers and payouts are created naturally by real customer activity. There is no backfill.

---

## 6. Cutover order

Sequencing matters — several steps have external lead time.

1. **Start now:** activate Account B (business details, bank account, tax ID). Live keys don't work until activation completes.
2. **Start now:** apply for **Connect in live mode** on Account B. Longest lead time in the whole cutover.
3. Register both webhook endpoints on Account B in live mode:
   - `/webhook/stripe` — `webhook.route.js:8`
   - `/webhook` (priority messages) — `priorityMessage.route.js:29`

   Events on the main endpoint:

   ```
   checkout.session.completed                customer.subscription.created
   checkout.session.async_payment_succeeded  customer.subscription.updated
   checkout.session.expired                  customer.subscription.deleted
   charge.refunded                           invoice.paid
   account.updated                           invoice.payment_failed
   ```

   > **`account.updated` is a connected-account event.** Tick **"Listen to events on Connected accounts"** when creating the endpoint. Miss it and Connect onboarding status silently never syncs — the most common Connect go-live failure.

4. Configure on Account B: enabled payment methods, statement descriptor, receipt emails, Radar rules, Apple/Google Pay domain verification if used.
5. **Stop the API.** Steps 6–9 must all happen with the server down. The crons run
   in-process via node-cron, so stopping the server is what disables them — there is
   no separate scheduler.

   > **This is the step that is easy to skip and expensive to skip.** `connectAccountSweep`
   > runs every 6 hours (`cronJobs.js:109`) and recreates a Connect account for every
   > talent and organizer missing a `stripe_connect_accounts` row. Run the cleanup while
   > the old test keys are still live and the sweep refills the table with a fresh batch
   > of dead test-account IDs, silently undoing §2. Swap keys but leave the API up and
   > live traffic hits dead IDs: `resource_missing` at checkout, 500s from `getBalance`
   > and `syncStatus`.

6. Put live `sk_` / `pk_` / `whsec_` into AWS Secrets Manager.
   > Production must have **no** `STRIPE_SECRET_KEY_LOCAL` or `STRIPE_WEBHOOK_SECRET_LOCAL` set. `config.js:74,77` gives those precedence, so a stray override silently points live traffic at test.
7. Update the publishable key in the web app.
8. **Run the cleanup migration.** Snapshot the database first.

   ```
   npm run stripe:cutover          # verify — row counts + FK impact, changes nothing
   npm run stripe:cutover:apply    # execute
   ```

9. Re-seed the plans against live:

   ```
   npm run seed:subscriptions:prod
   ```

   > **Both of these must run with `NODE_ENV=production`, which is why they exist as npm
   > scripts** (via `cross-env`, so the syntax works in PowerShell and bash alike).
   > `loadSecrets()` deliberately skips DB credentials unless `NODE_ENV=production`
   > (`secrets.js:55-57`) so local `.env` values survive in dev — which means running the
   > bare `node scripts/...` form silently targets **localhost, not RDS**. It connects,
   > finds the schema, and reports success against the wrong database. Always check the
   > `Target DB host:` line the cutover script prints before trusting a run.
   >
   > `npm run seed:subscriptions` (no `:prod`) is the local-DB variant and is left as-is.
10. **Start the API** — only once Connect is approved in live mode (step 2). If it is not,
    the sweep fails for every talent and organizer on its first run.
11. Let `sweepMissingConnectAccounts` run — verify accounts appear on the new platform.
12. Invite sellers to complete live onboarding.
13. Smoke test: one real low-value purchase end to end, confirm webhook delivery, confirm the transfer lands on the connected account, then refund it.

### Development environments

Use **Account B's test mode** for dev, not Account A. Then test and live share the same Connect configuration and product structure. Keeping Account A for dev guarantees the two environments drift apart.

---

## 7. Verification

### Before running — count what will be destroyed

```sql
SELECT 'orders' AS t, count(*) FROM orders
UNION ALL SELECT 'guest_orders', count(*) FROM guest_orders
UNION ALL SELECT 'shop_orders', count(*) FROM shop_orders
UNION ALL SELECT 'talent_sessions', count(*) FROM talent_sessions
UNION ALL SELECT 'talent_issues', count(*) FROM talent_issues
UNION ALL SELECT 'priority_message_payments', count(*) FROM priority_message_payments
UNION ALL SELECT 'group_course_enrollments', count(*) FROM group_course_enrollments
UNION ALL SELECT 'user_spends', count(*) FROM user_spends
UNION ALL SELECT 'user_subscriptions', count(*) FROM user_subscriptions
UNION ALL SELECT 'group_subscriptions', count(*) FROM group_subscriptions
UNION ALL SELECT 'subscription_plans', count(*) FROM subscription_plans
UNION ALL SELECT 'talent_payouts', count(*) FROM talent_payouts
UNION ALL SELECT 'organizer_payouts', count(*) FROM organizer_payouts
UNION ALL SELECT 'group_payouts', count(*) FROM group_payouts
UNION ALL SELECT 'stripe_customers', count(*) FROM stripe_customers
UNION ALL SELECT 'stripe_connect_accounts', count(*) FROM stripe_connect_accounts
UNION ALL SELECT 'purchased_tickets', count(*) FROM purchased_tickets
UNION ALL SELECT 'purchased_merchandise', count(*) FROM purchased_merchandise
ORDER BY 1;
```

### After running — must all return 0

```sql
SELECT count(*) FROM stripe_customers;
SELECT count(*) FROM stripe_connect_accounts;
SELECT count(*) FROM organizers WHERE stripe_account_id IS NOT NULL;
SELECT count(*) FROM group_subscription_tiers WHERE stripe_price_id IS NOT NULL;
SELECT count(*) FROM group_courses WHERE stripe_price_id IS NOT NULL;
SELECT count(*) FROM subscription_plans;
SELECT count(*) FROM user_subscriptions;
SELECT count(*) FROM event_tickets WHERE quantity_sold <> 0;
```

### Post-cutover sanity

- Organizer earnings dashboard shows zero.
- Talent wallet shows zero.
- No user has active BriteSide Plus except intentional `comped` grants (note: `comped` rows have no Stripe subscription behind them and are independent of this cutover — decide separately whether to keep them).
- A fresh signup can reach Stripe Checkout.

---

## 8. Decisions

Settled:

- [x] **`group_members` is NOT cleared.** Deleting `group_subscriptions` leaves test subscribers as free members of paid groups, because membership is service-managed (`groupSubscription.service.js:674,762`) with no DB cascade. Accepted: the members are test accounts, so free access to a test group has no consequence. Revisit only if any paid group has a real member.
- [x] **`comped` subscriptions are not preserved.** All of `user_subscriptions` is deleted. Same rationale — the grants are test grants.

Still open:

- [ ] **`talent_reviews` cascade (§2.1)** — confirm losing all talent reviews and ratings is acceptable. This is the only content loss in the plan that isn't payment data.
- [ ] **`user_payout_methods`** — keep or clear (§4.2).
- [ ] **Backup** — take a database snapshot before step 7. This is irreversible.
