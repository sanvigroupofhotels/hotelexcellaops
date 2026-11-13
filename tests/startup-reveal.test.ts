import { describe, expect, it } from "vitest";
import { claimStartupReveal, startupRevealAllowed } from "../src/lib/startup-reveal";

describe("single startup reveal", () => {
  it("plays only once in a session", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(claimStartupReveal(storage)).toBe(true);
    expect(claimStartupReveal(storage)).toBe(false);
  });
  it.each(["/.well-known/oauth-authorization-server", "/.lovable/oauth/consent", "/mcp", "/mcp/mulesoft", "/api/public/hook", "/oauth/callback", "/auth/callback"])("excludes machine and OAuth entry %s", (path) => {
    expect(startupRevealAllowed(path)).toBe(false);
  });
  it.each(["/", "/login"])("permits hotel entry %s", (path) => {
    expect(startupRevealAllowed(path)).toBe(true);
  });
});