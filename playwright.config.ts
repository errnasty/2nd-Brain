import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke suite (e2e/). Runs against a production build:
 *
 *   npm run build && npm run test:e2e
 *
 * The webServer block boots `npm start` on :3123 with placeholder Supabase
 * env, so the UNAUTHENTICATED surface is testable anywhere (CI included) —
 * no real backend needed. Authenticated flows need real env + a seeded user;
 * gate those specs on process.env.E2E_AUTH when they arrive.
 *
 * Agent sandboxes pre-install Chromium at /opt/pw-browsers/chromium and may
 * pin a different Playwright version than the registry layout expects, so we
 * point executablePath at it when present. CI/dev machines that ran
 * `npx playwright install chromium` use the normal resolution.
 */
const sandboxChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3123",
    ...(existsSync(sandboxChromium)
      ? { launchOptions: { executablePath: sandboxChromium } }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm start -- --port 3123",
    url: "http://localhost:3123/login",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "dummy",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x",
    },
  },
});
