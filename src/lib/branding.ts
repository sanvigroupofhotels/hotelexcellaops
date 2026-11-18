/** Browser-safe identity defaults and legacy compatibility; no database imports. */
export interface HotelIdentity {
  name: string;
  legal_name: string;
  logo_url: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
  website: string;
}

export interface BrandingSettings extends HotelIdentity {
  portal_title: string;
  welcome_message: string;
  invoice_footer: string;
  signature_url: string;
  signatory_designation: string;
}

export const DEFAULT_HOTEL: HotelIdentity = {
  name: "Hotel Excella", legal_name: "", logo_url: "",
  address: "Visakhapatnam, Andhra Pradesh", gstin: "",
  phone: "", email: "", website: "",
};

export const DEFAULT_BRANDING: BrandingSettings = {
  ...DEFAULT_HOTEL,
  portal_title: "Welcome to Hotel Excella",
  welcome_message: "Thank you for choosing us. We look forward to hosting you.",
  invoice_footer: "Thank you for staying with us.",
  signature_url: "",
  signatory_designation: "Authorised Signatory",
};

/** Branding is authoritative, including deliberately cleared fields. */
export function resolveBranding(branding?: unknown, legacyHotel?: unknown): BrandingSettings {
  const read = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const merged = { ...DEFAULT_BRANDING, ...read(legacyHotel), ...read(branding) };
  return Object.fromEntries(Object.entries(DEFAULT_BRANDING).map(([key, fallback]) =>
    [key, typeof merged[key as keyof typeof merged] === "string" ? merged[key as keyof typeof merged] : fallback],
  )) as unknown as BrandingSettings;
}