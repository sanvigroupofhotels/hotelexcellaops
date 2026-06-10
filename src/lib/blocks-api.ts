import { supabase } from "@/integrations/supabase/client";

export interface BlockRow {
  id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  active: boolean;
  blocked_by: string | null;
  blocked_at: string;
  unblocked_by: string | null;
  unblocked_at: string | null;
  created_at: string;
}

export async function listActiveBlocks(): Promise<BlockRow[]> {
  const { data, error } = await supabase
    .from("room_maintenance" as any)
    .select("*")
    .eq("active", true)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BlockRow[];
}

export async function listAllBlocks(): Promise<BlockRow[]> {
  const { data, error } = await supabase
    .from("room_maintenance" as any)
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BlockRow[];
}

export async function blockRoom(input: { room_id: string; start_date: string; end_date: string; reason: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("room_maintenance" as any).insert({
    user_id: user.id,
    room_id: input.room_id,
    start_date: input.start_date,
    end_date: input.end_date,
    reason: input.reason,
    blocked_by: user.id,
    blocked_at: new Date().toISOString(),
    active: true,
  } as any);
  if (error) throw error;
}

export async function updateBlock(id: string, patch: { start_date?: string; end_date?: string; reason?: string }) {
  const { error } = await supabase.from("room_maintenance" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function unblockRoom(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("room_maintenance" as any).update({
    active: false,
    unblocked_by: user.id,
    unblocked_at: new Date().toISOString(),
  } as any).eq("id", id);
  if (error) throw error;
}

/** Returns true if a room has an active block overlapping the date range. */
export function isRoomBlockedInRange(blocks: BlockRow[], room_id: string, check_in: string, check_out: string): BlockRow | null {
  const hit = blocks.find(
    (b) => b.active && b.room_id === room_id && b.start_date < check_out && check_in < b.end_date,
  );
  return hit ?? null;
}
