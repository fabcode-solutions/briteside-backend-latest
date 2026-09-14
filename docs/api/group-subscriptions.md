# Group Subscriptions API

**Base path:** `/api/v1/groups`
**Auth:** All endpoints require `Authorization: Bearer <token>` unless marked **Public**.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Tier Management](#tier-management-group-creator-only)
  - [List Tiers](#get-groupidsubscriptiontiers)
  - [Create Tier](#post-groupidsubscriptiontiers)
  - [Update Tier](#put-groupidsubscriptiontierstierid)
  - [Deactivate Tier](#delete-groupidsubscriptiontierstierid)
- [User Subscriptions](#user-subscription-management)
  - [Get My Subscription](#get-groupidsubscriptionme)
  - [Checkout](#post-groupidsubscriptioncheckout)
  - [Cancel](#post-groupidsubscriptioncancel)
  - [Refund](#post-groupidsubscriptionrefund)
  - [Customer Portal](#post-groupidsubscriptionportal)
- [Revenue Analytics](#revenue-analytics)
- [Frontend Integration Flows](#frontend-integration-flows)
- [Email Triggers](#email-triggers)
- [Error Shape](#error-shape)

---

## How It Works

```
GROUP CREATOR FLOW
──────────────────
Create private group
  └─▶ POST /subscription/tiers         (creates Stripe Product + Price automatically)
  └─▶ PUT  /subscription/tiers/:id     (price change → new Stripe Price + fee-change emails)
  └─▶ DELETE /subscription/tiers/:id   (archives Stripe Price, hides from new subscribers)

USER SUBSCRIPTION FLOW
──────────────────────
Visit private group page (isPublic=false, isPaid=true)
  └─▶ GET  /subscription/tiers         (show available plans)
  └─▶ POST /subscription/checkout      (get Stripe Checkout URL)
  └─▶ Redirect user → Stripe processes payment
  └─▶ Webhook fires automatically:
        • User added to groupMembers
        • Discussion notifications subscribed
        • Welcome email sent
  └─▶ GET  /subscription/me            (confirm status === "active")

USER SELF-SERVICE
─────────────────
GET  /subscription/me      → check current status + period end date
POST /subscription/cancel  → cancel at period end (access continues until then)
POST /subscription/refund  → immediate cancel + refund latest invoice + removed from group
POST /subscription/portal  → Stripe Customer Portal (update card, view invoices)

CREATOR REVENUE VIEW
─────────────────────
GET /:groupId/analytics/revenue → MRR, tier breakdown, churn rate, platform fee totals
```

---

## Tier Management (Group Creator Only)

### `GET /:groupId/subscription/tiers`

List all active tiers for a group.

**Access:** Public — no auth required.

**Response `200`**

```json
{
  "success": true,
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "groupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Member",
      "description": "Access to all discussions and events",
      "price": "9.99",
      "billingInterval": "monthly",
      "features": "Discussions, Events, Early access",
      "maxMembers": null,
      "isActive": true,
      "stripeProductId": "prod_xxx",
      "stripePriceId": "price_xxx",
      "createdAt": "2026-04-14T00:00:00.000Z",
      "updatedAt": "2026-04-14T00:00:00.000Z"
    }
  ]
}
```

---

### `POST /:groupId/subscription/tiers`

Create a subscription tier. Automatically creates a Stripe Product + Price.

**Access:** Group creator only.

**Request Body**

```json
{
  "name": "Member",
  "description": "Access to all discussions and events",
  "price": "9.99",
  "billingInterval": "monthly",
  "features": "Discussions, Events, Early access",
  "maxMembers": 100
}
```

| Field             | Type                      | Required | Notes                                |
| ----------------- | ------------------------- | -------- | ------------------------------------ |
| `name`            | string                    | ✅       | Max 100 chars                        |
| `price`           | string                    | ✅       | USD amount e.g. `"9.99"`             |
| `billingInterval` | `"monthly"` \| `"yearly"` | ❌       | Default: `"monthly"`                 |
| `description`     | string                    | ❌       | Max 500 chars                        |
| `features`        | string                    | ❌       | Comma-separated list, max 1000 chars |
| `maxMembers`      | number                    | ❌       | `null` = unlimited                   |

**Response `201`**

```json
{
  "success": true,
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "groupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Member",
    "description": "Access to all discussions and events",
    "price": "9.99",
    "billingInterval": "monthly",
    "features": "Discussions, Events, Early access",
    "maxMembers": null,
    "isActive": true,
    "stripeProductId": "prod_xxx",
    "stripePriceId": "price_xxx",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  }
}
```

**Errors**
| Status | Message |
|---|---|
| `400` | `"Subscription tiers can only be created for private groups."` |
| `403` | `"Only the group creator can manage subscription tiers."` |
| `404` | `"Group not found"` |

---

### `PUT /:groupId/subscription/tiers/:tierId`

Update a tier's metadata or price. All fields are optional.

**Access:** Group creator only.

> **Important:** If `price` changes, the old Stripe Price is archived and a new one is created. A fee-change email is automatically sent to all active subscribers before their next billing date. No extra action needed from the frontend.

**Request Body**

```json
{
  "name": "Premium Member",
  "description": "Updated description",
  "price": "14.99",
  "billingInterval": "monthly",
  "features": "Discussions, Events, Early access, 1:1 sessions",
  "maxMembers": 50
}
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Premium Member",
    "description": "Updated description",
    "price": "14.99",
    "billingInterval": "monthly",
    "features": "Discussions, Events, Early access, 1:1 sessions",
    "maxMembers": 50,
    "isActive": true,
    "stripePriceId": "price_yyy",
    "updatedAt": "2026-04-14T12:00:00.000Z"
  }
}
```

**Errors**
| Status | Message |
|---|---|
| `403` | `"Only the group creator can update tiers."` |
| `404` | `"Tier not found"` |

---

### `DELETE /:groupId/subscription/tiers/:tierId`

Deactivate a tier. Archives the Stripe Price and sets `isActive = false`.
Existing active subscribers are **not affected** — they continue until their subscription ends naturally.

**Access:** Group creator only.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "isActive": false,
    "updatedAt": "2026-04-14T12:00:00.000Z"
  }
}
```

**Errors**
| Status | Message |
|---|---|
| `403` | `"Only the group creator can deactivate tiers."` |
| `404` | `"Tier not found"` |

---

## User Subscription Management

### `GET /:groupId/subscription/me`

Get the current user's subscription for a specific group.

Use this to determine what UI to show:

| `data` value              | UI to show                                     |
| ------------------------- | ---------------------------------------------- |
| `null`                    | Subscribe CTA                                  |
| `status: "active"`        | Group content, manage subscription options     |
| `status: "trialing"`      | Group content, trial badge                     |
| `status: "past_due"`      | Warning banner: "Update your payment method"   |
| `cancelAtPeriodEnd: true` | Info banner: "Cancelled — access until {date}" |

**Response `200` — subscribed**

```json
{
  "success": true,
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "groupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "tierId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "active",
    "stripeSubscriptionId": "sub_xxx",
    "currentPeriodStart": "2026-04-01T00:00:00.000Z",
    "currentPeriodEnd": "2026-05-01T00:00:00.000Z",
    "cancelAtPeriodEnd": false,
    "platformFeePercent": "10.00",
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-04-01T00:00:00.000Z",
    "tier": {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Member",
      "price": "9.99",
      "billingInterval": "monthly",
      "features": "Discussions, Events, Early access",
      "isActive": true
    }
  }
}
```

**Response `200` — not subscribed**

```json
{
  "success": true,
  "data": null
}
```

**Subscription status values**

| Value       | Meaning                                |
| ----------- | -------------------------------------- |
| `active`    | Payment current                        |
| `trialing`  | In trial period                        |
| `past_due`  | Payment failed, in Stripe retry window |
| `cancelled` | Subscription ended                     |

---

### `POST /:groupId/subscription/checkout`

Create a Stripe Checkout Session. Redirect the user to the returned `url`.

**Request Body**

```json
{
  "tierId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "successUrl": "https://yourapp.com/groups/my-group?subscribed=true",
  "cancelUrl": "https://yourapp.com/groups/my-group"
}
```

| Field        | Type       | Required |
| ------------ | ---------- | -------- |
| `tierId`     | uuid       | ✅       |
| `successUrl` | URL string | ✅       |
| `cancelUrl`  | URL string | ✅       |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "sessionId": "cs_test_xxx",
    "url": "https://checkout.stripe.com/pay/cs_test_xxx"
  }
}
```

> **Frontend:** `window.location.href = data.url` — do not open in an iframe.
> After Stripe redirects to `successUrl`, call `GET /subscription/me` to confirm `status === "active"`. The webhook is fast; it normally resolves within 1–2 seconds.

**Errors**
| Status | Message |
|---|---|
| `400` | `"This group does not require a subscription"` (public group) |
| `404` | `"Subscription tier not found or inactive"` |
| `409` | `"You already have an active subscription for this group"` |

---

### `POST /:groupId/subscription/cancel`

Cancel the subscription at the end of the current billing period.
The user retains full access until `currentPeriodEnd`. A cancellation confirmation email is sent automatically.

**Request Body:** none

**Response `200`**

```json
{
  "success": true,
  "data": {
    "cancelled": true,
    "accessUntil": "2026-05-01T00:00:00.000Z"
  }
}
```

> Show `accessUntil` in the UI: _"You'll have access until May 1, 2026."_

**Errors**
| Status | Message |
|---|---|
| `404` | `"No active subscription found for this group"` |

---

### `POST /:groupId/subscription/refund`

Immediately cancel the subscription and refund the latest invoice payment.
The user is removed from the group at the moment the request succeeds.

**Request Body:** none

**Response `200`**

```json
{
  "success": true,
  "data": {
    "refunded": true
  }
}
```

> After this call `GET /subscription/me` returns `null`. Redirect the user away from the group page.

**Errors**
| Status | Message |
|---|---|
| `404` | `"No active subscription found for this group"` |

---

### `POST /:groupId/subscription/portal`

Open the Stripe Customer Portal. Lets users update their payment method, download invoices, and manage their subscription directly through Stripe's hosted UI.

**Request Body**

```json
{
  "returnUrl": "https://yourapp.com/groups/my-group"
}
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "url": "https://billing.stripe.com/session/xxx"
  }
}
```

> **Frontend:** `window.location.href = data.url`

---

## Revenue Analytics

### `GET /:groupId/analytics/revenue`

**Access:** Group admin or moderator only.

**Query Parameters** — all optional

| Param       | Type     | Example      |
| ----------- | -------- | ------------ |
| `startDate` | ISO date | `2026-04-01` |
| `endDate`   | ISO date | `2026-04-30` |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "monthlyRecurringRevenue": 649.5,
    "totalRevenue": 499.5,
    "previousPeriodRevenue": 359.5,
    "payingMembersCount": 50,
    "totalMembersCount": 50,
    "averageRevenuePerMember": 9.99,
    "platformFeeTotal": 64.95,
    "tierBreakdown": [
      {
        "tierId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "tierName": "Member",
        "price": 9.99,
        "billingInterval": "monthly",
        "subscriberCount": 40,
        "mrr": 399.6
      },
      {
        "tierId": "4ab96g75-6828-5673-c4gd-3d074g77bgb7",
        "tierName": "Premium",
        "price": 24.99,
        "billingInterval": "monthly",
        "subscriberCount": 10,
        "mrr": 249.9
      }
    ],
    "newSubscribersInPeriod": 12,
    "cancellationsInPeriod": 2,
    "churnRate": 3.85,
    "revenueByPeriod": [
      { "date": "2026-04-01", "newSubscribers": 5 },
      { "date": "2026-04-07", "newSubscribers": 3 },
      { "date": "2026-04-14", "newSubscribers": 4 }
    ]
  }
}
```

**Field descriptions**

| Field                     | Description                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `monthlyRecurringRevenue` | Total MRR across all active tiers. Annual plans are divided by 12.                                                       |
| `totalRevenue`            | Sum of all subscription prices within the selected period.                                                               |
| `previousPeriodRevenue`   | Same calculation for the equivalent prior period. Only present when both `startDate` and `endDate` are provided.         |
| `platformFeeTotal`        | MRR × platform fee % (recorded at subscription time). This is for display/accounting only — no Stripe Transfer involved. |
| `tierBreakdown`           | Per-tier subscriber count and MRR.                                                                                       |
| `churnRate`               | `cancellations / (active + cancellations) × 100` for the selected period.                                                |
| `revenueByPeriod`         | Daily new subscriber counts grouped by date.                                                                             |

**Errors**
| Status | Message |
|---|---|
| `403` | `"Unauthorized to view revenue analytics."` |
| `403` | `"Revenue analytics are only available for paid groups."` |
| `404` | `"Group not found."` |

---

## Frontend Integration Flows

### Flow A — User visits a private paid group page

```
1. Fetch group data
   Check: group.isPublic === false && group.isPaid === true

2. GET /:groupId/subscription/me
   ├── data === null
   │     → Show "Subscribe to Join" button
   ├── data.status === "active" && data.cancelAtPeriodEnd === false
   │     → Show group content + "Manage Subscription" button
   ├── data.status === "active" && data.cancelAtPeriodEnd === true
   │     → Show group content + banner: "Subscription cancelled — access until {currentPeriodEnd}"
   ├── data.status === "trialing"
   │     → Show group content + "Trial active" badge
   └── data.status === "past_due"
         → Show group content + warning: "Payment failed — update your payment method"

3. User clicks "Subscribe to Join"
   GET /:groupId/subscription/tiers
   → Render pricing cards

4. User selects a tier → click "Subscribe"
   POST /:groupId/subscription/checkout
   Body: { tierId, successUrl, cancelUrl }
   → window.location.href = data.url

5. Stripe redirects back to successUrl
   GET /:groupId/subscription/me  (poll once or on page load)
   → data.status === "active" → show group content
```

---

### Flow B — User cancels their subscription

```
1. User is on "Manage Subscription" page
   GET /:groupId/subscription/me
   → Display: tier name, price/interval, next billing date (currentPeriodEnd)

2. User clicks "Cancel Subscription"
   POST /:groupId/subscription/cancel
   → Show: "Cancelled. You have access until {data.accessUntil}"

3. Reload GET /subscription/me
   → data.cancelAtPeriodEnd === true
   → Show banner with access end date
```

---

### Flow C — User requests a refund

```
1. User on subscription page → clicks "Request Refund"
   (Apply your own policy check on the frontend, e.g. within 7 days of subscription)

2. POST /:groupId/subscription/refund
   → data.refunded === true

3. User is immediately removed from the group
   → Refund issued to their card (1–5 business days to appear)
   → Redirect user away from group page
   → Show: "Your refund has been processed."
```

---

### Flow D — Group creator manages tiers

```
1. Creator on group settings → "Subscription" tab
   GET /:groupId/subscription/tiers
   → Render list of tiers

2. Create tier
   POST /:groupId/subscription/tiers
   Body: { name, price, billingInterval, description, features, maxMembers }
   → 201 response with new tier

3. Edit tier
   PUT /:groupId/subscription/tiers/:tierId
   → If price changed: all active subscribers get a fee-change email automatically
   → No additional frontend action needed

4. Deactivate tier
   DELETE /:groupId/subscription/tiers/:tierId
   → Tier hidden from new checkouts
   → Existing subscribers unaffected until next renewal
```

---

### Flow E — User updates payment method

```
1. User clicks "Update Payment Method" (or sees past_due warning)
2. POST /:groupId/subscription/portal
   Body: { returnUrl: "https://yourapp.com/groups/my-group" }
   → window.location.href = data.url

3. User updates card in Stripe's hosted portal
4. Stripe redirects back to returnUrl
5. Reload GET /subscription/me → status should be "active"
```

---

## Email Triggers

These are sent automatically by the server. No frontend action required.

| Trigger                                              | Email sent to                                     |
| ---------------------------------------------------- | ------------------------------------------------- |
| User completes Stripe checkout (webhook)             | Subscriber — paid group welcome                   |
| Group creator updates tier price                     | All active subscribers — fee change notice        |
| `POST /cancel` called                                | Subscriber — membership cancellation confirmation |
| Stripe fires `subscription.deleted` (period ends)    | Subscriber — membership ended confirmation        |
| Stripe fires `invoice.payment_failed`                | Subscriber — payment failed with retry info       |
| User invited to group                                | Invitee — group invitation                        |
| Admin manually approves join request on a paid group | Approved user — paid group welcome                |

---

## Error Shape

All error responses follow this format:

```json
{
  "success": false,
  "message": "Human readable error message",
  "statusCode": 400
}
```

**Common status codes**

| Code  | Meaning                                      |
| ----- | -------------------------------------------- |
| `400` | Bad request / validation failure             |
| `401` | Missing or invalid auth token                |
| `403` | Forbidden — insufficient role or permissions |
| `404` | Resource not found                           |
| `409` | Conflict — e.g. already subscribed           |
| `503` | Stripe not configured on the server          |
