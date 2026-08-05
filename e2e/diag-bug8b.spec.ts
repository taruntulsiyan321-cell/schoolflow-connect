import { test, expect, type Page } from "@playwright/test";

/** Diagnostic only. Targets the revision_queue_open_unique path specifically:
 * two WRONG answers, same subject, fired back-to-back with no artificial
 * delay, to try to overlap two rpc_record_question_attempt calls that both
 * resolve to the same subject/chapter/topic mistake bucket. */

type Call = { name: string; startedAt: number; finishedAt: number | null; status: number | null; body: string | null };

function trackRpc(page: Page, calls: Call[]) {
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const m = req.url().match(/\/rpc\/(rpc_record_question_attempt|rpc_finish_practice_session|rpc_record_concept_mistake)/);
    if (!m) return;
    calls.push({ name: m[1], startedAt: Date.now(), finishedAt: null, status: null, body: null });
  });
  page.on("response", async (res) => {
    if (res.request().method() !== "POST") return;
    const m = res.url().match(/\/rpc\/(rpc_record_question_attempt|rpc_finish_practice_session|rpc_record_concept_mistake)/);
    if (!m) return;
    const call = [...calls].reverse().find((c) => c.name === m[1] && c.finishedAt === null);
    if (!call) return;
    call.finishedAt = Date.now();
    call.status = res.status();
    try { call.body = (await res.text()).slice(0, 500); } catch { call.body = "(unreadable)"; }
  });
}

async function openMode(page: Page, label: string) {
  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: label }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: label }).first().click();
}
function subjectChips(page: Page, labelText: string | RegExp) {
  return page.getByText(labelText).locator("..").locator("button");
}
async function optionButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByText(letter, { exact: true }).locator("..");
}
async function currentQuestionText(page: Page): Promise<string> {
  return (await page.locator("div.leading-relaxed").first().innerText()).trim();
}

test("diagnostic: two wrong answers same subject, no delay -- capture revision_queue evidence", async ({ page }) => {
  const calls: Call[] = [];
  trackRpc(page, calls);

  await openMode(page, "Subject Practice");
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const letters: Array<"A" | "B" | "C" | "D"> = ["D", "C", "B", "A"];
  let wrongCount = 0;
  for (let i = 0; i < 6 && wrongCount < 2; i++) {
    const qText = await currentQuestionText(page);
    const letter = letters[i % letters.length];
    await (await optionButton(page, letter)).click();
    const nextBtn = page.getByRole("button", { name: /Next Question|See Results/ });
    await expect(nextBtn).toBeVisible({ timeout: 10000 });
    const correctBtn = page.locator('button[class*="border-emerald-400"]').first();
    const correctLetter = (await correctBtn.locator("span").first().innerText()).trim();
    const isWrong = correctLetter !== letter;
    console.log(`Q${i}: "${qText.slice(0,40)}" picked=${letter} correct=${correctLetter} wrong=${isWrong}`);
    if (isWrong) wrongCount++;
    const isLast = (await nextBtn.textContent())?.includes("See Results") ?? false;
    // No wait here deliberately -- click immediately to maximize overlap odds.
    await nextBtn.click();
    if (isLast) break;
    if (wrongCount < 2) await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 15000 });
  }

  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });
  await page.waitForTimeout(2000);

  console.log(`=== Captured ${calls.length} RPC calls, ${wrongCount} wrong answers given ===`);
  for (const c of calls) {
    const dur = c.finishedAt ? c.finishedAt - c.startedAt : null;
    console.log(`${c.name} | dur=${dur}ms | status=${c.status} | body=${c.body?.slice(0, 300)}`);
  }
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i], b = calls[j];
      if (a.finishedAt == null || b.finishedAt == null) continue;
      if (a.startedAt < b.finishedAt && b.startedAt < a.finishedAt) {
        console.log(`OVERLAP: ${a.name} and ${b.name}`);
      }
    }
  }
  const revQueueErrors = calls.filter((c) => c.body?.includes("revision_queue"));
  console.log(`=== revision_queue-related errors: ${revQueueErrors.length} ===`);
});
