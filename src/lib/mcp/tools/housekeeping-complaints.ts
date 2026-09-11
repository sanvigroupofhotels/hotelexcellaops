import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { listTasksForDate } from "@/lib/hk-tasks";
import { listComplaints } from "@/lib/complaints-api";
import { capLimit, guarded, ok, PERM, requirePerm } from "../guard";

export const housekeepingTasksTool = defineTool({
  name: "list_housekeeping_tasks",
  title: "List housekeeping tasks",
  description: "List housekeeping tasks for an operational business date.",
  inputSchema: { business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), limit: z.number().int().min(1).max(200).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ business_date, limit }, ctx) => {
    const client = await requirePerm(ctx, PERM.housekeeping);
    const rows = (await listTasksForDate(business_date, client)).slice(0, capLimit(limit));
    return ok({ business_date, count: rows.length, rows });
  }),
});

export const complaintsSummaryTool = defineTool({
  name: "complaints_summary",
  title: "Get complaints summary",
  description: "Summarize complaints by status, priority, and category; optionally include capped safe rows.",
  inputSchema: { status: z.string().optional(), include_rows: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ status, include_rows, limit }, ctx) => {
    const client = await requirePerm(ctx, PERM.complaints);
    const source = await listComplaints(status ? { status } as any : undefined, client);
    const byStatus: Record<string, number> = {}, byPriority: Record<string, number> = {}, byCategory: Record<string, number> = {};
    for (const r of source as any[]) { byStatus[r.status ?? "Unknown"] = (byStatus[r.status ?? "Unknown"] ?? 0) + 1; byPriority[r.priority ?? "Unknown"] = (byPriority[r.priority ?? "Unknown"] ?? 0) + 1; byCategory[r.category ?? "Unknown"] = (byCategory[r.category ?? "Unknown"] ?? 0) + 1; }
    const rows = include_rows ? (source as any[]).slice(0, capLimit(limit, 25)).map((r) => ({ id: r.id, reference: r.reference ?? null, status: r.status, priority: r.priority, category: r.category, created_at: r.created_at, room_number: r.room_number ?? null })) : undefined;
    return ok({ total: source.length, by_status: byStatus, by_priority: byPriority, by_category: byCategory, ...(rows ? { rows } : {}) });
  }),
});