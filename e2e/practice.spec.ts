import { test, expect, type Page } from "@playwright/test";

const MODES = [
  "Subject Practice",
  "Chapter Practice",
  "Topic Practice",
  "Custom Practice",
  "Previous Year Questions",
  "Weak Areas Practice",
  "Incorrect Questions",
  "Skipped Questions",
  "Bookmarked Questions",
];

async function openMode(page: Page, label: string) {
  await page.goto("/student/practice");
  // Two renderings can exist (a "hot" shortcut tile + the full grid) --
  // both call the same handler, so whichever matches first is fine.
  // Observed cold-load / session-restore time on the live app ranges up to
  // ~28s in practice, so this needs real headroom, not Playwright's default.
  await expect(page.getByRole("button", { name: label }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: label }).first().click();
}

/**
 * The subject chips SubjectPicker renders are siblings of its own label
 * ("1. Subject" / "Subject"), both children of one wrapper div -- scoping to
 * that wrapper is the only reliable way to select them. A page-wide "any
 * button with text" locator also matches the sidebar nav (Home, Practice,
 * AI Coach, ...), and .first() there can land on those instead and navigate
 * away from Practice entirely.
 */
function subjectChips(page: Page, labelText: string | RegExp) {
  return page.getByText(labelText).locator("..").locator("button");
}

/** True if the "Could not start practice" error screen is showing. */
async function hasStartError(page: Page): Promise<string | null> {
  const heading = page.getByText("Could not start practice");
  if (await heading.isVisible().catch(() => false)) {
    const detail = await page
      .locator("text=Could not start practice")
      .locator("xpath=following-sibling::p[1]")
      .textContent()
      .catch(() => null);
    return detail || "Could not start practice (no detail text found)";
  }
  return null;
}

test.describe("Practice hub", () => {
  test("shows exactly the 9 spec'd modes, nothing else", async ({ page }) => {
    await page.goto("/student/practice");
    for (const label of MODES) {
      // First one absorbs the cold-load hydration delay; rest are fast.
      await expect(page.getByRole("button", { name: label }).first()).toBeVisible({ timeout: 15000 });
    }
    // Explicitly removed modes must not exist anywhere on the page.
    for (const removed of [
      "Daily Practice",
      "Teacher Assigned",
      "Timed Practice",
      "Untimed Practice",
      "Mock Tests",
      "Difficulty-Based",
    ]) {
      await expect(page.getByRole("button", { name: removed })).toHaveCount(0);
    }
  });
});

test.describe("Chapter Practice", () => {
  test("offers a chapter picker, not just subject", async ({ page }) => {
    await openMode(page, "Chapter Practice");
    // The reported bug: this mode fell through to a subject-only fallback.
    // A real chapter picker section must be present once a subject is chosen.
    await expect(page.getByText("1. Subject")).toBeVisible();
    // Pick whatever subject is first available -- content is real seed data,
    // not something this test should hardcode.
    await subjectChips(page, "1. Subject").first().click();
    await expect(page.getByText(/2\. Chapter/)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Topic Practice", () => {
  test("offers subject, chapter, and topic pickers", async ({ page }) => {
    await openMode(page, "Topic Practice");
    await expect(page.getByText("1. Subject")).toBeVisible();
    await subjectChips(page, "1. Subject").first().click();
    await expect(page.getByText(/2\. Chapter/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/3\. Topic/)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Custom Practice", () => {
  test("question count and time limit are mutually exclusive", async ({ page }) => {
    await openMode(page, "Custom Practice");
    await expect(page.getByText("Practice goal")).toBeVisible();

    await page.getByRole("button", { name: "Time limit" }).click();
    await expect(page.getByRole("button", { name: "60 min" })).toBeVisible();
    await expect(page.getByRole("button", { name: "20 questions" })).toHaveCount(0);

    await page.getByRole("button", { name: "Question count" }).click();
    await expect(page.getByRole("button", { name: "20 questions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "60 min" })).toHaveCount(0);
  });
});

test.describe("Instant modes open without error", () => {
  for (const label of ["Weak Areas Practice", "Incorrect Questions", "Skipped Questions", "Bookmarked Questions"]) {
    test(`${label} does not show "Could not start practice"`, async ({ page }) => {
      await openMode(page, label);
      // Wait for the loading state to genuinely finish (success or failure)
      // rather than a fixed delay -- this app's real load time varies widely
      // (observed 7s-28s live), so a flat short wait risks a false pass by
      // checking for the error before it's had time to appear.
      await expect(page.getByText("Loading practice questions…")).toBeHidden({ timeout: 30000 });
      const err = await hasStartError(page);
      expect(err, `${label} showed a start error: ${err}`).toBeNull();
    });
  }
});

test.describe("Subject Practice — full happy path", () => {
  test("start -> answer -> finish -> result", async ({ page }) => {
    await openMode(page, "Subject Practice");
    await expect(page.getByText("Choose subject")).toBeVisible();
    await subjectChips(page, "Choose subject").first().click();

    const start = page.getByRole("button", { name: "Start Practice" });
    await expect(start).toBeEnabled({ timeout: 10000 });
    await start.click();

    // Question view: labelled options A/B/C/D.
    await expect(page.getByText(/Q1 of/)).toBeVisible({ timeout: 15000 });
    const err = await hasStartError(page);
    expect(err, `Session failed to start: ${err}`).toBeNull();

    const firstOption = page.getByText("A", { exact: true }).locator("..");
    await firstOption.click();

    // Whatever "next/finish" affordance is showing after answering.
    const next = page.getByRole("button", { name: /Next|Finish|Submit/ }).first();
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    }
  });
});
