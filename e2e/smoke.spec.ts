import { test, expect, type Page } from "@playwright/test";

/**
 * Unauthenticated smoke: catches the failure classes that unit tests and
 * `curl` can't — broken hydration (client-rendered pages stay blank), CSP
 * violations (surface as console errors), middleware regressions on PWA
 * assets. Runs with placeholder Supabase env; nothing here talks to a
 * real backend.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// With placeholder Supabase env the middleware's auth check fails closed →
// network noise like "Failed to load resource … example.supabase.co" is
// expected. Anything else (CSP refusals, hydration crashes) is a bug.
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes("example.supabase.co") &&
      !e.includes("Failed to load resource") &&
      !e.includes("net::ERR"),
  );
}

test("unauthenticated /today redirects to /login", async ({ page }) => {
  // "/" is intentionally public (the marketing landing page — see the
  // isAuthRoute comment in src/lib/supabase/middleware.ts), so exercise the
  // redirect against an actual protected route instead.
  await page.goto("/today");
  await page.waitForURL("**/login**");
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("unauthenticated / shows the marketing landing page (no redirect)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("/login hydrates and renders the form (no CSP/hydration errors)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");
  // The page is fully client-rendered behind Suspense — the form appearing
  // proves the JS chunks loaded AND executed under the CSP.
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Password")).toBeVisible();
  expect(realErrors(errors)).toEqual([]);
});

test("/signup hydrates and renders the form", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/signup");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 10_000 });
  expect(realErrors(errors)).toEqual([]);
});

test("PWA assets are served without auth redirects", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("manifest");

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("sb-static-");
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/login");
  const headers = res.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
});

test("/api/cron rejects without secret", async ({ request }) => {
  const res = await request.get("/api/cron/sync-feeds");
  expect(res.status()).toBe(401);
});
