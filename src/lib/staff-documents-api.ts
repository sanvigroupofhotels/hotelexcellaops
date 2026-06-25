import { supabase } from "@/integrations/supabase/client";

export const STAFF_DOC_TYPES = [
  "Aadhaar",
  "PAN",
  "Passport",
  "Driving License",
  "Educational Certificate",
  "Experience Certificate",
  "Police Verification",
  "Employment Agreement",
  "Other",
] as const;
export type StaffDocType = (typeof STAFF_DOC_TYPES)[number];

export interface StaffDocumentRow {
  id: string;
  staff_id: string;
  doc_type: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  notes: string | null;
  uploaded_at: string;
}

const BUCKET = "staff-documents";

export async function listStaffDocuments(staffId: string): Promise<StaffDocumentRow[]> {
  const { data, error } = await supabase
    .from("staff_documents" as any)
    .select("*")
    .eq("staff_id", staffId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any;
}

export async function uploadStaffDocument(input: {
  staff_id: string;
  doc_type: StaffDocType | string;
  file: File;
  notes?: string;
}): Promise<StaffDocumentRow> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id ?? null;

  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${input.staff_id}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supabase
    .storage.from(BUCKET)
    .upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("staff_documents" as any)
    .insert({
      staff_id: input.staff_id,
      doc_type: input.doc_type,
      file_path: path,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      file_size_bytes: input.file.size || null,
      uploaded_by: userId,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) {
    // Clean up orphan file
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data as any;
}

export async function signedStaffDocumentUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUrl(filePath, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStaffDocument(row: StaffDocumentRow): Promise<void> {
  // Trigger removes the storage object on row delete, but we also remove explicitly
  // in case the trigger ever drops.
  const { error } = await supabase
    .from("staff_documents" as any)
    .delete()
    .eq("id", row.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([row.file_path]).catch(() => {});
}
