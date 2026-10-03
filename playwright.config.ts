import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3000";
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Chromium only: internal HR tool. A multi-browser matrix is not earned here.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The E2E suite must be runnable on a clean checkout with no .env.local.
    // SESSION_SECRET is required because session verification FAILS CLOSED —
    // without it every route 500s and the authorization suite proves nothing.
    // A fixed non-production secret, supplied only to the local test server.
    env: {
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-local-only-secret-at-least-32-characters",
      SESSION_SECRET_MIN_LENGTH: "32",
    },
  },
});