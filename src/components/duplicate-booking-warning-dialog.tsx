import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  checkBookingDuplicates, type DuplicateBookingMatch, type DuplicateCheckInput,
} from "@/lib/booking-duplicates-api";

/**
 * Advisory duplicate-booking guard for Front Desk creation.
 * `confirm()` resolves true when there is no duplicate or staff chose to continue.
 */
export function useDuplicateBookingGuard() {
  const [matches, setMatches] = useState<DuplicateBookingMatch[]>([]);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(async (input: DuplicateCheckInput): Promise<boolean> => {
    let found: DuplicateBookingMatch[] = [];
    try { found = await checkBookingDuplicates(input); } catch (e) { console.warn("duplicate check failed", e); }
    if (found.length === 0) return true;
    setMatches(found);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (ok: boolean) => {
    setMatches([]);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = (
    <Dialog open={matches.length > 0} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="luxe-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" /> Possible duplicate booking
          </DialogTitle>
          <DialogDescription>
            An active booking already exists for this guest on overlapping dates. Is this an additional room or a duplicate?
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {matches.map((m) => (
            <li key={m.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gold">#{m.booking_reference ?? m.id.slice(0, 8)}</span>
                <span className="text-xs text-muted-foreground">{m.status}</span>
              </div>
              <div className="mt-1">{m.guest_name} {m.phone ? `(${m.phone})` : ""}</div>
              <div className="text-xs text-muted-foreground">
                {m.check_in} → {m.check_out}{m.rooms.length ? ` · Room ${m.rooms.join(", ")}` : ""}
              </div>
              <a href={`/bookings/${m.id}`} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-gold hover:underline">
                View existing booking <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={() => close(true)}>Continue &amp; Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
