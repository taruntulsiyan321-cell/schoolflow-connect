import { test, expect, type Page } from "@playwright/test";

/** Diagnostic only. Corrected version of the bookmark round-trip test --
 * re-navigates into "Bookmarked Questions" via a fresh page.goto after every
 * reload instead of assuming a mid-session reload preserves phase. Bookmark
 * writes go through rpc_toggle_question_bookmark, a separate function from
 * the two proven-broken paths, so this should be unaffected by them. */

async function openMode(page: Page, label: string) {
  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: label }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: label }).first().click();
}
function subjectChips(page: Page, labelText: string | RegExp) {
  return page.getByText(labelText).locator("..").locator("button");
}
async function currentQuestionText(page: Page): Promise<string> {
  return (await page.locator("div.leading-relaxed").first().innerText()).trim();
}
async function bookmarkToggle(page: Page) {
  return page.locator('button[title*="Flag for this session"]');
}
async function waitForLoaded(page: Page) {
  await expect(page.getByText("Loading practice questions…")).toBeHidden({ timeout: 30000 });
}
async function hasStartError(page: Page): Promise<string | null> {
  const heading = page.getByText("Could not start practice");
  if (await heading.isVisible().catch(() => false)) {
    return (await page.locator("text=Could not start practice").locator("xpath=following-sibling::p[1]").textContent().catch(() => null)) || "error, no detail";
  }
  return null;
}
async function locateQuestionInQueueReadOnly(page: Page, needle: string, maxQuestions = 15): Promise<boolean> {
  // Read-only: only pages forward via Skip, never answers -- avoids mutating
  // current_status while searching, since this diagnostic only cares about bookmarks.
  for (let i = 0; i < maxQuestions; i++) {
    const cur = await currentQuestionText(page);
    if (cur.includes(needle)) return true;
    const skipBtn = page.getByRole("button", { name: "Skip" });
    if (!(await skipBtn.isVisible().catch(() => false))) return false;
    await skipBtn.click();
    await page.waitForTimeout(400);
  }
  return false;
}

test("diagnostic: bookmark add, persist, remove, persist -- via fresh navigation each time", async ({ page }) => {
  await openMode(page, "Subject Practice");
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const qText = await currentQuestionText(page);
  const needle = qText.slice(0, 30);
  console.log(`Target question: "${needle}"`);

  await (await bookmarkToggle(page)).click();
  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  // Step 1: fresh navigation, confirm bookmarked.
  await page.goto("/student/practice");
  await openMode(page, "Bookmarked Questions");
  await waitForLoaded(page);
  let err = await hasStartError(page);
  console.log(`After bookmarking, start error: ${err}`);
  expect(err).toBeNull();
  let found = await locateQuestionInQueueReadOnly(page, needle);
  console.log(`After bookmarking, found in queue: ${found}`);
  expect(found).toBe(true);

  // Step 2: reload the HUB (not mid-session), then re-navigate. Confirm still there.
  await page.goto("/student/practice");
  await page.reload();
  await openMode(page, "Bookmarked Questions");
  await waitForLoaded(page);
  err = await hasStartError(page);
  found = err ? false : await locateQuestionInQueueReadOnly(page, needle);
  console.log(`After hub reload + renav, found in queue: ${found} (err=${err})`);
  expect(found).toBe(true);

  // Step 3: remove it. Need to be looking at it (not skipped past) to toggle.
  err = await hasStartError(page);
  expect(err).toBeNull();
  const stillOnTarget = (await currentQuestionText(page)).includes(needle);
  console.log(`Currently viewing target question before removal: ${stillOnTarget}`);
  expect(stillOnTarget).toBe(true); // locateQuestionInQueueReadOnly leaves it as current
  await (await bookmarkToggle(page)).click();
  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  // Step 4: fresh navigation, confirm gone.
  await page.goto("/student/practice");
  await openMode(page, "Bookmarked Questions");
  await waitForLoaded(page);
  err = await hasStartError(page);
  found = err ? false : await locateQuestionInQueueReadOnly(page, needle);
  console.log(`After removal, found in queue: ${found} (err=${err})`);
  expect(found).toBe(false);

  // Step 5: reload hub, re-navigate again, confirm still gone.
  await page.goto("/student/practice");
  await page.reload();
  await openMode(page, "Bookmarked Questions");
  await waitForLoaded(page);
  err = await hasStartError(page);
  found = err ? false : await locateQuestionInQueueReadOnly(page, needle);
  console.log(`After removal + reload, found in queue: ${found} (err=${err})`);
  expect(found).toBe(false);
});
