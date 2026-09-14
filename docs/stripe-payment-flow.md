# Gokyro — Stripe Payment Flow Reference

> Source truth: `src/services/payment.service.js`, `refund.service.js`, `stripeConnect.service.js`,
> `talentSession.service.js`, `priorityMessage.service.js`, `cron/reserveRelease.js`

---

## Architecture: Stripe Connect (Destination Charges)

Gokyro uses **Stripe Connect with destination charges**.

- Platform owns the Stripe account (the "platform account").
- Organizers / Talents own connected accounts (`acct_xxx`), onboarded via Connect.
- Every charge is created on the **platform account** with `transfer_data.destination` → connected account.
- `application_fee_amount` stays on the platform; the remainder is transferred to the connected account.
- Because `fees.payer = application` and `losses.payments = application`, **Stripe fees and dispute losses hit the platform balance**, not the connected account.

---

## 1. Event Ticket Purchase

### Fee Components

| Variable | Formula | What it is |
|---|---|---|
| `totalCents` | sum of line items (fee-inclusive) | What Stripe charges customer |
| `baseCents` | `order.totalAmount` | Original ticket price before platform fee |
| `platformFeeCents` | `totalCents − baseCents` | Platform fee added on top of ticket price |
| `platformShareCents` | `platformFeeCents × 50%` | Platform's permanent keep |
| `organizerGrossCents` | `totalCents − platformShareCents` | Organizer's gross before reserve & Stripe fee |
| `reserveAmountCents` | `organizerGrossCents × reserveRate` | Held for disputes (default 15%, admin-editable) |
| `estimatedStripeFeeCents` | `round(totalCents × 2.9%) + 30` | Stripe processing fee estimate |
| **`application_fee_amount`** | `platformShare + reserve + estimatedStripeFee` | Total kept by platform at checkout |

### Concrete Example (10% platform fee, $100 ticket)

```
Customer pays:            $110.00   (totalCents)
  Base ticket price:      $100.00   (baseCents)
  Platform fee (10%):      $10.00   (platformFeeCents)

application_fee_amount breakdown:
  → platformShareCents:     $5.00   (50% of $10 fee — platform permanent)
  → reserveAmountCents:    $15.75   (15% of $105 organizer gross — held 5 days)
  → estimatedStripeFee:     $3.49   (2.9% × $110 + $0.30 — estimate)
  ─────────────────────────────────
  application_fee_amount:  $24.24

Stripe transfers to organizer account immediately:
  $110.00 − $24.24 =       $85.76
```

### Who earns what

| Party | Amount | When | Notes |
|---|---|---|---|
| **Stripe** | ~$3.49 | At charge | Real fee from `balance_transaction.fee`. Webhook overwrites estimate. |
| **Platform (permanent)** | $5.00 | At charge | `platformShareCents`. Never returned. |
| **Platform (reserve held)** | $15.75 | At charge | Held in platform Stripe balance. Released to organizer after dispute window. |
| **Organizer (immediate)** | $85.76 | At charge | Transferred to connected account. |
| **Organizer (reserve release)** | +$15.75 | +5 days post-event | `stripe.transfers.create` from platform → connected account. |
| **Organizer total** | **$101.51** | | $85.76 + $15.75 |
| **Platform net** | **$5.00** | | $24.24 − $3.49 (Stripe) − $15.75 (reserve released) = $5.00 |

### Stripe API call (simplified)

```js
// payment.service.js — createCheckoutSession
stripe.checkout.sessions.create({
  payment_intent_data: {
    application_fee_amount: 2424,   // cents
    transfer_data: { destination: 'acct_organizer' },
  },
  // ...line_items, success_url, etc.
});
```

---

## 2. Talent Session Booking

Source: `talentSession.service.js` line ~930

```
// Fee structure (Stripe fee fully borne by talent — platform breaks even on Stripe):
//   application_fee = chargedCents − talentReceive  (= platformRevenue + stripeEstimate)
```

- No reserve held (`reserveAmountCents: 0`).
- `applicationFeeCents = platformRevenue + estimatedStripeFeeCents`
- Talent receives: `chargedCents − applicationFeeCents`

### Example ($50 session, 20% platform commission)

```
Customer pays:              $50.00
Stripe fee estimate:         $1.75   (2.9% × $50 + $0.30)
Platform commission (20%):  $10.00
application_fee:            $11.75

Talent receives:            $38.25   ($50 − $11.75)
Platform net:               $10.00   ($11.75 − $1.75 Stripe)
```

No reserve window. Talent can request payout immediately from Stripe balance.

---

## 3. Priority Message

Source: `priorityMessage.service.js` lines 177–184

```js
const stripeFeeCents = Math.round(chargedCents * 0.029) + 30;
const platformCommissionCents = Math.round(baseCents * 0.05);  // 5%
const applicationFeeCents = stripeFeeCents + platformCommissionCents;
// Talent receives: baseCents − platformCommission
```

### Example ($20 priority message)

```
Customer pays (gross-up so Stripe fee is fully covered):  ~$20.92
Stripe fee:                                                  $0.92
Platform commission (5% of $20):                             $1.00
application_fee:                                             $1.92

Talent receives:                                            $19.00
Platform net:                                                $1.00
```

No reserve. No transfer window.

---

## 4. Door Sales

Source: `doorSales.service.js`

- Plain Stripe Checkout session — **no `application_fee_amount`**, no Connect.
- All revenue lands in the platform Stripe account directly.
- Organizer payout is handled manually / outside Stripe Connect.

---

## 5. Refunds

Source: `refund.service.js`

### Eligibility checks

| Check | Logic |
|---|---|
| `isEventRefundable` | `event.isRefundable === true` |
| `isWithinRefundWindow` | `now <= event.startDate − refundCutoffDays` (default 3 days) |
| Ticket used | `ticket.isUsed === true` OR `ticket.scanCount > 0` → NOT refundable |

### Refund amount formula (user-initiated)

Platform does NOT return 100% of the charge. Customer gets back a reduced amount:

```js
// refund.service.js lines 312-314
refundAmount = grossRefundAmount
             - platformFeeAmount * 0.5      // platform keeps 50% of platform fee
             - stripeFeeDollars * refundRatio // platform keeps Stripe processing fee
```

Code comment: `$350 base, 10% fee=$35, stripe fee=$5 → refund = $385 - $17.50 - $5 = $362.50`

### Stripe refund call (user-initiated)

```js
stripe.refunds.create({
  payment_intent: order.paymentIntentId,
  amount: Math.round(refundAmount * 100), // reduced amount, NOT the full charge
  reverse_transfer: true,                 // organizer's account bears the cost
  refund_application_fee: false,          // platform KEEPS its application_fee
});
```

### What happens on a user-initiated full-order refund

Example: $100 base ticket, 10% platform fee, $3.49 actual Stripe fee.

```
Customer paid:                $110.00

Refund amount calculation:
  grossRefundAmount:          $110.00
  − platformFeeAmount × 50%:   -$5.00   (platform keeps 50% of $10 fee)
  − stripeFeeDollars:           -$3.49   (platform keeps Stripe processing fee)
  ──────────────────────────────────
  Customer receives back:     $101.51   ← ACTUAL REFUND (not the full $110)

reverse_transfer:true   → organizer's $85.76 reversed back to platform
refund_application_fee:false → platform keeps $24.24 application_fee

Platform cash position:
  application_fee kept:      +$24.24
  reverse transfer in:       +$85.76   (organizer net clawed back)
  customer refunded out:    -$101.51
  Stripe fee (already paid):  -$3.49   (not returned by Stripe)
  reserve released (+5 days): -$15.75  (cron releases to organizer even on refunded orders)
  ──────────────────────────────────
  Platform net:                 $5.00  (= platformShareCents — always)
```

> **Key policy:** Customer loses 50% of the platform fee + the Stripe processing fee on refund.
> Platform always nets `platformShareCents`. Organizer bears 100% of the refund cost via
> `reverse_transfer: true`.

### Event cancellation refunds (organizer cancels event)

Different — no `amount:` passed to Stripe = **Stripe refunds the full $110 to customer**.

```js
// issueEventCancellationRefunds — amount omitted = full refund
stripe.refunds.create({
  payment_intent: order.paymentIntentId,
  // no amount → Stripe refunds $110.00 in full
  reverse_transfer: true,
  refund_application_fee: false,
});
```

```
Customer receives back:    $110.00   (FULL — no fee deduction on cancellation)
Organizer account debited:  $85.76   (reverse_transfer)
Platform keeps:             $24.24   (application_fee)
Stripe fee (already paid):  -$3.49   (not returned)
Reserve released (+5 days): -$15.75  (cron still runs)
──────────────────────────────────
Platform net:                 $5.00
```

Customer made whole; organizer bears the entire cancellation cost.

---

## 6. Reserve System

Source: `cron/reserveRelease.js`

### Hold periods

| Type | Hold | Trigger |
|---|---|---|
| Event order | 5 days | After event `endDate` |
| Talent session | 5 days | After session scheduled time |

### Release mechanic

```js
// reserveRelease.js
stripe.transfers.create({
  amount: totalReserveCents,
  currency: 'usd',
  destination: stripeAccountId,  // organizer/talent connected account
}, { idempotencyKey: `reserve-order-${eventId}` });
```

- Idempotency key prevents double-release.
- Reserve is released for both `status = 'paid'` AND `status = 'refunded'` orders.
  - Rationale: dispute window closed → reserve purpose fulfilled.
- Recorded in `orders.reserveReleasedAt`.

---

## 7. Disputes / Chargebacks

- `fees.payer = application` → **Stripe fees hit platform balance**.
- `losses.payments = application` → **Dispute losses hit platform balance**, NOT connected account.
- Reserve is the buffer — held 5 days to absorb disputes before organizer receives it.
- `getTransactionSummary` in `stripeConnect.service.js` fetches disputes via platform key, computes `chargebacksCents`.

---

## 8. Payouts to Organizer / Talent

```js
// stripeConnect.service.js — requestPayout
stripe.payouts.create(
  { amount: amountCents, currency: 'usd', method: 'instant' | 'standard' },
  { stripeAccount: record.stripeAccountId }
);
```

| Method | Speed | Fee |
|---|---|---|
| Standard | 2–5 business days | None |
| Instant | Minutes | ~1.5% (Stripe, deducted from connected account) |

---

## Summary: Money Flow at a Glance

```
CUSTOMER ($110)
    │
    ▼
STRIPE (collects charge)
    │
    ├─► Stripe keeps: ~$3.49 processing fee  [non-refundable on refunds]
    │
    └─► Platform Stripe account receives application_fee: $24.24
            ├─► platformShare:      $5.00   [permanent]
            ├─► reserve:           $15.75   [held 5 days → released to organizer]
            └─► stripeFeeEstimate:  $3.49   [used to cover Stripe above]

    └─► Transfer to organizer connected account: $85.76  [immediate]

+5 days after event:
    Platform → Organizer: $15.75 reserve release

FINAL SPLIT (no refund):
  Stripe:    $3.49
  Platform:  $5.00   (platformShareCents — permanent)
  Organizer: $101.51 ($85.76 immediate + $15.75 reserve)
  ─────────────────
  Total:     $110.00 ✓

USER-INITIATED REFUND (customer requests refund):
  Customer gets back:  $101.51  (gross $110 − 50% platform fee $5 − stripe fee $3.49)
  Organizer:           -$85.76  (reverse_transfer claws back their net)
  Platform keeps:       $5.00   (platformShareCents) + $3.49 (stripe fee) = $8.49 total
  Reserve released:    +$15.75  (paid to organizer by cron after 5 days)
  Platform net:         $5.00   (always — $8.49 kept − $3.49 Stripe)
  ──────────────────────────────
  Customer loss:        $8.49   (fees non-refundable on user-requested refunds)

EVENT CANCELLATION REFUND (organizer cancels):
  Customer gets back:  $110.00  (full — no deduction, organizer's fault)
  Organizer:           -$85.76  (reverse_transfer)
  Platform:             $5.00   (application_fee kept, reserve still released)
  Stripe:               $3.49   (processing fee — lost, not returned)
  ─────────────────────────────
  Net:                  $0.00 ✓ (customer whole; organizer bears full loss)
```

---

## Config / Tunables

| Setting | Default | Location |
|---|---|---|
| `platformFeePercentage` | per-event | `events.platformFeePercentage` |
| `reserveRate` | 15% (0.15) | `systemSettings.payout_reserve_rate` (admin-editable) |
| Reserve hold — orders | 5 days | `cron/reserveRelease.js` `EVENT_RESERVE_HOLD_DAYS` |
| Reserve hold — sessions | 5 days | `cron/reserveRelease.js` `SESSION_RESERVE_HOLD_DAYS` |
| Platform share ratio | 50% | `payment.service.js` hardcoded |
| Refund cutoff | 3 days | `event.refundCutoffDays` (per-event) |
| Priority message commission | 5% | `priorityMessage.service.js` hardcoded |


Here's the complete money flow from payment to refund:

Step 1: Customer pays $110
Customer's bank account: -$110.00
         ↓
    Stripe receives: $110.00
Step 2: Stripe processes payment & distributes funds
Stripe holds: $110.00

Stripe takes processing fee: -$3.49
Stripe balance: $106.51

Platform takes application_fee: -$5.00
Platform balance: $5.00

Remaining for organizer: $101.51
But $15.75 held in reserve initially
Immediate distribution:

Organizer receives: $85.76 (payout to their bank)
Reserve held by Stripe: $15.75
Platform balance: $5.00
Stripe keeps: $3.49
Step 3: Reserve releases (+5 days)
Reserve: $15.75
         ↓
Organizer receives: $15.75 (additional payout)

Organizer total received: $85.76 + $15.75 = $101.51
Step 4: Customer requests refund
Your code executes:

stripe.refunds.create({
  payment_intent: order.paymentIntentId,
  amount: 10151, // $101.51 in cents
  reverse_transfer: true,
  refund_application_fee: false
});
Step 5: Stripe processes refund
reverse_transfer: true means:

Organizer's Stripe balance: -$101.51
         ↓
    Stripe receives: $101.51 (pulled back from organizer)
         ↓
    Customer's bank: +$101.51
If organizer already received payouts:

Organizer's bank had: $101.51 total
Stripe debits organizer's account: -$101.51
(Creates negative balance or pulls from next payments)
refund_application_fee: false means:

Platform's $5.00 → NOT touched, platform keeps it
Stripe's processing fee:

Stripe's $3.49 → NOT refunded, Stripe keeps it
Final money positions
Customer:
  Paid: -$110.00
  Refunded: +$101.51
  Net: -$8.49 ❌ LOSS

Organizer:
  Received: +$101.51
  Reversed: -$101.51
  Net: $0.00 ⚖️ BREAK EVEN

Platform:
  Application fee kept: +$5.00
  Net: +$5.00 ✅ PROFIT

Stripe:
  Processing fee kept: +$3.49
  Net: +$3.49 ✅ PROFIT
Key mechanism: reverse_transfer
This is the critical parameter. It means:

WITHOUT reverse_transfer:

Platform would pay the refund from their own balance
Organizer keeps their $101.51
WITH reverse_transfer: true:

Stripe claws back $101.51 from the organizer's account
Platform pays nothing for the refund
Organizer's money is used to refund the customer
The $8.49 gap
Customer paid: $110.00
Customer refunded: $101.51
Missing: $8.49

Where did it go?
  Platform kept: $5.00
  Stripe kept: $3.49
  Total: $8.49 ✓
The customer loses exactly the amount that Platform + Stripe keep as fees.
