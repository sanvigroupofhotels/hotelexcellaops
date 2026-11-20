import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Opt-in against a temporary fixture; never change real guest bookings.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.OTA_TEST_USER_ID;
const integrationId = process.env.OTA_TEST_INTEGRATION_ID;
describe.skipIf(!url || !key || !userId || !integrationId)("OTA cancellation transaction", () => {
  it("offsets a 1890 prepaid receipt once, releases its room, and preserves a separate 100 staff payment", async () => {
    if (!url || !key || !userId || !integrationId) throw new Error("Missing test setup");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const ref = `OTA-TEST-${Date.now()}`;
    const { data: booking, error } = await db.from("bookings").insert({
      user_id: userId, guest_name: "Temporary OTA cancellation check", check_in: "2099-01-01", check_out: "2099-01-02",
      amount: 1990, integration_id: integrationId, external_ref: ref, status: "Confirmed",
    }).select("id").single();
    if (error || !booking) throw error ?? new Error("No fixture");
    try {
      const { data: room, error: roomError } = await db.from("rooms").select("id").limit(1).single();
      if (roomError || !room) throw roomError ?? new Error("No room");
      const { error: assignmentError } = await db.from("booking_room_assignments").insert({ booking_id: booking.id, room_id: room.id, user_id: userId, start_date: "2099-01-01", end_date: "2099-01-02" });
      if (assignmentError) throw assignmentError;
      const { error: creditError } = await db.rpc("record_ota_prepaid", { p_booking_id: booking.id, p_total: 1890, p_provider: "Test OTA", p_external_ref: ref });
      if (creditError) throw creditError;
      const { error: staffError } = await db.from("booking_payments").insert({ booking_id: booking.id, user_id: userId, amount: 100, payment_mode: "Bank Transfer", collected_by: "Test staff" });
      if (staffError) throw staffError;
      for (let replay = 0; replay < 2; replay++) {
        const { error: cancelError } = await db.rpc("process_ota_cancellation", { p_booking_id: booking.id, p_integration_id: integrationId, p_provider: "Test OTA", p_external_ref: ref });
        if (cancelError) throw cancelError;
      }
      const { data: saved } = await db.from("bookings").select("status,advance_paid").eq("id", booking.id).single();
      expect(saved).toMatchObject({ status: "Cancelled", advance_paid: 100 });
      const { data: refunds } = await db.from("booking_payments").select("amount,payment_mode").eq("booking_id", booking.id).eq("is_refund", true);
      expect(refunds).toEqual([{ amount: 1890, payment_mode: "OTA Refund" }]);
      const { count } = await db.from("booking_room_assignments").select("id", { count: "exact", head: true }).eq("booking_id", booking.id);
      expect(count).toBe(0);
      const { count: alerts } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("entity_id", booking.id).eq("type", "booking_cancelled");
      expect(alerts).toBe(1);
    } finally {
      await db.from("notifications").delete().eq("entity_id", booking.id);
      await db.from("bookings").delete().eq("id", booking.id);
    }
  }, 30000);
});