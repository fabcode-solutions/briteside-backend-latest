# Shop Courses & Services — Design

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning
**Repos affected:** `gokyro-api` (backend), `gokiro-web-app` (frontend)
**Related:** [2026-08-12-course-modules-design.md](./2026-08-12-course-modules-design.md) — this spec reuses that one's modules/lessons/attachments infrastructure for standalone (non-group) courses.

## Problem

A profile's Shop tab already has UI for two listing types beyond plain digital products — "New Course" (`Courses.tsx` → `CourseFormDialog`) and "New Service" (`Services.tsx` → `ServiceFormDialog`) — reachable via `NewListingMenu.tsx`. Both dialogs collect real, type-specific data (`listingType`, `courseModules`, `turnaround`, `cancellationPolicy`, `revisionsIncluded/Count`, `pricingModel`, `fromPrice`, `paymentMode`, `depositPercent`, `milestones`) and submit it via `useShopApi().createProduct()`/`updateProduct()`.

None of this persists. The backend `shop_products` table (`gokyro-api/src/db/schema/shop.js`) has no columns for any of it, and the shared frontend type `ShopProductInput` (`gokiro-web-app/src/types/shop.ts`) doesn't declare these fields either. Every course/service-specific field submitted today is silently dropped on save; the listing is stored as an indistinguishable plain product.

Additionally, the Course dialog's `courseModules` field is only a syllabus stub (module title + a lesson *count*, no real lesson content) — there is no way for a buyer to actually access hosted course content today. This spec fixes both: real field persistence, and turning a Shop "course" listing into an actually-hosted course by reusing the Group Courses infrastructure from the companion spec above.

## Data Model

### `group_courses` — relax the group requirement

`group_id` becomes **nullable**. A course can now exist standalone (created from the Shop tab, not tied to any group). All existing group-scoped behavior (group courses list, group course detail pages) is unaffected — those queries already filter by a specific `group_id` and simply won't return standalone courses.

### `shop_products` — additive changes

| Column | Type | Notes |
|---|---|---|
| `listing_type` | enum(`product`, `course`, `service`), not null, default `'product'` | Existing rows backfill to `'product'`. |
| `course_id` | uuid, nullable, FK → `group_courses.id`, cascade | Set only when `listing_type = 'course'`. Points at the standalone course holding real modules/lessons. |
| `service_kind` | varchar(20), nullable | Currently only `'project'`. |
| `turnaround` | varchar(100), nullable | e.g. "5 business days". |
| `cancellation_policy` | text, nullable | |
| `revisions_included` | boolean, nullable | |
| `revisions_count` | integer, nullable | |
| `pricing_model` | varchar(20), nullable | Currently only `'flat'`. |
| `from_price` | boolean, nullable | True = "starts from" display; false = flat fee. |
| `payment_mode` | enum(`full`, `deposit`, `milestones`), nullable | Display/metadata only this phase — see Payment Scope below. |
| `deposit_percent` | integer, nullable | |
| `milestones` | jsonb, nullable | `[{label, percent}]`. |

No `course_modules` column — the earlier syllabus-stub idea is dropped in favor of real hosted content via `course_id` → `group_courses` → `group_course_modules`/`group_course_lessons` (see companion spec).

### Migration

1. Add `listing_type` (default `'product'`, backfills all existing rows correctly since none had course/service data to begin with).
2. Add `course_id` + the service columns (all nullable, no backfill needed).
3. Alter `group_courses.group_id` to nullable.

## Payment Scope (this phase)

`payment_mode`/`deposit_percent`/`milestones` are captured and persisted as **display/agreement metadata only** — "what the seller and buyer agreed to." Actual charging stays a single Stripe Checkout charge for the full `priceCents`, same as every other shop product today. Building real deposit-then-milestone charge execution (multiple charges per order, a milestone-approval workflow, partial refunds) is a materially larger payment feature and is explicitly deferred to a later phase.

## Course Linking & Enrollment Flow

- `shop.controller.createProduct`: when `input.listingType === 'course'`, wraps in a transaction that also creates an empty `group_courses` row (`groupId: null`, `createdBy: req.user.id`, `title`/`description` copied from the product) and sets the new `shop_products.course_id` to it. The response includes the linked `courseId` so the frontend can redirect into the course editor immediately after creation.
- For a shop-linked course, `group_courses.is_free`/`price` are left at their defaults and ignored — `shop_products.priceCents` is the single source of truth for price.
- `groupCourse.controller` `enrollFree` and `createCheckout` reject (400) if the target course has a linked `shop_products` row — a shop-linked course can only be purchased through the normal shop checkout flow, not the course's own enroll/checkout endpoints.
- Shop order fulfillment (wherever a `shop_orders` row transitions to `paid`, or the free-order path for `priceCents = 0`): if the product's `listingType === 'course'`, also insert a `group_course_enrollments` row for the buyer (`courseId: product.courseId`, `userId: buyerId`, `amountPaid: order.chargedCents / 100`). This grants the buyer real, progress-tracked access to the course content — same enrollment table the Group Courses feature already uses, so `CourseDetails.tsx`'s existing progress/completion UI works unmodified.

## API Changes

New top-level routes, addressed without a `groupId`, reusing the existing `groupCourse` controller/service functions (which primarily key off `courseId` already):

| Method | Path | Purpose |
|---|---|---|
| GET | `/courses/:courseId` | Standalone course detail |
| PATCH | `/courses/:courseId` | Update standalone course |
| POST/PATCH/DELETE | `/courses/:courseId/modules*` | Module CRUD/reorder (same as companion spec, group-agnostic) |
| POST/PATCH/DELETE | `/courses/:courseId/lessons*` | Lesson CRUD/reorder + attachments (same as companion spec) |

Existing `/groups/:groupId/courses/*` routes are unchanged; they simply never return/operate on standalone courses (`group_id IS NULL` never matches a `group_id`-scoped query).

`shop.controller.createProduct`/`updateProduct` accept and persist the new fields; `shop_products` read endpoints include them in the response (all owner-and-public per the existing pattern — course/service fields are descriptive, not sensitive, so no new field-stripping needed beyond what already exists for `deliveryType`/`deliveryFileKey`/`deliveryLink`).

## Frontend Changes (`gokiro-web-app`)

- **`types/shop.ts`**: add `listingType`, `courseId` (course only), and the service fields to `ShopProduct`/`ShopProductInput`. Remove any reference to a `courseModules` field.
- **`Courses.tsx` (`CourseFormDialog`)**: reworked into a lighter "storefront" step — title, description, price, cover, gallery only. Drops the delivery-file-or-link section and the module-count stub entirely (neither applies to a real hosted course). On successful create, redirects the organizer to a standalone course editor instead of just closing the dialog.
- **New standalone course editor route**: a variant of `CourseDetails.tsx` (from the companion spec) addressed at something like `/shop/courses/:courseId/edit`, reusing the same module/lesson/attachment/video-upload UI, minus group-specific chrome ("Back to Group" navigation, group member-count display).
- **`Services.tsx` (`ServiceFormDialog`)**: unchanged UX — its existing fields now actually round-trip through create/update instead of being silently dropped.
- **`useShopApi.ts`**: `createProduct` return type includes `courseId` when applicable, so the dialog can redirect.

## Error Handling & Validation

- `createProduct` with `listingType: 'course'` failing partway (product created, course creation fails) must roll back the whole transaction — no orphaned `shop_products` row without its `course_id`.
- `enrollFree`/`createCheckout` on a shop-linked course return a clear 400 ("This course is sold through the shop — purchase it from the seller's shop page.") rather than a generic error.
- Deleting a `shop_products` course listing: cascades to the linked `group_courses` row (and everything under it — modules, lessons, attachments, enrollments) via the existing `course_id` FK cascade, same soft-delete-aware pattern the rest of Shop already uses for products with existing orders (need to confirm: since `shopOrders.productId` has no cascade — by design, per the schema comment, "products are soft-deleted, so an order always resolves back to its product" — deleting a course-linked product should also soft-delete, not hard-delete, to preserve that guarantee for buyers with existing enrollments).

## Testing / Verification

**Backend:** create a course-type product → verify a linked `group_courses` row exists with `group_id IS NULL` → add modules/lessons via the new top-level routes → simulate a free/paid order → verify a `group_course_enrollments` row is created → verify direct `enrollFree`/`createCheckout` calls on that course are rejected. Create a service-type product with milestones → verify fields round-trip on read after create/update.

**Frontend (manual, dev server):** Shop tab → New Course → fill storefront fields → confirm redirect into the course editor → add modules/lessons/video/attachments (reusing the companion spec's UI) → view the public shop listing → purchase as a different user → confirm real course access with progress tracking. Shop tab → New Service → fill out turnaround/milestones → save → reopen edit dialog → confirm all fields are populated from the saved record (not reset to defaults).

## Out of Scope (explicitly deferred)

Deposit/milestone charge execution (multiple Stripe charges per order, milestone-approval workflow, partial refunds tied to milestones) — flagged for a later phase once the metadata-only version ships and the client confirms priority. Subscription-tier gating for shop-linked courses is likewise not covered here (mirrors the same deferral in the companion Group Courses spec).
