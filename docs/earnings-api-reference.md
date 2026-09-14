# Earnings, Wallet & Stripe Connect — API Reference

> All protected routes require: `Authorization: Bearer <token>`  
> Adjust base prefix to your actual API mount path.

---

## FLOW OVERVIEW

```
1. Stripe Connect Onboarding
   POST  /talent/me/stripe/connect          ← create account
   GET   /talent/me/stripe/connect/link     ← get onboarding URL → redirect user
   (user completes Stripe onboarding on Stripe's hosted page)
   GET   /talent/me/stripe/connect/status   ← poll until chargesEnabled=true

2. Booking creates checkout with 15% reserve held on platform
   POST  /talent/sessions/checkout          ← existing session checkout (now includes reserve)
   POST  /payments/checkout                 ← existing event ticket checkout (now includes reserve)

3. View Earnings (BriteSide Plus subscription required for talent /me/earnings)
   GET   /talent/me/earnings?period=monthly
   GET   /organizer/earnings?period=weekly

4. Wallet & Cashout
   GET   /talent/me/wallet                  ← live Stripe balance + recent payouts
   POST  /talent/me/wallet/cashout          ← request payout
   GET   /talent/me/wallet/payouts          ← full payout history

5. Payout Methods (bank info for manual cashout)
   POST  /talent/me/payout-methods          ← add bank/PayPal
   GET   /talent/me/payout-methods          ← list saved methods
```

---

## TALENT ROUTES

### Stripe Connect

#### `POST /talent/me/stripe/connect`
Create a Stripe Connect v2 account for this user.

**Body:**
```json
{ "country": "US" }
```
`country` optional, defaults to `"US"`.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "stripeAccountId": "acct_xxx",
    "chargesEnabled": false,
    "payoutsEnabled": false,
    "detailsSubmitted": false,
    "country": "US",
    "createdAt": "2026-04-27T00:00:00.000Z"
  }
}
```

---

#### `GET /talent/me/stripe/connect/status`
Sync and return latest Connect account status from Stripe.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "stripeAccountId": "acct_xxx",
    "chargesEnabled": true,
    "payoutsEnabled": true,
    "detailsSubmitted": true,
    "country": "US",
    "updatedAt": "2026-04-27T00:00:00.000Z"
  }
}
```

---

#### `GET /talent/me/stripe/connect/link`
Get a Stripe onboarding link. Redirect user to `data.url`.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "url": "https://connect.stripe.com/setup/...",
    "expiresAt": "2026-04-27T01:00:00.000Z"
  }
}
```

---

#### `GET /talent/me/stripe/connect/dashboard`
Get Stripe Express dashboard login link (lets talent view their Stripe dashboard).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "url": "https://connect.stripe.com/express/..."
  }
}
```

---

### Earnings
> Requires active BriteSide Plus subscription — returns `403` otherwise.

#### `GET /talent/me/earnings`
**Query params:**
| Param | Values | Default |
|-------|--------|---------|
| `period` | `weekly` `monthly` `yearly` `custom` | `monthly` |
| `start` | `YYYY-MM-DD` | required if `custom` |
| `end` | `YYYY-MM-DD` | required if `custom` |

**groupBy auto-logic (for `custom`):**
- ≤ 31 days → `day`
- ≤ 365 days → `week`
- > 365 days → `month`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalEarnings": 450,
      "totalEarningsCents": 45000,
      "videoChatEarnings": 300,
      "videoChatEarningsCents": 30000,
      "messageEarnings": 150,
      "messageEarningsCents": 15000,
      "refunded": 50,
      "refundedCents": 5000
    },
    "chart": [
      {
        "label": "Apr 1",
        "videoEarnings": 100,
        "messageEarnings": 50,
        "pending": 0
      }
    ],
    "period": {
      "type": "monthly",
      "start": "2026-03-28T00:00:00.000Z",
      "end": "2026-04-27T00:00:00.000Z",
      "groupBy": "day"
    }
  }
}
```

---

### Wallet

#### `GET /talent/me/wallet`
Live Stripe balance + 5 most recent payouts.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "availableCents": 28500,
    "pendingCents": 12000,
    "available": 285,
    "pending": 120,
    "currency": "usd",
    "connected": true,
    "recentPayouts": [
      {
        "id": "uuid",
        "amountCents": 10000,
        "amount": 100,
        "status": "paid",
        "type": "standard",
        "stripePayoutId": "po_xxx",
        "processedAt": "2026-04-20T00:00:00.000Z",
        "createdAt": "2026-04-20T00:00:00.000Z"
      }
    ]
  }
}
```
> `connected: false` = no Stripe Connect account yet. Show onboarding CTA instead of balance.

---

#### `POST /talent/me/wallet/cashout`
**Body:**
```json
{
  "amountCents": 10000,
  "type": "standard",
  "payoutMethodId": "uuid-optional"
}
```
- `type`: `"standard"` (2–5 days) or `"instant"`
- `payoutMethodId`: optional link to saved payout method
- If `payoutsEnabled=true` → Stripe payout created immediately → `status: "paid"`
- If not connected → record saved as `status: "pending"` for manual admin processing

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "talentProfileId": "uuid",
    "amountCents": 10000,
    "amount": 100,
    "status": "paid",
    "type": "standard",
    "stripePayoutId": "po_xxx",
    "processedAt": "2026-04-27T00:00:00.000Z",
    "createdAt": "2026-04-27T00:00:00.000Z"
  }
}
```

---

#### `GET /talent/me/wallet/payouts`
Paginated payout history.

**Query:** `?page=1&limit=20`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "amountCents": 10000,
        "amount": 100,
        "status": "paid",
        "type": "standard",
        "stripePayoutId": "po_xxx",
        "adminNote": null,
        "processedAt": "2026-04-27T00:00:00.000Z",
        "createdAt": "2026-04-27T00:00:00.000Z"
      }
    ],
    "page": 1,
    "limit": 20
  }
}
```

---

### Payout Methods

#### `GET /talent/me/payout-methods`
**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "bank",
      "label": "Chase ****1234",
      "last4": "1234",
      "isDefault": true,
      "createdAt": "2026-04-27T00:00:00.000Z"
    }
  ]
}
```

---

#### `POST /talent/me/payout-methods`
**Body:**
```json
{
  "type": "bank",
  "label": "Chase Checking",
  "last4": "1234",
  "fullDetails": {
    "routingNumber": "021000021",
    "accountNumber": "000123456789",
    "accountHolderName": "John Doe"
  }
}
```
`type`: `"bank"` | `"paypal"` | `"venmo"` | `"zelle"`  
`fullDetails` stored encrypted in DB (jsonb) — never returned to client.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "bank",
    "label": "Chase Checking",
    "last4": "1234",
    "isDefault": false,
    "createdAt": "2026-04-27T00:00:00.000Z"
  }
}
```

---

#### `PUT /talent/me/payout-methods/:methodId/default`
**Response `200`:**
```json
{ "success": true, "data": { "id": "uuid", "isDefault": true } }
```

---

#### `DELETE /talent/me/payout-methods/:methodId`
**Response `200`:**
```json
{ "success": true, "message": "Payout method removed" }
```

---

## ORGANIZER ROUTES

All routes under `/organizer` are auth-gated.

### Stripe Connect

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/organizer/stripe/connect` | Create Connect account |
| `GET` | `/organizer/stripe/connect/status` | Sync status |
| `GET` | `/organizer/stripe/connect/link` | Onboarding URL |
| `GET` | `/organizer/stripe/connect/dashboard` | Stripe dashboard link |

Responses identical to talent equivalents above.  
One Stripe Connect account is shared per user — creating it as talent means organizer routes see it too.

---

### Earnings

#### `GET /organizer/earnings`
All events for this organizer, aggregated.

**Query:** `?period=monthly&start=&end=` — same as talent.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "grossRevenue": 5000,
      "grossRevenueCents": 500000,
      "platformFees": 500,
      "platformFeesCents": 50000,
      "refundsChargebacks": 100,
      "refundsChargebacksCents": 10000,
      "netEarnings": 4400,
      "netEarningsCents": 440000,
      "ticketsSold": 48
    },
    "chart": [
      {
        "label": "Apr 1",
        "grossRevenue": 200,
        "platformFees": 20,
        "refunds": 0,
        "netEarnings": 180,
        "ticketsSold": 2
      }
    ],
    "period": {
      "type": "monthly",
      "start": "2026-03-28T00:00:00.000Z",
      "end": "2026-04-27T00:00:00.000Z",
      "groupBy": "day"
    }
  }
}
```

---

#### `GET /organizer/earnings/events/:eventId`
Single event earnings. Same shape + `event` field:

```json
{
  "success": true,
  "data": {
    "event": { "id": "uuid", "title": "Summer Fest" },
    "summary": { "...same fields as above..." },
    "chart": [],
    "period": {}
  }
}
```

---

### Wallet & Payouts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/organizer/wallet` | Live balance + recent payouts |
| `POST` | `/organizer/wallet/cashout` | Request cashout |
| `GET` | `/organizer/wallet/payouts` | Paginated payout history |
| `GET` | `/organizer/payout-methods` | List methods |
| `POST` | `/organizer/payout-methods` | Add method |
| `PUT` | `/organizer/payout-methods/:methodId/default` | Set default |
| `DELETE` | `/organizer/payout-methods/:methodId` | Remove |

Request/response shapes identical to talent wallet/payout endpoints above.

---

## RESERVE SYSTEM

- **15%** of every payment is held on the platform via `application_fee_amount`.
- Remaining **85%** is transferred immediately to the connected account via `transfer_data.destination`.
- After **30 days** with no dispute, the cron (`runReserveRelease`) sends the reserve to the connected account via `stripe.transfers.create`.
- Rate is admin-editable: `system_settings` table, key `payout_reserve_rate` (float, e.g. `0.15`).

---

## ERROR RESPONSES

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400
}
```

| Code | Scenario |
|------|----------|
| `400` | Cashout amount < $1, invalid custom date range |
| `403` | No active BriteSide Plus subscription |
| `404` | No talent/organizer profile |
| `503` | Stripe not configured |

---

## BACKEND SETUP CHECKLIST

- [ ] Migrate: `stripe_connect_accounts`, `user_payout_methods`, `talent_payouts`, `organizer_payouts` tables
- [ ] Migrate: add `reserve_amount_cents INT`, `reserve_released_at TIMESTAMP` to `talent_sessions` and `orders`
- [ ] Insert: `system_settings` row `key='payout_reserve_rate', value='0.15'`
- [ ] Wire: `runReserveRelease()` from `src/cron/reserveRelease.js` into node-cron (run daily)
