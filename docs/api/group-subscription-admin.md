# Group Subscription Admin & User APIs

This document describes the new APIs for group creators to manage member subscriptions, and for users to view all their group subscriptions.

---

## 1. Group Creator: Manage Member Subscriptions

All endpoints require the group creator to be authenticated and will return 403 if the user is not the creator of the group.

### List All Member Subscriptions

**GET** `/api/groups/:groupId/subscription/admin/members`

- **Query Params:**
  - `page` (optional, default: 1)
  - `limit` (optional, default: 20)
  - `status` (optional, filter by subscription status: `active`, `trialing`, `past_due`, etc)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "subscription-uuid",
      "user": {
        "id": "user-uuid",
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com",
        "profileImage": "url-or-null"
      },
      "tier": {
        "id": "tier-uuid",
        "name": "Membership",
        "price": "10.00",
        "billingInterval": "monthly"
      },
      "status": "active",
      "currentPeriodStart": "2024-04-01T00:00:00.000Z",
      "currentPeriodEnd": "2024-05-01T00:00:00.000Z",
      "cancelAtPeriodEnd": false,
      "createdAt": "2024-03-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

### Get a Member's Subscription Detail

**GET** `/api/groups/:groupId/subscription/admin/members/:userId`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "subscription-uuid",
    "user": { ... },
    "tier": { ... },
    "status": "active",
    "currentPeriodStart": "2024-04-01T00:00:00.000Z",
    "currentPeriodEnd": "2024-05-01T00:00:00.000Z",
    "cancelAtPeriodEnd": false,
    "createdAt": "2024-03-01T00:00:00.000Z"
  }
}
```

---

### Cancel a Member's Subscription (at period end)

**POST** `/api/groups/:groupId/subscription/admin/members/:userId/cancel`

**Response:**

```json
{
  "success": true,
  "data": {
    "cancelled": true,
    "accessUntil": "2024-05-01T00:00:00.000Z"
  }
}
```

---

### Refund & Remove a Member's Subscription (immediate)

**POST** `/api/groups/:groupId/subscription/admin/members/:userId/refund`

**Response:**

```json
{
  "success": true,
  "data": {
    "refunded": true
  }
}
```

---

## 2. User: All My Group Subscriptions

**GET** `/api/subscriptions/my-groups`

Returns all group subscriptions for the logged-in user, across all groups.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "subscription-uuid",
      "group": {
        "id": "group-uuid",
        "name": "Chess Club",
        "slug": "chess-club",
        "coverImage": "url-or-null",
        "isPaid": true
      },
      "tier": {
        "id": "tier-uuid",
        "name": "Membership",
        "price": "10.00",
        "billingInterval": "monthly"
      },
      "status": "active",
      "currentPeriodStart": "2024-04-01T00:00:00.000Z",
      "currentPeriodEnd": "2024-05-01T00:00:00.000Z",
      "cancelAtPeriodEnd": false,
      "createdAt": "2024-03-01T00:00:00.000Z"
    }
  ]
}
```

---

## Notes

- All endpoints require authentication.
- All dates are ISO8601 strings (UTC).
- For group admin endpoints, only the group creator can access/manage member subscriptions.
- For user endpoint, all group subscriptions (active, canceled, etc) are returned.
