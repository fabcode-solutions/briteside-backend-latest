# Payout Architecture: Current State → Target State

Backend engineering reference for integrating the payout/reserve architecture described in `paymentsnew.pdf` (a 21-day, three-bucket creator ledger with a 15%/85% reserve split, a scheduled 1st/15th bank sweep, an accelerated Day-7 payout option, and dispute clawback) into this codebase.

**Status: not implemented.** Every section below states what exists today, what the doc wants, and exactly where the gap is. This is a reference for planning the build, not a description of shipped behavior.

---

## 1. Current state

### 1.1 How a seller/talent/organizer gets paid today

There is **no per-creator ledger**. Every payable transaction (a shop order, a custom offer, a milestone, a video session, a tip, a priority message) tracks its own `reserveAmountCents` on its own row. A single daily cron, `src/cron/reserveRelease.js` (runs at 01:00, wired in `src/cron/cronJobs.js`), transfers **100% of the seller's net cut, once, in one lump**, directly to their Stripe Connect account balance via `stripe.transfers.create()` (`transferReserve()`, `reserveRelease.js:53-78`). There's no "Pending / Available / Reserve" concept anywhere — the wallet UI (`WalletTransactions.tsx` → `/talent/me/wallet/transactions` → `StripeConnectService.listDetailedTransactions`) reads a live list of past Stripe transfers, and `getWallet` reads Stripe's own `balance.available`/`balance.pending` directly. Nothing in this app decides when money becomes "available" — Stripe's balance object already reflects that.

### 1.2 Current hold windows (flat, single-release, per flow)

| Flow | Constant | Value | Clock starts at |
|---|---|---|---|
| 1:1 Video sessions + tips | `SESSION_RESERVE_HOLD_HOURS` (`reserveRelease.js:26`) | 168h (7 days) | `billingEndedAt` |
| Event tickets (organizer's 15% cut only — see below) | `EVENT_RESERVE_HOLD_DAYS` (`:30`) | 2 days | event `endDate` (or immediately if the event was cancelled) |
| Shop orders | `SHOP_ORDER_RESERVE_HOLD_HOURS` (`:35`) | 168h | order `paidAt` |
| Priority messages | `PRIORITY_MESSAGE_RESERVE_HOLD_HOURS` (`:39`) | 48h | message `repliedAt` |
| Shop Custom Offers (deposit/remainder) | `CUSTOM_OFFER_RESERVE_HOLD_HOURS` (`:51`) | 168h | `deliveredAt` |
| Shop Offer Milestones | `MILESTONE_RELEASE_HOLD_MS` (`services/shop/shopCustomOffer.service.js:46`) | 7 days | buyer's milestone approval |

None of these are 21 days. None split a transaction 15%/85%.

### 1.3 The one place a 15% figure already exists

Event tickets are the sole exception to "100% held, then released once": they use a Stripe **destination charge** with `transfer_data.destination` set at charge time, so the organizer is paid **85% immediately**, and only a 15% slice is held back as a true reserve (`payment.service.js:351`, rate from `getReserveRate()` in `stripeConnect.service.js:14,26-37`, default `DEFAULT_RESERVE_RATE = 0.15`, admin-overridable via the `payout_reserve_rate` system setting). That reserve releases in one lump 2 days after the event ends — not 21, and not into a ledger, just a second transfer. **This is structurally the closest thing to the doc's model, but only for one flow, with different math and timing, and it's a lump-sum release, not a three-tier clearing schedule.**

### 1.4 The critical fact that constrains everything else

Connect accounts are created in `stripeConnect.service.js:54-75` with **no `settings.payouts.schedule` at all**:

```js
const account = await stripe.accounts.create({
  country,
  controller: {
    losses: { payments: 'application' },
    fees: { payer: 'application' },
    stripe_dashboard: { type: 'express' },
    requirement_collection: 'stripe',
  },
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
});
```

No code anywhere in `src/` sets a payout `interval` or `delay_days` on a connected account (confirmed — no matches for `settings.payouts` outside this file). That means **Stripe's own default automatic payout schedule is already active and uncontrolled by this app** for every connected account. The moment `reserveRelease.js` transfers money into a creator's Connect balance, Stripe pays it out to their bank on its own schedule — today, that's roughly the next business day for most US Express accounts.

**This is the single most important fact for planning the new architecture.** A per-creator Pending/Available/Reserve ledger with a fixed 1st/15th sweep is meaningless if Stripe keeps auto-draining the Connect balance the moment money lands in it. Every connected account must be switched to `interval: "manual"` (new accounts at creation, existing accounts via a one-time `stripe.accounts.update()` migration) **before** any bucket/timeline logic is built, or the two systems will race each other.

### 1.5 What already exists that the new build should reuse

- **Manual cashout**, already built and working: `requestCashout()` in `talentEarnings.service.js:333-384` (organizer equivalent in `organizerEarnings.service.js:333+`, group in `groupPayouts`/`group.route.js:254`). It validates the amount, calls `stripe.payouts.create()` on the connected account (`stripeConnect.service.js:908-932`), and falls back to a `'manual'`-status DB row if Stripe payouts aren't enabled yet. Its only floor today is **$1.00** (`talentEarnings.service.js:335`), not the doc's $25–50.
- **Payout record tables**, already shaped close to what's needed: `talent_payouts` / `organizer_payouts` / `group_payouts` (`src/db/schema/stripeConnect.js:66-158`). All three share: `amountCents`, `status` (`'pending'|'approved'|'paid'|'rejected'|'failed'`, plus `'held'` on organizer payouts), `type` (`'standard'|'instant'|'manual'` — already anticipates an instant-payout type), `stripePayoutId`, `stripeTransferId`, `adminNote`. None currently have a fee/net-amount column or a direct connected-account-id column (resolved via `userId` → `stripe_connect_accounts.stripeAccountId`).
- **Idempotent transfer pattern**: `transferReserve()` (`reserveRelease.js:53-78`) uses a per-batch `idempotencyKey` and decrements `reserveAmountCents` by the exact amount released (not a blind overwrite), so a late-arriving tip after an earlier release can't be lost. Any new bucket-clearing logic should follow this same decrement-not-overwrite pattern.

---

## 2. Target architecture (per `paymentsnew.pdf`)

- A **per-creator ledger** with three running balances: Pending, Available, Reserve (15% of each transaction).
- **Day 7**: creator may manually pull the 85% non-reserve portion early, for a 5% fee, instantly to a debit card on file.
- **Day 14**: if not pulled early, the 85% clears to Available for free.
- **Day 21**: the 15% Reserve clears to Available regardless.
- **1st and 15th of each month**: the platform sweeps whatever is in Available (above a $25–50 floor) to the creator's bank via standard ACH (2-3 business days). Balances below the floor roll to the next cycle.
- **On-demand manual withdrawal**: creator can pull their current Available balance any time, free, standard ACH — separate from the scheduled sweep.
- **Auto/Manual toggle**: enabled (automatic sweep) by default, per-creator switch to accumulate manually instead.
- **Dispute offset**: a chargeback after an early 85% payout must pull from the still-held 15% Reserve first, and freeze the creator's other pending transactions until the resulting negative balance is resolved.

---

## 3. Stripe platform constraints (verified against live Stripe docs, not just this codebase)

These affect *how* the target architecture gets built, not *whether* it can be:

- **1st/15th as a native Stripe schedule**: the classic `interval: "monthly"` payout setting historically supported only a single anchor day. The current **Balance Settings API** supports `monthly_payout_days` as an *array* (e.g. `[1, 15]`), which would let Stripe itself handle the twice-monthly sweep natively — confirm this account/API version actually exposes it before relying on it (`docs.stripe.com/connect/manage-payout-schedule`); if not available, fall back to an app-owned cron calling `stripe.payouts.create()` directly on those two calendar dates (the same primitive `requestCashout` already uses).
- **The manual/auto toggle is nearly free**: `interval: "manual"` is a first-class Stripe account setting (and a hard prerequisite for Instant Payouts — see below), so "toggle to manual" is mostly "set this one field on the Connect account," not new business logic.
- **Day-7 accelerated payout = Stripe's real Instant Payouts product**, with real constraints the doc doesn't mention:
  - Stripe charges the **platform** 1% of every instant payout. A 5% creator-facing fee nets against that (recommended: collect it via an **Application Fee** on the payout — atomic, so a creator can never be paid more than they have, and reversible; reads amount from the *expanded* `balance.instant_available.net_available` field, not the plain available balance).
  - Requires **full-TOS onboarding** and **explicit debit-card collection**, which this app doesn't do today — Connect accounts only request `card_payments`/`transfers` capabilities; no external-account/debit-card flow exists anywhere in the codebase (`user_payout_methods` only supports `'bank_transfer'|'paypal'`).
  - **Country-gated** (US, UK, EU, Canada, Australia, and a short list of others only).
  - Subject to a **platform-wide daily dollar cap on instant payouts**, shared across every connected account, resetting at midnight US Central — plan for creators occasionally being blocked on high-volume days, not "always available."
  - (`docs.stripe.com/connect/instant-payouts`)
- **Dispute clawback does not work the way the doc assumes.** For this app's charge pattern (charge lands on the platform's own balance, seller's cut moves later via a separate untagged `stripe.transfers.create()` call — Stripe calls this "separate charges and transfers"), **Stripe debits every dispute from the platform's balance automatically, never the connected account's.** There is no automatic "claw it back from the creator" behavior. To recover money already transferred to a creator, the platform must explicitly call a **transfer reversal** in response to a `charge.dispute.created` webhook — **which this app does not currently listen for anywhere** (`webhook.controller.js` handles `checkout.session.*`, `charge.refunded`, subscription/invoice events, and `account.updated`; every other event type is logged as unhandled).
  - A transfer reversal requires knowing **which specific Transfer paid for the disputed charge.** Today, only `shop_offer_milestones` records that link 1:1 (`stripePaymentIntentId` at `db/schema/shop.js:657` **and** `transferId` at `:664`, both populated by `reserveRelease.js:525`). Every other flow either has no transfer-id column at all (Shop Orders), aggregates several charges — deposit + remainder + tips — into one transfer with no per-charge record (Custom Offers), or has a `transferId` column that exists but is never written by the release cron (Video Sessions, Session Tips, Priority Messages). **This is the single biggest blocker to automatic, precise dispute handling** — everything except milestones needs either a transfer↔charge link table or a move to one-transfer-per-charge before automatic reversal is safe to build.
  - (`docs.stripe.com/connect/disputes`)

---

## 4. Schema additions needed

1. **A per-creator ledger table** (new) — one row per creator (talent/organizer/group), holding `pendingCents`, `availableCents`, `reserveCents`, and a `payoutSchedule` (`'auto'|'manual'`) column for the toggle.
2. **An append-only ledger-entries table** (new) — every credit/bucket-transition as its own row (source transaction, amount, which bucket it entered/left, when), so balances are always reconstructable and auditable rather than trusted as a mutable running total. Mirror the decrement-not-overwrite discipline already used in `reserveRelease.js`.
3. **Extend `talent_payouts` / `organizer_payouts` / `group_payouts`** (`db/schema/stripeConnect.js:66-158`) with a fee/net-amount column (needed for the Day-7 5% fee) — `type` already anticipates `'instant'`, reuse it rather than adding a new enum.
4. **Transfer↔charge linkage** for the four flows that lack it (see §3) — required before Phase 4 (dispute handling) can do anything beyond milestones.

---

## 5. Recommended phased rollout

This is a recommendation for planning purposes, not a decision already made — flag rollout scope (all flows at once vs. incremental) and dispute-handling scope (admin-mediated vs. full automatic reversal) explicitly before building, since both are real product/risk decisions.

1. **Phase 0 — Foundation, no user-visible change.** Pin `interval: "manual"` on account creation and migrate existing accounts via `stripe.accounts.update()`. Build the ledger + ledger-entries tables. Nothing changes for creators yet.
2. **Phase 1 — New reserve timeline.** Replace the flat single-release hold with the 15%/85%, Day-14/Day-21 split, one flow at a time (suggest starting with Shop Orders — no milestone/tip complexity — before extending to the other four). This is a real payout-timing change for sellers and should be communicated as one.
3. **Phase 2 — Scheduled sweep + manual withdrawal + toggle.** New cron for the 1st/15th sweep (native `monthly_payout_days` if available, else app-driven); manual on-demand withdrawal reuses `requestCashout`'s existing `stripe.payouts.create()` call, adapted to debit the ledger's `availableCents` instead of the current live-Stripe-balance computation; toggle just flips `payoutSchedule` on the ledger row.
4. **Phase 3 — Day-7 accelerated payout.** Debit-card onboarding + collection, Instant Payouts integration via Application Fee, ship last given the constraints in §3 (country gating, daily cap, TOS requirements).
5. **Phase 4 — Dispute handling.** Add the `charge.dispute.created` webhook. At minimum: decrement the creator's ledger Reserve immediately (pure app-side bookkeeping, safe regardless of Stripe transfer-linkage state) and freeze their other pending bucket transitions. Automatic Stripe-side transfer reversal should start scoped to Milestones only (the one flow with real linkage today) and stay admin-mediated for the other four flows until a link table (or one-transfer-per-charge) exists.

---

## 6. Open questions to resolve before building

- Roll out to all 5 flows simultaneously, or incrementally starting with Shop Orders?
- Should the wallet UI switch to the new ledger's numbers as soon as a flow migrates, or run the ledger silently first and compare it against today's live Stripe-balance numbers before creators ever see it?
- Is admin-mediated dispute handling acceptable long-term for Shop Orders / Custom Offers / Sessions / Priority Messages, or does the business want automatic reversal everywhere — which requires committing to one-transfer-per-charge (a bigger structural change to how `reserveRelease.js` batches payments)?
