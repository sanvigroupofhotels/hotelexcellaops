import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Star, UserCheck, X } from "lucide-react";
import { searchCustomers, type CustomerRow } from "@/lib/customers-api";
import { listCustomerBookings } from "@/lib/bookings-api";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * Debounced customer search. Surfaces matches as a dropdown.
 * When the user picks a match, fires onPick(customer) — the parent decides what to prefill.
 * Also exposes an "Existing Customer Found" banner via onMatch when name OR phone has a strong match.
 */
export function CustomerAutocomplete({
  name,
  phone,
  email,
  onPick,
}: {
  name: string;
  phone: string;
  email?: string;
  onPick: (c: CustomerRow) => void;
}) {
  const query = (phone || name).trim();
  const [debounced, setDebounced] = useState(query);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: matches = [] } = useQuery({
    queryKey: ["customer-search", debounced],
    queryFn: () => searchCustomers(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  if (matches.length === 0 || !open) {
    // open auto-on when there are matches and user typing
    if (matches.length > 0 && !open) setTimeout(() => setOpen(true), 0);
    if (matches.length === 0) return null;
  }

  return (
    <div className="rounded-md border border-gold/30 bg-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-wider text-gold bg-gold-soft border-b border-gold/20">
        <span>{matches.length} matching customer{matches.length === 1 ? "" : "s"}</span>
        <button type="button" onClick={() => setOpen(false)} className="hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="max-h-56 overflow-auto divide-y divide-border/40">
        {matches.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { onPick(c); setOpen(false); }}
            className="w-full text-left px-3 py-2 hover:bg-secondary/50 text-sm"
          >
            <div className="flex items-center gap-2">
              {c.total_bookings > 0 && <Star className="h-3 w-3 fill-gold text-gold" />}
              <span className="font-medium">{c.guest_name}</span>
              <span className="text-xs text-muted-foreground">{c.customer_reference}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {c.phone} · {c.total_quotes} quote{c.total_quotes === 1 ? "" : "s"} · {c.total_bookings} booking{c.total_bookings === 1 ? "" : "s"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Banner shown when the form is linked to an existing customer.
 * Includes "Use Existing" (default) and "Create New Customer Anyway" actions.
 */
export function ExistingCustomerBanner({
  customer,
  onUseExisting,
  onCreateNew,
}: {
  customer: CustomerRow;
  onUseExisting: () => void;
  onCreateNew: () => void;
}) {
  const { data: bookings = [] } = useQuery({
    queryKey: ["customer-bookings", customer.id],
    queryFn: () => listCustomerBookings(customer.id),
    staleTime: 60_000,
  });
  return (
    <div className="rounded-lg border border-gold/40 bg-gold-soft p-4">
      <div className="flex items-start gap-3">
        <UserCheck className="h-5 w-5 text-gold mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-gold font-semibold">Existing Customer Found</span>
            {customer.total_bookings > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] text-gold">
                <Star className="h-2.5 w-2.5 fill-gold" /> Repeat
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-medium text-foreground">
            <Link to="/customers/$id" params={{ id: customer.id }} className="hover:text-gold">
              {customer.guest_name}
            </Link>
            <span className="text-muted-foreground"> · {customer.phone}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {customer.total_quotes} quote{customer.total_quotes === 1 ? "" : "s"} · {bookings.length} booking{bookings.length === 1 ? "" : "s"}
            {customer.customer_reference && <> · <span className="font-mono">{customer.customer_reference}</span></>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUseExisting}
          className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal"
        >
          Use Existing Customer
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs",
            "text-muted-foreground hover:text-foreground"
          )}
        >
          Create New Customer Anyway
        </button>
      </div>
    </div>
  );
}
