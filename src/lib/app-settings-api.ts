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
