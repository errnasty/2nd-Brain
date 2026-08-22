import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuth } from "./cron-auth";

const original = process.env.CRON_SECRET;
afterEach(() => {
  process.env.CRON_SECRET = original;
});

function req(authorization?: string): Request {
  return new Request("https://example.test/api/cron/sync-feeds", {
    headers: authorization ? { authorization } : {},
  });
}

describe("checkCronAuth", () => {
  it("accepts a matching bearer token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req("Bearer s3cret"))).toBeNull();
  });

  it("accepts a secret stored with stray whitespace", () => {
    // The exact failure that took the cron down: a value pasted into the host
    // dashboard with a trailing newline looks identical in both UIs.
    process.env.CRON_SECRET = "s3cret\n";
    expect(checkCronAuth(req("Bearer s3cret"))).toBeNull();
  });

  it("accepts a header sent with stray whitespace", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req("Bearer  s3cret "))).toBeNull();
  });

  it("rejects a genuinely different secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = checkCronAuth(req("Bearer wrong"));
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toMatchObject({
      diagnostic: { receivedToken: "5 chars", expectedSecret: "6 chars" },
    });
  });

  it("reports a missing header rather than comparing empties", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = checkCronAuth(req());
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toMatchObject({
      diagnostic: { receivedToken: "missing" },
    });
  });

  it("refuses every request when the server has no secret", async () => {
    delete process.env.CRON_SECRET;
    const res = checkCronAuth(req("Bearer anything"));
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toMatchObject({
      error: "CRON_SECRET is not set in the server environment.",
    });
  });
});
