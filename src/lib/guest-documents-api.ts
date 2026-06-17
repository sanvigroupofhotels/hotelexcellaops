import { supabase } from "@/integrations/supabase/client";

export const GUEST_DOC_BUCKET = "guest-documents";
export const GUEST_DOC_TYPES = ["Aadhaar", "PAN", "Passport", "Driving License", "Other"] as const;
export type GuestDocType = (typeof GUEST_DOC_TYPES)[number];

export interface GuestDocumentRow {
  id: string;
  booking_id: string;
  user_id: string;
  doc_type: string;
  front_path: string | null;
  back_path: string | null;
  selfie_path: string | null;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function listGuestDocuments(bookingId: string): Promise<GuestDocumentRow[]> {
  const { data, error } = await supabase
    .from("guest_documents" as any)
    .select("*")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as GuestDocumentRow[];
}

function extOf(file: File) {
  const m = file.name.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || "jpg").toLowerCase();
}

async function uploadOne(bookingId: string, docId: string, kind: "front" | "back" | "selfie", file: File): Promise<string> {
  const path = `${bookingId}/${docId}/${kind}.${extOf(file)}`;
  const { error } = await supabase.storage.from(GUEST_DOC_BUCKET).upload(path, file, {
    upsert: true, cacheControl: "3600", contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

export interface CreateGuestDocumentInput {
  bookingId: string;
  docType: GuestDocType | string;
  front?: File | null;
  back?: File | null;
  selfie?: File | null;
  notes?: string;
  uploadedByName?: string;
}

export async function createGuestDocument(input: CreateGuestDocumentInput): Promise<GuestDocumentRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  if (!input.front) throw new Error("Front side is mandatory");

  const insertRes = await supabase
    .from("guest_documents" as any)
    .insert({
      booking_id: input.bookingId,
      doc_type: input.docType,
      notes: input.notes ?? null,
      uploaded_by: user.id,
      uploaded_by_name: input.uploadedByName ?? user.email ?? "Staff",
      user_id: user.id,
    } as any)
    .select()
    .single();
  if (insertRes.error) throw insertRes.error;
  const row = insertRes.data as unknown as GuestDocumentRow;

  const patch: Record<string, string> = {};
  try {
    if (input.front) patch.front_path = await uploadOne(input.bookingId, row.id, "front", input.front);
    if (input.back) patch.back_path = await uploadOne(input.bookingId, row.id, "back", input.back);
    if (input.selfie) patch.selfie_path = await uploadOne(input.bookingId, row.id, "selfie", input.selfie);
  } catch (e) {
    // rollback the row if upload fails
    await supabase.from("guest_documents" as any).delete().eq("id", row.id);
    throw e;
  }

  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase
      .from("guest_documents" as any)
      .update(patch)
      .eq("id", row.id)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as GuestDocumentRow;
  }
  return row;
}

export async function softDeleteGuestDocument(id: string, deletedByName?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("guest_documents" as any)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id ?? null,
      deleted_by_name: deletedByName ?? user?.email ?? "Staff",
    })
    .eq("id", id);
  if (error) throw error;
}

export async function signedUrlForPath(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(GUEST_DOC_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
