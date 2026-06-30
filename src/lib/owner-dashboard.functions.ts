/**
 * Owner Dashboard — server functions.
 *
 * One aggregator that computes every KPI shown on the Owner Dashboard from
 * existing tables (bookings, booking_payments, booking_charges, customers,
 * rooms, cash_transactions). Range is [start, end] inclusive (YYYY-MM-DD).
 *
 * Uses `requireSupabaseAuth` because this is owner/admin-only data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADR, RevPAR, OccupancyPct, nightsBetween } from "@/lib/kpi-defs";
import { groupStayItems } from "@/lib/stay-segments";
import { sumCommittedRoomNights } from "@/lib/room-counts";

const CANCELLED = new Set(["Cancelled"]);
const NO_SHOW = new Set(["No-Show"]);
const OTA_SOURCES = new Set(["Booking.com", "MakeMyTrip", "Goibibo", "Agoda", "Expedia", "Hotelzify", "OTA"]);


export const getOwnerDashboardKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      range_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { range_start, range_end } = data;

    // Asia/Kolkata calendar date for the Business-Date freshness chip
    const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
    const calendarDate = tzFmt.format(new Date());

    const [
      { data: bdRow },
      { data: rooms },
      { data: stays },
      { data: items },
      { data: payments },
      { data: charges },
      { data: cash },
    ] = await Promise.all([
      supabase.from("app_settings" as any).select("value").eq("key", "business_date").maybeSingle(),
      supabase.from("rooms" as any).select("id,room_type,active"),
      supabase
        .from("bookings" as any)
        .select("id,customer_id,status,source_channel,room_details,check_in,check_out,amount,advance_paid,created_at")
        .lt("check_in", isoNext(range_end))
        .gt("check_out", range_start),
      // booking_items powers the shared room-count helper — sums rooms × nights
      // across multi-room and split-stay bookings instead of counting parent
      // booking rows. Filtered to the same date window as `stays`.
      supabase
        .from("booking_items" as any)
        .select("booking_id,position,room_type,rooms,check_in,check_out,bookings!inner(check_in,check_out)")
        .lt("bookings.check_in", isoNext(range_end))
        .gt("bookings.check_out", range_start),
      supabase
        .from("booking_payments" as any)
        .select("amount,payment_mode,is_refund,occurred_at")
        .gte("occurred_at", range_start + "T00:00:00")
        .lte("occurred_at", range_end + "T23:59:59"),
      supabase
        .from("booking_charges" as any)
        .select("amount,occurred_at")
        .gte("occurred_at", range_start + "T00:00:00")
        .lte("occurred_at", range_end + "T23:59:59"),
      // current cash balance — active only
      supabase.from("cash_transactions" as any).select("kind,amount").eq("active", true),
    ]);


    const businessDate = (bdRow as any)?.value?.date ?? calendarDate;

    const activeRooms = (rooms ?? []).filter((r: any) => r.active !== false).length;
    const rangeNights = nightsBetween(range_start, isoNext(range_end));
    const availableRoomNights = activeRooms * rangeNights;

    // ---- Stay-derived KPIs (overlap with range) ----
    let roomsSold = 0;
    let roomRevenue = 0;
    let alosSum = 0;
    let alosCount = 0;
    let cancellations = 0;
    let noShows = 0;
    let directCount = 0;
    let otaCount = 0;
    let totalForChannelMix = 0;
    let bookingsInRange = 0;
    const repeatGuestBookings: string[] = [];
    const newGuestBookings: string[] = [];
    const revenueByCategory = new Map<string, number>();

    // Customer-id → previous bookings count snapshot
    const customerIds = Array.from(new Set((stays ?? []).map((s: any) => s.customer_id).filter(Boolean)));
    let customerBookingCounts = new Map<string, number>();
    if (customerIds.length > 0) {
      const { data: cust } = await supabase
        .from("customers" as any)
        .select("id,total_bookings")
        .in("id", customerIds);
      customerBookingCounts = new Map(((cust ?? []) as any[]).map((c) => [c.id, Number(c.total_bookings ?? 0)]));
    }

    for (const s of (stays ?? []) as any[]) {
      const status = String(s.status ?? "");

      // Count cancellations / no-shows by arrival date within range
      const arriveInRange = s.check_in >= range_start && s.check_in <= range_end;
      if (arriveInRange) {
        bookingsInRange++;
        if (CANCELLED.has(status)) cancellations++;
        if (NO_SHOW.has(status)) noShows++;
        // Channel mix
        const src = String(s.source_channel ?? "Direct");
        if (!CANCELLED.has(status) && !NO_SHOW.has(status)) {
          totalForChannelMix++;
          if (OTA_SOURCES.has(src)) otaCount++; else directCount++;
        }
        // Repeat guest classification
        if (s.customer_id) {
          const prior = customerBookingCounts.get(s.customer_id) ?? 0;
          if (prior > 1) repeatGuestBookings.push(s.id); else newGuestBookings.push(s.id);
        }
        // ALOS
        const nights = nightsBetween(s.check_in, s.check_out);
        if (nights > 0 && !CANCELLED.has(status) && !NO_SHOW.has(status)) {
          alosSum += nights; alosCount++;
        }
      }

      // Revenue & rooms-sold — only for counted statuses; prorated by overlap
      if (!COUNTED_FOR_REVENUE.has(status)) continue;
      const totalNights = nightsBetween(s.check_in, s.check_out) || 1;
      const inRange = overlapNights(s.check_in, s.check_out, range_start, range_end);
      if (inRange <= 0) continue;
      roomsSold += inRange;
      const prorated = Number(s.amount ?? 0) * (inRange / totalNights);
      roomRevenue += prorated;
      const cat = String(s.room_details ?? "—");
      revenueByCategory.set(cat, (revenueByCategory.get(cat) ?? 0) + prorated);
    }

    // ---- Outstanding dues (current snapshot — not range-bound) ----
    const { data: openBookings } = await supabase
      .from("bookings" as any)
      .select("amount,advance_paid,status")
      .not("status", "in", "(Cancelled,No-Show,Draft)");
    let outstandingDues = 0;
    for (const b of (openBookings ?? []) as any[]) {
      const amt = Number(b.amount ?? 0);
      const paid = Number(b.advance_paid ?? 0);
      outstandingDues += Math.max(0, amt - paid);
    }

    // ---- Payments / Collections ----
    let collections = 0;
    for (const p of (payments ?? []) as any[]) {
      const sign = p.is_refund ? -1 : 1;
      collections += sign * Number(p.amount ?? 0);
    }

    // ---- Charges (in-house extras) ----
    let chargeRevenue = 0;
    for (const c of (charges ?? []) as any[]) chargeRevenue += Number(c.amount ?? 0);
    const totalRevenue = roomRevenue + chargeRevenue;

    // ---- Cash Balance (current) ----
    let cashBalance = 0;
    for (const t of (cash ?? []) as any[]) {
      const sign = t.kind === "expense" ? -1 : 1;
      cashBalance += sign * Number(t.amount ?? 0);
    }

    const repeatPct =
      bookingsInRange > 0
        ? (repeatGuestBookings.length / Math.max(1, repeatGuestBookings.length + newGuestBookings.length)) * 100
        : 0;
    const cancellationPct = bookingsInRange > 0 ? (cancellations / bookingsInRange) * 100 : 0;
    const noShowPct = bookingsInRange > 0 ? (noShows / bookingsInRange) * 100 : 0;
    const directPct = totalForChannelMix > 0 ? (directCount / totalForChannelMix) * 100 : 0;
    const otaPct = totalForChannelMix > 0 ? (otaCount / totalForChannelMix) * 100 : 0;

    const topRooms = Array.from(revenueByCategory.entries())
      .map(([category, revenue]) => ({ category, revenue: Math.round(revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      range: { start: range_start, end: range_end, nights: rangeNights },
      businessDate,
      calendarDate,
      auditPending: businessDate < calendarDate,
      kpis: {
        occupancy_pct: OccupancyPct(roomsSold, availableRoomNights),
        adr: ADR(roomRevenue, roomsSold),
        revpar: RevPAR(roomRevenue, availableRoomNights),
        room_revenue: Math.round(roomRevenue),
        total_revenue: Math.round(totalRevenue),
        collections: Math.round(collections),
        outstanding_dues: Math.round(outstandingDues),
        rooms_sold: roomsSold,
        available_room_nights: availableRoomNights,
        active_rooms: activeRooms,
        repeat_pct: repeatPct,
        direct_pct: directPct,
        ota_pct: otaPct,
        cancellation_pct: cancellationPct,
        no_show_pct: noShowPct,
        alos: alosCount > 0 ? alosSum / alosCount : 0,
        cash_balance: Math.round(cashBalance),
      },
      topRooms,
    };
  });

function isoNext(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
