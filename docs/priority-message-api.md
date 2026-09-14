# Priority Message API Integration Guide

This document describes the backend flow and API responses for the priority message feature so your frontend can integrate cleanly.

## Overview

Priority messages are paid messages sent by fans to talent. The message content is saved in the backend during checkout creation and is delivered only after Stripe confirms payment.

The flow is:

1. User submits a priority message request.
2. Backend creates a pending payment record and a Stripe Checkout session.
3. User completes Stripe Checkout.
4. Stripe sends a webhook, backend delivers the message to the conversation and marks the payment `paid`.
5. Frontend polls payment status after Stripe redirect to confirm delivery.

---

## API Endpoints

### 1. Create Checkout

- Method: `POST`
- Path: `/priority-messages`
- Auth: required
- Body:
  - `talentProfileId` (string, required)
  - `subject` (string, optional)
  - `messageContent` (string, required)

#### Example Request

```json
POST /priority-messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "talentProfileId": "profile-id-123",
  "subject": "Quick question",
  "messageContent": "Hi! I wanted to ask about your availability for a collaboration."
}
```

#### Success Response

```json
HTTP/1.1 201 Created
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_...",
    "paymentId": "payment-id-123"
  }
}
```

#### Notes

- The returned `checkoutUrl` is the Stripe Checkout page the user should be redirected to.
- The returned `paymentId` should be saved by the frontend for later status polling.
- The backend stores the message as a pending payment record; it is not delivered until Stripe confirms payment.

---

### 2. Poll Payment Status

- Method: `GET`
- Path: `/priority-messages/:paymentId/status`
- Auth: required

#### Example Request

```http
GET /priority-messages/payment-id-123/status
Authorization: Bearer <token>
```

#### Success Response

```json
HTTP/1.1 200 OK
{
  "success": true,
  "data": {
    "status": "paid",
    "conversationId": "conversation-id-456",
    "messageId": "message-id-789",
    "paidAt": "2026-04-13T12:34:56.789Z",
    "amountCents": 2500
  }
}
```

#### Possible `status` values

- `pending` — checkout created, payment not yet confirmed
- `paid` — Stripe confirmed payment and the message has been delivered
- `failed` — delivery failed after payment webhook processing
- `refunded` — refunded by the backend
- `cancelled` — checkout expired before payment

#### Notes

- The frontend should poll this endpoint after the user returns from Stripe Checkout.
- When `status` becomes `paid`, the message is delivered and the talent can be notified.

---

### 3. Get Received Priority Messages (Talent)

- Method: `GET`
- Path: `/priority-messages/received`
- Auth: required
- Query params:
  - `page` (number, optional, default: `1`)
  - `limit` (number, optional, default: `20`, max: `50`)

#### Example Request

```http
GET /priority-messages/received?page=1&limit=20
Authorization: Bearer <token>
```

#### Success Response

```json
HTTP/1.1 200 OK
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "payment-id-123",
        "amountCents": 2500,
        "amount": 25,
        "subject": "Quick question",
        "messageContent": "Hi! I wanted to ask about your availability for a collaboration.",
        "paidAt": "2026-04-13T12:34:56.789Z",
        "conversationId": "conversation-id-456",
        "messageId": "message-id-789",
        "isSeen": false,
        "sender": {
          "id": "sender-id-abc",
          "firstName": "Jane",
          "lastName": "Doe",
          "username": "janedoe",
          "image": "https://..."
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 10,
      "totalPages": 1,
      "hasMore": false
    }
  }
}
```

#### Notes

- This endpoint is intended for talent users to view all paid priority messages they have received.
- It includes sender details and delivery status via `isSeen`.

---

## Stripe Webhook Behavior

The backend also exposes a webhook endpoint:

- `POST /priority-messages/webhook`

This endpoint is not called from the frontend. Stripe sends events here directly.

Handled events:

- `checkout.session.completed` or `checkout.session.async_payment_succeeded`
  - Delivers the stored message to the chat conversation
  - Marks the payment record as `paid`
- `checkout.session.expired`
  - Marks the payment record as `cancelled` if still `pending`

The webhook uses Stripe session metadata to connect the event back to the stored `paymentId`.

---

## Frontend integration sequence

1. `POST /priority-messages` with `talentProfileId`, optional `subject`, and `messageContent`
2. Receive `checkoutUrl` and `paymentId`
3. Redirect user to `checkoutUrl`
4. After Stripe redirect, poll `GET /priority-messages/:paymentId/status`
5. Use `status` to show:
   - `pending`: still waiting for webhook/delivery
   - `paid`: success, message sent
   - `failed` / `cancelled` / `refunded`: show failure state

---

## Important frontend notes

- Save `paymentId` from checkout creation to poll status.
- The backend uses Stripe Checkout metadata to connect payment and message delivery.
- The amount charged is in `amountCents`. You can display it as dollars by dividing by `100`.
- `messageContent` is stored on the backend and delivered only after payment succeeds.
