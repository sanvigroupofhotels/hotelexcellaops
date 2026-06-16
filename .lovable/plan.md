# Hotel Excella PMS — Active Backlog

Goal: Operationally perfect PMS for Hotel Excella today, gradually evolving towards Multi-tenant Hotel PMS SaaS tomorrow.

## 1. Cancellation Refund Workflow
Cancel Booking → Refund Amount → Refund Mode → Negative Cashbook Entry → Activity Log.

## 2. Cashbook Audit Close (Admin only)
- Cashbook → Audit Close → select date → Confirm.
- Lock all transactions up to that date.
- After Audit Close: No Edit / No Delete for Staff, Owner, Admin.
- Show 🔒 Audited badge on locked rows.
- No unlock / reopen flow (keep simple).

## 3. Master Data Reorganization
Move hardcoded values into master data:
- Room Categories, Charge Categories, Expense Categories
- Payment Modes, Issue Types, Taxes
- Cancellation Reasons, Hotel Settings, Templates

## 4. FabHotels Gmail Email Parser
FabHotels → Booking Email → hotelexcellaoperations@gmail.com → PMS Gmail Integration → Email Parser → Create/Update Booking → House View / Dashboard / Guest Portal updated.

## 5. Hotelzify API / Webhook Integration
If APIs/webhooks available: Hotelzify → API/Webhook → PMS → Create/Update Booking.

### Common External Booking Source requirements
Store on booking:
- `source` (FabHotels | Hotelzify | …)
- `external_booking_id`
- `gmail_message_id` (Gmail imports only)
- `raw_email` (debugging)
- `parsed_at`

Prevent duplicate imports. Activity log: "Booking Imported from {source}".

Long-term: generic External Booking Sources framework supporting Gmail parser, APIs, Webhooks, CSV imports.

## 6. Quote Module Deprecation
- **Phase 1 (now)**: Remove Quote entry points from Home and Quick Actions. ✅ (already absent)
- **Phase 2**: Hotel Settings → "Enable Quotes" toggle, default OFF.
- **Phase 3**: Freeze Quote features; archive if unused.

---

## Removed from backlog
- Cashbook Day Close — not required for Hotel Excella (replaced by Cashbook Audit Close above).
- Hyberto — not applicable (replaced by FabHotels + Hotelzify above).
