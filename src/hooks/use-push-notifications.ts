import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/push-config";
import { savePushSubscription, removePushSubscription } from "@/lib/push-subscriptions.functions";

/**
 * Granular lifecycle states for the Push subscription UI.
 *
 * Every failure mode is its own enum value so the settings screen can
 * surface a meaningful status and remediation instead of a generic
 * "Temporarily unavailable" message.
 */
export type PushStatus =
  | "idle"               // initial state before probing
  | "checking"           // capability probe in progress
  | "unsupported"        // browser lacks SW / PushManager / Notification
  | "insecure_context"   // page not served over https / localhost
  | "permission_default" // user hasn't been asked yet
  | "permission_denied"  // user blocked notifications in browser
  | "requesting"         // permission prompt is up
  | "registering_sw"     // installing service worker
  | "subscribing"        // calling PushManager.subscribe()
  | "persisting"         // calling savePushSubscription server fn
  | "enabled"            // subscribed and persisted, ready to receive
  | "sw_failed"          // service worker registration failed
  | "subscribe_failed"   // PushManager.subscribe() threw
  | "persist_failed"     // server-side upsert failed
  | "vapid_invalid"      // VAPID public key missing/malformed
  | "unknown_error";     // anything we couldn't classify

export interface PushDiagnostics {
  status: PushStatus;
  permission: NotificationPermission | "unknown";
  secureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  vapidKeyPresent: boolean;
  errorDetail: string | null;
  subscriptionEndpoint: string | null;
  swScope: string | null;
  lastUpdated: string;
}

const initialDiag = (): PushDiagnostics => ({
  status: "idle",
  permission: "unknown",
  secureContext: false,
  hasServiceWorker: false,
  hasPushManager: false,
  hasNotification: false,
  vapidKeyPresent: false,
  errorDetail: null,
  subscriptionEndpoint: null,
  swScope: null,
  lastUpdated: new Date().toISOString(),
});

function detectCapabilities(): Partial<PushDiagnostics> {
  if (typeof window === "undefined") {
    return { status: "checking" };
  }
  const secureContext =
    window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  const vapidKeyPresent = typeof VAPID_PUBLIC_KEY === "string" && VAPID_PUBLIC_KEY.length > 0;
  return { secureContext, hasServiceWorker, hasPushManager, hasNotification, vapidKeyPresent };
}

export function usePushNotifications(options: { autoRegister?: boolean } = {}) {
  const [diag, setDiag] = useState<PushDiagnostics>(initialDiag);
  const save = useServerFn(savePushSubscription);
  const remove = useServerFn(removePushSubscription);

  const update = useCallback((patch: Partial<PushDiagnostics>) => {
    setDiag((d) => ({ ...d, ...patch, lastUpdated: new Date().toISOString() }));
  }, []);

  /** Re-probe capabilities + permission and reflect the current truth. */
  const probe = useCallback(async () => {
    const caps = detectCapabilities();
    const permission =
      typeof Notification !== "undefined" ? Notification.permission : "unknown";

    if (!caps.secureContext) {
      update({ ...caps, permission, status: "insecure_context" });
      return;
    }
    if (!caps.hasServiceWorker || !caps.hasPushManager || !caps.hasNotification) {
      update({ ...caps, permission, status: "unsupported" });
      return;
    }
    if (!caps.vapidKeyPresent) {
      update({ ...caps, permission, status: "vapid_invalid", errorDetail: "VAPID public key not configured" });
      return;
    }
    if (permission === "denied") { update({ ...caps, permission, status: "permission_denied" }); return; }
    if (permission === "default") { update({ ...caps, permission, status: "permission_default" }); return; }

    // permission === granted — confirm existing subscription AND re-persist
    // server-side so a missing/expired DB row gets healed on every mount.
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        update({ ...caps, permission, status: "permission_default", subscriptionEndpoint: null, swScope: reg?.scope ?? null });
        return;
      }
      // Idempotent re-upsert — guarantees the dispatcher can find this device.
      try {
        const json: any = sub.toJSON();
        await save({
          data: {
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
            user_agent: navigator.userAgent,
          },
        });
        update({ ...caps, permission, status: "enabled", subscriptionEndpoint: sub.endpoint, swScope: reg?.scope ?? null });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error("[push] re-persist failed", e);
        update({ ...caps, permission, status: "persist_failed", errorDetail: msg, subscriptionEndpoint: sub.endpoint, swScope: reg?.scope ?? null });
      }
    } catch (e: any) {
      update({ ...caps, permission, status: "unknown_error", errorDetail: e?.message ?? String(e) });
    }
  }, [update, save]);

  /**
   * Full enable flow. Each step transitions to a granular status so the UI
   * can show progress and the user can see exactly where a failure happened.
   */
  const enable = useCallback(async (): Promise<PushStatus> => {
    update({ status: "checking", errorDetail: null });
    const caps = detectCapabilities();
    if (!caps.secureContext) { update({ ...caps, status: "insecure_context" }); return "insecure_context"; }
    if (!caps.hasServiceWorker || !caps.hasPushManager || !caps.hasNotification) {
      update({ ...caps, status: "unsupported" }); return "unsupported";
    }
    if (!caps.vapidKeyPresent) { update({ ...caps, status: "vapid_invalid" }); return "vapid_invalid"; }

    // Permission
    let permission = Notification.permission;
    if (permission === "default") {
      update({ status: "requesting" });
      try { permission = await Notification.requestPermission(); }
      catch (e: any) {
        update({ status: "unknown_error", errorDetail: e?.message ?? String(e) });
        return "unknown_error";
      }
    }
    if (permission === "denied") { update({ permission, status: "permission_denied" }); return "permission_denied"; }
    if (permission !== "granted") { update({ permission, status: "permission_default" }); return "permission_default"; }
    update({ permission });

    // Service Worker
    update({ status: "registering_sw" });
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      update({ swScope: reg.scope });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[push] SW registration failed", e);
      update({ status: "sw_failed", errorDetail: msg });
      return "sw_failed";
    }

    // Subscribe
    update({ status: "subscribing" });
    let sub: PushSubscription;
    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        sub = existing;
      } else {
        // Fresh ArrayBuffer per subscribe (some Safari/Chromium builds reject views)
        const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        const ab = new ArrayBuffer(keyBytes.byteLength);
        new Uint8Array(ab).set(keyBytes);
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ab });
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[push] subscribe failed", e);
      // InvalidStateError tends to mean an existing subscription has different keys → unsubscribe + retry once
      if (/invalid state|already subscribed/i.test(msg)) {
        try {
          const existing = await reg.pushManager.getSubscription();
          await existing?.unsubscribe();
        } catch { /* noop */ }
      }
      update({ status: "subscribe_failed", errorDetail: msg });
      return "subscribe_failed";
    }

    // Persist
    update({ status: "persisting", subscriptionEndpoint: sub.endpoint });
    try {
      const json: any = sub.toJSON();
      await save({
        data: {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          user_agent: navigator.userAgent,
        },
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[push] persist failed", e);
      update({ status: "persist_failed", errorDetail: msg });
      return "persist_failed";
    }

    update({ status: "enabled" });
    return "enabled";
  }, [save, update]);

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        try { await remove({ data: { endpoint: sub.endpoint } }); } catch { /* noop */ }
        try { await sub.unsubscribe(); } catch { /* noop */ }
      }
    } catch (e) { console.warn("[push] disable failed", e); }
    update({ status: "permission_default", subscriptionEndpoint: null });
  }, [remove, update]);

  // Initial probe on mount
  useEffect(() => { void probe(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Optional auto-resync when caller explicitly opts in (e.g. layout-level)
  useEffect(() => {
    if (!options.autoRegister) return;
    if (diag.status === "permission_default" && diag.permission === "granted") {
      void enable();
    }
  }, [options.autoRegister, diag.status, diag.permission, enable]);

  return { diag, enable, disable, refresh: probe };
}
