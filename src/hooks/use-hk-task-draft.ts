/**
 * Housekeeping task draft persistence.
 *
 * The task screen collects a lot of local state before submit — consumables
 * selected + quantities, linen picked, issues + notes, remarks. If the tab
 * is refreshed / crashes / phone reboots, that work is lost even though the
 * `housekeeping_tasks` row is still pending.
 *
 * This hook mirrors the in-memory form state into `localStorage`, scoped by:
 *
 *   { userId (recorder), workingAsId (performer), taskId }
 *
 * so drafts never leak between staff sharing a device or between different
 * tasks. Drafts include a `savedAt` timestamp and are silently ignored if
 * older than 24h (stale-draft guard — the task might have been completed
 * on another device meanwhile). On successful submit, callers MUST call
 * `clear()` — the completeTask handler owns that.
 */
import { useEffect, useRef } from "react";

export interface HkTaskDraft {
  consumSel: Record<string, { on: boolean; qty: number }>;
  consumEdit: Record<string, boolean>;
  linenSel: Record<string, boolean>;
  issueSel: Record<string, { on: boolean; note: string }>;
  remarks: string;
  noIssue: boolean;
  savedAt: number;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function keyOf(userId: string | null, workingAsId: string | null, taskId: string) {
  return `hk_task_draft:${userId ?? "anon"}:${workingAsId ?? "self"}:${taskId}`;
}

export function loadHkDraft(
  userId: string | null,
  workingAsId: string | null,
  taskId: string,
): HkTaskDraft | null {
  try {
    const raw = window.localStorage.getItem(keyOf(userId, workingAsId, taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HkTaskDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(keyOf(userId, workingAsId, taskId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearHkDraft(
  userId: string | null,
  workingAsId: string | null,
  taskId: string,
) {
  try {
    window.localStorage.removeItem(keyOf(userId, workingAsId, taskId));
  } catch { /* ignore */ }
}

/**
 * Debounced auto-save of the current form state. Returns nothing; parents
 * remain the source of truth for state. Call `clearHkDraft` after successful
 * submit.
 */
export function useHkTaskDraftAutoSave(
  userId: string | null,
  workingAsId: string | null,
  taskId: string,
  snapshot: Omit<HkTaskDraft, "savedAt">,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const draft: HkTaskDraft = { ...snapshot, savedAt: Date.now() };
        window.localStorage.setItem(keyOf(userId, workingAsId, taskId), JSON.stringify(draft));
      } catch { /* quota / private mode — ignore */ }
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workingAsId, taskId, JSON.stringify(snapshot)]);
}
