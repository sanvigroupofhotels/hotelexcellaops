/**
 * Copilot booking preview + creation. Reuses the canonical engines only:
 * rates (resolveAverageRate), inventory (getRoomTypeAvailability), guest
 * allocation, pricing (computePricing) and creation (submitNewBooking).
 */
import type { CopilotDraft } from "@/lib/copilot.functions";
import { listRoomRates, listRateOverrides } from "@/lib/rates-api";
import { resolveAverageRate } from "@/lib/rates";
import { getRoomRate } from "@/lib/mock-data";
import { getRoomTypeAvailability, maxSelectableRooms } from "@/lib/room-inventory";
import { allocateGuestsToLines } from "@/lib/guest-allocation";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";
import { submitNewBooking } from "@/lib/booking-create";
import { getPaymentSettings, DEFAULT_PAYMENT_SETTINGS } from "@/lib/app-settings-api";
import type { LineItem } from "@/components/line-items-editor";

export type CopilotPreview = {
  draft: Required<{ [K in keyof CopilotDraft]: NonNullable<CopilotDraft[K]> }>;
  rate: number;
  nights: number;
  available: number;
  total: number;
  subtotal: number;
  taxes: number;
  taxRate: number;
  discount: number;
  items: LineItem[];
  /** Staff-agreed total (all rooms × nights); null = rack rate. */
  totalOverride: number | null;
  taxesIncluded: boolean;
};

export async function buildCopilotPreview(d: CopilotDraft): Promise<CopilotPreview> {
  const draft = {
    guest_name: d.guest_name!, phone: d.phone!, check_in: d.check_in!, check_out: d.check_out!,
    adults: Math.max(1, d.adults ?? 2), children: Math.max(0, d.children ?? 0),
    room_type: d.room_type ?? "Oak Room", rooms: Math.max(1, d.rooms ?? 1),
    agreed_rate: d.agreed_rate ?? 0, gst_included: !!d.gst_included,
  } as CopilotPreview["draft"];
  const [rates, overrides, avail] = await Promise.all([
    listRoomRates(),
    listRateOverrides({ from: draft.check_in, to: draft.check_out }),
    getRoomTypeAvailability({ check_in: draft.check_in, check_out: draft.check_out }),
  ]);
  const rate = resolveAverageRate(draft.room_type, draft.check_in, draft.check_out, rates, overrides) ?? getRoomRate(draft.room_type, false);
  const inv = maxSelectableRooms(avail, draft.room_type, 0);
  const base: LineItem = {
    room_type: draft.room_type, rooms: draft.rooms, adults: 0, children: 0,
    check_in: draft.check_in, check_out: draft.check_out,
    breakfast_included: false, extra_bed: 0, rate,
    early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null,
    pet_size: "none", extra_adults: 0, drivers: 0,
  } as LineItem;
  const items = allocateGuestsToLines([base], { adults: draft.adults, children: draft.children });
  const nights = Math.round((Date.parse(draft.check_out) - Date.parse(draft.check_in)) / 86400000);
  const totalOverride = draft.agreed_rate > 0 ? draft.agreed_rate * nights * draft.rooms : null;
  const taxesIncluded = totalOverride != null && draft.gst_included;
  const p = computePricing(items, 0, DEFAULT_TAX_RATE, { totalOverride, taxesIncluded });
  return { totalOverride, taxesIncluded, draft, rate: draft.agreed_rate > 0 ? draft.agreed_rate : rate, nights, available: inv.available, total: p.total, subtotal: p.subtotal, taxes: p.taxes, taxRate: p.taxRate, discount: p.discount ?? 0, items };
}

export async function createCopilotBooking(pv: CopilotPreview) {
  if (pv.available < pv.draft.rooms) throw new Error(`Only ${pv.available} ${pv.draft.room_type} available`);
  const s = await getPaymentSettings().catch(() => DEFAULT_PAYMENT_SETTINGS);
  const d = pv.draft;
  const { booking } = await submitNewBooking({
    linkedCustomerId: null,
    forceNew: false,
    booking: {
      source_quote_id: null, guest_name: d.guest_name.trim(), phone: `+91${d.phone}`, email: null,
      check_in: d.check_in, check_out: d.check_out, adults: d.adults, children: d.children,
      guests: d.adults + d.children, room_details: `${d.room_type.replace(" Room", "")} × ${d.rooms}`, room_id: null,
      amount: pv.total, subtotal: pv.subtotal, taxes: pv.taxes, tax_rate: pv.taxRate, discount: pv.discount,
      notes: null, internal_notes: "Created via HEOS Copilot", payment_status: "None", lead_source: "Direct",
      total_override: pv.totalOverride ?? null, taxes_included: pv.taxesIncluded ?? false,
      allow_full_payment: s.allow_full_payment, allow_part_payment: s.allow_part_payment,
      allow_pay_at_hotel: s.allow_pay_at_hotel, part_payment_type: "percent", part_payment_value: s.default_part_percent,
    },
    items: pv.items,
  });
  return booking;
}
