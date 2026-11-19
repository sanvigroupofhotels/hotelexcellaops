type ExistingItem = { id: string; room_type: string; assigned_room_id?: string | null; item_status?: string | null; checked_in_at?: string | null; checked_out_at?: string | null };
const typeKey = (value: string) => value.trim().toLowerCase().replace(/\s+room$/, "");

/** Preserve physical-stay identity; never silently discard operational history. */
export function planBookingItemEdit<T extends ExistingItem>(previous: T[], roomTypes: string[], linkedIds: Set<string>) {
  const pool = [...previous];
  const matched = roomTypes.map((type) => {
    const index = pool.findIndex((item) => typeKey(item.room_type) === typeKey(type));
    return index < 0 ? null : pool.splice(index, 1)[0];
  });
  const protectedItem = (item: T) => linkedIds.has(item.id) || !!item.assigned_room_id || !!item.checked_in_at || !!item.checked_out_at || !!(item.item_status && item.item_status !== "Confirmed");
  if (pool.some(protectedItem)) throw new Error("An assigned or previously occupied room cannot be removed or changed through booking edits. Use the room operations first.");
  return { matched, removableIds: pool.map((item) => item.id) };
}