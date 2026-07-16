## HEOS Core v1.1 — UAT Follow-up Sprint

### UAT-001 / UAT-002 — Manual Laundry Pickup

**Root cause:** In `src/routes/_authenticated/laundry.tsx`, `queuedIds` is built from every row `previewPickup` returns. But `previewPickup` seeds a row for every active linen type (heos_queue = 0 when nothing is queued). So `availableForManual = linenTypes.filter(l => !queuedIds.has(l.id))` becomes empty and the "Add linen not in queue" button never renders when the queue is empty.

**Fix:** Change `queuedIds` to only include linen types where `heos_queue > 0`, and rename the manual-picker CTA to "+ Add Manual Line" per spec. Lifecycle parity for manual lines is already correct: `createBatch` uses the same `create_laundry_batch` RPC with `qty_heos_queue = 0`, so they flow through the shared batch → return → correction → damaged/lost → vendor billing → reports/CSV engines with no branch. No further changes required for UAT-002.

### UAT-025 — Guest Portal Payment Flow

**Issue 1 (technical errors leaked to guests):** `errMsg()` in `portal.$token.tsx` returns raw `e.message`. Zod validation errors from `createRazorpayOrder`'s `inputValidator` serialize to a JSON `[{...}]` string. Sanitize `errMsg`: if the message looks like a serialized Zod / stack / JSON payload (starts with `[`/`{`, contains `"code":"invalid_`, `ZodError`, `Failed to fetch`), fall back to the friendly default.

**Issue 2 (25% Advance still asks for amount):** Two problems.

1. `PortalPaymentOptions` renders the amount input whenever `mode === "part"`. Hide it entirely when `defaultPartPercent > 0` and auto-compute `partAmt = ceil(balance * percent / 100)` (paise-safe).
2. `createRazorpayOrder` does `Math.round(data.amount)` which floors ₹0.25 → 0 and throws "Amount must be greater than zero". Rewrite to compute in paise: `amountPaise = min(round(balance*100), round(data.amount*100))`, reject only when `amountPaise <= 0`.

**Issue 3 (future custom amount):** Keep the existing three intents (`full`, `part`, `pay_at_hotel`). Add a Zod-validated `"custom"` intent slot in `PortalPaymentChoice` but don't surface it in UI yet — noted in code as the extension point. No behavioural change now.

### UAT-041 — Guest Portal Layout

- Delete the standalone `PortalPhonesCard` slot in the outer render tree; render it inside `GuestDetailsForm` as a subsection labeled "Alternate Mobile Numbers (Optional)", collapsed under the existing "Optional" disclosure? — per user spec it stays visible under Your Details, so render it as a bordered subsection just above the Optional disclosure. Reuse the existing component (still keyed by token).
- Reorder cards after the payment section: Order Food → Manage Documents → Report Complaint → Cancel Booking → Reviews → Invoice. Move `DocumentsCard` and `PortalInvoiceCard` out of their pre-payment slots.

### UAT-039 — Intelligent Signature Processing

**Approach:** Client-side canvas pipeline in `settings.branding.tsx`. No new dependencies (background-removal ML models are too heavy for the Worker/edge).

Pipeline in a new util `src/lib/signature-processor.ts`:

1. Decode uploaded image to `<canvas>`.
2. Sample corner pixels to detect paper luminance; pixels within ±Δ of that luminance → alpha 0. Mid-luminance → soft alpha ramp for smooth edges.
3. Increase contrast on remaining pixels (linear stretch of L channel) and slight sharpen (unsharp-mask via one-pass 3×3 kernel).
4. Compute non-transparent bounding box; crop with a 4px margin.
5. Export as PNG dataURL.

UI in the Branding page:

- On file pick → process → open a preview modal showing "Original" vs "Processed" side by side with Accept & Save / Reprocess / Upload Different buttons.
- Only the processed dataURL is written to `app_settings.signature_url`. Invoice/Proforma/Portal already read the same `signature_url` — no changes needed there.

### Files Changed

- `src/routes/_authenticated/laundry.tsx` — queuedIds filter + CTA label.
- `src/routes/portal.$token.tsx` — `errMsg` sanitize, PortalPhonesCard moved inside GuestDetailsForm, card reordering.
- `src/components/portal/payment-options.tsx` — hide amount input when `defaultPartPercent > 0`.
- `src/lib/portal.functions.ts` — paise-safe amount handling in `createRazorpayOrder`.
- `src/lib/signature-processor.ts` — new util (canvas-based background removal, trim, contrast).
- `src/routes/_authenticated/settings.branding.tsx` — process on upload, preview modal.

### Out of Scope

UAT-007, UAT-009, UAT-037 stay untouched per instructions.

&nbsp;

My response - 

The plan is solid overall. I only have a few comments to make it align exactly with the UAT expectations.

&nbsp;

&nbsp;

---

&nbsp;

Approved. A few comments before implementation:

&nbsp;

UAT-001 / UAT-002

&nbsp;

Approved.

&nbsp;

Please ensure the pickup composer always shows a visible "+ Add Manual Line" action, even when the queue is completely empty. This is the primary UAT expectation.

&nbsp;

&nbsp;

---

&nbsp;

UAT-025

&nbsp;

Approved with one addition.

&nbsp;

Please also ensure:

&nbsp;

Guests never see raw validation errors, JSON, stack traces or internal exception messages anywhere in the Guest Portal.

&nbsp;

All payment failures should display only friendly business messages.

&nbsp;

&nbsp;

For 25% Advance, there should be no amount input visible at all.

&nbsp;

Flow should simply be:

&nbsp;

> Select 25% Advance → Proceed to Pay → Razorpay opens with the automatically calculated amount.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

---

&nbsp;

UAT-041

&nbsp;

Approved.

&nbsp;

The new sequence should be exactly:

&nbsp;

1. Order Food

&nbsp;

&nbsp;

2. Manage Documents

&nbsp;

&nbsp;

3. Report Complaint

&nbsp;

&nbsp;

4. Cancel Booking

&nbsp;

&nbsp;

5. Review / Feedback

&nbsp;

&nbsp;

6. Invoice

&nbsp;

&nbsp;

&nbsp;

Also, Alternate Mobile Numbers should appear inside Your Details as an optional subsection, not as a separate card.

&nbsp;

&nbsp;

---

&nbsp;

UAT-039

&nbsp;

Approved.

&nbsp;

The proposed upload pipeline is exactly the direction expected.

&nbsp;

One additional request:

&nbsp;

If automatic processing cannot confidently isolate the signature (poor image quality, dark background, multiple objects, etc.), please allow the administrator to crop/select the signature region manually before processing instead of producing a poor-quality result.

&nbsp;

The objective is that every future signature upload should automatically produce a professional invoice-ready signature without requiring external image editing.

&nbsp;

&nbsp;

---

&nbsp;

Everything else looks good. Please proceed with implementation.