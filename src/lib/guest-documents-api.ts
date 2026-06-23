import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";


export const GUEST_DOC_BUCKET = "guest-documents";
export const GUEST_DOC_TYPES = ["Aadhaar", "PAN", "Passport", "Driving License", "Other"] as const;
export type GuestDocType = (typeof GUEST_DOC_TYPES)[number];

export interface GuestDocumentRow {
  id: string;
  booking_id: string | null;
  customer_id: string | null;
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
  expires_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * List documents for a booking. Includes:
 *   - documents directly attached to this booking
 *   - documents attached to the booking's customer (so prior IDs auto-appear
 *     on new bookings for the same customer — single source of truth).
 */
export async function listGuestDocuments(bookingId: string): Promise<GuestDocumentRow[]> {
  // Look up the booking's customer first so we can union both views.
  const { data: b } = await supabase
    .from("bookings" as any)
    .select("customer_id")
    .eq("id", bookingId)
    .maybeSingle();
  const customerId = (b as any)?.customer_id as string | null | undefined;

  let q = supabase
    .from("guest_documents" as any)
    .select("*")
    .is("deleted_at", null);
  q = customerId
    ? q.or(`booking_id.eq.${bookingId},customer_id.eq.${customerId}`)
    : q.eq("booking_id", bookingId);
  const { data, error } = await q.order("uploaded_at", { ascending: false });
  if (error) throw error;
  // De-dupe by id (in case both filters match the same row).
  const rows = (data ?? []) as unknown as GuestDocumentRow[];
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function listCustomerGuestDocuments(customerId: string): Promise<GuestDocumentRow[]> {
  const { data, error } = await supabase
    .from("guest_documents" as any)
    .select("*")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as GuestDocumentRow[];
}

function extOf(file: File) {
  const m = file.name.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || "jpg").toLowerCase();
}

async function uploadOne(scope: string, docId: string, kind: "front" | "back" | "selfie", file: File): Promise<string> {
  const path = `${scope}/${docId}/${kind}.${extOf(file)}`;
  const { error } = await supabase.storage.from(GUEST_DOC_BUCKET).upload(path, file, {
    upsert: true, cacheControl: "3600", contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

export interface CreateGuestDocumentInput {
  /** At least one of bookingId or customerId must be provided. */
  bookingId?: string | null;
  customerId?: string | null;
  docType: GuestDocType | string;
  front?: File | null;
  back?: File | null;
  selfie?: File | null;
  notes?: string;
  uploadedByName?: string;
  /** Where the upload originated: Reception, Guest Portal, Booking Engine, OTA, Walk-in, etc. */
  source?: string | null;
  /** Set true when a previously uploaded doc already has a Front Side on file. */
  allowMissingFront?: boolean;
}

export async function createGuestDocument(input: CreateGuestDocumentInput): Promise<GuestDocumentRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  if (!input.bookingId && !input.customerId) {
    throw new Error("Document must be linked to a booking or a customer");
  }
  if (!input.front && !input.allowMissingFront) throw new Error("Front side is mandatory");
  if (!input.front && !input.back && !input.selfie) throw new Error("Please choose at least one file to upload");

  const insertRes = await supabase
    .from("guest_documents" as any)
    .insert({
      booking_id: input.bookingId ?? null,
      customer_id: input.customerId ?? null,
      doc_type: input.docType,
      notes: input.notes ?? null,
      uploaded_by: user.id,
      uploaded_by_name: input.uploadedByName ?? user.email ?? "Staff",
      source: input.source ?? "Reception",
      user_id: user.id,
    } as any)
    .select()
    .single();
  if (insertRes.error) throw insertRes.error;
  const row = insertRes.data as unknown as GuestDocumentRow;

  // Path prefix: use the booking when present, otherwise the customer.
  const scope = input.bookingId ? `${input.bookingId}` : `customer/${input.customerId}`;

  const patch: Record<string, string> = {};
  try {
    if (input.front) patch.front_path = await uploadOne(scope, row.id, "front", input.front);
    if (input.back) patch.back_path = await uploadOne(scope, row.id, "back", input.back);
    if (input.selfie) patch.selfie_path = await uploadOne(scope, row.id, "selfie", input.selfie);
  } catch (e) {
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
    const updated = data as unknown as GuestDocumentRow;
    void logActivity({
      page: "Guest Documents",
      action: "customer_documents_uploaded",
      entity_type: "guest_document",
      entity_id: updated.id,
      entity_reference: updated.doc_type,
      summary: `Uploaded ${updated.doc_type}`,
      metadata: { booking_id: updated.booking_id, customer_id: updated.customer_id },
      source: "manual",
    });
    return updated;
  }
  void logActivity({
    page: "Guest Documents",
    action: "customer_documents_uploaded",
    entity_type: "guest_document",
    entity_id: row.id,
    entity_reference: row.doc_type,
    summary: `Created ${row.doc_type} record`,
    metadata: { booking_id: row.booking_id, customer_id: row.customer_id },
    source: "manual",
  });
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
