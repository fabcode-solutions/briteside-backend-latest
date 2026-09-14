# Subscription API Reference

## Base URL
```
https://your-api-domain.com/api
```

## Authentication
All protected endpoints require a JWT bearer token:
```
Authorization: Bearer <token>
```

---

## Platform Subscriptions (Britoside Plus)

### Get Plans
```
GET /subscriptions/plans
Auth: Not required
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Pro",
      "description": "...",
      "price": "9.99",
      "currency": "usd",
      "interval": "month",
      "stripePriceId": "price_xxx",
      "isActive": true,
      "displayOrder": 1,
      "features": [
        {
          "id": "uuid",
          "featureKey": "priority_messages",
          "featureLabel": "Priority Messages"
        }
      ]
    }
  ]
}
```

---

### Create Checkout Session
```
POST /subscriptions/checkout
Auth: Required
```

**Request Body**
```json
{
  "planId": "uuid",
  "successUrl": "https://yourapp.com/success",
  "cancelUrl": "https://yourapp.com/cancel"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_xxx",
    "url": "https://checkout.stripe.com/..."
  }
}
```

> Redirect the user to `data.url`. Stripe handles payment. A webhook fires on completion to activate the subscription.

---

### Open Billing Portal
```
POST /subscriptions/portal
Auth: Required
```

**Request Body**
```json
{
  "returnUrl": "https://yourapp.com/settings/billing"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "url": "https://billing.stripe.com/..."
  }
}
```

> Redirect the user to `data.url` to manage payment methods, invoices, and cancel.

---

### Get My Subscription
```
GET /subscriptions/me
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "planId": "uuid",
    "status": "active",
    "cancelAtPeriodEnd": false,
    "currentPeriodStart": "2026-04-01T00:00:00Z",
    "currentPeriodEnd": "2026-05-01T00:00:00Z",
    "canceledAt": null,
    "plan": {
      "name": "Pro",
      "price": "9.99",
      "interval": "month",
      "features": [
        { "featureKey": "priority_messages", "featureLabel": "Priority Messages" }
      ]
    }
  }
}
```

> Returns `data: null` if the user has no active subscription.

---

### Get Subscription History
```
GET /subscriptions/me/history
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "status": "canceled",
      "currentPeriodStart": "2026-01-01T00:00:00Z",
      "currentPeriodEnd": "2026-02-01T00:00:00Z",
      "plan": { "name": "Pro", "price": "9.99" }
    }
  ]
}
```

---

### Cancel Subscription
```
POST /subscriptions/me/cancel
Auth: Required
Body: none
```

**Response**
```json
{
  "success": true,
  "message": "Subscription will cancel at end of billing period",
  "data": {
    "id": "uuid",
    "status": "active",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2026-05-01T00:00:00Z"
  }
}
```

> Subscription stays `active` until `currentPeriodEnd`. Access is not removed immediately.

---

### Get My Group Subscriptions
```
GET /subscriptions/my-groups
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "groupId": "uuid",
      "tierId": "uuid",
      "status": "active",
      "cancelAtPeriodEnd": false,
      "currentPeriodEnd": "2026-06-01T00:00:00Z",
      "tier": {
        "name": "VIP",
        "price": "4.99",
        "billingInterval": "monthly"
      }
    }
  ]
}
```

---

## Group Subscriptions

### List Group Tiers
```
GET /groups/:groupId/subscription/tiers
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "VIP",
      "description": "...",
      "price": "4.99",
      "billingInterval": "monthly",
      "features": ["Exclusive content", "Early access"],
      "maxMembers": 100,
      "isActive": true
    }
  ]
}
```

---

### Create Group Checkout Session
```
POST /groups/:groupId/subscription/checkout
Auth: Required
```

**Request Body**
```json
{
  "tierId": "uuid",
  "successUrl": "https://yourapp.com/groups/:groupId?success=true",
  "cancelUrl": "https://yourapp.com/groups/:groupId"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_xxx",
    "url": "https://checkout.stripe.com/..."
  }
}
```

> A 5% platform fee is applied if the organizer has a Stripe Connect account. Redirect user to `data.url`.

---

### Get My Group Subscription
```
GET /groups/:groupId/subscription/me
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "active",
    "cancelAtPeriodEnd": false,
    "currentPeriodEnd": "2026-06-01T00:00:00Z",
    "tier": { "name": "VIP", "price": "4.99" }
  }
}
```

---

### Cancel Group Subscription
```
POST /groups/:groupId/subscription/cancel
Auth: Required
Body: none
```

**Response**
```json
{
  "success": true,
  "message": "Subscription will cancel at end of billing period",
  "data": { "cancelAtPeriodEnd": true }
}
```

---

### Refund Group Subscription
```
POST /groups/:groupId/subscription/refund
Auth: Required
Body: none
```

**Response**
```json
{
  "success": true,
  "message": "Subscription refunded successfully",
  "data": {
    "refundId": "re_xxx",
    "refundStatus": "succeeded",
    "refundAmount": 499
  }
}
```

> Immediately cancels the subscription, issues a full refund, and removes the user from the group.

---

### Check Refund Eligibility
```
GET /groups/:groupId/subscription/me/refund
Auth: Required
```

**Response**
```json
{
  "success": true,
  "data": {
    "eligible": true
  }
}
```

---

### Open Group Billing Portal
```
POST /groups/:groupId/subscription/portal
Auth: Required
```

**Request Body**
```json
{
  "returnUrl": "https://yourapp.com/groups/:groupId"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "url": "https://billing.stripe.com/..."
  }
}
```

---

## Subscription Status Values

| Status | Meaning | Grant Access? |
|--------|---------|---------------|
| `active` | Paid and active | ✅ Yes |
| `trialing` | In free trial | ✅ Yes |
| `comped` | Admin-granted free access | ✅ Yes |
| `past_due` | Payment failed, Stripe retrying | ⚠️ Usually yes |
| `canceled` | Canceled by user or admin | ❌ No |
| `expired` | Period ended, not renewed | ❌ No |
| `incomplete` | Checkout not completed | ❌ No |

**Scheduled cancellation:** `status === "active"` AND `cancelAtPeriodEnd === true`  
→ Show a banner — access remains until `currentPeriodEnd`.

---

## Frontend Integration Flows

### Flow 1: User Subscribes to Platform Plan

```
1. Fetch & display plans
   GET /subscriptions/plans

2. User picks a plan → create checkout session
   POST /subscriptions/checkout
   { planId, successUrl, cancelUrl }

3. Redirect user to data.url (Stripe-hosted checkout)

4. Stripe processes payment → webhook activates subscription in DB automatically

5. User lands on successUrl → poll/fetch current subscription
   GET /subscriptions/me

6. Show subscription details / gated features
```

---

### Flow 2: User Manages Billing

```
1. User goes to billing settings
   GET /subscriptions/me   ← display plan, status, next billing date

2. User clicks "Manage Billing"
   POST /subscriptions/portal  { returnUrl }
   → redirect to data.url

3. User updates card or views invoices on Stripe portal, returns to returnUrl
```

---

### Flow 3: User Cancels Platform Subscription

```
1. User clicks "Cancel Subscription"
   POST /subscriptions/me/cancel

2. Response has cancelAtPeriodEnd: true, currentPeriodEnd: "..."
   → Show: "Your plan is active until <date>"

3. On/after currentPeriodEnd, GET /subscriptions/me returns null
   → Show upgrade prompt
```

---

### Flow 4: User Joins a Paid Group

```
1. Fetch group tiers
   GET /groups/:groupId/subscription/tiers

2. User picks a tier → create checkout session
   POST /groups/:groupId/subscription/checkout
   { tierId, successUrl, cancelUrl }

3. Redirect to data.url

4. Stripe processes → webhook adds user to group automatically

5. User returns to successUrl → verify membership
   GET /groups/:groupId/subscription/me
```

---

### Flow 5: User Refunds Group Subscription

```
1. Check eligibility
   GET /groups/:groupId/subscription/me/refund
   { eligible: true }

2. User confirms → submit refund
   POST /groups/:groupId/subscription/refund

3. User is removed from group, refund issued to original payment method
```

---

## Error Responses

All errors follow this shape:

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

| HTTP Code | Scenario |
|-----------|---------|
| `400` | Validation error / user already subscribed |
| `401` | Missing or invalid token |
| `403` | Not authorized (e.g. not group creator) |
| `404` | Plan / subscription not found |
| `409` | Conflict (e.g. active subscription already exists) |
| `500` | Internal server error |
