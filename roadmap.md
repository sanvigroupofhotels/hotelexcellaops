# Roadmap

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
