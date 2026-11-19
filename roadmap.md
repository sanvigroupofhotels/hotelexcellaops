# Roadmap

## Current request — Owner access and five-minute abandonment
- [x] Give Owner/Admin full page access through authenticated roles and permissions; named owner verified on user management, roles, access, settings, calendar, owner reports, housekeeping and laundry with no runtime errors and no missing admin permissions.
- [x] Set abandonment to five minutes and check each minute; saved settings and active schedule verified, 29 focused regressions passed.

## Current request — configurable OTA imports and WhatsApp abandonment
- [x] Add configurable room-count, payment-mode and category mappings with generic provider parsing.
- [x] Preserve GST-inclusive OTA totals, record prepaid payments only, expand rooms and recover orphan imports; TU7C6I restored with three rooms, five guests and ₹14,601 inclusive total. Preserve staff-assigned/check-in room rows and existing receipts.
- [x] Hide all pre-selection WhatsApp charges and capture unfinished room selections in leads/inbox/notifications; valid guest contact required, existing 10-minute abandonment window verified.
- [x] Run 250 rule regressions and verify public capture, signed-in inbox, abandoned alert, configurable parser preview, live OTA recovery and idempotent prepaid replay; temporary data removed.

## Previous request — WhatsApp booking form only
- [x] Hide room-category tariffs before selection and use the approved actual-prices request notice; verified live phone/desktop selection and deselection, GST-inclusive ₹2,500 breakdown and 15 regression tests; full WhatsApp message unchanged.
- FabHotels/OTA pricing, payments, multi-room allocation and recovery are deferred to a separate request.

## Phase 1 — guest bookings, breakdowns and alerts
- [x] Correct multi-room early check-in, late check-out and extra-adult quantities through shared pricing; verified BE-261118-5RIC in reception, proforma and guest portal.
- [x] Add zero-default room-category selectors, children, live rates and sticky estimated total; require at least one room. Desktop and 390px phone layouts verified.
- [x] Persist mixed-category requests with canonical allocation and atomic server-side inventory validation; verified Oak + Mapple and child allocation.
- [x] Ensure unpaid WhatsApp bookings reach the linked inbox and notification bell; verified real test submission and signed-in read-back.
- [x] Repair operational push audience targeting and subscription recovery; authenticated dispatch accepted by both registered devices (sent 2, pruned 0).
- [x] Run 236 regression tests and verify guest submission, saved rooms, inbox and alerts end-to-end; remove test booking data.
- [ ] Phase 1 release and physical-phone checks: publish latest changes, then verify notification display with app closed/backgrounded and after reinstall — requires publication and access to the user's phone.

- [x] Complete status-aware booking invoice action and company/GST editing in reception and guest invoice menus.
- [ ] Remove synthetic adjustment rows by allocating recorded accommodation totals to room rates; preserve real extras, charges, discounts and tax.
- [ ] Verify three real bookings, company billing read-back, PDF downloads and phone layout; save completed changes.

- [x] Upgrade the shared invoice model, PDF and viewer across reception, House View, guest portal and read-only integrations; verified real booking invoice download and 29 financial/identity safeguards.
- [x] Centralize editable hotel/legal identity, contact, logo, signature and footer in Branding, preserving existing settings.
- [x] Add guest company/GST editing through the existing customer profile; verified saved billing details and desktop PDF with the supplied crown and existing signature.
- [x] Fix the existing notification-bell hook-order crash encountered while checking phone invoices; no notification operations changed.

- [x] House View: desktop second row with Legend, date navigation, wide Search and Stats last; mobile Legend in ROOM opens a shared-content dialog. Preview build OK and 38 occupancy/display regression tests pass; hotel operations unchanged.
- [ ] Verify the revised House View desktop/mobile controls with live bookings — blocked on preview sign-in; own-account session mint found no matching user, and multiple users prevent automatic selection.

- [x] Replace the earlier opening sequence with one authentic crown-logo reveal and matching login branding; desktop/mobile rendering, once-per-session playback, reduced motion and 10 safeguards verified.

- [x] Add automatic browser-side photo compression to guest IDs, staff documents, receipts, and payment screenshots; six safeguards pass, real browser sample shrank 91% with readable text, PDFs unchanged.
- [x] Add a brief gold hotel crest opening animation with reduced-motion support; desktop/mobile crest rendering, fade-out and reduced motion verified without console errors.
- [ ] Verify a saved photo upload and read-back through the staff/guest UI — blocked until the user signs in to the preview; own-account session mint found no matching account.
- [x] Part 1: Replace startup and login logo with the supplied white-background logo, preserving the existing animation; phone/desktop inspected using the registered asset's exact pixels because localhost does not serve the asset CDN path.
- [x] Part 2: Add expected arrival/departure slots, visible per-room charges and Best Price Assured; save flags through canonical per-room booking allocation/pricing; 35 safeguards and phone/desktop form interactions pass.
- [ ] Verify Part 2 saved booking, timing charges, and House View read-back with a real request — blocked on staff sign-in; own-account session mint found no matching account.
- [ ] Part 3: Live/History WhatsApp inbox, internal notes, direct quote, payment link and one-click dispatch — paused at budget checkpoint because the remaining estimate risks exceeding this request's 3-credit cap.
- [x] Check recorded build-credit use between parts; stopped before Part 3 at 2.00 credits recorded, reserving the remainder for verification and saving completed work.

- [x] Restrict Cancel and No-Show to owner/admin across UI, shared calls, database writes, and the guest portal; no approval workflow.
- [x] Run 64 focused permission/lifecycle/display regression tests and verify the admin cancellation control in the preview; staff UI remains unverified because no staff test account was selected.

- [x] Fix only House View grouped multi-day booking rendering; 38 targeted display and occupancy regression tests pass, preview build OK; operational engines unchanged.
- [ ] Verify HEXB-0241CF visually in authenticated House View — blocked until the user signs in to the preview.

- [x] Register a dedicated confidential OAuth client for MuleSoft with `https://mulesoft.com` as its exact redirect URI.
- [x] Verify OAuth discovery, client registration, callback binding, and MCP protection remain intact.
- [x] Provide the MuleSoft Client ID and Client Secret through a private deliverable.
- [x] Apply the required routine package security update and confirm the preview build remains healthy.
- [x] Provision a dedicated `mulesoft@hotelexcella.in` owner-equivalent service identity on first authenticated use.
- [x] Add a MuleSoft-only client-credentials adapter and dedicated MCP endpoint without changing Claude OAuth.
- [x] Verify deployed MuleSoft token issuance, MCP initialization, `whoami`, and all 21 registered read-only tools after publishing.
