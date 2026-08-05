import { test, expect, type Page } from "@playwright/test";

async function optionButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByText(letter, { exact: true }).locator("..");
}
async function currentQuestionText(page: Page): Promise<string> {
  return (await page.locator("div.leading-relaxed").first().innerText()).trim();
}
function subjectChips(page: Page, labelText: string | RegExp) {
  return page.getByText(labelText).locator("..").locator("button");
}

test("diagnostic: raw student_mistakes query response after a wrong answer", async ({ page }) => {
  const restCalls: { url: string; status: number; body: string }[] = [];
  const allSupabaseCalls: string[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("supabase.co")) {
      allSupabaseCalls.push(`${res.status()} ${res.url()}`);
    }
    if (!res.url().includes("/rest/v1/student_mistakes")) return;
    let body = "";
    try { body = await res.text(); } catch { body = "(unreadable)"; }
    restCalls.push({ url: res.url(), status: res.status(), body: body.slice(0, 2000) });
  });

  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Subject Practice" }).first().click();
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const letters: Array<"A" | "B" | "C" | "D"> = ["D", "C", "B", "A"];
  let wrongText = "";
  for (let i = 0; i < 6 && !wrongText; i++) {
    const qText = await currentQuestionText(page);
    const letter = letters[i % letters.length];
    await (await optionButton(page, letter)).click();
    const nextBtn = page.getByRole("button", { name: /Next Question|See Results/ });
    await expect(nextBtn).toBeVisible({ timeout: 10000 });
    const correctBtn = page.locator('button[class*="border-emerald-400"]').first();
    const correctLetter = (await correctBtn.locator("span").first().innerText()).trim();
    if (correctLetter !== letter) wrongText = qText;
    const isLast = (await nextBtn.textContent())?.includes("See Results") ?? false;
    await nextBtn.click();
    if (isLast) break;
    if (!wrongText) await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 15000 });
  }
  console.log(`Wrong answer given for: "${wrongText}"`);
  expect(wrongText, "did not get a wrong answer in 6 questions").not.toBe("");

  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  await page.waitForTimeout(2000);
  await page.goto("/student/mistakes");
  await expect(page.getByText("Restoring your session…")).toBeHidden({ timeout: 30000 });
  await page.waitForTimeout(15000);

  console.log(`=== Captured ${restCalls.length} student_mistakes REST calls ===`);
  for (const c of restCalls) {
    console.log(`URL: ${c.url}`);
    console.log(`STATUS: ${c.status}`);
    console.log(`MATCHES WRONG ANSWER: ${c.body.includes(wrongText.slice(0, 25))}`);
    console.log(`BODY: ${c.body}`);
    console.log("---");
  }
  console.log(`=== All ${allSupabaseCalls.length} supabase.co calls on this page ===`);
  for (const c of allSupabaseCalls) console.log(c);
});
