/**
 * Long-press diagnostic overlay. Mount once near the page root and toggle via
 * the URL search param `?lp=debug`. Shows a rolling log of pointer events
 * captured by `useLongPress`, plus the most recent state per chip id.
 *
 * This is a UAT tool — leave mounted in House View; it self-hides when the
 * `lp=debug` flag is absent so it costs nothing in normal operation.
 */
import { useEffect, useState } from "react";
import { subscribeLongPressDebug, type LongPressDebugEvent } from "@/hooks/use-long-press";

export function LongPressDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [log, setLog] = useState<LongPressDebugEvent[]>([]);

  // Read the flag from URL once on mount (and respond to history changes).
  useEffect(() => {
    function read() {
      try {
        const u = new URL(window.location.href);
        setEnabled(u.searchParams.get("lp") === "debug");
      } catch {
        setEnabled(false);
      }
    }
    read();
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    window.history.pushState = function pushState(this: History, ...args) {
      const result = originalPush.apply(this, args as any);
      read();
      return result;
    } as typeof window.history.pushState;
    window.history.replaceState = function replaceState(this: History, ...args) {
      const result = originalReplace.apply(this, args as any);
      read();
      return result;
    } as typeof window.history.replaceState;
    window.addEventListener("popstate", read);
    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      window.removeEventListener("popstate", read);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribeLongPressDebug((e) => {
      setLog((prev) => {
        const next = [...prev, e];
        // keep last 30
        return next.length > 30 ? next.slice(next.length - 30) : next;
      });
    });
    return () => { unsub(); };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        right: 8,
        zIndex: 9999,
        maxHeight: 260,
        overflow: "auto",
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        fontFamily: "ui-monospace,Menlo,monospace",
        fontSize: 10,
        padding: 8,
        borderRadius: 8,
        border: "1px solid rgba(255,215,0,0.5)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
        <strong style={{ color: "#FFD700" }}>Long-Press Debug</strong>
        <span style={{ flex: 1, opacity: 0.85 }}>
          {(() => {
            const last = log[log.length - 1];
            const dialog = [...log].reverse().find((e) => e.kind === "dialog-open");
            const fire = [...log].reverse().find((e) => e.kind === "timer-complete");
            if (!last) return "idle";
            return `last: ${last.kind}${last.reason ? ` (${last.reason})` : ""}` +
              (fire ? ` · fired#${fire.id?.slice(0,6) ?? ""}` : "") +
              (dialog ? ` · dialog✓` : "");
          })()}
        </span>
        <button
          type="button"
          onClick={() => setLog([])}
          style={{
            background: "transparent",
            border: "1px solid #888",
            color: "#fff",
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 10,
            cursor: "pointer",
          }}
        >clear</button>
      </div>
      {log.length === 0 ? (
        <div style={{ opacity: 0.7 }}>Touch a booking chip to trace events…</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {log.slice().reverse().map((e, i) => (
              <tr key={`${e.t}-${i}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={{ width: 60, opacity: 0.6 }}>{new Date(e.t).toISOString().slice(14, 23)}</td>
                <td style={{ width: 50, color: kindColor(e.kind), fontWeight: 600 }}>{e.kind}</td>
                <td style={{ opacity: 0.85 }}>
                  {e.pointerType ? `${e.pointerType} ` : ""}
                  {e.dx != null ? `Δ${e.dx},${e.dy} ` : ""}
                  {e.reason ? `· ${e.reason} ` : ""}
                  {e.id ? `· ${e.id.slice(0, 8)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function kindColor(k: LongPressDebugEvent["kind"]): string {
  switch (k) {
    case "touchstart": return "#FFD700";
    case "eligible": return "#22c55e";
    case "ineligible": return "#ef4444";
    case "timer-start": return "#fbbf24";
    case "timer-complete": return "#22c55e";
    case "dialog-open": return "#a855f7";
    case "abort": return "#ef4444";
    case "cancel": return "#f97316";
    case "up": return "#60a5fa";
    case "move": return "#94a3b8";
    default: return "#fff";
  }
}
