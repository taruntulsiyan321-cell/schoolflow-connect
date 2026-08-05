import { test, expect, type Page } from "@playwright/test";

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

test("diagnostic: instrument the removal toggle click directly", async ({ page }) => {
  const toggleCalls: { status: number | null; body: string | null }[] = [];
  page.on("response", async (res) => {
    if (res.request().method() !== "POST") return;
    if (!res.url().includes("rpc_toggle_question_bookmark")) return;
    let body: string | null = null;
    try { body = await res.text(); } catch { body = "(unreadable)"; }
    toggleCalls.push({ status: res.status(), body });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") console.log(`CONSOLE[${msg.type()}]: ${msg.text()}`);
  });

  await openMode(page, "Subject Practice");
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const qText = await currentQuestionText(page);
  const needle = qText.slice(0, 30);
  console.log(`Target: "${needle}"`);

  console.log("--- clicking bookmark ON ---");
  await (await bookmarkToggle(page)).click();
  await page.waitForTimeout(1500);
  console.log(`toggle calls so far: ${JSON.stringify(toggleCalls)}`);
  const btnClassAfterOn = await (await bookmarkToggle(page)).getAttribute("class");
  console.log(`button class after ON click: ${btnClassAfterOn}`);

  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  await page.goto("/student/practice");
  await openMode(page, "Bookmarked Questions");
  await waitForLoaded(page);
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 15000 });
  console.log(`Now viewing (should be target or another bookmarked q): "${(await currentQuestionText(page)).slice(0,40)}"`);

  // Page to the target via Skip if not already on it (read-only paging).
  let onTarget = (await currentQuestionText(page)).includes(needle);
  let hops = 0;
  while (!onTarget && hops < 15) {
    const skipBtn = page.getByRole("button", { name: "Skip" });
    if (!(await skipBtn.isVisible().catch(() => false))) break;
    await skipBtn.click();
    await page.waitForTimeout(400);
    onTarget = (await currentQuestionText(page)).includes(needle);
    hops++;
  }
  console.log(`On target after ${hops} skips: ${onTarget}`);
  expect(onTarget).toBe(true);

  const btnClassBeforeOff = await (await bookmarkToggle(page)).getAttribute("class");
  console.log(`button class BEFORE removal click (should show bookmarked/active state): ${btnClassBeforeOff}`);

  toggleCalls.length = 0;
  console.log("--- clicking bookmark OFF ---");
  await (await bookmarkToggle(page)).click();
  await page.waitForTimeout(1500);
  console.log(`toggle calls for OFF click: ${JSON.stringify(toggleCalls)}`);
  const btnClassAfterOff = await (await bookmarkToggle(page)).getAttribute("class");
  console.log(`button class AFTER removal click: ${btnClassAfterOff}`);
});
