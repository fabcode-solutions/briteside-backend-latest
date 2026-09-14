# Tax Flow Plan — Event Marketplace Platform

**Prepared for:** Client Review  
**Date:** 2026-05-19  
**Source:** Stripe Tax official documentation (API version 2026-03-25)  
**Status:** Pre-Implementation Planning

---

## 1. Platform Type & Legal Classification

This platform is a **Marketplace Facilitator** — the US legal term for platforms that:
- Enable transactions between buyers and sellers (organizers)
- Directly or indirectly collect customer payments

**In Europe**, this is called a **"deemed seller"**.

Many US states and countries legally require marketplace facilitators to collect, report, and remit sales tax and VAT on all facilitated sales — regardless of whether individual organizers are registered for tax themselves.

| Entity | Tax Role |
|---|---|
| **Platform** | Marketplace facilitator — liable for tax collection & remittance |
| **Organizer (Connected Account)** | Seller — receives net payout, has no individual tax obligation |
| **Buyer** | Pays tax at checkout |

**Key implication from Stripe docs:** Connected accounts (organizers) do not collect or file taxes. Their tax status columns in the Stripe dashboard will appear empty. All tax is calculated and managed through the platform account only.

---

## 2. How Stripe Tax Works for This Platform

Stripe Tax automates tax calculation across 100+ countries. For this platform:

- Tax is calculated based on the **platform account's** head office location, tax codes, and active registrations — not the organizer's account
- Stripe determines the correct rate automatically based on the **event venue location** (for tickets) or **buyer's shipping address** (for merchandise)
- Stripe generates reports per jurisdiction for remittance
- Stripe does **not** auto-file — the platform or its accountant files using Stripe's reports

### Setup Steps (Official Stripe Sequence)

1. Configure platform account tax settings (head office, preset tax code, registrations)
2. Assign tax codes to ticket and merchandise products
3. Enable `automatic_tax` in checkout with `liability[type]=self`
4. Withhold collected tax from organizer payouts
5. Access Stripe Tax reports monthly/quarterly for filing

---

## 3. Charge Type — Destination Charges Required

**Important Stripe constraint:**

> Direct charges are NOT supported when the platform is liable for tax.

This platform must use **Destination Charges** exclusively:

| Charge Type | Supported for platform tax liability? |
|---|---|
| Direct charges | **No — not supported** |
| Destination charges | **Yes — required** |

Destination charges: payment is processed on the platform's Stripe account, then funds are transferred to the organizer's connected account. The platform retains the tax amount before transferring.

---

## 4. How Tax Is Calculated for Event Tickets

### Rule: Tax follows the event venue location

If a buyer in New York buys a ticket for an event in Denver, Colorado — Colorado tax applies, not New York. This is achieved via Stripe's **Performance Location** object.

**Performance Location** = a saved venue address registered in Stripe. Each event venue gets a `taxloc_xxx` ID stored against that event.

### Ticket Tax Codes

| Tax Code | Description | Use When |
|---|---|---|
| `txcd_50010001` | Admission to Amusement, Entertainment & Recreation | Concerts, festivals, conferences, sports |
| `txcd_10401000` | Admission to Cultural Events | Museums, galleries, exhibitions |
| `txcd_10000000` | General Services | Fallback |

**Note:** `txcd_50010001` has `location_requirement: required` — a Performance Location ID **must** be passed or Stripe returns an error.

---

## 5. How Tax Is Calculated for Merchandise

### Rule: Merchandise tax follows the buyer's shipping address

| Tax Code | Description |
|---|---|
| `txcd_99999999` | General Physical Goods |
| `txcd_30060006` | Clothing / Apparel |
| `txcd_81100000` | Books |

**Stripe constraint:** Only one shipping address per transaction. If a buyer purchases ticket + merchandise in the same checkout, all physical goods are taxed at that single shipping address.

---

## 6. Virtual Events — How Tax Is Calculated

> **Correction from Stripe docs:** Stripe offers **14 event-specific tax codes total** — the same 14 codes apply to both live and virtual events. There is no separate virtual-only category. `txcd_50010001` is valid for both.

### Key Difference from Physical Events

| Aspect | Physical Event | Virtual Event |
|---|---|---|
| Performance Location | Venue address (required) | Platform's business address (used as proxy) |
| Tax determination | Based on venue jurisdiction | Varies — see options below |
| Tax code | Same 14 event codes | Same 14 event codes |

### How Jurisdictions Treat Virtual Events (Two Approaches)

Virtual events have no physical venue. Different jurisdictions classify them differently, and the correct approach depends on legal/tax advice per jurisdiction:

**Option A — Treated as Admission Fees (use event tax codes)**
- Use the same event tax codes (e.g., `txcd_50010001`)
- Pass the **platform's business address** as the `performance_location`
- Stripe calculates tax as if the event happens at the platform's location
- Applies in jurisdictions that treat online admission the same as physical admission

**Option B — Treated as Digital Services (use digital product tax codes)**
- Use digital service codes instead: `txcd_10000000` (General — Electronically Supplied Services)
- No `performance_location` required
- Tax is based on the **buyer's location**
- Applies in jurisdictions that classify virtual events as electronic services

### Which Option to Use

There is no single universal answer. Tax treatment for virtual events **varies by jurisdiction**:
- Some US states tax virtual event access as admission
- Others treat it as a digital product with different rates or exemptions
- EU/UK typically treats online events as electronically supplied services (buyer's location)

**Legal/tax advice is required** before selling virtual event tickets internationally or at significant US scale.

### Stripe's Default Recommendation

Stripe's preset product tax code for events is `txcd_20030000` (General — Services) — this serves as the safe fallback when no specific code has been assigned. Use it as the platform default; assign specific codes per event type as the business grows.

### All 14 Stripe Event Tax Codes

Stripe provides 14 event-specific tax codes (public preview). View the full list at the [Stripe product tax code reference for events](https://docs.stripe.com/tax/tax-codes?type=events#all-tax-codes). Most common for this platform:

| Tax Code | Description |
|---|---|
| `txcd_50010001` | Admission to Amusement, Entertainment & Recreation — Participant |
| `txcd_50010002` | Admission to Amusement, Entertainment & Recreation — Spectator |

> **Note:** Event tax codes cannot be set as the platform's default product tax code. The default must be `txcd_20030000` (General — Services).

### Mixed Physical + Virtual Events on the Same Platform

The platform has both event types (confirmed in codebase: `eventVirtualDetails` schema exists). Each event needs a flag (e.g. `isVirtual`) so checkout logic knows:

- Physical event → pass venue `performance_location` (`taxloc_xxx`)
- Virtual event → pass platform business address as `performance_location` OR omit and use digital service tax code — **depends on jurisdiction classification decision**

This is a required implementation distinction and a decision the client must make with their tax advisor before development begins.

---

## 7. Mixed Cart (Ticket + Merchandise)

Both can be in the same Checkout Session. Stripe splits taxation automatically:

```
Buyer in Chicago purchases:
  ├─ Ticket to Boulder, CO event     → taxed at Boulder, CO rates
  └─ Event T-Shirt (ships to Chicago) → taxed at Chicago, IL rates

One checkout. Stripe calculates each line item independently.
```

- Physical ticket → `tax_code: txcd_50010001` + `performance_location: taxloc_xxx` (venue address)
- Virtual ticket → `tax_code: txcd_50010001` + `performance_location:` platform business address (OR digital service code — per tax advice)
- Merch line item → `tax_code: txcd_99999999` (uses buyer's shipping address)

---

## 7. Tax Withholding from Organizer Payout

Stripe does not automatically withhold tax from the organizer payout. **The platform must do this explicitly.**

Two official Stripe options:

### Option A — Reduce `transfer_data[amount]` (Recommended)

Exclude the tax amount from what gets transferred to the organizer:

```
Total charge:         $100.00
  Platform fee (10%): -$10.00
  Tax collected:       -$8.50
  ─────────────────────────
  Organizer receives:  $81.50
  Platform retains:    $18.50 ($10 fee + $8.50 tax)
```

### Option B — Include tax in `application_fee_amount`

Platform fee includes the tax amount. Same end result — organizer doesn't receive tax money.

**Rule:** Tax collected must stay with the platform so it can be remitted to the relevant tax authority. It must never be included in organizer payouts.

---

## 8. Complete Transaction Flow

```
STEP 1 — Organizer Creates Event
│
├─ Organizer enters venue address (city, state, country)
├─ Platform calls Stripe: create Performance Location → gets taxloc_xxx ID
└─ taxloc_xxx stored against the event in platform database

STEP 2 — Organizer Assigns Tickets & Merchandise
│
├─ Ticket product → tax_code: txcd_50010001
├─ Merch product  → tax_code: txcd_99999999 (or specific clothing/book code)
└─ Tax behavior set per product: exclusive (US) or inclusive (EU/UK)

STEP 3 — Buyer Checkout
│
├─ Buyer selects items, enters shipping address
├─ Platform creates Checkout Session:
│    ├─ automatic_tax: { enabled: true }
│    ├─ automatic_tax.liability: { type: "self" }  ← platform is liable
│    ├─ payment_intent_data.transfer_data.destination: organizer_stripe_id
│    ├─ Ticket line item: { tax_code, performance_location: taxloc_xxx }
│    └─ Merch line item:  { tax_code }  (uses shipping address automatically)
└─ Stripe calculates exact tax per line item, per jurisdiction

STEP 4 — Payment Captured
│
├─ Total charged = ticket + merch + taxes (shown separately to buyer)
├─ Tax amount recorded on the payment
└─ Stripe logs tax transaction for reporting

STEP 5 — Organizer Payout
│
├─ Platform transfers: (revenue − platform fee − tax amount) to organizer
├─ Tax amount stays in platform Stripe balance
└─ Organizer receives net payout with no tax obligations

STEP 6 — Tax Remittance (Monthly/Quarterly)
│
├─ Platform downloads Stripe Tax reports from dashboard
├─ Reports show: tax collected per jurisdiction, per time period
└─ Platform or accountant files and remits to each relevant state/country
```

---

## 9. Tax Registration — Who Does It & Where

### Who registers: The Platform

The platform registers for tax collection in each jurisdiction where events are held. Organizers have no registration obligation.

### When registration is required (US)

| Trigger | Typical Threshold |
|---|---|
| Revenue in a state | $100,000+ per year |
| Transaction count in a state | 200+ transactions per year |

Stripe Tax monitors nexus thresholds and alerts when approaching. Platform must register **before** collecting tax in a jurisdiction.

### Non-US / EU

Many EU countries require VAT registration from the **first sale** — no revenue threshold. Legal advice is required before selling to EU buyers or hosting EU events.

### Registration Process

1. Accountant registers the business in required states/countries
2. Active registration is added in Stripe Dashboard → Tax → Registrations
3. Stripe begins collecting tax in that jurisdiction from that date onward

**No code required for registration management.** This is a Stripe dashboard operation.

---

## 10. Inclusive vs Exclusive Tax Display

| Mode | Buyer sees | Example ($50 ticket, 10% tax) |
|---|---|---|
| **Exclusive** | Tax added at checkout | $50.00 + $5.00 tax = **$55.00 total** |
| **Inclusive** | Tax baked into price | **$50.00 total** (includes $4.55 tax) |

**Recommendation:**
- US events → **Exclusive** (standard expectation)
- EU/UK events → **Inclusive** (legal norm, prices must be shown VAT-inclusive)

---

## 11. What Needs to Be Built

| Feature | Description | Effort |
|---|---|---|
| Performance Location creation | On venue save: create `taxloc_xxx` in Stripe, store ID on event | Low |
| Tax code on products | Ticket products auto-assigned `txcd_50010001`; merch products assigned by category | Low |
| Checkout Session update | Add `automatic_tax`, `liability[type]=self`, `transfer_data.destination`, `performance_location` per ticket line item | Medium |
| Tax withholding on payout | Adjust `transfer_data[amount]` to exclude tax before organizer payout | Medium |
| Tax storage on payment | Store tax amount on payment record for reconciliation | Low |
| Tax reporting | Stripe Tax dashboard provides built-in reports — **no custom build needed** | None |

---

## 12. What the Client (Platform Owner) Must Do Before Launch

1. **Consult a tax accountant** — determine which states require registration based on current or projected volume
2. **Register in required states** — file for sales tax permits (via each state's revenue website)
3. **Configure Stripe Tax** — in Stripe Dashboard → Tax: set head office location, preset tax code, add active registrations
4. **Decide: inclusive or exclusive** — communicate to organizers how ticket prices should be listed
5. **Inform organizers** — they have no tax liability; their payouts will exclude collected tax amounts

---

## 13. What Organizers Need to Know

- They are **not** liable for tax — the platform collects and remits on their behalf
- Their listed ticket prices are **pre-tax** (if exclusive mode used)
- Their payout will not include the tax collected — tax stays with the platform
- They must enter **accurate venue addresses** — venue location determines which tax rates apply
- Merchandise must be categorized correctly (clothing vs general goods) at listing time

---

## 14. Key Decisions to Make Before Implementation

| Decision | Options | Recommendation |
|---|---|---|
| Tax display | Inclusive vs Exclusive | Exclusive for US |
| New state activation | Admin manually adds registrations vs auto-trigger on new venue | Start manual, automate in v2 |
| International scope | US-only vs global | US-only first; expand with legal guidance |
| Tax filing | Platform/accountant manually vs Stripe Tax Assist (Stripe files, paid add-on) | Manual if low volume; Stripe Tax Assist when scaling |
| Mixed cart merch shipping | Single shipping address per order (Stripe limit) | Accept; document clearly in checkout UI |

---

## 15. Summary — Quick Reference

| Question | Answer |
|---|---|
| Legal classification | Marketplace Facilitator (US) / Deemed Seller (EU) |
| Who pays tax? | The buyer (added at checkout) |
| Who collects tax? | The platform (via Stripe Tax) |
| Who remits tax to authorities? | The platform (files with each state/country) |
| Do organizers register for tax? | No |
| Does Stripe charge type matter for tax? | Yes — must use Destination Charges; Direct Charges not supported |
| Can tax differ by event location? | Yes — physical events use venue location; virtual events use buyer's billing address |
| Is merchandise taxed differently? | Yes — buyer's shipping address, different tax code |
| Can ticket + merch be in one checkout? | Yes — Stripe splits tax per line item automatically |
| Does Stripe auto-file taxes? | No — Stripe collects and reports; platform files |
| Is this production-ready in Stripe today? | Yes — Stripe Tax + Performance Locations is GA |
| What if platform sells in unregistered state? | Non-compliant — must register before collecting tax there |

---

*This document is a planning reference for client communication. Final implementation subject to technical decisions and legal review.*
