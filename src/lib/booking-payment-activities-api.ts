import { supabase } from "@/integrations/supabase/client";

export interface BookingPaymentActivity {
  id: string;
  payment_id: string | null;
  booking_id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: "created" | "updated" | "deleted" | string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  summary: string;
  created_at: string;
}

export async function listBookingPaymentActivities(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_payment_activities" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingPaymentActivity[];
}
