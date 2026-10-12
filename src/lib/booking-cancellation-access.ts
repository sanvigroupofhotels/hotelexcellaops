import { supabase } from "@/integrations/supabase/client";

export const BOOKING_CANCELLATION_DENIED =
  "Only an owner or admin can cancel a booking or mark it as no-show.";

export function isRestrictedBookingStatus(status: string | null | undefined): boolean {
  return status === "Cancelled" || status === "No-Show";
}

/** Fresh caller-scoped role verification; UI role flags are only presentation. */
export async function assertBookingCancellationAllowed(): Promise<void> {
  const { data, error } = await supabase.rpc("can_cancel_bookings");
  if (error || data !== true) throw new Error(BOOKING_CANCELLATION_DENIED);
}