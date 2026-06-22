/**
 * Shared shell for the End of Day module.
 *
 * Provides the right-side info column visible in the Treebo-style mockup
 * (Business Date, Calendar Date, Timezone, version), plus a slot for the
 * main page content. Designed mobile-first; the info column stacks below
 * content on phones and floats to the right on md+.
 */
import * as React from "react";
import { Calendar, Clock, Globe2 } from "lucide-react";
import { useNightAuditStatus } from "@/hooks/use-night-audit-status";
import { Topbar } from "@/components/topbar";

function fmtDate(ymd?: string): string {
  if (!ymd) return "—";
  try {
    return new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

function useNow() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function EodShell({ title, children }: { title: string; children: React.ReactNode }) {
  const status = useNightAuditStatus();
  const now = useNow();
  const businessDate = status.data?.businessDate;
  const calendar = now.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div>
      <Topbar title={title} />
      <div className="mx-auto max-w-6xl p-4 md:p-6 grid gap-4 md:grid-cols-[1fr_240px]">
        <div className="min-w-0 space-y-4">{children}</div>
        <aside className="md:sticky md:top-4 self-start space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Business Date</div>
              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="h-3.5 w-3.5 text-gold" />
                <span className="font-medium">{fmtDate(businessDate)}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Calendar Date</div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{calendar}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Timezone</div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5" />
                <span>UTC +05:30</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground text-center">v1.0.0</div>
        </aside>
      </div>
    </div>
  );
}
