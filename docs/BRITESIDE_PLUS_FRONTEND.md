# BriteSide Plus — Frontend Integration Guide

## How It Works

```
User subscribes → isBritesidePlus = true (stored on user row)
Admin adds feature key to plan → feature gated routes unlock for subscribers
Frontend reads user.isBritesidePlus → show/hide UI gates
```

- **No extra API call** to check subscription — `user.isBritesidePlus` is on every auth'd user object
- **403** on gated route = user needs Plus upgrade
- **Customer routes** (booking, viewing profiles, sending priority messages) — never gated

---

## Feature Keys

| Key | What it unlocks |
|-----|----------------|
| `talent_profile` | Create/manage talent profile, availability, schedule |
| `video_booking` | Receive video booking requests, confirm/decline sessions |
| `priority_messaging` | Read received priority messages in inbox |
| `verified_badge` | Verified badge shown on public profile |

Admin manages which keys are active per plan via the admin API.

---

## Auth Headers

All authenticated routes require:
```
Authorization: Bearer <jwt_token>
```

---

## Base URL

```
/api
```

---

## Subscription Routes

### GET `/subscriptions/plans`
Public. Returns active plans with features.

**Response 200**
```json
{
  "plans": [
    {
      "id": "uuid",
      "name": "BriteSide Plus Monthly",
      "description": "Unlock premium features — billed monthly.",
      "price": "9.99",
      "currency": "usd",
      "interval": "month",
      "isActive": true,
      "displayOrder": 1,
      "features": [
        { "id": "uuid", "featureKey": "talent_profile", "featureLabel": "Talent Profile & Availability" },
        { "id": "uuid", "featureKey": "video_booking", "featureLabel": "Video Booking Sessions" },
        { "id": "uuid", "featureKey": "priority_messaging", "featureLabel": "Priority Messaging" },
        { "id": "uuid", "featureKey": "verified_badge", "featureLabel": "Verified Badge" }
      ]
    },
    {
      "id": "uuid",
      "name": "BriteSide Plus Yearly",
      "price": "99.99",
      "interval": "year",
      "features": ["...same keys..."]
    }
  ]
}
```

---

### POST `/subscriptions/checkout`
Auth required. Creates Stripe Checkout session. Redirect user to `url`.

**Request body**
```json
{
  "planId": "uuid",
  "successUrl": "https://yourapp.com/subscription/success",
  "cancelUrl": "https://yourapp.com/subscription/cancel"
}
```

**Response 200**
```json
{
  "sessionId": "cs_live_xxx",
  "url": "https://checkout.stripe.com/pay/cs_live_xxx"
}
```

Frontend: `window.location.href = data.url`

---

### POST `/subscriptions/portal`
Auth required. Opens Stripe billing portal (manage/cancel subscription).

**Request body**
```json
{
  "returnUrl": "https://yourapp.com/account"
}
```

**Response 200**
```json
{
  "url": "https://billing.stripe.com/session/xxx"
}
```

Frontend: `window.location.href = data.url`

---

### GET `/subscriptions/me`
Auth required. Current user's active subscription.

**Response 200 — active**
```json
{
  "subscription": {
    "id": "uuid",
    "status": "active",
    "cancelAtPeriodEnd": false,
    "currentPeriodStart": "2026-04-01T00:00:00Z",
    "currentPeriodEnd": "2026-05-01T00:00:00Z",
    "plan": {
      "id": "uuid",
      "name": "BriteSide Plus Monthly",
      "price": "9.99",
      "interval": "month",
      "features": [
        { "featureKey": "talent_profile", "featureLabel": "Talent Profile & Availability" },
        { "featureKey": "video_booking", "featureLabel": "Video Booking Sessions" },
        { "featureKey": "priority_messaging", "featureLabel": "Priority Messaging" },
        { "featureKey": "verified_badge", "featureLabel": "Verified Badge" }
      ]
    }
  }
}
```

**Response 200 — no subscription**
```json
{
  "subscription": null
}
```

---

### GET `/subscriptions/me/history`
Auth required. All past and current subscriptions.

**Response 200**
```json
{
  "subscriptions": [
    {
      "id": "uuid",
      "status": "canceled",
      "cancelAtPeriodEnd": false,
      "canceledAt": "2026-03-15T00:00:00Z",
      "currentPeriodEnd": "2026-04-01T00:00:00Z",
      "plan": { "name": "BriteSide Plus Monthly", "price": "9.99", "interval": "month" }
    }
  ]
}
```

---

### POST `/subscriptions/me/cancel`
Auth required. Cancels at period end (or immediately if comped).

**Response 200**
```json
{
  "message": "Subscription will cancel at end of billing period.",
  "subscription": {
    "id": "uuid",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2026-05-01T00:00:00Z"
  }
}
```

---

### GET `/subscriptions/my-groups`
Auth required. All group subscriptions for current user.

**Response 200**
```json
{
  "subscriptions": [
    {
      "id": "uuid",
      "groupId": "uuid",
      "status": "active",
      "currentPeriodEnd": "2026-05-01T00:00:00Z"
    }
  ]
}
```

---

## Gated Route Error

Any gated route returns **403** if user lacks the required feature:

```json
{
  "code": 403,
  "message": "This feature requires an active BriteSide Plus subscription"
}
```

Frontend: catch 403 → redirect to `/upgrade` or show paywall modal.

---

## Talent Routes — Gating Reference

### Talent-side (requires Plus)

| Method | Path | Feature required |
|--------|------|-----------------|
| POST | `/talent/me/profile` | `talent_profile` |
| PUT | `/talent/me/profile` | `talent_profile` |
| GET | `/talent/me/profile` | `talent_profile` |
| PUT | `/talent/me/availability` | `talent_profile` |
| GET | `/talent/me/availability` | `talent_profile` |
| PUT | `/talent/me/schedule` | `talent_profile` |
| GET | `/talent/me/video-requests` | `video_booking` |
| PUT | `/talent/sessions/:id/confirm` | `video_booking` |
| PUT | `/talent/sessions/:id/decline` | `video_booking` |
| GET | `/talent/me/dashboard-stats` | any active Plus |
| GET | `/talent/me/earnings` | any active Plus |
| GET | `/priority-messages/received` | `priority_messaging` |

### Customer-side (auth only, no Plus needed)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/talent/` | Browse talent profiles |
| GET | `/talent/:profileId` | View talent profile |
| GET | `/talent/:profileId/availability` | View availability |
| GET | `/talent/:profileId/slots` | View open slots |
| GET | `/talent/:profileId/reviews` | View reviews |
| POST | `/talent/:profileId/favorite` | Favorite a talent |
| POST | `/talent/sessions/checkout` | Pay to book session |
| POST | `/talent/sessions/book` | Book session |
| GET | `/talent/sessions/:id` | View session details |
| PUT | `/talent/sessions/:id/cancel` | Cancel session |
| POST | `/talent/sessions/:id/join` | Join video session |
| POST | `/talent/sessions/:id/reschedule` | Reschedule |
| POST | `/talent/sessions/:id/review` | Submit review |
| GET | `/talent/sessions/:id/review` | Get review |
| POST | `/priority-messages/` | Send priority message (pay per message) |
| GET | `/priority-messages/:paymentId/status` | Poll payment status |

---

## Priority Messages — Customer Send Flow

```
1. POST /priority-messages/
   body: { talentProfileId, subject, messageContent }
   → { checkoutUrl, paymentId }

2. Redirect to checkoutUrl (Stripe)

3. After redirect back:
   GET /priority-messages/:paymentId/status
   → { status: "paid" | "pending" | "failed" }
```

---

## Admin — Feature Registry

### GET `/admin/subscriptions/features/registry`
Admin auth required. Returns all available feature keys for admin UI.

**Response 200**
```json
{
  "success": true,
  "features": [
    { "key": "talent_profile", "label": "Talent Profile & Availability", "description": "Create and manage talent profile, availability schedule, and onboarding." },
    { "key": "video_booking", "label": "Video Booking Sessions", "description": "Offer video sessions, receive booking requests, confirm or decline." },
    { "key": "priority_messaging", "label": "Priority Messaging", "description": "Receive paid priority messages from customers in your inbox." },
    { "key": "verified_badge", "label": "Verified Badge", "description": "Display a verified badge on your public talent profile." }
  ]
}
```

### POST `/admin/subscriptions/plans/:planId/features`
Add feature to plan (turns on for all subscribers).

**Request body**
```json
{
  "featureKey": "talent_profile",
  "featureLabel": "Talent Profile & Availability"
}
```

**Response 201**
```json
{
  "id": "uuid",
  "planId": "uuid",
  "featureKey": "talent_profile",
  "featureLabel": "Talent Profile & Availability"
}
```

### DELETE `/admin/subscriptions/plans/:planId/features/:featureId`
Remove feature from plan. Returns **204** no content.

---

## Frontend Checklist

- [ ] Read `user.isBritesidePlus` after login — show upgrade CTA if `false`
- [ ] Intercept 403 globally — redirect to upgrade page or show paywall modal
- [ ] `GET /subscriptions/plans` on pricing page
- [ ] `POST /subscriptions/checkout` → redirect to Stripe URL
- [ ] `POST /subscriptions/portal` → redirect to Stripe portal for manage/cancel
- [ ] `GET /subscriptions/me` on account/billing page
- [ ] Hide "Create Talent Profile" button if `!user.isBritesidePlus`
- [ ] Hide "Video Requests" tab if `!user.isBritesidePlus`
- [ ] Hide "Priority Messages" inbox tab if `!user.isBritesidePlus`
- [ ] Customer "Send Priority Message" — always visible, no Plus check needed
- [ ] Customer booking flow — always accessible
