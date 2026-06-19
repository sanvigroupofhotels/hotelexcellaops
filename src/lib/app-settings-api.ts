import { supabase } from "@/integrations/supabase/client";

export interface PaymentSettings {
  allow_full_payment: boolean;
  allow_part_payment: boolean;
  default_part_percent: number;
  allow_pay_at_hotel: boolean;
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  allow_full_payment: true,
  allow_part_payment: true,
  default_part_percent: 25,
  allow_pay_at_hotel: true,
};

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const { data, error } = await supabase
    .from("app_settings" as any)
    .select("value")
    .eq("key", "payment_settings")
    .maybeSingle();
  if (error) throw error;
  const v = (data as any)?.value ?? {};
  return { ...DEFAULT_PAYMENT_SETTINGS, ...v };
}

export async function setPaymentSettings(value: PaymentSettings): Promise<void> {
  const { error } = await supabase
    .from("app_settings" as any)
    .upsert({ key: "payment_settings", value, updated_at: new Date().toISOString() } as any);
  if (error) throw error;
}

// ===== Generic app settings (hotel info, ops, branding, documents retention) =====

export interface HotelSettings {
  name: string;
  logo_url: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
}
export interface OpsSettings {
  check_in_time: string;
  check_out_time: string;
  currency: string;
  timezone: string;
}
export interface BrandingSettings {
  portal_title: string;
  welcome_message: string;
  invoice_footer: string;
  /** Base64 data URL of the authorised-signatory signature image. Empty = none. */
  signature_url: string;
  /** Free-text designation rendered beneath the signature (e.g. "Authorised Signatory · Hotel Excella"). */
  signatory_designation: string;
}
/**
 * Documents Retention setting.
 * retention_days = 0 means "Never Delete" — cleanup job is a no-op.
 */
export interface DocumentsRetentionSettings {
  retention_days: number;
}

export const DEFAULT_HOTEL: HotelSettings = {
  name: "Hotel Excella",
  logo_url: "",
  address: "Visakhapatnam, Andhra Pradesh",
  gstin: "",
  phone: "",
  email: "",
};
export const DEFAULT_OPS: OpsSettings = {
  check_in_time: "13:00",
  check_out_time: "11:00",
  currency: "INR",
  timezone: "Asia/Kolkata",
};
export const DEFAULT_BRANDING: BrandingSettings = {
  portal_title: "Welcome to Hotel Excella",
  welcome_message: "Thank you for choosing us. We look forward to hosting you.",
  invoice_footer: "Thank you for staying with us.",
  signature_url: "",
  signatory_designation: "Authorised Signatory · Hotel Excella",
};
export const DEFAULT_DOCUMENTS_RETENTION: DocumentsRetentionSettings = {
  retention_days: 60,
};

export const DOCUMENTS_RETENTION_OPTIONS: { label: string; days: number }[] = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "Never delete", days: 0 },
];

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await supabase
    .from("app_settings" as any)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  const v = (data as any)?.value ?? {};
  return { ...fallback, ...v };
}
async function writeSetting<T>(key: string, value: T): Promise<void> {
  const { error } = await supabase
    .from("app_settings" as any)
    .upsert({ key, value, updated_at: new Date().toISOString() } as any);
  if (error) throw error;
}

export const getHotelSettings = () => readSetting("hotel", DEFAULT_HOTEL);
export const setHotelSettings = (v: HotelSettings) => writeSetting("hotel", v);

export const getOpsSettings = () => readSetting("ops", DEFAULT_OPS);
export const setOpsSettings = (v: OpsSettings) => writeSetting("ops", v);

export const getBrandingSettings = () => readSetting("branding", DEFAULT_BRANDING);
export const setBrandingSettings = (v: BrandingSettings) => writeSetting("branding", v);

export const getDocumentsRetention = () =>
  readSetting("documents_retention", DEFAULT_DOCUMENTS_RETENTION);
export const setDocumentsRetention = (v: DocumentsRetentionSettings) =>
  writeSetting("documents_retention", v);
