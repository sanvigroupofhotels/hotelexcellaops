/**
 * Robust mobile long-press hook.
 *
 * Performance contract
 * --------------------
 * Each mounted chip historically attached its own `pointermove` /
 * `touchmove` capture listeners on `window` (passive or otherwise). With
 * dozens of chips visible in House View this serialized through the
 * compositor on every scroll frame and was the dominant cause of mobile
 * scroll jank.
 *
 * This rewrite attaches window listeners **only while a press is in
 * progress**, scoped to the chip that initiated the press. When the user
 * lifts, cancels, or moves past tolerance, listeners are detached.
 *
 * A global debug bus emits events so `LongPressDebugOverlay` can render the
 * live state without coupling the hook to UI.
 */
import { useCallback, useEffect, useRef } from "react";
import type React from "react";

export type LongPressDebugEvent = {
  t: number;
  kind:
    | "touchstart"
    | "eligible"
    | "ineligible"
    | "timer-start"
    | "timer-complete"
    | "dialog-open"
    | "move" | "up" | "cancel" | "abort";
  id?: string;
  pointerType?: string;
  dx?: number;
  dy?: number;
  reason?: string;
  delayMs?: number;
};

type Listener = (e: LongPressDebugEvent) => void;
const listeners = new Set<Listener>();
export function subscribeLongPressDebug(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(e: LongPressDebugEvent) {
  if (listeners.size === 0) return;
  listeners.forEach((l) => { try { l(e); } catch { /* noop */ } });
}
export function emitLongPressDebug(e: Omit<LongPressDebugEvent, "t"> & { t?: number }) {
  emit({ t: Date.now(), ...e });
}

export interface LongPressOptions {
  enabled: boolean;
  delayMs?: number;
  moveTolerancePx?: number;
  onTrigger: () => void;
  debugId?: string;
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
  const detachRef = useRef<(() => void) | null>(null);

  // Latest onTrigger ref — avoids re-running the listener-attach effect on
  // each render just because the parent passed a new closure.
  const onTriggerRef = useRef(onTrigger);
  useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

  const detach = useCallback(() => {
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
  }, []);

  const cancel = useCallback((reason: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      emit({ t: Date.now(), kind: "abort", id: debugId, reason });
    }
    start.current = null;
    activePointerId.current = null;
    activeTouchId.current = null;
    detach();
  }, [debugId, detach]);

  const attachWindowListeners = useCallback(() => {
    detach();
    function onPointerMove(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      if (!start.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        emit({ t: Date.now(), kind: "move", id: debugId, pointerType: e.pointerType, dx, dy });
        cancel("moved beyond tolerance");
      }
    }
    function onPointerUp(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      emit({ t: Date.now(), kind: "up", id: debugId, pointerType: e.pointerType });
      cancel("pointerup");
    }
    function onPointerCancel(e: PointerEvent) {
      if (activePointerId.current == null || e.pointerId !== activePointerId.current) return;
      emit({ t: Date.now(), kind: "cancel", id: debugId, pointerType: e.pointerType });
      cancel("pointercancel");
    }
    function activeTouch(e: TouchEvent): Touch | null {
      if (activeTouchId.current == null) return null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (t?.identifier === activeTouchId.current) return t;
      }
      return null;
    }
    function onTouchMove(e: TouchEvent) {
      const t = activeTouch(e);
      if (!t || !start.current) return;
      const dx = Math.abs(t.clientX - start.current.x);
      const dy = Math.abs(t.clientY - start.current.y);
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        emit({ t: Date.now(), kind: "move", id: debugId, pointerType: "touch", dx, dy });
        cancel("touch moved beyond tolerance");
      }
    }
    function onTouchEnd(e: TouchEvent) {
      const t = activeTouch(e);
      if (!t) return;
      emit({ t: Date.now(), kind: e.type === "touchcancel" ? "cancel" : "up", id: debugId, pointerType: "touch" });
      cancel(e.type);
    }
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onPointerCancel, { capture: true });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    window.addEventListener("touchend", onTouchEnd, { capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { capture: true });
    detachRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove, { capture: true } as any);
      window.removeEventListener("pointerup", onPointerUp, { capture: true } as any);
      window.removeEventListener("pointercancel", onPointerCancel, { capture: true } as any);
      window.removeEventListener("touchmove", onTouchMove, { capture: true } as any);
      window.removeEventListener("touchend", onTouchEnd, { capture: true } as any);
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true } as any);
    };
  }, [cancel, detach, moveTolerancePx, debugId]);

  const begin = useCallback((input: {
    x: number;
    y: number;
    pointerId?: number | null;
    touchId?: number | null;
    pointerType: string;
  }) => {
    emit({ t: Date.now(), kind: "touchstart", id: debugId, pointerType: input.pointerType });
    if (!enabled) {
      emit({ t: Date.now(), kind: "ineligible", id: debugId, pointerType: input.pointerType, reason: disabledReason || "disabled" });
      return;
    }
    if (input.pointerType === "mouse") {
      emit({ t: Date.now(), kind: "abort", id: debugId, pointerType: input.pointerType, reason: "mouse pointer ignored" });
      return;
    }
    emit({ t: Date.now(), kind: "eligible", id: debugId, pointerType: input.pointerType, reason: "movable" });
    if (timer.current) clearTimeout(timer.current);
    triggered.current = false;
    activePointerId.current = input.pointerId ?? null;
    activeTouchId.current = input.touchId ?? null;
    start.current = { x: input.x, y: input.y };
    attachWindowListeners();
    emit({ t: Date.now(), kind: "timer-start", id: debugId, pointerType: input.pointerType, delayMs });
    timer.current = setTimeout(() => {
      timer.current = null;
      triggered.current = true;
      emit({ t: Date.now(), kind: "timer-complete", id: debugId, reason: `held ${delayMs}ms` });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(40); } catch { /* noop */ }
      }
      onTriggerRef.current();
    }, delayMs);
  }, [enabled, debugId, disabledReason, delayMs, attachWindowListeners]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      detach();
    };
  }, [detach]);

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

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (triggered.current) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { triggered.current = false; }, 250);
    }
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (enabled) e.preventDefault();
  }, [enabled]);

  const bind = useCallback(() => ({
    onPointerDown,
    onTouchStart,
    onClickCapture,
    onContextMenu,
  }), [onPointerDown, onTouchStart, onClickCapture, onContextMenu]);

  return { bind, onPointerDown, onTouchStart, onClickCapture, onContextMenu, didTrigger: triggered };
}
