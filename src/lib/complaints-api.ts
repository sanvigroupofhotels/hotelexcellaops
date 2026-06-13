import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD } from "@/lib/utils";

export const COMPLAINT_TYPES = ["Room", "General"] as const;
export const COMPLAINT_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export const COMPLAINT_STATUSES = ["Open", "In Progress", "Resolved"] as const;
export const ISSUE_TYPES = [
  "Guest Complaint",
  "Housekeeping",
  "Maintenance",
  "Electrical",
  "Plumbing",
  "AC",
  "TV",
  "WiFi",
  "Furniture",
  "Other",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export type ComplaintType = (typeof COMPLAINT_TYPES)[number];
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export interface ComplaintCategoryRow {
  id: string; user_id: string; name: string; active: boolean;
  created_at: string; updated_at: string;
}
export interface ComplaintRow {
  id: string; user_id: string; complaint_number: string;
  complaint_type: ComplaintType;
  room_number: string | null;
  customer_id: string | null; booking_id: string | null;
  category: string; category_other: string | null;
  priority: ComplaintPriority; status: ComplaintStatus;
  entered_by_staff_id: string | null; entered_by_name: string | null;
  assigned_to_staff_id: string | null; assigned_to_name: string | null;
  description: string;
  issue_type: string | null;
  guest_impacted: boolean;
  resolution_notes: string | null;
  closed_at: string | null;
  resolved_at: string | null;
  resolved_by_staff_id: string | null;
  resolved_by_name: string | null;
  created_at: string; updated_at: string;
}
export interface ComplaintActivityRow {
  id: string; complaint_id: string;
  actor_id: string | null; actor_name: string | null; actor_role: string | null;
  action: string; field: string | null; old_value: string | null; new_value: string | null;
  summary: string | null; created_at: string;
}

export interface ComplaintInput {
  complaint_type: ComplaintType;
  room_number?: string | null;
  customer_id?: string | null; booking_id?: string | null;
  category: string; category_other?: string | null;
  priority: ComplaintPriority; status?: ComplaintStatus;
  entered_by_staff_id?: string | null; entered_by_name?: string | null;
  assigned_to_staff_id?: string | null; assigned_to_name?: string | null;
  description: string;
  issue_type?: string | null;
  guest_impacted?: boolean;
  resolution_notes?: string | null;
}

// ---------- Categories ----------
export async function listComplaintCategories(activeOnly = false) {
  let q = supabase.from("complaint_categories" as any).select("*").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ComplaintCategoryRow[];
}
export async function createComplaintCategory(name: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("complaint_categories" as any)
    .insert({ user_id: user.id, name } as any).select().single();
  if (error) throw error; return data as unknown as ComplaintCategoryRow;
}
export async function updateComplaintCategory(id: string, patch: Partial<Pick<ComplaintCategoryRow, "name" | "active">>) {
  const { error } = await supabase.from("complaint_categories" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

// ---------- Complaints ----------
function validate(c: ComplaintInput) {
  if (!c.complaint_type) throw new Error("Complaint type is required");
  if (c.complaint_type === "Room" && !c.room_number?.trim()) throw new Error("Room number is required");
  if (!c.category?.trim()) throw new Error("Category is required");
  if (c.category === "Other" && !c.category_other?.trim()) throw new Error("Please specify the Other category");
  if (!c.priority) throw new Error("Priority is required");
  if (!c.entered_by_staff_id) throw new Error("Entered By is required");
  if (!c.description?.trim()) throw new Error("Description is required");
}

export interface ComplaintFilters {
  status?: ComplaintStatus | "all";
  priority?: ComplaintPriority | "all";
  category?: string | "all";
  assignedTo?: string | "all" | "unassigned";
  room?: string;
  from?: string; to?: string;
  search?: string;
}
export async function listComplaints(f?: ComplaintFilters) {
  let q = supabase.from("complaints" as any).select("*");
  if (f?.status && f.status !== "all") q = q.eq("status", f.status);
  if (f?.priority && f.priority !== "all") q = q.eq("priority", f.priority);
  if (f?.category && f.category !== "all") q = q.eq("category", f.category);
  if (f?.assignedTo === "unassigned") q = q.is("assigned_to_staff_id", null);
  else if (f?.assignedTo && f.assignedTo !== "all") q = q.eq("assigned_to_staff_id", f.assignedTo);
  if (f?.room) q = q.eq("room_number", f.room);
  if (f?.from) q = q.gte("created_at", f.from);
  if (f?.to) q = q.lte("created_at", f.to);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  let rows = (data ?? []) as unknown as ComplaintRow[];
  if (f?.search) {
    const s = f.search.toLowerCase();
    rows = rows.filter(r =>
      r.complaint_number.toLowerCase().includes(s) ||
      (r.room_number ?? "").toLowerCase().includes(s) ||
      r.category.toLowerCase().includes(s) ||
      (r.description ?? "").toLowerCase().includes(s) ||
      (r.assigned_to_name ?? "").toLowerCase().includes(s) ||
      (r.entered_by_name ?? "").toLowerCase().includes(s),
    );
  }
  // priority sort (Critical → High → Medium → Low), then created desc
  const rank: Record<ComplaintPriority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rows.sort((a, b) => (rank[a.priority] - rank[b.priority]) ||
    (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  return rows;
}

export async function getComplaint(id: string) {
  const { data, error } = await supabase.from("complaints" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as ComplaintRow | null;
}

export async function createComplaint(input: ComplaintInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  validate(input);
  const row: any = {
    user_id: user.id,
    status: input.status ?? "Open",
    ...input,
  };
  const { data, error } = await supabase.from("complaints" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as ComplaintRow;
}

export async function updateComplaint(id: string, patch: Partial<ComplaintInput>) {
  const { data, error } = await supabase.from("complaints" as any).update(patch as any).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as ComplaintRow;
}

export async function setComplaintStatus(id: string, status: ComplaintStatus) {
  const { error } = await supabase.from("complaints" as any).update({ status } as any).eq("id", id);
  if (error) throw error;
}

export async function assignComplaint(id: string, staff: { id: string; name: string } | null) {
  const { error } = await supabase.from("complaints" as any)
    .update({ assigned_to_staff_id: staff?.id ?? null, assigned_to_name: staff?.name ?? null } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteComplaint(id: string) {
  const { error } = await supabase.from("complaints" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listComplaintActivities(complaintId: string) {
  const { data, error } = await supabase.from("complaint_activities" as any)
    .select("*").eq("complaint_id", complaintId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ComplaintActivityRow[];
}

/** Find an active booking matching a room number (best-effort).
 *  We don't store a room field on bookings, so we check booking.room_details
 *  for a token match against the room number and choose one whose stay covers today.
 */
export async function findActiveBookingForRoom(roomNumber: string) {
  if (!roomNumber?.trim()) return null;
  const today = toLocalYMD();
  const { data, error } = await supabase.from("bookings" as any)
    .select("id,booking_reference,guest_name,phone,customer_id,room_details,check_in,check_out,status")
    .lte("check_in", today).gte("check_out", today)
    .not("status", "in", "(Cancelled,Stay Completed)")
    .order("check_in", { ascending: false }).limit(20);
  if (error) return null;
  const rx = new RegExp(`(^|[^0-9])${roomNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`, "i");
  const match = (data ?? []).find((b: any) => b.room_details && rx.test(b.room_details));
  return (match ?? (data ?? [])[0]) as any | null;
}

export const priorityStyles: Record<ComplaintPriority, string> = {
  Critical: "border-destructive/40 bg-destructive/10 text-destructive",
  High:     "border-warning/40 bg-warning/10 text-warning",
  Medium:   "border-gold/30 bg-gold-soft text-gold",
  Low:      "border-border bg-card text-muted-foreground",
};
export const statusStyles: Record<ComplaintStatus, string> = {
  Open:           "border-warning/40 bg-warning/10 text-warning",
  "In Progress":  "border-gold/30 bg-gold-soft text-gold",
  Resolved:       "border-success/40 bg-success/10 text-success",
};
