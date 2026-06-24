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
import type React from "react";
import { useDrag } from "@use-gesture/react";

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
  /** Shown in the debug overlay when the chip receives touch but is disabled. */
  disabledReason?: string;
}

export function useLongPress(opts: LongPressOptions) {
  const {
    enabled,
    delayMs = 500,
    moveTolerancePx = 14,
    onTrigger,
    debugId,
    disabledReason,
  } = opts;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const triggered = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const activeTouchId = useRef<number | null>(null);

  const cancel = useCallback((reason: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      emit({ t: Date.now(), kind: "abort", id: debugId, reason });
    }
    start.current = null;
    activePointerId.current = null;
    activeTouchId.current = null;
  }, [debugId]);

  const begin = useCallback((input: {
    x: number;
    y: number;
    pointerId?: number | null;
    touchId?: number | null;
    pointerType: string;
  }) => {
    if (!enabled) {
      emit({ t: Date.now(), kind: "abort", id: debugId, pointerType: input.pointerType, reason: disabledReason || "disabled" });
      return;
    }
    if (input.pointerType === "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    triggered.current = false;
    activePointerId.current = input.pointerId ?? null;
    activeTouchId.current = input.touchId ?? null;
    start.current = { x: input.x, y: input.y };
    emit({ t: Date.now(), kind: "down", id: debugId, pointerType: input.pointerType });
    timer.current = setTimeout(() => {
      timer.current = null;
      triggered.current = true;
      emit({ t: Date.now(), kind: "fire", id: debugId });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(40); } catch { /* noop */ }
      }
      onTrigger();
    }, delayMs);
  }, [enabled, debugId, disabledReason, delayMs, onTrigger]);

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

  // Touch fallback for browsers/webviews that translate long-press gestures
  // into touch events before React's pointer handlers can reliably hold state.
  useEffect(() => {
    if (!enabled) return;
    function activeTouch(e: TouchEvent) {
      if (activeTouchId.current == null) return null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (t?.identifier === activeTouchId.current) return t;
      }
      return null;
    }
    function onMove(e: TouchEvent) {
      const t = activeTouch(e);
      if (!t || !start.current) return;
      const dx = Math.abs(t.clientX - start.current.x);
      const dy = Math.abs(t.clientY - start.current.y);
      emit({ t: Date.now(), kind: "move", id: debugId, pointerType: "touch", dx, dy });
      if (dx > moveTolerancePx || dy > moveTolerancePx) cancel("touch moved beyond tolerance");
    }
    function onEnd(e: TouchEvent) {
      const t = activeTouch(e);
      if (!t) return;
      emit({ t: Date.now(), kind: e.type === "touchcancel" ? "cancel" : "up", id: debugId, pointerType: "touch" });
      cancel(e.type);
    }
    window.addEventListener("touchmove", onMove, { capture: true, passive: true });
    window.addEventListener("touchend", onEnd, { capture: true });
    window.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      window.removeEventListener("touchmove", onMove, { capture: true } as any);
      window.removeEventListener("touchend", onEnd, { capture: true } as any);
      window.removeEventListener("touchcancel", onEnd, { capture: true } as any);
    };
  }, [enabled, cancel, moveTolerancePx, debugId]);

  const bindGesture = useDrag(({ first, last, movement: [mx, my], event }) => {
    const ev = event as PointerEvent | TouchEvent;
    const pointerType = "pointerType" in ev ? ev.pointerType : ev.type.startsWith("touch") ? "touch" : "unknown";
    if (pointerType === "mouse") return;
    if (first) {
      if ("clientX" in ev) {
        begin({ x: ev.clientX, y: ev.clientY, pointerId: "pointerId" in ev ? ev.pointerId : null, pointerType });
      }
    }
    const dx = Math.abs(mx);
    const dy = Math.abs(my);
    if (dx || dy) emit({ t: Date.now(), kind: "move", id: debugId, pointerType, dx, dy });
    if (dx > moveTolerancePx || dy > moveTolerancePx) cancel("gesture moved beyond tolerance");
    if (last) cancel("gesture end");
  }, {
    enabled,
    pointer: { capture: false, touch: true, keys: false },
    filterTaps: true,
    tapsThreshold: moveTolerancePx,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (activeTouchId.current != null) return;
    begin({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType });
  }, [begin]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (activePointerId.current != null) return;
    const t = e.changedTouches.item(0);
    if (!t) return;
    begin({ x: t.clientX, y: t.clientY, touchId: t.identifier, pointerType: "touch" });
  }, [begin]);

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

  const bind = useCallback(() => {
    const gestureProps = bindGesture() as Record<string, any>;
    const gesturePointerDown = gestureProps.onPointerDown;
    const gestureTouchStart = gestureProps.onTouchStart;
    return {
      ...gestureProps,
      onPointerDown: (e: React.PointerEvent) => {
        gesturePointerDown?.(e);
        onPointerDown(e);
      },
      onTouchStart: (e: React.TouchEvent) => {
        gestureTouchStart?.(e);
        onTouchStart(e);
      },
      onClickCapture,
      onContextMenu,
    };
  }, [bindGesture, onPointerDown, onTouchStart, onClickCapture, onContextMenu]);

  return { bind, onPointerDown, onTouchStart, onClickCapture, onContextMenu, didTrigger: triggered };
}
