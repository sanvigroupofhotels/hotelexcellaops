/**
 * Runtime database handle.
 *
 * Every shared engine that must be callable from BOTH the browser (RLS, user
 * session) and a trusted server context (scheduled Night Audit, webhooks)
 * resolves its Supabase client through `db()` instead of importing the browser
 * client directly. This keeps ONE implementation of each engine — the server
 * simply swaps the handle for the duration of the call.
 *
 * Usage on the server:
 *
 *   import { supabaseAdmin } from "@/integrations/supabase/client.server";
 *   await withDb(supabaseAdmin as unknown as Db, () => runScheduledNightAudit());
 *
 * NOTE: the override is scoped to the synchronous+awaited body of `withDb`.
 * It is intended for single-flight server tasks (cron / webhook handlers), not
 * for concurrent per-user request handling.
 */
import { supabase } from "@/integrations/supabase/client";

export type Db = typeof supabase;

let override: Db | null = null;

/** The client the shared engines should use right now. */
export function db(): Db {
  return override ?? supabase;
}

/** True when a server-side handle is currently installed. */
export function isServerDb(): boolean {
  return override !== null;
}

export async function withDb<T>(client: Db, fn: () => Promise<T>): Promise<T> {
  const prev = override;
  override = client;
  try {
    return await fn();
  } finally {
    override = prev;
  }
}
