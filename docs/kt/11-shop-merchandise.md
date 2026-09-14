# Shop & Merchandise — KT

> Two unrelated systems share the word "merchandise" in this codebase. Don't conflate them:
>
> 1. **Creator Shop** (this doc's main subject) — a digital storefront on a talent/creator's
>    profile (`src/db/schema/shop.js`, `src/routes/shop.route.js`, `src/services/shop/*`).
>    Sellers are users with a **talent profile**; buyers are any authenticated user.
> 2. **Event Merchandise** — physical add-on items (t-shirts, posters, etc.) an **organizer**
>    attaches to an **event**, sold alongside tickets in the same checkout
>    (`src/db/schema/purchasedMerchandise.js`, `eventMerchandise` in `src/db/schema/tickets.js`,
>    logic embedded in `event.service.js` / `order.service.js` / `refund.service.js`). It has no
>    dedicated routes/controllers/services of its own — it's part of the events/ticketing flow.
>
> This doc covers system 1 in depth (that's where `src/services/shop/` and `shop.route.js` live)
> and system 2 briefly, for completeness, since `purchasedMerchandise.js` was flagged for this KT.
> Full event-merchandise checkout/refund detail belongs to [02-events.md](./02-events.md).

## Overview

The **Creator Shop** lets any user with a **talent profile** ([05-talent.md](./05-talent.md)) sell
digital products from their own profile's "Shop" tab: downloadable files (PDFs, zips, audio,
video…), external links, or plain redirect buttons (e.g. to an external storefront). Any
authenticated user can buy. There is no concept of physical shipping, inventory, or variants —
this is a lightweight digital-goods storefront, not a general e-commerce system.

Key relationships to other modules:

- **Talent** ([05-talent.md](./05-talent.md)) — selling requires a `talent_profiles` row
  (`ShopProductService.canSell`, `src/services/shop/shopProduct.service.js:161-167`). Payouts flow
  through the same Stripe Connect account as talent session bookings and priority messages;
  shop revenue is folded into the talent earnings dashboard
  (`src/services/talentEarnings.service.js`, "Shop Sales" bucket).
- **Organizers** ([06-organizers-venues.md](./06-organizers-venues.md)) — organizers don't sell
  shop products themselves, but a **group** (which an organizer runs) can *surface* an existing
  talent seller's products on its group details page (`group_shop_products`,
  `src/services/group.service.js`) — this is a BriteSide Plus–gated feature, not a selling
  mechanism for the organizer.
- **Social / posts** ([04-social.md](./04-social.md)) — a post can link up to 3 shop products
  (`post_shop_products`, `src/services/social/post.service.js`), also gated to BriteSide Plus
  subscribers.
- **Payments** ([07-payments-stripe.md](./07-payments-stripe.md)) — checkout, webhooks, and the
  fee split all reuse the platform's existing Stripe Connect wiring; see the Core Flows section
  below for exactly where the handoff happens.

Event Merchandise (system 2 above) belongs conceptually to events/ticketing: an **organizer**
defines merch items on an **event**, an **attendee** buys them bundled with tickets in one order,
and refunds/stock restoration are handled inside the same event-order refund path. See
[02-events.md](./02-events.md) for that flow; it's summarized only in Data Model below.

## Key Files

| Path | Purpose |
|---|---|
| `src/routes/shop.route.js` | All Creator Shop endpoints, mounted at `/api/shop`. Also defines the `multer` upload config (memory storage, 500MB limit, blocks executable extensions) for deliverable uploads. |
| `src/controllers/shop.controller.js` | Thin controllers for products, checkout, purchases, downloads, refund requests, and the admin refund-override endpoints (the latter are wired into `admin.route.js`, not `shop.route.js`). |
| `src/services/shop/shopProduct.service.js` | Product CRUD, validation, pin/reorder, shop settings (visibility + refund policy), view tracking, per-product analytics. |
| `src/services/shop/shopOrder.service.js` | Checkout (Stripe session creation + free-product fast path), payment/expiry webhook handlers, fee-split math, download issuance, buyer purchase list, seller stats dashboard. |
| `src/services/shop/shopDeliverable.service.js` | Uploads a seller's paid-product file to a **private** S3 bucket and mints short-lived signed download URLs. |
| `src/services/shop/shopRefund.service.js` | Refund request lifecycle: buyer requests → seller (or admin) approves/rejects → Stripe refund + order/product bookkeeping. |
| `src/db/schema/shop.js` | Tables: `shop_products`, `shop_orders`, `shop_refund_requests`, `post_shop_products`, `group_shop_products`, `shop_product_views`. |
| `src/db/schema/social.js` (lines ~75-83) | `social_profiles.shop_visible` / `shop_refunds_enabled` / `shop_refund_window_days` / `shop_refund_after_download` — the seller's shop-level settings live on the social profile row, not on `shop_products`. |
| `src/db/schema/purchasedMerchandise.js` | Event Merchandise (system 2): one row per purchased merch item, tied to an event/order/organizer. Not part of the Creator Shop schema. |
| `src/db/schema/tickets.js` (`eventMerchandise` table, ~line 66) | Event Merchandise catalog item (name, price, stock) attached to an event. |
| `src/controllers/webhook.controller.js` (~lines 92-137) | Dispatches Stripe `checkout.session.completed` / `checkout.session.expired` events with `metadata.type === 'shop'` to `ShopOrderService`. |
| `src/services/talentEarnings.service.js` | Rolls shop net revenue into the talent earnings dashboard/withdrawable balance alongside session and priority-message income. |
| `src/services/social/post.service.js` | Validates/persists `post_shop_products` (max 3 per post, BriteSide Plus gated). |
| `src/services/group.service.js` | Validates/persists `group_shop_products` (BriteSide Plus gated). |
| `src/controllers/social.controller.js` | Includes `shopProductCount` (via `ShopProductService.countForUser`) on a user's profile payload. |
| `src/db/schema/relations.js` (~lines 1112-1192) | Drizzle relational config for all shop tables. |

## Data Model

### Creator Shop tables (`src/db/schema/shop.js`)

**`shop_products`** — one row per listing.

| Column | Notes |
|---|---|
| `user_id` | Seller (FK → `users`, cascade delete). |
| `title`, `description`, `price_cents` | Price is an integer, cents, ≥ 0; `0` = free product. |
| `cover_url` / `cover_type`, `gallery` (jsonb) | `gallery` capped at 6 items, enforced in the service not the DB. |
| `button_action` | `'payment'` (sold through platform) or `'redirect'` (external link, no order/money/delivery). |
| `redirect_url` | Required and validated (`http(s)://`) when `button_action = 'redirect'`. |
| `delivery_type` | `'file'` or `'link'`, only meaningful when `button_action = 'payment'`. |
| `delivery_file_key`, `delivery_file_name`, `delivery_link` | Private fields — stripped from API responses for anyone but the owner (`ShopProductService.sanitize`). `delivery_file_key` is an S3 object key, never a public URL. |
| `display_order`, `is_pinned`, `pin_order` | Pinning mirrors pinned posts: max 9 per shop (`shop_pin_order_range` CHECK: 1–9), one owner only so it's plain columns rather than a join table. |
| `views_count`, `sales_count` | Denormalized counters, kept in sync by the services. |
| `deleted_at` | Soft delete only — past buyers must still download, and refund disputes must still resolve against the product. |

**`shop_orders`** — one row per purchase attempt.

| Column | Notes |
|---|---|
| `product_id` | FK → `shop_products`, **no cascade** (soft-deleted products must still resolve for orders). |
| `buyer_id`, `seller_id` | Both FK → `users`; `seller_id` is denormalized off the product so earnings queries skip a join. |
| `status` | `pending → paid → refunded`, or `pending → expired`. |
| `product_title_snapshot`, `price_cents`, `charged_cents`, `seller_receive_cents`, `platform_share_cents` | Snapshotted at order time — survive later product edits. |
| `refunds_allowed_snapshot`, `refund_window_days_snapshot`, `refund_after_download_snapshot` | The seller's refund policy **as it stood at purchase**. Eligibility is always judged against these, never the seller's live settings. |
| `stripe_session_id` (unique), `stripe_payment_intent_id` | The unique index on `stripe_session_id` makes Stripe's at-least-once webhook redelivery a no-op. |
| `download_count`, `first_downloaded_at` | `first_downloaded_at` doubles as the refund guard when `refund_after_download_snapshot = false`. |
| `refunded_at`, `refund_amount_cents`, `stripe_refund_id`, `paid_at` | Refund/payment bookkeeping. |

**`shop_refund_requests`** — one buyer dispute per order (`order_id` is `unique`).

| Column | Notes |
|---|---|
| `reason` | One of `not_as_described`, `not_received`, `wrong_item`, `other`. |
| `status` | `pending → approved` (terminal — money moved) or `pending → rejected` (an admin may still override to `approved`). |
| `resolved_by_user_id`, `resolved_by_role` | `'seller'` or `'admin'` — the seller rules first, an admin can overturn a rejection. |
| `refund_amount_cents`, `stripe_refund_id`, `resolved_at` | Set on resolution. |

**`post_shop_products`** — up to 3 products a post links to (`post_shop_products_position_range` CHECK: 0–2), unique on `(post_id, product_id)`.

**`group_shop_products`** — products an organizer surfaces on a group page (`group_shop_products_position_range` CHECK: 0–5, i.e. up to 6 slots), unique on `(group_id, product_id)`.

**`shop_product_views`** — one row per distinct `(product_id, user_id)` view, unique index enforces "count viewers not impressions."

**Seller settings live outside `shop_products`, on `social_profiles`** (`src/db/schema/social.js`):
`shop_visible` (default `true`), `shop_refunds_enabled` (default `true`), `shop_refund_window_days`
(default `14`), `shop_refund_after_download` (default `false`).

### Event Merchandise tables (adjacent system, not Creator Shop)

| Table | File | Purpose |
|---|---|---|
| `event_merchandise` | `src/db/schema/tickets.js` (~line 66) | Catalog item an organizer attaches to an event: `name`, `description`, `image_url`, `price` (decimal), `quantity_available` (decrements on purchase, restored on refund). |
| `purchased_merchandise` | `src/db/schema/purchasedMerchandise.js` | One row per purchased merch line item: `merchandise_code` (unique, like a ticket code), `event_id`, `merchandise_id` → `event_merchandise`, `user_id`, `organizer_id`, `holder_name`/`holder_email`, `quantity`, `unit_price`/`total_price` (decimal), `status` (`active`/refund states), `refunded_at`/`refund_amount`. |

These are created/updated as part of `EventService.createEvent` / `updateEvent`
(`src/services/event.service.js`, the `merchandise` array in the request body), purchased via
`OrderService` alongside tickets (`merchandiseSelections` in the checkout body,
`src/services/order.service.js`), and refunded via `RefundService` /
`EventService.refundPurchasedMerchandise`. There is no separate route file — these fields ride
along inside the event and order/ticket endpoints documented in
[02-events.md](./02-events.md).

## API Endpoints

All Creator Shop routes are mounted at `/api/shop` (`src/routes/index.js:101`) and require auth —
`shop.route.js:64` applies `authMiddleware` to the whole router (no public/optional-auth shop
routes exist). Route order matters: literal path segments (`/products/reorder`,
`/products/detail/:productId`, etc.) are declared before the catch-all `/products/:username`,
otherwise Express would match a literal segment as a `:username`/`:productId` value.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/shop/deliverable` | Required (must pass `assertCanSell`) | Upload a paid product's file to private S3; returns an S3 key, never a URL. `multipart/form-data`, field `file`, 500MB max, blocks `.exe/.bat/.cmd/.scr/.vbs/.jar/.msi/.dll`. |
| PUT | `/api/shop/products/reorder` | Required (owner) | Persist full grid ordering (`productIds` array). |
| PUT | `/api/shop/products/pins/reorder` | Required (owner) | Persist pinned-row ordering. |
| GET | `/api/shop/products/detail/:productId` | Required | Fetch one product (sanitized per-viewer). |
| PUT | `/api/shop/visibility` | Required | Show/hide the caller's whole shop (`{ visible: boolean }`). |
| GET | `/api/shop/stats` | Required | Seller's own shop dashboard: revenue, orders, per-product rollup, 6-month chart, recent transactions. |
| GET | `/api/shop/settings` | Required | Get the caller's shop visibility + refund policy. |
| PUT | `/api/shop/refund-policy` | Required | Set `{ refundsEnabled, refundWindowDays (1-90), refundAfterDownload }`. |
| GET | `/api/shop/purchases` | Required | Buyer's own purchase history, paginated (`page`, `limit`). |
| GET | `/api/shop/orders/:orderId/download` | Required (buyer of that order) | Mint a fresh signed download URL / return the delivery link; re-verifies ownership + `status === 'paid'` every call. |
| GET | `/api/shop/refund-requests/eligible` | Required | Buyer's paid orders that are still within the refund window and not already disputed. |
| GET | `/api/shop/refund-requests/mine` | Required | Buyer's own refund requests (any status). |
| GET | `/api/shop/refund-requests/received` | Required (seller) | Refund requests against the caller's shop; optional `?status=` filter; also returns `pendingCount`. |
| POST | `/api/shop/refund-requests` | Required (buyer) | File a dispute: `{ orderId, reason, message }`. |
| PATCH | `/api/shop/refund-requests/:requestId/respond` | Required (seller who owns the shop) | `{ action: 'approve'|'reject', resolutionNote? }`. |
| POST | `/api/shop/products` | Required (must pass `assertCanSell`) | Create a product. |
| PUT | `/api/shop/products/:productId` | Required (owner) | Update a product (partial; merged-then-validated). |
| DELETE | `/api/shop/products/:productId` | Required (owner) | Soft-delete (also un-pins). |
| POST | `/api/shop/products/:productId/view` | Required | Record a distinct view (no-op for the owner viewing their own product, and for repeat viewers). |
| POST | `/api/shop/products/:productId/checkout` | Required (buyer) | Start a purchase; body may include `{ platform: 'android' }` for deep-link redirects. |
| POST | `/api/shop/products/:productId/pin` | Required (owner) | Pin (max 9); idempotent. |
| DELETE | `/api/shop/products/:productId/pin` | Required (owner) | Unpin. |
| GET | `/api/shop/products/:productId/analytics` | Required (owner) | Per-product analytics: views, checkouts, sales, revenue, conversion, daily series, prior-period comparison. Query: `days` (1-730 or `all`), or `from`/`to`. |
| GET | `/api/shop/products/:username` | Required (any authenticated viewer) | List a seller's shop by **username** (not id) — resolved via `userService.findByUsername`, mirroring how `social.controller.js` splits profile URLs. Returns empty product lists if the shop is hidden and viewer ≠ owner. |

Admin overrides (mounted separately under `/api/admin`, `src/routes/admin.route.js:789-793`,
gated by `authMiddleware` + `requireAdmin` applied to the whole admin router):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/shop-refund-requests` | Admin | All refund requests across every shop, paginated, optional `?status=`. |
| PATCH | `/api/admin/shop-refund-requests/:requestId/override` | Admin | Force `{ action: 'approve'|'reject', resolutionNote? }`; can turn a `rejected` request into `approved`, but never touch one already `approved` (money already moved). |

No dedicated Zod validation middleware/schemas exist for `shop.route.js` (unlike most other
routes) — request validation happens inline in the service layer via `ApiError` throws
(`ShopProductService.validate`, etc.). The admin override route is the one exception, validated
with a local Zod schema (`overrideShopRefundSchema`, `admin.route.js:784-787`). There are also no
`@swagger` JSDoc blocks on `shop.route.js`, so these endpoints do **not** appear in `/api-docs`.

## Core Flows

### 1. Creating / listing a shop product

1. Seller must have a `talent_profiles` row (`ShopProductService.assertCanSell`,
   `shopProduct.service.js:169-176`) — there's no separate "become a seller" toggle; setting up a
   talent profile *is* what unlocks selling. This is deliberate: payouts are keyed to
   `talentProfileId` elsewhere (talent sessions, payouts), so a seller without one would take
   payment with no way to withdraw it.
2. `POST /api/shop/products` → `ShopProductService.createProduct` validates the payload
   (`validate()`), builds writable fields (`buildWritableFields()` — nulls out whichever of
   `redirect_url`/`delivery_*` doesn't apply to the chosen `buttonAction`), and inserts with
   `display_order` set below the current minimum so new products appear first.
3. For a file-delivered product, the seller must call `POST /api/shop/deliverable` **first**
   (multipart upload → private S3 via `ShopDeliverableService.upload`) to obtain a
   `deliveryFileKey`, then pass that key when creating/updating the product. The upload endpoint
   re-checks `assertCanSell` before touching S3, "so a user who can't sell can't leave orphaned
   objects in the private bucket" (`shop.controller.js:115-123`).
4. Listing: `GET /api/shop/products/:username` resolves the username → user id, then
   `ShopProductService.listForUser` returns pinned + unpinned products, the shop's settings,
   whether the *viewer* can sell (only computed for the owner), and `payoutsReady` (a cached
   `chargesEnabled` flag off the seller's Stripe Connect account — not a live Stripe call, since
   this runs on every shop page load; checkout does the authoritative live re-check).
5. Non-owner viewers of a hidden shop (`shop_visible = false`) get an empty product list rather
   than a 404/403 — the shop "exists" but shows nothing.
6. Delivery fields (`deliveryFileKey`/`deliveryLink`/`deliveryFileName`) are stripped from every
   response to non-owners (`ShopProductService.sanitize`); a `hasDeliverable` boolean is exposed
   instead so the UI can still show "includes a file" without leaking where it is.

### 2. Placing an order and payment

1. `POST /api/shop/products/:productId/checkout` → `ShopOrderService.createCheckout`. Guards:
   product must exist and not be soft-deleted, `buttonAction` must be `'payment'` (redirect
   products never create orders), buyer ≠ seller, and no existing **paid** order for the same
   buyer+product (`findPaidOrder` — no repeat purchases).
2. The seller's refund policy is snapshotted onto the order right now
   (`refundsAllowedSnapshot`/`refundWindowDaysSnapshot`/`refundAfterDownloadSnapshot`) — this is
   what refund eligibility is judged against later, never the seller's live settings.
3. **Free product path** (`priceCents === 0`): no Stripe involved. An order is inserted directly
   as `status: 'paid'`, `salesCount` increments, and delivery notifications fire immediately
   (`notifyPurchase`). Returns `{ free: true, orderId }`.
4. **Paid product path**: this is the handoff point into the Stripe/Connect machinery documented
   in [07-payments-stripe.md](./07-payments-stripe.md) — the shop code only does shop-specific
   bookkeeping around a standard Connect destination-charge checkout:
   - Re-verifies the seller's Connect account has `chargesEnabled` (a stale cached `false` is
     re-synced live before rejecting a real sale, `syncStatus`); if payouts still aren't ready,
     the sale is blocked, the seller gets a rate-limited (1/day) in-app notification + email
     nudging them to finish Stripe onboarding, and the buyer gets a 400.
   - Fee split (`ShopOrderService.computeFees`, identical math to talent session bookings):
     seller receives 95% of the base price, the platform's effective take is ~10% (5% padded into
     what the buyer is charged via Stripe's `application_fee_amount`, 5% built into the seller's
     cut), Stripe's own processing fee comes out of the platform's application fee, not the
     seller's payout.
   - An order row is inserted as `status: 'pending'`, then a Stripe Checkout Session is created
     (`mode: 'payment'`, 30-minute expiry, `transfer_data.destination` = seller's Connect account,
     `metadata.type = 'shop'` on **both** the session and the payment intent — the webhook
     dispatcher reads `session.metadata.type`, the wallet/ledger code reads
     `charge.metadata.type`). The order is updated with the resulting `stripeSessionId`.
   - Returns `{ free: false, checkoutUrl, orderId }` for the client to redirect the buyer to.
5. **Webhook completion**: `webhook.controller.js` (~line 92-94) sees
   `checkout.session.completed` with `metadata.type === 'shop'` and calls
   `ShopOrderService.handlePaymentWebhook`. This flips the order to `paid` with a
   conditional `WHERE status = 'pending'` update (idempotent against Stripe's at-least-once
   redelivery and concurrent webhook races), increments `salesCount`, records the spend via
   `UserSpendService.recordSpend` (`spendType: 'shop'`), and sends purchase-confirmation
   notifications/emails to both sides.
6. **Abandoned checkout**: `checkout.session.expired` with `metadata.type === 'shop'` (~line 136)
   calls `handlePaymentExpired`, flipping a still-`pending` order to `expired`.
7. Buyer downloads via `GET /api/shop/orders/:orderId/download` →
   `ShopOrderService.getDownload`, which re-checks buyer ownership and `status === 'paid'` on
   **every call** (nothing is authorized by a stored URL). For `deliveryType: 'link'` it returns
   the stored link; for `'file'` it mints a 15-minute pre-signed S3 URL
   (`ShopDeliverableService.getSignedDownloadUrl`). Every access — link or file — stamps
   `firstDownloadedAt` and increments `downloadCount`; `firstDownloadedAt` is what later gates
   refund eligibility when `refundAfterDownload = false`.

### 3. Fulfilling a "deliverable"

A "deliverable" is simply **the digital thing a buyer receives after paying** — either:

- **`deliveryType: 'file'`** — an arbitrary file (zip, PDF, audio, video, etc., anything except
  the blocked executable extensions) the seller uploaded ahead of time via
  `POST /api/shop/deliverable`. It's stored in a **private** S3 bucket
  (`AWS_S3_PRIVATE_BUCKET` — `ShopDeliverableService.bucket` throws loudly rather than falling
  back to the public bucket used by `upload.service.js` if this env var is missing). Buyers never
  get a permanent URL; each download mints a fresh 15-minute pre-signed URL that forces the
  browser to save the file under the seller's original filename
  (`ResponseContentDisposition: attachment; filename=...`).
- **`deliveryType: 'link'`** — just a stored URL (e.g. a Google Drive link, an external course
  platform) handed back verbatim on download, with no expiry and no S3 involvement.

There is no fulfillment "step" beyond serving the file/link — "fulfillment" happens synchronously
and repeatably on every authorized download request; there's no shipping, no manual seller action,
and nothing that can be "un-fulfilled" once a buyer has paid (short of a refund).

Note: `buttonAction: 'redirect'` products have **no deliverable at all** — they're an external
link button with no order, no payment, and no download entry; they exist purely to drive traffic
off-platform.

### 4. Refund flow

1. Buyer checks eligibility: `GET /api/shop/refund-requests/eligible` →
   `ShopRefundService.listEligibleOrders` — paid orders where
   `ShopOrderService.isRefundEligible(order)` is true (policy snapshot allows refunds, not already
   refunded, not past the snapshot's window measured from `paidAt`, and — unless the snapshot
   allows refunds after download — not yet downloaded) **and** not already disputed.
2. Buyer files a dispute: `POST /api/shop/refund-requests` with `{ orderId, reason, message }`.
   `reason` must be one of `not_as_described | not_received | wrong_item | other`. Re-validates
   eligibility server-side (never trusts the eligible-list response) and enforces one dispute per
   order (`order_id` is `unique` on `shop_refund_requests`). Seller gets a notification.
3. **Seller decides**: `PATCH /api/shop/refund-requests/:requestId/respond` with
   `{ action: 'approve'|'reject', resolutionNote? }` — only from `pending`, only the seller who
   owns that shop.
4. **Approve path** (`ShopRefundService.resolve`): if the order had a real charge
   (`chargedCents > 0`), issues a real Stripe refund first —
   `stripe.refunds.create({ payment_intent, reverse_transfer: true, refund_application_fee: false })`
   — pulling the money back out of the **seller's** Connect balance while the platform keeps its
   application fee (same policy as event ticket refunds elsewhere in the codebase). Only after
   the Stripe call succeeds does it update `shop_refund_requests.status = 'approved'` and
   `shop_orders.status = 'refunded'`, decrement the product's `salesCount` (floored at 0), and call
   `UserSpendService.markSpendRefunded`. Both parties are notified.
5. **Reject path**: just flips status to `rejected` and notifies the buyer — no Stripe call, no
   order mutation.
6. **Admin override** (`PATCH /api/admin/shop-refund-requests/:requestId/override`,
   `ShopRefundService.adminOverride`): can act on any `pending` request, or flip a `rejected` one
   to `approved`. Cannot touch an already-`approved` request — approval is terminal because the
   money has already moved. Uses the exact same `resolve()` path as the seller, just with
   `role: 'admin'`, which also changes the notification copy sent to the seller ("An admin
   refunded/declined...").
7. A shop with `shop_refunds_enabled = false` accepts **no** refund requests at all for its
   orders — per the code comment, "that is the accepted consequence of making seller policy
   absolute." There is no separate admin path to force a refund on a shop that opted out other
   than the general admin-override endpoint acting on a request that was never filed (which can't
   happen, since `requestRefund` itself blocks on `refundsAllowedSnapshot`).

## Integrations

| Integration | How it's used |
|---|---|
| **Stripe Checkout + Connect** | Paid checkout sessions with `transfer_data.destination` to the seller's connected account and `application_fee_amount` for the platform cut — see [07-payments-stripe.md](./07-payments-stripe.md) for the shared Connect onboarding/payout machinery. Shop code only adds its own fee math and metadata. |
| **Stripe Webhooks** | `checkout.session.completed` / `checkout.session.expired` dispatched by `src/controllers/webhook.controller.js` based on `metadata.type === 'shop'`. |
| **Stripe Refunds API** | `stripe.refunds.create` with `reverse_transfer: true`, called from `ShopRefundService.resolve` on approval. |
| **AWS S3 (private bucket)** | `AWS_S3_PRIVATE_BUCKET` stores deliverable files under `shop-deliverables/{sellerId}/{uuid}/{filename}`. Separate from the public bucket `upload.service.js` uses for avatars/media — deliberately, so paid files are never publicly readable. |
| **Notifications + email** | `createNotification` (in-app) and `mailService.sendGeneralEmail` for: purchase confirmation (both sides), payout-setup-required nudges to the seller (rate-limited to 1/day via a notification-type lookup rather than a timestamp column, to stay correct across multiple app instances), and refund approved/declined. |
| **UserSpendService** | `recordSpend` (`spendType: 'shop'`) on payment, `markSpendRefunded` on refund — feeds the platform-wide spend/analytics ledger ([08-dashboards-analytics.md](./08-dashboards-analytics.md)). |
| **Talent earnings dashboard** | `talentEarnings.service.js` pulls `shop_orders` by `sellerId` (deliberately, per its own comment, "a shop seller need not have a talent profile at all" — though note the current `canSell` gate actually requires one; see Gotchas) and folds `sellerReceiveCents` into the same withdrawable balance as session/priority-message income. |

## Business Rules & Gotchas

- **Selling requires a talent profile, full stop.** `ShopProductService.canSell` only checks
  `talent_profiles`; organizers with no talent profile cannot sell shop products even though they
  can *surface* other people's products on their group page. This appears to be in tension with a
  comment in `talentEarnings.service.js` claiming a shop seller "need not have a talent profile at
  all" — in the current code, they do (see the earnings-dashboard row above).
- **Money is always integer cents** in `shop_products`/`shop_orders` (`priceCents`,
  `chargedCents`, etc.) — unlike `purchased_merchandise`, which uses `decimal` dollar amounts.
  Don't mix assumptions between the two systems.
- **Refund eligibility is judged against a per-order snapshot, never live seller settings.**
  Changing your refund policy never revokes or grants a right on orders placed under the old
  policy. This applies symmetrically — a seller who *tightens* their window after the fact still
  honors the old window for existing buyers, and one who *loosens* it doesn't retroactively grant
  it either.
- **`buttonAction: 'redirect'` bypasses money entirely.** No order row, no delivery, no refund
  path — it's just an outbound link. Don't expect `shop_orders` rows for these products.
  `updateProduct` validates the **merged** result of existing + incoming fields specifically so a
  partial update can't switch `buttonAction` to `'redirect'` while leaving a stale
  `deliveryFileKey` around, or vice versa.
- **Free products (`priceCents = 0`) skip Stripe entirely** and are marked `paid` immediately —
  there's no "free checkout session," so don't expect a `stripeSessionId` on these orders.
- **One paid order per buyer per product.** `findPaidOrder` blocks a second purchase outright
  (409) rather than allowing repeat buys of the same digital good.
- **Downloading is a refund guard.** `firstDownloadedAt` is stamped on both file and link
  deliveries; if the seller's policy has `refundAfterDownload = false` (the default), touching
  download even once forecloses a refund for that order.
- **`AWS_S3_PRIVATE_BUCKET` is mandatory for file-delivered products** — `ShopDeliverableService`
  throws rather than silently falling back to the public bucket if it's unset. If shop file
  uploads start failing in an environment, check this env var first.
- **Pin cap is 9, gallery cap is 6, post-link cap is 3** — enforced only in the service layer for
  gallery, and in a DB `CHECK` for pins/post-links. A direct DB write (migration/backfill/seed)
  bypassing the service could violate the gallery cap silently. The DB `CHECK` constraints that
  *do* exist: `shop_pin_order_range` (1-9), `post_shop_products_position_range` (0-2),
  `group_shop_products_position_range` (0-5).
- **No Zod validation middleware on `shop.route.js`**, unlike most other route files — request
  shape validation happens inside the service methods via thrown `ApiError`s. Keep that pattern
  when adding new shop endpoints, or migrate the whole file deliberately rather than mixing
  conventions.
- **No swagger/OpenAPI annotations** on any shop route — these endpoints won't show up at
  `/api-docs`.
- **Soft delete only.** `shop_products.deletedAt` is set, never a hard delete — orders and refund
  disputes must keep resolving against a product's data indefinitely. Always filter
  `isNull(shopProducts.deletedAt)` in any new query against this table.
- **Username-keyed listing route.** `GET /api/shop/products/:username` takes a username, every
  other product route takes a UUID `:productId` — easy to mix up when wiring a client.
- **Route ordering is load-bearing** in `shop.route.js` — literal segments (`reorder`, `detail`,
  etc.) must stay declared before their corresponding `:productId`/`:username` wildcard routes, or
  Express will treat the literal word as the parameter value.

## Common Tasks

| Task | Where to look |
|---|---|
| Add a new product field | `src/db/schema/shop.js` (`shopProducts`) → migration → `ShopProductService.validate` + `buildWritableFields` + `sanitize` (remember to strip it from non-owner responses if it's sensitive). |
| Change the platform fee split | `ShopOrderService.computeFees` (`shopOrder.service.js:42-51`) — mirror any change against the talent session service's identical math if the two are meant to stay in sync. |
| Debug a stuck/duplicate order after a Stripe webhook retry | `ShopOrderService.handlePaymentWebhook` — check the conditional `WHERE status = 'pending'` update; a second webhook delivery should log "already {status}, ignoring" and no-op. |
| Debug a blocked sale ("This creator can't accept payments yet") | Check the seller's Stripe Connect `chargesEnabled` via `StripeConnectService`; see [07-payments-stripe.md](./07-payments-stripe.md) for onboarding. |
| A buyer says their download link doesn't work | Links are freshly signed per-request with a 15-minute TTL (`ShopDeliverableService.getSignedDownloadUrl`) — an old saved URL is expected to fail; have them hit `GET /api/shop/orders/:orderId/download` again. |
| Add a new refund reason | `REFUND_REASONS` in `shopRefund.service.js:14`, plus whatever the client-side enum mirrors. |
| Investigate why a shop shows no products to a non-owner | Check `social_profiles.shop_visible` for that seller — an empty list (not a 404) is the intended behavior for a hidden shop viewed by someone else. |
| Adjust pin/gallery caps | Constants at the top of `shopProduct.service.js` (`MAX_GALLERY`, `MAX_PINNED`) and the DB `CHECK` constraints in `shop.js` — update both together. |
| Work on Event Merchandise instead (physical, event-attached) | Start in `src/services/event.service.js` (`merchandise` array on create/update) and `src/services/order.service.js` (`merchandiseSelections` on checkout) — see [02-events.md](./02-events.md). |

## Related Modules

- [07-payments-stripe.md](./07-payments-stripe.md) — Stripe Checkout, Connect onboarding/payouts,
  webhook dispatch, and refund mechanics that the Creator Shop reuses directly.
- [05-talent.md](./05-talent.md) — talent profiles are the seller identity for the Creator Shop;
  shop revenue rolls into the same earnings/withdrawal system as talent sessions and priority
  messages.
- [06-organizers-venues.md](./06-organizers-venues.md) — organizers/groups can surface (but not
  sell) a talent seller's shop products on a group page; this is where "Event Merchandise" (the
  organizer/event-attached physical-item system) conceptually lives, even though its code is
  spread across event/order/refund services rather than living in its own module.
- [02-events.md](./02-events.md) — full detail on Event Merchandise: `event_merchandise` /
  `purchased_merchandise`, bundled ticket+merch checkout, and stock/refund handling.
- [04-social.md](./04-social.md) — posts can link up to 3 shop products
  (`post_shop_products`), gated to BriteSide Plus subscribers.
- [09-moderation.md](./09-moderation.md) — shop product text/media (title, description, cover,
  gallery) flows through the same content moderation pipeline as other user-generated content
  (not covered in this file — check that module if investigating a moderation hold on a listing).
