import { supabase } from "@/integrations/supabase/client";

export type IntegrationProvider =
  | "fabhotels" | "hotelzify" | "booking_com" | "agoda" | "razorpay" | "whatsapp" | "custom";

export type IntegrationType = "email_parser" | "api" | "webhook" | "csv_import";

export type IntegrationStatus = "draft" | "connected" | "disabled" | "error";

export interface IntegrationRow {
  id: string;
  name: string;
  provider: IntegrationProvider;
  type: IntegrationType;
  status: IntegrationStatus;
  config: Record<string, any>;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  bookings_imported: number;
  created_at: string;
  updated_at: string;
}

export interface IntegrationRun {
  id: string;
  integration_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "error";
  message: string | null;
  created_count: number;
  updated_count: number;
  payload_excerpt: string | null;
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  fabhotels: "FabHotels",
  hotelzify: "Hotelzify",
  booking_com: "Booking.com",
  agoda: "Agoda",
  razorpay: "Razorpay",
  whatsapp: "WhatsApp",
  custom: "Custom",
};

export const TYPE_LABELS: Record<IntegrationType, string> = {
  email_parser: "Email Parser",
  api: "API",
  webhook: "Webhook",
  csv_import: "CSV Import",
};

export const STATUS_STYLES: Record<IntegrationStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  connected: "bg-success/15 text-success border-success/40",
  disabled: "bg-muted/60 text-muted-foreground border-border",
  error: "bg-destructive/15 text-destructive border-destructive/40",
};

export async function listIntegrations(): Promise<IntegrationRow[]> {
  const { data, error } = await supabase
    .from("integrations" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationRow[];
}

export async function getIntegration(id: string): Promise<IntegrationRow> {
  const { data, error } = await supabase.from("integrations" as any).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as IntegrationRow;
}

export async function createIntegration(input: {
  name: string;
  provider: IntegrationProvider;
  type: IntegrationType;
  config?: Record<string, any>;
}): Promise<IntegrationRow> {
  const { data, error } = await supabase
    .from("integrations" as any)
    .insert({
      name: input.name,
      provider: input.provider,
      type: input.type,
      config: input.config ?? {},
      status: "draft",
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as IntegrationRow;
}

export async function updateIntegration(
  id: string,
  patch: Partial<Pick<IntegrationRow, "name" | "status" | "config">>,
): Promise<void> {
  const { error } = await supabase.from("integrations" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function deleteIntegration(id: string): Promise<void> {
  const { error } = await supabase.from("integrations" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listIntegrationRuns(integrationId: string): Promise<IntegrationRun[]> {
  const { data, error } = await supabase
    .from("integration_runs" as any)
    .select("*")
    .eq("integration_id", integrationId)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationRun[];
}
