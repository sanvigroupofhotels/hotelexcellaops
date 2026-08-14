import { supabase } from "@/integrations/supabase/client";
import { phoneSearchVariants, splitPhone } from "@/lib/phone";

/**
 * ============================================================================
 * SHARED SEARCH SERVICE (HEOS)
 * ============================================================================
 * Single definition of "find a booking" for every Reception entry point
 * (House View, Front Desk, Charges, Payments, Dashboard, Reports…).
 *
 * Searchable dimensions:
 *   - Booking Holder      (bookings.guest_name)
 *   - Primary Occupant    (booking_items.primary_occupant_name)
 *   - Mobile Number       (bookings.phone, digits-insensitive)
 *   - Booking Reference   (bookings.booking_reference)
 *   - Assigned Room No.   (booking_room_assignments → rooms.room_number)
 *   - Company / Group     (customers.company_name)
 *
 * No module should re-implement any part of this. UI components consume the
 * results and decide what to do with them (navigate, attribute a charge, …).
 */

export interface BookingSearchResult {
  id: string;
  booking_reference: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  check_in: string;
  check_out: string;
  status: string;
  /** Room numbers from occupancy segments (any segment, newest first). */
  roomNumbers: string[];
  /** Primary occupant names on the booking's operational rooms. */
  occupants: string[];
  /** Company / group name from the linked customer. */
  company: string | null;
  /** Which dimension(s) matched — useful for result subtitles. */
  matchedOn: BookingSearchField[];
}

export type BookingSearchField =
  | "holder"
  | "occupant"
  | "phone"
  | "reference"
  | "room"
  | "company";

export const normText = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const normDigits = (s: string | null | undefined) =>
  (s ?? "").replace(/\D/g, "");

/** Statuses that should never surface in operational search. */
const HIDDEN_STATUSES = new Set(["Cancelled", "No-Show"]);

/** Escape a value for use inside a PostgREST `ilike` pattern. */
const like = (q: string) => `%${q.replace(/[%,()]/g, " ").trim()}%`;

/**
 * Pure predicate — reusable when a module already has booking rows in memory
 * and just needs the same matching semantics without another round-trip.
 */
export function matchesBookingSearch(
  query: string,
  candidate: {
    guest_name?: string | null;
    booking_reference?: string | null;
    phone?: string | null;
    occupants?: (string | null | undefined)[];
    roomNumbers?: (string | null | undefined)[];
    company?: string | null;
  },
): BookingSearchField[] {
  const q = query.trim();
  if (!q) return [];
  const t = normText(q);
  const d = normDigits(q);
  const hits: BookingSearchField[] = [];
  if (t.length >= 2 && normText(candidate.guest_name).includes(t)) hits.push("holder");
  if (t.length >= 2 && normText(candidate.booking_reference).includes(t)) hits.push("reference");
  const candDigits = normDigits(candidate.phone);
  const candNational = normDigits(splitPhone(candidate.phone).national);
  if (
    d.length >= 3 &&
    (candDigits.includes(d) ||
      phoneSearchVariants(q).some((v) => {
        const vd = normDigits(v);
        return vd.length >= 3 && (candDigits.includes(vd) || (!!candNational && candNational.includes(vd)));
      }))
  )
    hits.push("phone");
  if (t.length >= 2 && (candidate.occupants ?? []).some((o) => normText(o).includes(t)))
    hits.push("occupant");
  if ((candidate.roomNumbers ?? []).some((r) => normText(r) === t || normText(r).includes(t)))
    hits.push("room");
  if (t.length >= 2 && normText(candidate.company).includes(t)) hits.push("company");
  return hits;
}

/**
 * The shared search entry point. Resolves across every searchable dimension
 * and returns enriched, de-duplicated booking results.
 */
export async function searchBookings(
  query: string,
  opts: { limit?: number; includeCancelled?: boolean } = {},
): Promise<BookingSearchResult[]> {
  const q = query.trim();
  const limit = opts.limit ?? 20;
  if (q.length < 2) return [];
  const digits = normDigits(q);
  const ids = new Set<string>();

  // 1) Booking Holder / Reference / Mobile — direct booking columns.
  const orParts = [`guest_name.ilike.${like(q)}`, `booking_reference.ilike.${like(q)}`];
  // International-safe phone matching: try every canonical variant (E.164,
  // digits-only, national number) so the same guest resolves however typed.
  const phoneVariants = new Set<string>();
  if (digits.length >= 3) phoneVariants.add(digits);
  for (const v of phoneSearchVariants(q)) {
    const vd = normDigits(v);
    if (vd.length >= 3) phoneVariants.add(vd);
  }
  for (const v of phoneVariants) orParts.push(`phone.ilike.${like(v)}`);
  const direct = await supabase
    .from("bookings" as any)
    .select("id")
    .or(orParts.join(","))
    .limit(limit * 3);
  for (const r of (direct.data ?? []) as any[]) ids.add(r.id);

  // 2) Primary Occupant — operational room identity.
  const occ = await supabase
    .from("booking_items" as any)
    .select("booking_id")
    .ilike("primary_occupant_name", like(q))
    .limit(limit * 3);
  for (const r of (occ.data ?? []) as any[]) ids.add(r.booking_id);

  // 3) Assigned Room Number — occupancy segments are the source of truth.
  const roomHits = await supabase
    .from("rooms" as any)
    .select("id")
    .ilike("room_number", like(q))
    .limit(50);
  const roomIds = ((roomHits.data ?? []) as any[]).map((r) => r.id);
  if (roomIds.length > 0) {
    const seg = await supabase
      .from("booking_room_assignments" as any)
      .select("booking_id")
      .in("room_id", roomIds)
      .limit(limit * 5);
    for (const r of (seg.data ?? []) as any[]) ids.add(r.booking_id);
  }

  // 4) Company / Group name — from the linked customer record.
  const comp = await supabase
    .from("customers" as any)
    .select("id")
    .ilike("company_name", like(q))
    .limit(50);
  const custIds = ((comp.data ?? []) as any[]).map((c) => c.id);
  if (custIds.length > 0) {
    const cb = await supabase
      .from("bookings" as any)
      .select("id")
      .in("customer_id", custIds)
      .limit(limit * 3);
    for (const r of (cb.data ?? []) as any[]) ids.add(r.id);
  }

  if (ids.size === 0) return [];

  // Hydrate the union, then enrich with occupants / rooms / company.
  const { data: rows } = await supabase
    .from("bookings" as any)
    .select("id,booking_reference,guest_name,phone,email,check_in,check_out,status,customer_id")
    .in("id", Array.from(ids))
    .order("check_in", { ascending: false })
    .limit(limit * 3);

  const bookings = ((rows ?? []) as any[]).filter(
    (b) => opts.includeCancelled || !HIDDEN_STATUSES.has(b.status),
  );
  if (bookings.length === 0) return [];
  const bookingIds = bookings.map((b) => b.id);

  const [itemsRes, segRes, roomRes, custRes] = await Promise.all([
    supabase
      .from("booking_items" as any)
      .select("booking_id,primary_occupant_name,item_status")
      .in("booking_id", bookingIds),
    supabase
      .from("booking_room_assignments" as any)
      .select("booking_id,room_id,start_date")
      .in("booking_id", bookingIds),
    supabase.from("rooms" as any).select("id,room_number"),
    supabase
      .from("customers" as any)
      .select("id,company_name")
      .in("id", bookings.map((b) => b.customer_id).filter(Boolean)),
  ]);

  const roomNumberById = new Map<string, string>(
    ((roomRes.data ?? []) as any[]).map((r) => [r.id, r.room_number]),
  );
  const companyByCustomer = new Map<string, string | null>(
    ((custRes.data ?? []) as any[]).map((c) => [c.id, c.company_name ?? null]),
  );
  const occupantsByBooking = new Map<string, string[]>();
  for (const it of ((itemsRes.data ?? []) as any[])) {
    if (it.item_status === "Removed") continue;
    const name = (it.primary_occupant_name ?? "").trim();
    if (!name) continue;
    const arr = occupantsByBooking.get(it.booking_id) ?? [];
    if (!arr.includes(name)) arr.push(name);
    occupantsByBooking.set(it.booking_id, arr);
  }
  const roomsByBooking = new Map<string, string[]>();
  for (const s of ((segRes.data ?? []) as any[]).sort((a, b) =>
    String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")),
  )) {
    const num = roomNumberById.get(s.room_id);
    if (!num) continue;
    const arr = roomsByBooking.get(s.booking_id) ?? [];
    if (!arr.includes(num)) arr.push(num);
    roomsByBooking.set(s.booking_id, arr);
  }

  return bookings
    .map((b) => {
      const occupants = occupantsByBooking.get(b.id) ?? [];
      const roomNumbers = roomsByBooking.get(b.id) ?? [];
      const company = b.customer_id ? (companyByCustomer.get(b.customer_id) ?? null) : null;
      return {
        id: b.id,
        booking_reference: b.booking_reference,
        guest_name: b.guest_name,
        phone: b.phone ?? null,
        email: b.email ?? null,
        check_in: b.check_in,
        check_out: b.check_out,
        status: b.status,
        roomNumbers,
        occupants,
        company,
        matchedOn: matchesBookingSearch(q, {
          guest_name: b.guest_name,
          booking_reference: b.booking_reference,
          phone: b.phone,
          occupants,
          roomNumbers,
          company,
        }),
      } as BookingSearchResult;
    })
    .slice(0, limit);
}
