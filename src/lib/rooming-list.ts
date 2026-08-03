import { downloadCSV } from "@/lib/csv";

/**
 * ============================================================================
 * SHARED ROOMING LIST SERVICE (HEOS · Group Booking Productivity)
 * ============================================================================
 * One definition of "the rooming list" for printing and for the (future-ready)
 * Room Allocation export. Booking Items are the operational identity, so the
 * list is built from items + their active occupancy segments — never from the
 * booking header.
 */

export interface RoomingListRow {
  "#": number;
  Room: string;
  "Room Type": string;
  "Primary Occupant": string;
  Mobile: string;
  Adults: number;
  Children: number;
  "Check-In": string;
  "Check-Out": string;
  Status: string;
  Notes: string;
}

const ymd = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function buildRoomingList(input: {
  items: any[];
  rooms: any[];
  activeAssignments: any[];
}): RoomingListRow[] {
  const active = input.items.filter((it) => (it.item_status ?? "") !== "Removed");
  return active.map((it, i) => {
    const seg = input.activeAssignments.find((a) => a.item_id === it.id);
    const room = input.rooms.find((r) => r.id === (seg?.room_id ?? it.assigned_room_id));
    return {
      "#": i + 1,
      Room: room?.room_number ?? "Unassigned",
      "Room Type": room?.room_type ?? it.room_type ?? "",
      "Primary Occupant": (it.primary_occupant_name ?? "").trim() || "—",
      Mobile: it.primary_phone ?? "",
      Adults: it.adults ?? 0,
      Children: it.children ?? 0,
      "Check-In": ymd(it.check_in),
      "Check-Out": ymd(it.check_out),
      Status: it.item_status ?? "Confirmed",
      Notes: it.operational_notes ?? "",
    };
  });
}

/** Print-ready rooming list in a new window (no app chrome, no duplication). */
export function printRoomingList(booking: any, rows: RoomingListRow[]) {
  if (rows.length === 0) throw new Error("Nothing to print — this booking has no operational rooms");
  const cols = Object.keys(rows[0]) as (keyof RoomingListRow)[];
  const esc = (s: any) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Rooming List — ${esc(booking.booking_reference)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 2px}
  .sub{font-size:12px;color:#555;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
  th{background:#f5f2ea;text-transform:uppercase;letter-spacing:.04em;font-size:10px}
  @media print{@page{size:A4 landscape;margin:12mm}}
</style></head><body>
<h1>Rooming List — ${esc(booking.guest_name)}</h1>
<div class="sub">${esc(booking.booking_reference)} · ${esc(ymd(booking.check_in))} → ${esc(ymd(booking.check_out))} · ${rows.length} room(s)</div>
<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to print the rooming list");
  w.document.write(html);
  w.document.close();
}

/** Room Allocation export — same shared rows, CSV for ops/finance handoff. */
export function exportRoomAllocation(booking: any, rows: RoomingListRow[]) {
  downloadCSV(`room-allocation-${booking.booking_reference}.csv`, rows as any);
}
