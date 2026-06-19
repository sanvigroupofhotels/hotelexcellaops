import { supabase } from "@/integrations/supabase/client";

export type BookingActivityAction =
  | "check_in"
  | "check_out"
  | "revert_check_in"
  | "revert_check_out"
  | "checkout_override"
  | "cancelled"
  | "no_show"
  | "reactivated";

export interface BookingActivityRow {
  id: string;
  booking_id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: BookingActivityAction;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

async function currentActor() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null as string | null, name: "system", role: "system" };
  const [{ data: prof }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("display_name,email").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  const role =
    (roles ?? []).map((r: any) => r.role).find((r: string) => r === "admin") ??
    (roles ?? [])[0]?.role ?? "staff";
  return {
    id: user.id,
    name: (prof as any)?.display_name || (prof as any)?.email || "user",
    role,
  };
}

export async function logBookingActivity(input: {
  booking_id: string;
  action: BookingActivityAction;
  from_status?: string | null;
  to_status?: string | null;
  notes?: string | null;
  metadata?: Record<string, any> | null;
}) {
  const actor = await currentActor();
  const { error } = await supabase
    .from("booking_activities" as any)
    .insert({
      booking_id: input.booking_id,
      action: input.action,
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
    } as any);
  if (error) throw error;
}

export async function listBookingActivities(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_activities" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingActivityRow[];
}
