/**
 * Cursor-style ResearchOS full loop E2E.
 *
 * This test exercises the new chat-first UX end to end:
 *   1. Register a fresh user.
 *   2. Create a global Skill.
 *   3. From the dashboard composer, launch a run.
 *   4. Wait for events to stream in, then send a follow-up message.
 *   5. Click Stop to hard-abort the in-flight step.
 *   6. Use the /skip slash command to disable an agent.
 *   7. Use "Finish now" to terminate the loop early.
 *   8. Assert the run reaches a terminal status.
 *
 * Requires:
 *   - The Next.js app running at E2E_BASE_URL (default http://localhost:3000).
 *   - A worker connected to the same Postgres + Redis.
 *   - Anthropic key configured (otherwise the run fails before reaching skip).
 *
 * Skip-by-env: set E2E_SKIP_FULL_LOOP=1 to skip the suite (useful in CI without
 * an Anthropic key).
 */
import { test, expect } from "@playwright/test";

const SKIP = process.env.E2E_SKIP_FULL_LOOP === "1";

test.describe("Cursor-style ResearchOS full loop", () => {
  test.skip(SKIP, "E2E_SKIP_FULL_LOOP=1 — skipping");

  test("register → skill → run → follow-up → interrupt → skip → finish", async ({ page }) => {
    test.setTimeout(5 * 60_000);

    const ts = Date.now();
    const email = `e2e-${ts}@researchos.local`;
    const password = "passw0rd12345";

    await page.goto("/register");
    await page.fill('input#email', email);
    await page.fill('input#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/);
    await expect(page).toHaveURL(/\/dashboard/);

    // Create a skill via the skills page.
    await page.goto("/skills");
    await page.getByRole("button", { name: /New skill/i }).first().click();
    await page.fill('input#skill-name', "Mechanism first");
    await page.fill('input#skill-description', "Prefer mechanism-grounded hypotheses.");
    await page.fill(
      'textarea#skill-body',
      "Always anchor every hypothesis claim to a specific molecular or cellular mechanism. Penalize vague systems-level claims.",
    );
    await page.getByRole("button", { name: /Save skill/i }).click();
    await expect(page.getByText("Mechanism first").first()).toBeVisible();

    // Back to dashboard composer and launch a run.
    await page.goto("/dashboard");
    await page.fill(
      "textarea",
      "Generate a small, fast set of mechanism-grounded hypotheses about cellular senescence in human fibroblasts.",
    );
    await page.getByRole("button", { name: /Launch run/i }).click();
    await page.waitForURL(/runs\//, { timeout: 60_000 });

    // Wait for the first agent event to land.
    await expect(
      page.locator('text=/Supervisor|Initializer|Literature|Generation/i').first(),
    ).toBeVisible({ timeout: 90_000 });

    // Send a follow-up message via the composer.
    const composer = page.locator("textarea").last();
    await composer.fill("Please focus on mitochondrial mechanisms specifically.");
    await page.getByRole("button", { name: /Send/i }).click();
    await expect(
      page.locator('text=Please focus on mitochondrial mechanisms specifically.'),
    ).toBeVisible({ timeout: 30_000 });

    // Hard-abort with Stop.
    const stop = page.getByRole("button", { name: /Stop/i });
    if (await stop.isVisible({ timeout: 5000 }).catch(() => false)) {
      await stop.click();
      await expect(
        page.locator("text=/aborted|step skipped|task aborted/i").first(),
      ).toBeVisible({ timeout: 30_000 });
    }

    // Skip via slash command.
    await composer.fill("/skip EvolutionAgent");
    await page.keyboard.press("Enter");

    // Finish now via the composer button.
    const finishNow = page.getByRole("button", { name: /finish now/i });
    if (await finishNow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finishNow.click();
    }

    // Eventually the run should reach a terminal status badge.
    await expect(
      page.locator("text=/completed|completed_with_limit|cancelled|failed/i").first(),
    ).toBeVisible({ timeout: 4 * 60_000 });
  });
});
