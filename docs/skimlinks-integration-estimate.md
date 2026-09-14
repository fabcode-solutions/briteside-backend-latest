# Skimlinks Integration — API Capability Review & Build Estimate

**Date:** 2026-08-04
**Scope:** Sub-affiliate monetization for creator outbound links, per-creator attribution, earnings dashboard, payouts.
**Source:** `developers.skimlinks.com` (Apiary blueprints, pulled 2026-08-04)

---

## 1. What Skimlinks Actually Gives You

Four separate products. Only one of them matters for per-creator attribution.

### 1.1 Authentication API
`POST https://authentication.skimapis.com/access_token`

```json
{ "client_id": "...", "client_secret": "...", "grant_type": "client_credentials" }
```

Returns `access_token` (format `{publisherId}:{timestamp}:{hash}`), `timestamp`, `expiry_timestamp`.
**Token lifetime is 7 days** (604800s in the documented example). Cache it; do not re-auth per request.

### 1.2 Link Wrapper — the monetization surface
```
https://go.skimresources.com/?id={domainId}&url={urlencoded}&xcust={tracking}&sref={referrerPage}
```

| Param | Req | Notes |
|---|---|---|
| `id` | yes | **Domain-specific** publisher ID (per registered domain, from Hub → Settings → Install) |
| `url` | yes | Destination, URL-encoded |
| `xcust` | no | **Your own tracking string — this is the creator ID carrier** |
| `sref` | no | URL of the page hosting the link |

If Skimlinks can't monetize the destination, it redirects through unmodified. No breakage on unaffiliated merchants.

⚠️ **`xcust` max length and allowed charset are not documented.** Must be confirmed with the account manager before the encoding scheme is fixed.

### 1.3 Reporting API — `https://reporting.skimapis.com/`

| Endpoint | Purpose | Rate limit (per key) | `custom_id` support |
|---|---|---|---|
| `GET /publisher/{id}/commission-report` | Raw individual commissions | 40/min, 300/hr | ✅ **filter + response field** |
| `GET /publisher/{id}/reports` | Aggregated performance | 40/min, 500/hr | ❌ |
| `GET /publisher/{id}/aggregation/v1/link-report` | Multi-dim click report (NDJSON) | **5/min**, 100/hr | ❌ |
| `GET /publisher/{id}/aggregation/v1/page-report` | Multi-dim page report (NDJSON) | 5/min, 100/hr | ❌ |
| `GET /publisher/{id}/payment-status` | Invoices, paid/unpaid | — | ❌ |
| `GET /publisher/{id}/product-report` | Products purchased | — | ❌ |
| `GET /publisher/{id}/trending-products` | Discovery / merchandising | — | n/a |
| `GET /publisher/{id}/deactivated-merchants` | Merchants that dropped out | — | n/a |

Per-IP limits apply *in addition* (e.g. commission-report: 80/min, 500/hr, 1000/day per IP).

**`commission-report` — the endpoint the whole integration hangs on**

Filters: `limit` (max **5000**), `offset`, `start_date`, `end_date` (datetime, not date), **`updated_since`**, **`custom_id`**, `merchant_id`, `a_id`, `domain_id`, `commission_id`, `status` (`active`|`cancelled`), `commission_type` (`CPA`|`CPC`|`CPL`|`Flat-fee`|`Performance`), `sort_by` (`id`|`transaction_date`), `sort_dir`.

Response fields: `custom_id`, `publisher_amount`, `order_amount`, `currency`, `status`, `payment_status`, `transaction_date`, `last_updated`, `commission_id`, `commission_type`, `aggregation_id`, `invoice_id`, `publisher_domain_id`, `merchant_details{merchant_id, merchant_name}`, `advertiser_id`, `advertiser_name`, `click_details{clicked_url, page_url, normalized_page_url, normalized_page_referrer, user_country, platform}`, `transaction_details{basket{items}}`, plus `pagination{limit, offset, total_count, has_next}`.

Two behaviours from the docs that drive the data model:
- **Reversals/cancellations arrive as separate rows with a negative `publisher_amount`.** Not as an update to the original row.
- **`updated_since` exists specifically because commissions mutate** (refunds, cancellations) after the fact.

**Aggregated endpoints** (`/reports`) group by `page | date | device | country | domain | link | merchant | network_payout_type`; max 600 rows; `currency` override available.
**Multi-agg** (`link-report`) takes up to 4 `dim` from `advertiser_id, date, device_type, merchant_id, page_url, platform_id, publisher_domain_id, skim_product_id, target_url, user_ip_country` and `met` from `clicks_count_total, items_count, order_amount[_eur|_gbp|_usd], publisher_commission_amount[_eur|_gbp|_usd], sales_total`. Streams NDJSON with `X-Count` / `X-Has-Next` headers; limit 10k–100k rows. Docs note its sale counts **match the Hub exactly**, unlike commission-report.

### 1.4 Merchant API — `https://merchants.skimapis.com/v4/`
`/v4/publisher/{id}/merchants` (search, vertical, country, favourites), `/v4/publisher/{id}/domains`, `/v4/verticals`, `/v4/alternative_verticals`, `/v4/publisher/{id}/offers`. Entities carry commission **`Rate`** objects and **`Offer`** (deals/coupons). v3 (`apikey`-based) is deprecated.

Useful for merchant discovery / "which brands pay what" UI. Not needed for monetization.

### 1.5 DataPipe — bulk export
Daily export to **GCS (preferred) or S3**, AVRO or CSV. Four datasets: **clicks, page impressions, commissions, product purchases**.

**All four datasets carry `xcust`.** Clicks/impressions partitioned by `date`; commissions/products partitioned by `snapshot_date` (mutable). 30-day retention if the bucket is Skimlinks-owned.

Requires **managed-publisher status** and an account-manager setup process. This is the escape hatch from Reporting API rate limits and the only way to get **per-creator click data from Skimlinks**.

---

## 2. The Constraint That Shapes Everything

> **`custom_id` / `xcust` appears on exactly one Reporting API endpoint — `commission-report` — and nowhere in any aggregated endpoint's dimension list.**

Four consequences, all of which change the build:

**(a) You cannot ask Skimlinks "how much did creator_123 earn".**
Per-creator revenue has to be built by pulling raw commission rows into Postgres and aggregating locally. There is no server-side group-by-creator.

**(b) Do not loop the API per creator.**
`custom_id` is a filter, so `GET ?custom_id=X` per creator is *technically* possible and *operationally fatal* — 300 requests/hour means ~300 creators/hour ceiling, and it wastes the entire budget re-fetching unchanged data.
Correct pattern: **one nightly account-wide sweep using `updated_since`**, paginated at 5000/page, then fan out to creators locally by `custom_id`. Same sweep also picks up refunds and cancellations for free.

**(c) Per-creator clicks are not available from the Reporting API at all.**
Briteside must own the redirect and count its own clicks. This is genuinely better (real-time, no rate limit, full control) but it means Briteside's click numbers will never exactly equal Skimlinks'. Pick one as canonical for creator-facing CTR and label it.
✅ Good news: `src/services/trackingLink.service.js` + the `tracking_links` / `tracking_link_clicks` tables already do this, including 24h dedup per (link, user) / (link, IP).

**(d) The commission ledger must be append-only with signed amounts.**
Reversals are separate negative rows. An upsert-by-`commission_id` model will silently overwrite and corrupt balances.

---

## 3. What Already Exists in the Codebase

Substantial reuse available — this is why the estimate isn't larger.

| Need | Already there |
|---|---|
| Stripe Connect onboarding | `services/stripeConnect.service.js`, `db/schema/stripeConnect.js` |
| Hold-then-transfer payout pattern w/ idempotency keys | `cron/reserveRelease.js` (233 lines) — near-identical shape to pending→locked affiliate release |
| Cron registry | `cron/cronJobs.js` (node-cron), 20+ jobs registered |
| Earnings dashboard service (date bucketing, chart building, stats, fee splits) | `services/organizerEarnings.service.js` (469 lines) — directly adaptable |
| Earnings dashboard precedents (3×) | `organizerEarnings`, `talentEarnings`, `groupEarnings` + `adminEarnings` controllers |
| Click tracking + redirect + dedup | `services/trackingLink.service.js` (237 lines), `db/schema/trackingLinks.js` |
| Migrations | Drizzle, `src/db/migrations/` |
| Secrets | AWS Secrets Manager loader (existing pattern) |

⚠️ `tracking_links` has **NOT NULL FKs on `event_id` and `organizer_id`**. Reusing it for creator product links is a real migration with a backfill, not an additive column.

---

## 4. Estimate

Dev-days for one senior full-stack dev, including self-test. Excludes Skimlinks' own approval lead time.

### Phase 0 — Commercial prerequisites · **0 dev days, 1–3 weeks calendar · BLOCKING**
- Skimlinks **sub-affiliate / platform agreement** (see Risk 1 — this is not the self-serve publisher signup)
- Obtain `client_id` / `client_secret`, `publisher_id`, domain-specific link-wrapper `id`
- Confirm `xcust` max length + charset
- Confirm managed-publisher status (gates DataPipe)

**Start this today.** It's the long pole and it costs one email.

### Phase 1 — Link wrapping + click tracking · **5–7 days**
| Task | Days |
|---|---|
| Config + secrets wiring | 0.5 |
| URL wrapper util (merchant detection, encoding, `id`/`xcust`/`sref` injection, passthrough, malformed-URL guard) | 1.5 |
| `xcust` encoding scheme (short, opaque, stable, reversible + mapping table) | 0.5 |
| Generalize `tracking_links`/`tracking_link_clicks` off `event_id`/`organizer_id` → polymorphic owner (migration + backfill + service refactor) | 2.0 |
| `GET /r/:code` redirect: record click, 302 to wrapped URL, bot filter | 1.0 |
| Tests | 1.0 |

### Phase 2 — Ingestion pipeline · **7–9 days**
| Task | Days |
|---|---|
| Auth client: 7-day token cache, refresh-on-401, single-flight | 1.0 |
| Rate-limited HTTP client: token bucket per endpoint (link-report is 5/min!), 429 backoff | 1.5 |
| Schema: `skimlinks_commissions` (append-only, signed), `skimlinks_sync_state` (cursor), `skimlinks_creator_ledger`, `skimlinks_invoices` | 1.5 |
| Nightly `updated_since` sweep: cursor, 5000/page pagination, idempotent insert, reversal handling | 2.5 |
| Attribution mapper: `custom_id` → creator, **orphan bucket** for unmatched | 1.0 |
| `payment-status` sync → invoice reconciliation | 1.0 |

⚠️ The orphan bucket is real money (deleted creators, malformed `xcust`, Skimlinks-JS clicks with no `xcust`). Needs a product decision on where it lands.

### Phase 3 — Revenue split + payout engine · **6–8 days** · *highest risk*
| Task | Days |
|---|---|
| Split config: platform %, per-creator override, **effective-dated** so rate changes don't rewrite history | 1.5 |
| Ledger state machine: `pending → locked → available → paid_out → reversed` | 2.0 |
| Weekly Friday payout cron: threshold, aggregate, Stripe transfer, idempotency (adapt `reserveRelease.js`) | 2.0 |
| Negative-balance / clawback: reversal landing *after* payout → carry negative forward, never reverse-transfer | 1.5 |
| Tests incl. reversal-after-payout | 1.0 |

Money correctness. Reversal-after-payout is guaranteed at scale and is the classic affiliate-platform bug.

### Phase 4 — Creator dashboard API + UI · **7–9 days**
| Task | Days |
|---|---|
| Endpoints: summary (available/pending/lifetime), timeseries, top links, top merchants/products, payout history — reuse `organizerEarnings` bucketing helpers | 2.5 |
| UI: 3-tile summary, chart, top-links table, payout history, empty/loading/error states — clone existing earnings dashboards | 4.0 |
| Connect onboarding entry point (mostly exists) | 0.5 |
| Threshold + "next payout Friday" messaging | 0.5 |
| Responsive polish | 1.0 |

### Phase 5 — Admin / ops · **4–5 days** · *non-negotiable*
| Task | Days |
|---|---|
| Platform dashboard: GMV, total commissions, platform take, top creators, orphan bucket | 2.0 |
| Reconciliation: Skimlinks invoice total vs sum of creator ledger, drift alerting | 1.5 |
| Manual re-sync trigger + sync health observability | 1.0 |

Without reconciliation you will not notice when the nightly sweep silently misses a day.

### Phase 6 — Hardening + launch · **4–5 days**
E2E on staging with live data (1.5) · historical backfill (0.5) · alerts for sync failure / 429 storms / ledger drift / payout failure (1.5) · docs + runbook (1.0)

### Totals

| | Dev days |
|---|---|
| Phases 1–6 | **33–43** |
| +15% third-party integration overhead | **38–49** |

| Staffing | Calendar |
|---|---|
| 1 senior dev | **8–10 weeks** |
| 2 devs (1 backend P1–3+5, 1 frontend P4) | **5–6 weeks** |

**Realistic: first creator sees real earnings ~7–9 weeks from today**, assuming Skimlinks approves the sub-affiliate arrangement inside the first 2 weeks (Phase 0 overlaps Phase 1–2 dev).

---

## 5. Recommended MVP Cut — **15–19 dev days / ~4 weeks**

- **Phase 1 in full** — non-negotiable, see below
- Phase 2 minus `payment-status` sync
- Phase 3 with **manual** payouts (CSV export + admin-triggered batch, no Friday cron)
- Phase 4 reduced to the summary tile + top links (no charts)
- Phase 5 reduced to the reconciliation view

Deferred: automated weekly payouts, charts, trending products, merchant catalog, clawback automation.

**Why Phase 1 can't be cut:** link wrapping is the only irreversible piece. Every day a creator posts an unwrapped link is commission that can never be recovered. Dashboards and payout automation can lag — you can pay by hand for the first month and backfill the UI later.

---

## 6. What NOT to Build in v1

| Skip | Why |
|---|---|
| Merchant catalog browsing, trending products, offers/coupons UI | Merchant API + `trending-products`. Demos well, ~8–10 extra days, **zero revenue impact at launch**. It's discovery, not monetization. |
| Aggregated `/reports` or `link-report` for creator dashboards | Cannot group by `custom_id` → useless per-creator. Use them **only** for platform-level admin totals and cross-checking. |
| DataPipe | Needs managed-publisher status + negotiated setup + a whole GCS/S3 ingestion path. Revisit when volume makes 300/hr bite — with `updated_since` sweeps that's a long way off. |

---

## 7. Risks & Assumptions

1. **🔴 BLOCKING — commercial, not technical.** Skimlinks must contractually approve **sub-affiliating to third-party creators**. Standard publisher T&Cs generally cover traffic from *your own* sites. If they refuse, this plan is dead and the alternative is Sovrn / CJ / Impact. **Validate before writing any code.** Biggest risk in the plan; cost to de-risk is one email.
2. **`xcust` length/charset undocumented.** Design the encoding short. If the cap is 50 chars a raw UUID (36) fits but leaves no room for a link ID alongside it.
3. **Click counts will diverge.** Yours (own redirect) vs Skimlinks' (their pipeline). Decide which is canonical for creator-facing CTR — recommend yours, clearly labelled.
4. **"Weekly Friday payouts" only applies to already-locked funds.** Merchant return windows are 30–90 days, then Skimlinks' own invoice cycle on top. Set creator expectations in the UI copy or you get support tickets on day one.
5. **Sale counts legitimately disagree between endpoints** (reversals as separate rows — stated in the docs). Never show two numbers sourced from both `commission-report` and `/reports` on the same screen.
6. **Rate limits are per-apikey AND per-IP.** Multi-instance API behind one NAT shares the per-IP budget. The sweep must be a single leader-elected job, not per-instance. Cron currently initializes in `app.js` — confirm instance count before shipping.
7. **Currency.** Skimlinks converts to the publisher's preferred currency using OpenExchangeRates *as of the conversion day*. Store the delivered `currency` + amount and never re-convert, or historical totals will drift.

---

## 8. Immediate Next Actions

1. Email Skimlinks: sub-affiliate/platform agreement + `xcust` limits + managed-publisher status. **(today — blocks everything)**
2. Product decision: platform/creator split %, payout threshold ($10–25), orphan-commission destination.
3. Decide `xcust` encoding scheme (pending answer on #1's length limit).
4. Confirm production API instance count (Risk 6).
