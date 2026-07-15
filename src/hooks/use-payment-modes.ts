/**
 * usePaymentModes — single source of truth for the Payment Mode dropdown
 * across every surface (Add Payment, Refund, Cancel-with-Refund, Advance on
 * new/quick booking, Payment Reports filter, etc.).
 *
 * Reads active rows from `master_data.payment_method` and returns their
 * `label` values (what the admin curates in Master Data → Finance → Payment
 * Modes). Falls back to a small legacy list when the master is empty so the
 * UI never renders an empty dropdown during initial deployment.
 *
 * The internal storage category remains `payment_method` for backward
 * compatibility with existing rows, activity logs, and reporting. Any
 * historical `booking_payments.payment_mode` value survives untouched — this
 * hook governs only what the admin sees and picks in dropdowns.
 */
import { useMasterData } from "@/hooks/use-master-data";
import { PAYMENT_MODES as LEGACY_PAYMENT_MODES } from "@/lib/booking-payments-api";

export function usePaymentModes() {
  const md = useMasterData("payment_method", [...LEGACY_PAYMENT_MODES]);
  // Prefer curated labels; when the master is empty, useMasterData already
  // returns the fallback via `values`, so we mirror that shape.
  const labels = md.rows.filter((r) => r.active).map((r) => r.label);
  const modes = labels.length > 0 ? labels : [...LEGACY_PAYMENT_MODES];
  return { modes, isLoading: md.isLoading };
}
