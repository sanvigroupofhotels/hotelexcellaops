# Booking Engine + Guest Portal Expansion — Design Proposal

This is a design-only document. No code will be written until you approve.

---

## 1. Architecture Overview

Single Lovable project + single Supabase DB. Host-header routing in `src/routes/__root.tsx` selects which "app" renders:

```
ops.hotelexcella.in    -> PMS (existing _authenticated tree)
book.hotelexcella.in   -> Booking Engine (new /be/* routes, host-rewritten to /)
guest.hotelexcella.in  -> Guest Portal (rewrites / -> /portal landing, /:token -> existing portal)
ops.hotelexcella.in/portal/<token>  -> KEEPS WORKING (no break)
```

Why one project: shared rooms, rates, bookings, customers, payments tables. Zero sync. OTA push-pull later plugs into the same inventory layer.

---

## 2. Route Structure

### Booking Engine (book.hotelexcella.in)
```
/                      Landing — hero, dates picker, "Search"
/search                Results — room cards, prices, availability
/rooms/$slug           Room detail — gallery, amenities, policies
/checkout              Guest details + add-ons + tax breakup
/checkout/payment      Payment method (Pay Now / Pay at Hotel)
/checkout/processing   Razorpay callback handler
/confirmation/$ref     Success page + portal link + WhatsApp share
/policies, /contact, /faq
```

### Guest Portal (guest.hotelexcella.in)
```
/                      Marketing splash → "Enter your booking link"
/$token                Portal home (mirrors current ops/portal/<token>)
/$token/documents      Upload ID
/$token/pay            Pay due
/$token/food           Order food (during stay)
/$token/complaint      Raise complaint
/$token/extend         Extend stay request
/$token/charges        In-house charges
/$token/invoice        Download invoice / proforma
/$token/review         Post-stay review
```

Legacy `ops.hotelexcella.in/portal/<token>` continues to work — same route file, same token, no DB change.

---

## 3. UX Flow

### Booking Engine (mobile-first, 4 thumb-taps to book)
```
[Landing]
  Dates + Guests (sticky bottom CTA "Check Availability")
       ↓
[Search Results]
  Filter chips • Room cards (image, price/night, "Select")
       ↓
[Room Detail] (optional skip)
  Gallery • Amenities • Inclusions • "Book Now"
       ↓
[Checkout — single scroll page]
  • Guest details (name, phone OTP-light, email)
  • Special requests
  • Price summary (sticky)
  • Pay Now / Pay at Hotel toggle
       ↓
[Payment]  →  Razorpay Checkout (UPI/Card/Netbanking)
       ↓
[Confirmation]
  • Booking ref • WhatsApp share • "Open Guest Portal" deep link
  • Auto-send WhatsApp + Email with portal token
```

Pay-at-Hotel path: skips Razorpay, confirms booking immediately with `status='Confirmed'`, `advance_paid=0`, portal link issued.

---

## 4. Database Changes

Minimal — reuses existing `bookings`, `rooms`, `room_rates`, `rate_overrides`, `booking_payments`, `booking_tokens`, `customers`.

### New columns (additive)
```sql
ALTER TABLE bookings ADD COLUMN source_channel text DEFAULT 'PMS';
  -- 'PMS' | 'BookingEngine' | 'Hotelzify' | 'FabHotels' | 'BookingCom' ...
ALTER TABLE bookings ADD COLUMN pay_at_hotel boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN gateway_order_id text;
ALTER TABLE bookings ADD COLUMN gateway_payment_id text;
```

### New tables (future-ready, optional now)
```sql
-- Promo codes / coupons (schema only, not enforced yet)
public.promo_codes(code, type, value, valid_from, valid_to,
                   min_nights, applicable_room_types text[], max_uses, used_count)

-- Seasonal / dynamic pricing layer (above rate_overrides)
public.rate_seasons(name, start_date, end_date, room_type, multiplier, priority)

-- OTA channel inventory map (future)
public.channel_inventory(channel, room_type, date, allotment, stop_sell)
```

### Public read access
Booking Engine runs unauthenticated. Add narrow `TO anon SELECT` policies on:
- `rooms` (only active, public-safe columns)
- `room_rates`, `rate_overrides`
- `app_settings` (branding subset)

All writes (create booking, create payment) go through a **server function** with input validation — never direct anon insert.

---

## 5. Inventory & Availability Rules

**Occupied** (block the room/date):
- Bookings with status ∈ {`Pending`, `Confirmed`, `Advance Paid`, `Full Paid`, `Checked-In`}
- `room_maintenance` rows where `active=true`
- Future: `channel_inventory.stop_sell=true`

**Available** (free the room/date):
- `Cancelled`, `No-Show`, `Checked-Out`, `Stay Completed` (already enforced in DB triggers ✓)

**Availability query** (room-type level, not room-id level — Booking Engine sells *types*, PMS assigns specific rooms at check-in):
```
available(type, date) =
  total_active_rooms_of_type
  - count(active bookings of type overlapping date)
  - count(maintenance overlapping date)
  - channel_inventory.allotment_consumed (future)
```

Server function `getAvailability(checkIn, checkOut, guests)` returns per-type:
`{ type, available_count, nightly_breakdown[], total, taxes, grand_total }`.

OTA-ready: same function will later subtract `channel_inventory` and respect stop-sell.

---

## 6. Rates & Pricing

Single source of truth chain:
```
rate_overrides (date-specific)  >  rate_seasons (range)  >  room_rates (default/weekday/weekend)
```
Resolver already exists in `src/hooks/use-resolved-rate.ts` / `src/lib/rates.ts` — extend it server-side for the engine.

Tax breakup displayed at checkout:
- Pulled from `app_settings` (GST slabs by tariff — already configured in PMS)
- Line items: Room × nights, Extra guest, Taxes (CGST/SGST split), Grand total

---

## 7. Payment Flow

**Gateway: Razorpay** (already wired — `RAZORPAY_KEY_ID`, `_SECRET`, `_WEBHOOK_SECRET` exist in secrets, webhook route already lives at `/api/public/razorpay-webhook`).

```
Checkout → createServerFn createDraftBooking()
                ↓ returns {booking_id, amount}
         → Razorpay Checkout (client SDK, key_id only)
                ↓ on success: payment_id, order_id, signature
         → createServerFn confirmPayment() verifies signature
                ↓
         → booking.status = 'Advance Paid' or 'Full Paid'
         → portal token issued, WhatsApp + email dispatched
```

**Pay at Hotel:** skip gateway, booking goes to `Confirmed` directly, `advance_paid=0`.

**Failure handling:**
- Draft booking held with `status='Draft'` for 15 min (TTL sweep job)
- On payment failure → confirmation page shows "Retry" → re-opens Razorpay with same order
- Webhook is the source of truth; client callback is best-effort
- Idempotent: webhook upserts by `gateway_payment_id`

**Retry:** if user closes browser, the draft booking holds inventory 15 min. WhatsApp "complete your booking" link uses same draft.

---

## 8. Guest Portal Integration

Zero DB changes. Reuse `booking_tokens` table and existing `src/routes/portal.$token.tsx`.

- `guest.hotelexcella.in/$token` → renders existing portal component
- `ops.hotelexcella.in/portal/$token` → continues to work (no redirect — both paths render)
- Booking Engine confirmation auto-issues a token and shares the **guest.** URL going forward
- Old WhatsApp links with ops/portal continue to work indefinitely

New portal sections (Food, Complaint, Extend, Charges, Review) reuse existing PMS tables (`tasks`, `complaints`, `booking_charges`). New tiny table only for reviews:
```sql
public.guest_reviews(booking_id, rating, comment, would_recommend, created_at)
```

---

## 9. Mobile-First Design Approach

- **Tailwind v4 breakpoints**: design at 360px first, enhance at md/lg
- **Sticky bottom CTA** on every booking step (thumb zone)
- **Single-column** everywhere; no horizontal scrolling
- **Skeleton loaders** for slow networks; cached availability per session
- **Inline date picker** (no modal) on mobile
- **WhatsApp-safe**: meta tags for rich previews; portal pages render < 1s on 3G
- **Premium feel**: hospitality typography (serif display + clean sans body), generous whitespace, hero photography
- **PWA**: installable, offline-tolerant for portal "view booking"

---

## 10. Open Questions / Assumptions

**Please confirm:**

1. **Branding for book.** — Use Hotel Excella visual identity from PMS settings (logo, colors, hero image), or do you want a separate design pass with 2-3 prototype directions before build?
2. **Inventory granularity** — Sell by **room type** (recommended; OTA-standard) or by **specific room number**? PMS already assigns specific rooms at/before check-in.
3. **Draft booking TTL** — 15 minutes acceptable to hold inventory during payment?
4. **Phone verification** — OTP at checkout (extra friction, less spam) or just collect phone (faster, current PMS behavior)? Recommend: skip OTP for v1, add later if abuse seen.
5. **Guest portal landing** (`guest.hotelexcella.in/`) — Marketing splash, or redirect to hotelexcella.in marketing site, or 404 unless token present?
6. **Reviews** — Public on website, or internal-only for now?
7. **Cancellation policy** — Self-serve cancel from portal, or "Contact hotel" only? Refund rules?
8. **Multi-room bookings** — Allow booking 2+ rooms in one transaction in v1, or single-room only and iterate?
9. **Promo codes** — Schema only now, UI in v2? Or include a simple flat-discount field at v1?
10. **Email/SMS** — WhatsApp via existing pipeline is fine; do we also send transactional email at confirmation (you have Google Mail connector)?

**Assumptions I'll make unless you object:**
- Razorpay for payments (already wired)
- Room-type level inventory
- 15-min draft TTL with cron sweep
- No OTP at v1
- guest. landing = marketing splash with "Enter booking link" input
- Self-serve cancel disabled at v1 ("Contact hotel")
- Single-room bookings at v1
- Promo codes = schema only, no UI at v1
- WhatsApp + Email confirmation

---

## 11. Phased Delivery Plan

**Phase 1 (Booking Engine MVP)** — search → checkout → Razorpay → confirmation → portal link
**Phase 2 (Guest Portal expansion)** — guest. subdomain wiring, document upload, pay due, charges view
**Phase 3 (In-stay features)** — food order, complaint, extend stay
**Phase 4 (Post-stay)** — invoice download, reviews
**Phase 5 (OTA-ready)** — channel_inventory layer, stop-sell, allotment sync hooks

Each phase ends with Deep UAT before the next.

---

Please review and:
1. Answer the open questions
2. Confirm/adjust the architecture
3. Approve phasing

I'll then write the Phase 1 implementation plan and start building.
