import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_HOTEL, DEFAULT_BRANDING, resolveBranding, type BrandingSettings, type HotelIdentity } from "@/lib/branding";
import { saveBranding } from "@/lib/branding.functions";
export { DEFAULT_HOTEL, DEFAULT_BRANDING };
export type { BrandingSettings };

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

export type HotelSettings = HotelIdentity;
export interface OpsSettings {
  check_in_time: string;
  check_out_time: string;
  currency: string;
  timezone: string;
}
/**
 * Documents Retention setting.
 * retention_days = 0 means "Never Delete" — cleanup job is a no-op.
 */
export interface DocumentsRetentionSettings {
  retention_days: number;
}

export const DEFAULT_OPS: OpsSettings = {
  check_in_time: "13:00",
  check_out_time: "11:00",
  currency: "INR",
  timezone: "Asia/Kolkata",
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

export const getHotelSettings = async (): Promise<HotelSettings> => {
  const branding = await getBrandingSettings();
  return Object.fromEntries(Object.keys(DEFAULT_HOTEL).map((key) => [key, branding[key as keyof HotelIdentity]])) as unknown as HotelSettings;
};
export const setHotelSettings = async (v: HotelSettings) => setBrandingSettings({ ...await getBrandingSettings(), ...v });

export const getOpsSettings = () => readSetting("ops", DEFAULT_OPS);
export const setOpsSettings = (v: OpsSettings) => writeSetting("ops", v);

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const { data, error } = await supabase.from("app_settings" as any).select("key,value").in("key", ["hotel", "branding"]);
  if (error) throw error;
  const settings = new Map((data ?? []).map((row: any) => [row.key, row.value]));
  return resolveBranding(settings.get("branding"), settings.get("hotel"));
}
export const setBrandingSettings = async (v: BrandingSettings): Promise<void> => { await saveBranding({ data: v }); };

export const getDocumentsRetention = () =>
  readSetting("documents_retention", DEFAULT_DOCUMENTS_RETENTION);
export const setDocumentsRetention = (v: DocumentsRetentionSettings) =>
  writeSetting("documents_retention", v);
