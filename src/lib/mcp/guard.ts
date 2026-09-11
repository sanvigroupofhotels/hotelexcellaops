/**
 * Shared MCP guard + result helpers.
 *
 * Rules for every HEOS MCP tool:
 *  - read-only in Phase 1;
 *  - authenticate through the verified OAuth token (never trust tool input);
 *  - authorize against the SAME permission matrix the app uses (`my_permissions`);
 *  - read through shared HEOS engines with the caller-scoped client injected;
 *  - never return documents, signatures, payment gateway secrets or raw notes.
 */
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Db } from "@/lib/db";
import { supabaseForUser } from "./supabase";

/** Error whose message is safe to show the calling assistant. */
export class McpToolError extends Error {}

/** Permission key groups, mirroring the app's PermissionGate usage. */
export const PERM = {
  bookings: ["bookings.view", "bookings.edit", "bookings.create", "house_view.view"],
  finance: ["dues.view", "reporting.payments.view", "bookings.view"],
  cash: ["cash.view"],
  housekeeping: ["housekeeping.view", "tasks.view", "house_view.view"],
  rooms: ["rooms.view", "house_view.view", "housekeeping.view"],
  complaints: ["complaints.view"],
  nightAudit: ["night_audit.run", "reporting.night_audit.view", "house_view.night_audit"],
  analytics: ["reporting.analytics.view", "reports.view"],
} as const;

/** Hard result caps so a natural-language request can never pull the database. */
export const MAX_ROWS = 200;
export function capLimit(n: number | undefined, fallback = 50) {
  const v = Number.isFinite(n) ? Number(n) : fallback;
  return Math.min(Math.max(1, Math.trunc(v as number)), MAX_ROWS);
}

async function loadPermissions(client: Db): Promise<Set<string>> {
  const { data, error } = await (client as any).rpc("my_permissions");
  if (error) throw new McpToolError("Could not verify permissions for this user.");
  const list = ((data as any[]) ?? []).map((r) =>
    typeof r === "string" ? r : (r?.my_permissions ?? r?.permission_key ?? null),
  );
  return new Set(list.filter(Boolean) as string[]);
}

/**
 * Authenticate + authorize, returning the caller-scoped client to inject into
 * the shared engines. `anyOf` is satisfied when the user holds ANY listed key.
 */
export async function requirePerm(ctx: ToolContext, anyOf: readonly string[] = []): Promise<Db> {
  if (!ctx.isAuthenticated()) throw new McpToolError("Not authenticated. Reconnect this app to Hotel Excella.");
  const client = supabaseForUser(ctx) as unknown as Db;
  if (anyOf.length) {
    const perms = await loadPermissions(client);
    if (!anyOf.some((p) => perms.has(p))) {
      throw new McpToolError(`Your Hotel Excella role does not allow this (needs one of: ${anyOf.join(", ")}).`);
    }
  }
  return client;
}

/** Stable JSON result: text for the model, structured for programmatic clients. */
export function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

/** Wrap a handler so engine/permission errors come back as clean tool errors. */
export function guarded<I>(fn: (input: I, ctx: ToolContext) => Promise<ReturnType<typeof ok>>) {
  return async (input: I, ctx: ToolContext) => {
    try {
      return await fn(input, ctx);
    } catch (e: any) {
      const msg = e instanceof McpToolError ? e.message : (e?.message ?? "Unexpected error");
      return fail(msg);
    }
  };
}

export const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

/** YYYY-MM-DD guard for date inputs. */
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDaysYmd(ymd: string, days: number) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
