/**
 * Robust mobile long-press hook.
 *
 * Why we don't use the previous in-line pointer handlers:
 *  - `setPointerCapture` on horizontally-scrolling rows fails silently on
 *    several Android Chrome / WebView versions.
 *  - Listening for `pointermove` / `pointerup` on the same element can be
 *    pre-empted by the parent scroll container claiming the gesture.
 *  - `touch-action: none` only takes effect AFTER touch starts on the
 *    element, and was applied conditionally which left a race window.
 *
 * This hook listens on `window` for the lifecycle events after `pointerdown`,
 * so the timer survives small scrolls / browser quirks. It still cancels
 * on movement past `moveTolerancePx` (so a real scroll attempt aborts).
 *
 * A global debug bus emits events so `LongPressDebugOverlay` can render the
 * live state without coupling the hook to UI.
 */
import { useCallback, useEffect, useRef } from "react";

export type LongPressDebugEvent = {
  t: number;
  kind: "down" | "move" | "up" | "cancel" | "fire" | "abort";
  id?: string;
  pointerType?: string;
  dx?: number;
  dy?: number;
  reason?: string;
};

type Listener = (e: LongPressDebugEvent) => void;
const listeners = new Set<Listener>();
export function subscribeLongPressDebug(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(e: LongPressDebugEvent) {
  // Always cheap; UI subscribes only when overlay is mounted.
  if (listeners.size === 0) return;
  listeners.forEach((l) => {
    try { l(e); } catch { /* noop */ }
  });
}

export interface LongPressOptions {
  enabled: boolean;
  delayMs?: number;
  moveTolerancePx?: number;
  onTrigger: () => void;
  /** Optional id for debug labelling (e.g. booking id). */
  debugId?: string;
}

export function useLongPress(opts: LongPressOptions) {
  const {
    enabled,
    delayMs = 500,
    moveTolerancePx = 14,
    onTrigger,
    debugId,
  } = opts;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const triggered = useRef(false);
  const activePointerId = useRef<number | null>(null);

  const cancel = useCallback((reason: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      emit({ t: Date.now(), kind: "abort", id: debugId, reason });
    }
    start.current = null;
    activePointerId.current = null;
  }, [debugId]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Window listeners — attached only while a press is in progress to
  // avoid leaking listeners for every chip on screen.
  useEffect(() => {
    if (!enabled) return;
    function onMove(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      if (!start.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      emit({ t: Date.now(), kind: "move", id: debugId, pointerType: e.pointerType, dx, dy });
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        cancel("moved beyond tolerance");
      }
    }
    function onUp(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      emit({ t: Date.now(), kind: "up", id: debugId, pointerType: e.pointerType });
      cancel("pointerup");
    }
    function onCancel(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      emit({ t: Date.now(), kind: "cancel", id: debugId, pointerType: e.pointerType });
      cancel("pointercancel");
    }
    // capture:true so we see events even when a child handler stopsPropagation.
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onCancel, { capture: true });
    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true } as any);
      window.removeEventListener("pointerup", onUp, { capture: true } as any);
      window.removeEventListener("pointercancel", onCancel, { capture: true } as any);
    };
  }, [enabled, cancel, moveTolerancePx, debugId]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled) return;
    if (e.pointerType === "mouse") return; // mobile/pen only
    if (timer.current) clearTimeout(timer.current);
    triggered.current = false;
    activePointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    emit({ t: Date.now(), kind: "down", id: debugId, pointerType: e.pointerType });
    timer.current = setTimeout(() => {
      timer.current = null;
      triggered.current = true;
      emit({ t: Date.now(), kind: "fire", id: debugId });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(40); } catch { /* noop */ }
      }
      onTrigger();
    }, delayMs);
  }, [enabled, delayMs, onTrigger, debugId]);

  // Block the synthetic onClick that may follow a long-press release.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (triggered.current) {
      e.preventDefault();
      e.stopPropagation();
      // Clear shortly after so a normal tap a moment later still fires.
      setTimeout(() => { triggered.current = false; }, 250);
    }
  }, []);

  // Block Android's native long-press context menu so it doesn't race with us.
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (enabled) e.preventDefault();
  }, [enabled]);

  return { onPointerDown, onClickCapture, onContextMenu, didTrigger: triggered };
}
