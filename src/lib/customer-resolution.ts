/**
 * Shared Customer Resolution layer.
 *
 * Single consumer point for "given some contact details, who is the customer?".
 * Every booking source (Detailed Booking, Quick Booking, Website, OTA,
 * Walk-in, Group Booking, API) MUST use these helpers — never re-implement
 * mobile normalization, lookup, or duplicate-prevention inside a screen.
 *
 * Wraps:
 *   • `normalizePhoneNumber` / `validatePhoneNumber`  → `@/lib/phone`
 *   • `findCustomerByContact`                         → `@/lib/customers-api`
 *
 * Customer CREATION is owned by the booking pipeline:
 *   `createBooking()` passes `customer_id: customer_id || null` and the
 *   DB-side trigger atomically links-by-phone or creates a new customer.
 *   That is the single duplicate-prevention authority — UIs must not race
 *   their own create paths.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";
import { findCustomerByContact, type CustomerRow } from "@/lib/customers-api";

export interface PhoneLookupResult {
  /** Trimmed/cleaned canonical phone (+91XXXXXXXXXX) — or "" if not yet valid. */
  normalizedPhone: string;
  /** True if `normalizedPhone` passes the E.164 IN check. */
  isValid: boolean;
  /** Existing customer auto-detected by phone — null while typing or when no match. */
  matchedCustomer: CustomerRow | null;
  /** Lookup query is in-flight. */
  isLoading: boolean;
}

/**
 * Phone-only lookup. Quick Booking and any other phone-first surface use this:
 * Reception types a mobile → existing customer surfaces immediately. No name
 * or email heuristics — phone is our unique customer key.
 */
export function useExistingCustomerByPhone(rawPhone: string): PhoneLookupResult {
  const normalizedPhone = useMemo(() => normalizePhoneNumber(rawPhone), [rawPhone]);
  const isValid = validatePhoneNumber(normalizedPhone);
  const { data, isFetching } = useQuery({
    queryKey: ["customer-resolution", "by-phone", normalizedPhone],
    queryFn: () => findCustomerByContact(normalizedPhone, undefined, undefined),
    enabled: isValid,
    staleTime: 30_000,
  });
  return {
    normalizedPhone,
    isValid,
    matchedCustomer: (data ?? null) as CustomerRow | null,
    isLoading: isFetching,
  };
}

/**
 * Contact-blob lookup (phone OR email, with optional exact-name disambiguation).
 * Used by the Detailed Booking Form which can prefill from an email-only
 * inbound lead. Internally debounced.
 */
export function useExistingCustomerByContact(input: {
  phone: string;
  email: string;
  name: string;
  /** Disable the lookup entirely when the form is already linked/forced. */
  enabled?: boolean;
}): {
  matchedCustomer: CustomerRow | null;
  exactMatch: CustomerRow | null;
} {
  const [debounced, setDebounced] = useState(input);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), 300);
    return () => clearTimeout(t);
  }, [input.phone, input.email, input.name]); // eslint-disable-line

  const phone = debounced.phone.trim();
  const email = debounced.email.trim();
  const phoneOk = phone.length >= 7;
  const emailOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const enabled = (input.enabled ?? true) && (phoneOk || emailOk);

  const { data } = useQuery({
    queryKey: ["customer-resolution", "by-contact", phone, email, debounced.name],
    queryFn: () => findCustomerByContact(
      phoneOk ? phone : undefined,
      emailOk ? email : undefined,
      debounced.name,
    ),
    enabled,
    staleTime: 30_000,
  });

  const matched = (data ?? null) as CustomerRow | null;
  const exact = matched && phoneOk && matched.phone === phone &&
    (matched.guest_name ?? "").trim().toLowerCase() === debounced.name.trim().toLowerCase()
    ? matched : null;

  return { matchedCustomer: matched, exactMatch: exact };
}
