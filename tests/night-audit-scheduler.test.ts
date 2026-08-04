import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Automatic Night Audit scheduler regressions.
 *
 * The scheduler must never re-implement audit logic — it drives the shared
 * session engine. These tests mock that engine plus the DB handle and assert
 * the scheduler's contract: idempotency, IST calendar clamp, blocking on
 * pending work, and multi-day catch-up.
 */

const state = {
  businessDate: "2026-07-01",
  pending: { ci: 0, co: 0 },
  priorAutoRun: false,
  runs: [] as any[],
  closes: 0,
};

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: state.priorAutoRun ? { id: "run-1" } : null,
              }),
            }),
          }),
        }),
      }),
      insert: async (row: any) => {
        state.runs.push(row);
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/night-audit-api", () => ({
  getBusinessDate: async () => state.businessDate,
  getPendingForAudit: async (bd: string) => ({
    businessDate: bd,
    pendingCheckIns: Array.from({ length: state.pending.ci }, (_, i) => ({ id: `ci${i}` })),
    pendingCheckOuts: Array.from({ length: state.pending.co }, (_, i) => ({ id: `co${i}` })),
  }),
}));

vi.mock("@/lib/night-audit-sessions-api", () => {
  class NightAuditPendingError extends Error {
    pendingCheckIns: any[] = [];
    pendingCheckOuts: any[] = [];
  }
  return {
    NightAuditPendingError,
    openOrResumeSession: async () => ({ id: `sess-${state.businessDate}` }),
    closeSession: async () => {
      state.closes += 1;
      const d = new Date(state.businessDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      state.businessDate = d.toISOString().slice(0, 10);
      return { newBusinessDate: state.businessDate };
    },
  };
});

vi.mock("@/lib/activity-log", () => ({
  logActivity: async () => {},
  newCorrelationId: () => "corr-test",
}));

import { runScheduledNightAudit, istToday } from "@/lib/night-audit-scheduler";

const AT_6AM_IST = new Date("2026-07-03T00:30:00Z");

beforeEach(() => {
  state.businessDate = "2026-07-02";
  state.pending = { ci: 0, co: 0 };
  state.priorAutoRun = false;
  state.runs = [];
  state.closes = 0;
});

afterEach(() => vi.clearAllMocks());

describe("night audit scheduler", () => {
  it("resolves today's date in Asia/Kolkata", () => {
    expect(istToday(AT_6AM_IST)).toBe("2026-07-03");
  });

  it("advances the business date by one day at 06:00 IST", async () => {
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("advanced");
    expect(r.ok).toBe(true);
    expect(r.businessDateBefore).toBe("2026-07-02");
    expect(r.businessDateAfter).toBe("2026-07-03");
    expect(r.daysAdvanced).toBe(1);
    expect(state.closes).toBe(1);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].mode).toBe("auto");
  });

  it("is a no-op when the business date already matches the calendar date", async () => {
    state.businessDate = "2026-07-03";
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("already_current");
    expect(state.closes).toBe(0);
  });

  it("is idempotent — a second run for the same business date does nothing", async () => {
    state.priorAutoRun = true;
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("already_ran");
    expect(state.closes).toBe(0);
  });

  it("never advances while pending check-ins exist", async () => {
    state.pending = { ci: 2, co: 0 };
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("blocked");
    expect(r.ok).toBe(false);
    expect(r.pendingCheckIns).toBe(2);
    expect(state.closes).toBe(0);
    expect(state.runs[0].notes).toContain("Blocked");
  });

  it("never advances while pending check-outs exist", async () => {
    state.pending = { ci: 0, co: 1 };
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("blocked");
    expect(r.pendingCheckOuts).toBe(1);
    expect(state.closes).toBe(0);
  });

  it("catches up multiple lagging business dates without passing today", async () => {
    state.businessDate = "2026-06-30";
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(r.status).toBe("advanced");
    expect(r.businessDateAfter).toBe("2026-07-03");
    expect(r.daysAdvanced).toBe(3);
    expect(state.closes).toBe(3);
    expect(state.runs).toHaveLength(3);
  });

  it("reports every run with duration telemetry", async () => {
    const r = await runScheduledNightAudit({ now: AT_6AM_IST });
    expect(typeof r.durationMs).toBe("number");
    expect(r.correlationId).toBe("corr-test");
  });
});
