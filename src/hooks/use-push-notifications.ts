import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/push-config";
import { savePushSubscription, removePushSubscription } from "@/lib/push-subscriptions.functions";

type PushState =
  | "unsupported"
  | "denied"
  | "default"
  | "granted-pending"
  | "granted"
  | "error";


/**
 * Reusable Push Notification framework hook.
 *
 * Push is additive to in-app notifications: if anything here fails (no SW,
 * no Push API, permission denied, network error, VAPID issue), the app
 * continues to function and the bell continues to receive realtime / poll
 * updates as usual.
 *
 * Usage: call `usePushNotifications()` once at the authenticated layout level
 * to auto-register the SW. Use the returned `requestPermission()` to prompt
 * the user from a settings screen or a one-time CTA.
 */
export function usePushNotifications(options: { autoRegister?: boolean } = {}) {
  const [state, setState] = useState<PushState>("default");
  const save = useServerFn(savePushSubscription);
  const remove = useServerFn(removePushSubscription);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const sync = useCallback(async () => {
    if (!supported) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    if (Notification.permission === "default") { setState("default"); return; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes.buffer.slice(
            keyBytes.byteOffset,
            keyBytes.byteOffset + keyBytes.byteLength,
          ) as ArrayBuffer,
        });
      }
      const json: any = sub.toJSON();
      await save({
        data: {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          user_agent: navigator.userAgent,
        },
      });
      setState("granted");
    } catch (e) {
      console.warn("[push] subscription sync failed", e);
      setState("error");
    }
  }, [supported, save]);

  const requestPermission = useCallback(async () => {
    if (!supported) return "unsupported" as const;
    if (Notification.permission === "granted") { await sync(); return "granted" as const; }
    if (Notification.permission === "denied") return "denied" as const;
    setState("granted-pending");
    const res = await Notification.requestPermission();
    if (res === "granted") { await sync(); return "granted" as const; }
    setState(res === "denied" ? "denied" : "default");
    return res;
  }, [supported, sync]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        try { await remove({ data: { endpoint: sub.endpoint } }); } catch { /* noop */ }
        await sub.unsubscribe();
      }
    } catch (e) { console.warn("[push] unsubscribe failed", e); }
    setState("default");
  }, [supported, remove]);

  // Auto-register SW and refresh subscription on mount if already granted.
  useEffect(() => {
    if (!options.autoRegister) return;
    if (!supported) { setState("unsupported"); return; }
    if (Notification.permission === "granted") { sync(); }
    else if (Notification.permission === "denied") { setState("denied"); }
  }, [options.autoRegister, supported, sync]);

  return { state, supported, requestPermission, unsubscribe, sync };
}
