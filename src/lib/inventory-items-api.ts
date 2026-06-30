import { supabase } from "@/integrations/supabase/client";

export interface InventoryItemRow {
  id: string;
  name: string;
  photo_path: string | null;
  category_value: string | null;
  preferred_vendor_id: string | null;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  auto_consume_catalog_key: string | null;
  housekeeping_per_room: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemInput {
  name: string;
  category_value?: string | null;
  preferred_vendor_id?: string | null;
  unit?: string;
  minimum_stock?: number;
  auto_consume_catalog_key?: string | null;
  active?: boolean;
}

const BUCKET = "inventory-photos";

export async function listInventoryItems(opts?: { activeOnly?: boolean }): Promise<InventoryItemRow[]> {
  let q = supabase.from("inventory_items" as any).select("*").order("name");
  if (opts?.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getInventoryItem(id: string): Promise<InventoryItemRow | null> {
  const { data, error } = await supabase.from("inventory_items" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as any;
}

export async function createInventoryItem(input: InventoryItemInput): Promise<InventoryItemRow> {
  const name = input.name?.trim();
  if (!name) throw new Error("Item name is required");
  const { data: u } = await supabase.auth.getUser();
  const row = {
    name,
    category_value: input.category_value || null,
    preferred_vendor_id: input.preferred_vendor_id || null,
    unit: (input.unit?.trim() || "piece"),
    minimum_stock: Number(input.minimum_stock ?? 0),
    auto_consume_catalog_key: input.auto_consume_catalog_key || null,
    active: input.active ?? true,
    user_id: u?.user?.id ?? null,
  };
  const { data, error } = await supabase.from("inventory_items" as any).insert(row).select().single();
  if (error) throw error;
  return data as any;
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryItemInput>): Promise<void> {
  const next: any = { ...patch };
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.unit != null) next.unit = patch.unit.trim() || "piece";
  if (patch.minimum_stock != null) next.minimum_stock = Number(patch.minimum_stock);
  if (patch.preferred_vendor_id === "") next.preferred_vendor_id = null;
  if (patch.category_value === "") next.category_value = null;
  if (patch.auto_consume_catalog_key === "") next.auto_consume_catalog_key = null;
  const { error } = await supabase.from("inventory_items" as any).update(next).eq("id", id);
  if (error) throw error;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from("inventory_items" as any).delete().eq("id", id);
  if (error) throw error;
}

/** Client-side resize to max 800px, JPEG ~0.82 quality. */
async function resizeImage(file: File, maxSide = 800): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
}

export async function uploadItemPhoto(itemId: string, file: File): Promise<string> {
  const blob = await resizeImage(file, 800);
  const path = `${itemId}/photo_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg", upsert: true,
  });
  if (error) throw error;

  // Remove old photo, if any
  const prev = await getInventoryItem(itemId);
  const oldPath = prev?.photo_path;
  const { error: updErr } = await supabase
    .from("inventory_items" as any).update({ photo_path: path }).eq("id", itemId);
  if (updErr) throw updErr;
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
  }
  return path;
}

export async function removeItemPhoto(itemId: string): Promise<void> {
  const item = await getInventoryItem(itemId);
  if (!item?.photo_path) return;
  await supabase.from("inventory_items" as any).update({ photo_path: null }).eq("id", itemId);
  await supabase.storage.from(BUCKET).remove([item.photo_path]).catch(() => {});
}

export async function signedPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}
