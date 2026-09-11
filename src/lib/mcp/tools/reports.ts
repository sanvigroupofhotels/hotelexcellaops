import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { listCashTx } from "@/lib/cash-api";
import { buildDailyCashReport, computeOpeningBalance } from "@/lib/cash-report";
import { ADR, OccupancyPct, RevPAR } from "@/lib/kpi-defs";
import { groupStayItems } from "@/lib/stay-segments";
import { sumCommittedRoomNights } from "@/lib/room-counts";
import { addDaysYmd, guarded, money, ok, PERM, requirePerm } from "../guard";

export const cashSummaryTool = defineTool({
  name: "cash_summary",
  title: "Get cash summary",
  description: "Return the canonical daily cash totals without guest or staff details.",
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ date }, ctx) => {
    const client = await requirePerm(ctx, PERM.cash);
    const rows = await listCashTx({ to: date + "T23:59:59", includeInactive: false }, client);
    const day = new Date(date + "T00:00:00");
    const opening = computeOpeningBalance(rows, day);
    const current = rows.filter((r) => r.occurred_at.slice(0, 10) === date);
    const income = current.filter((r) => r.kind === "collection").reduce((s, r) => s + Number(r.amount), 0);
    const expenses = current.filter((r) => r.kind === "expense").reduce((s, r) => s + Number(r.amount), 0);
    buildDailyCashReport(rows, day, opening); // canonical engine invocation
    return ok({ date, opening_balance: money(opening), income: money(income), expenses: money(expenses), closing_balance: money(opening + income - expenses), transaction_count: current.length });
  }),
});

export const occupancyRevenueSummaryTool = defineTool({
  name: "occupancy_revenue_summary",
  title: "Get occupancy and revenue summary",
  description: "Return shared room-night, occupancy, ADR, RevPAR, revenue, and collection metrics for a date range.",
  inputSchema: { range_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), range_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ range_start, range_end }, ctx) => {
    const client = await requirePerm(ctx, PERM.analytics);
    const after = addDaysYmd(range_end, 1);
    const [roomsRes, bookingsRes, itemsRes, paymentsRes, chargesRes] = await Promise.all([
      client.from("rooms").select("id").eq("active", true),
      client.from("bookings").select("id,status,check_in,check_out,amount").lt("check_in", after).gt("check_out", range_start),
      client.from("booking_items" as any).select("booking_id,position,room_type,rooms,check_in,check_out").lt("check_in", after).gt("check_out", range_start),
      client.from("booking_payments" as any).select("amount,is_refund,occurred_at").gte("occurred_at", range_start + "T00:00:00").lte("occurred_at", range_end + "T23:59:59"),
      client.from("booking_charges" as any).select("amount,occurred_at").gte("occurred_at", range_start + "T00:00:00").lte("occurred_at", range_end + "T23:59:59"),
    ]);
    const error = roomsRes.error ?? bookingsRes.error ?? itemsRes.error ?? paymentsRes.error ?? chargesRes.error;
    if (error) throw error;
    const bookings = (bookingsRes.data ?? []) as any[];
    const { totalRoomNights: roomsSold, byBooking } = sumCommittedRoomNights(bookings, groupStayItems((itemsRes.data ?? []) as any[]), range_start, range_end);
    let roomRevenue = 0;
    for (const b of bookings) { const n = byBooking.get(b.id); if (n?.total && n.inRange) roomRevenue += Number(b.amount ?? 0) * n.inRange / n.total; }
    const chargeRevenue = (chargesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const collections = (paymentsRes.data ?? []).reduce((s: number, r: any) => s + (r.is_refund ? -1 : 1) * Number(r.amount ?? 0), 0);
    const rangeNights = Math.max(1, Math.round((new Date(after).getTime() - new Date(range_start).getTime()) / 86400000));
    const available = (roomsRes.data?.length ?? 0) * rangeNights;
    return ok({ range: { start: range_start, end: range_end }, rooms_sold: roomsSold, available_room_nights: available, occupancy_pct: OccupancyPct(roomsSold, available), adr: money(ADR(roomRevenue, roomsSold)), revpar: money(RevPAR(roomRevenue, available)), room_revenue: money(roomRevenue), extra_charge_revenue: money(chargeRevenue), total_revenue: money(roomRevenue + chargeRevenue), collections: money(collections) });
  }),
});