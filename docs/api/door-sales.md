# Door Sales (Backdoor) — Frontend Integration Guide

All routes are mounted at `/api/door-sales`.

---

## Auth Summary

| Route group | Auth required |
|---|---|
| Admin/team management routes | Yes — Bearer token + `event.manage_door_sales` permission |
| Public buyer routes | No auth required |

---

## Admin / Team Management Routes

These are called from the organizer dashboard or event team panel.

---

### 1. Enable Door Sales

Generates a new secret token for the event and enables the door-sales backdoor.

```
POST /api/door-sales/:eventId/enable
```

**Headers**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**URL Params**
| Param | Type | Required | Description |
|---|---|---|---|
| `eventId` | UUID | Yes | The event to enable door sales for |

**Request body:** none

**Response `200`**
```json
{
  "success": true,
  "data": {
    "token": "a3f9c1e2b4d6...",
    "doorSalesUrl": "https://gokyro.com/door-sale/a3f9c1e2b4d6..."
  }
}
```

> **Frontend usage:** Store `token` and display `doorSalesUrl` as a QR or shareable link. This is the link you give to walk-up buyers.

---

### 2. Disable Door Sales

Disables the backdoor without deleting the token.

```
POST /api/door-sales/:eventId/disable
```

**Headers**
```
Authorization: Bearer <token>
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `eventId` | UUID | Yes |

**Request body:** none

**Response `200`**
```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

---

### 3. Regenerate Door Sales Token

Invalidates the old token and creates a fresh one. Also re-enables door sales if it was disabled.

```
POST /api/door-sales/:eventId/regenerate-qr
```

**Headers**
```
Authorization: Bearer <token>
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `eventId` | UUID | Yes |

**Request body:** none

**Response `200`**
```json
{
  "success": true,
  "data": {
    "token": "new64hextoken...",
    "doorSalesUrl": "https://gokyro.com/door-sale/new64hextoken..."
  }
}
```

> **Frontend usage:** Re-render the QR code and shareable link using the new `doorSalesUrl`.

---

### 4. Get Current Door Sales Config

Returns the current door sales status and all ticket tiers with their door-sale prices.

```
GET /api/door-sales/:eventId/config
```

**Headers**
```
Authorization: Bearer <token>
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `eventId` | UUID | Yes |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "event": {
      "id": "uuid-here",
      "title": "Summer Fest 2026",
      "startDate": "2026-07-01T18:00:00.000Z",
      "endDate": "2026-07-01T23:00:00.000Z",
      "doorSalesEnabled": true,
      "doorSalesToken": "a3f9c1e2b4d6..."
    },
    "tiers": [
      {
        "id": "tier-uuid-1",
        "name": "General Admission",
        "description": "Standard entry",
        "price": "25.00",
        "doorSalePrice": "30.00",
        "quantityAvailable": 200,
        "minTicketsPerOrder": 1,
        "maxTicketsPerOrder": 10
      },
      {
        "id": "tier-uuid-2",
        "name": "VIP",
        "description": "VIP access",
        "price": "75.00",
        "doorSalePrice": null,
        "quantityAvailable": 50,
        "minTicketsPerOrder": 1,
        "maxTicketsPerOrder": 4
      }
    ],
    "doorSalesUrl": "https://gokyro.com/door-sale/a3f9c1e2b4d6..."
  }
}
```

> **Frontend usage:**
> - Show `doorSalesEnabled` toggle
> - Display `doorSalesUrl` as current token link / QR
> - List tiers with `price` (online price) vs `doorSalePrice` (door price)
> - A tier with `doorSalePrice: null` is **not available for door sale** — highlight this in the UI

---

### 5. Set Door Sale Prices Per Tier

Updates the door-sale price for one or more ticket tiers. Set `doorSalePrice` to `null` to remove a tier from door sales.

```
PUT /api/door-sales/:eventId/tiers
```

**Headers**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `eventId` | UUID | Yes |

**Request body**
```json
{
  "ticketUpdates": [
    {
      "ticketTierId": "tier-uuid-1",
      "doorSalePrice": "30.00"
    },
    {
      "ticketTierId": "tier-uuid-2",
      "doorSalePrice": null
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `ticketUpdates` | array | Yes | Array of tier update objects |
| `ticketUpdates[].ticketTierId` | UUID | Yes | The ticket tier to update |
| `ticketUpdates[].doorSalePrice` | string (decimal) or null | Yes | Door sale price. Pass `null` to remove from door sales |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "updated": 2
  }
}
```

---

## Public Buyer Routes (No Auth)

These are accessed by walk-up buyers via the shared token URL.

---

### 6. Get Event by Token

Called when a buyer opens the door-sale link. Returns event info and available ticket tiers.

```
GET /api/door-sales/token/:token
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `token` | string | Yes | The door-sale secret token |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "event": {
      "id": "uuid-here",
      "title": "Summer Fest 2026",
      "description": "The biggest event of the year",
      "startDate": "2026-07-01T18:00:00.000Z",
      "endDate": "2026-07-01T23:00:00.000Z",
      "venueId": "venue-uuid"
    },
    "tiers": [
      {
        "id": "tier-uuid-1",
        "name": "General Admission",
        "description": "Standard entry",
        "price": "25.00",
        "doorSalePrice": "30.00",
        "quantityAvailable": 200,
        "minTicketsPerOrder": 1,
        "maxTicketsPerOrder": 10
      }
    ]
  }
}
```

> **Frontend usage:**
> - Only tiers with a non-null `doorSalePrice` should be shown for purchase
> - Show the `doorSalePrice` as the price (not `price`)
> - Respect `minTicketsPerOrder` and `maxTicketsPerOrder` in your quantity input
> - If this endpoint returns `404`, the token is invalid or door sales are disabled — show an error page

**Error `404`**
```json
{
  "success": false,
  "message": "Door sale token is invalid or disabled"
}
```

---

### 7. Checkout (Create Guest Order + Stripe Session)

The buyer submits their info and ticket selections. Returns a Stripe Checkout URL to redirect the buyer to.

```
POST /api/door-sales/token/:token/checkout
```

> **Rate limited:** 5 requests per 15 minutes per IP.

**URL Params**
| Param | Type | Required |
|---|---|---|
| `token` | string | Yes | The door-sale secret token |

**Request body**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "ticketSelections": [
    {
      "ticketTierId": "tier-uuid-1",
      "quantity": 2
    }
  ]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | Yes | Buyer full name |
| `email` | string | Yes | Buyer email (Stripe will use this) |
| `phone` | string | No | Buyer phone number |
| `ticketSelections` | array | Yes | At least one item required |
| `ticketSelections[].ticketTierId` | UUID | Yes | Must belong to the event |
| `ticketSelections[].quantity` | integer | Yes | Positive integer within min/max limits |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "sessionId": "cs_test_...",
    "orderId": "guest-order-uuid"
  }
}
```

> **Frontend usage:**
> - Redirect the browser to `checkoutUrl` immediately
> - Store `orderId` locally (localStorage/sessionStorage) to retrieve tickets later
> - After Stripe checkout completes, buyer is redirected to:
>   - Success: `https://gokyro.com/door-sales/success?orderId=<orderId>`
>   - Cancel: `https://gokyro.com/door-sales/cancel?orderId=<orderId>`

**Common errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `Missing required fields` | `name`, `email`, or `ticketSelections` is missing |
| `400` | `Ticket tier X is not available for door sale` | Tier has no `doorSalePrice` set |
| `400` | `Quantity exceeds max per order for ...` | Quantity > `maxTicketsPerOrder` |
| `400` | `Quantity below min per order for ...` | Quantity < `minTicketsPerOrder` |
| `400` | `Not enough event capacity` | Event is sold out |
| `404` | `Door sale token is invalid or disabled` | Token wrong or door sales disabled |
| `429` | `Too many requests, please try again later` | Rate limit hit |

---

### 8. Get Guest Ticket Bundle (After Payment)

Called on the success page to retrieve the full order and all issued tickets.

```
GET /api/door-sales/order/:orderId
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `orderId` | UUID | Yes | Returned from the checkout endpoint |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": "guest-order-uuid",
      "eventId": "event-uuid",
      "guestName": "Jane Doe",
      "guestEmail": "jane@example.com",
      "guestPhone": "+1234567890",
      "totalAmount": "60.00",
      "status": "paid",
      "isDoorSale": true,
      "paymentIntentId": "pi_...",
      "stripeSessionId": "cs_test_...",
      "receiptUrl": "https://pay.stripe.com/receipts/...",
      "createdAt": "2026-07-01T19:30:00.000Z",
      "updatedAt": "2026-07-01T19:31:00.000Z"
    },
    "items": [
      {
        "id": "item-uuid",
        "guestOrderId": "guest-order-uuid",
        "ticketTierId": "tier-uuid-1",
        "quantity": 2,
        "unitPrice": "30.00",
        "createdAt": "2026-07-01T19:30:00.000Z"
      }
    ],
    "tickets": [
      {
        "id": "ticket-uuid-1",
        "ticketCode": "TKT-XXXXXXXX",
        "eventId": "event-uuid",
        "ticketTierId": "tier-uuid-1",
        "guestOrderId": "guest-order-uuid",
        "holderName": "Jane Doe",
        "holderEmail": "jane@example.com",
        "holderPhone": "+1234567890",
        "price": "30.00",
        "status": "active",
        "qrCode": "{...json...}",
        "qrCodeUrl": "https://cdn.gokyro.com/tickets/ticket-uuid-1.png",
        "purchasedAt": "2026-07-01T19:31:00.000Z"
      }
    ]
  }
}
```

> **Frontend usage:**
> - Check `order.status === "paid"` before showing tickets. If still `"pending"`, tickets are not yet issued (Stripe webhook is async) — poll this endpoint every 2–3 seconds until ready
> - Each item in `tickets[]` is one physical ticket
> - Display `ticket.qrCodeUrl` as the scannable QR image
> - Display `ticket.ticketCode` as the readable ticket code
> - Provide a download/print button using `qrCodeUrl`
> - Link `order.receiptUrl` to the Stripe receipt if present

**Polling note:** Tickets are issued asynchronously by the Stripe webhook. Always poll until `tickets.length > 0`.

**Error `404`**
```json
{
  "success": false,
  "message": "Guest order not found"
}
```

---

### 9. Get Single Ticket by Code

Lookup one guest ticket by its code. Useful for a standalone ticket detail / printable page.

```
GET /api/door-sales/ticket/:ticketCode
```

**URL Params**
| Param | Type | Required |
|---|---|---|
| `ticketCode` | string | Yes | e.g. `TKT-XXXXXXXX` |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "ticket-uuid-1",
    "ticketCode": "TKT-XXXXXXXX",
    "eventId": "event-uuid",
    "ticketTierId": "tier-uuid-1",
    "guestOrderId": "guest-order-uuid",
    "holderName": "Jane Doe",
    "holderEmail": "jane@example.com",
    "holderPhone": "+1234567890",
    "price": "30.00",
    "status": "active",
    "qrCode": "{...json...}",
    "qrCodeUrl": "https://cdn.gokyro.com/tickets/ticket-uuid-1.png",
    "purchasedAt": "2026-07-01T19:31:00.000Z"
  }
}
```

**Error `404`**
```json
{
  "success": false,
  "message": "Ticket not found"
}
```

---

## Buyer Flow Summary

```
Step 1 — Open backdoor link
  GET /api/door-sales/token/:token
  → Show event info + ticket tiers (only those with non-null doorSalePrice)

Step 2 — Buyer fills in details and selects tickets
  POST /api/door-sales/token/:token/checkout
  → Redirect browser to data.checkoutUrl (Stripe hosted checkout)
  → Save data.orderId to localStorage

Step 3 — Buyer pays on Stripe
  Stripe redirects to /door-sales/success?orderId=<id>
  (or /door-sales/cancel?orderId=<id> on cancel)

Step 4 — Success page loads order + tickets
  GET /api/door-sales/order/:orderId
  → Poll every 2-3s until order.status === "paid" and tickets.length > 0
  → Display each ticket's qrCodeUrl and ticketCode

Step 5 — (Optional) Standalone ticket page
  GET /api/door-sales/ticket/:ticketCode
```

---

## Admin Flow Summary

```
Step 1 — Enable door sales (generates token + shareable URL)
  POST /api/door-sales/:eventId/enable

Step 2 — Set door-sale prices per ticket tier
  PUT /api/door-sales/:eventId/tiers

Step 3 — View current config and existing token URL
  GET /api/door-sales/:eventId/config

Step 4 — Regenerate token if needed (old link becomes invalid)
  POST /api/door-sales/:eventId/regenerate-qr

Step 5 — Disable door sales when done
  POST /api/door-sales/:eventId/disable
```
