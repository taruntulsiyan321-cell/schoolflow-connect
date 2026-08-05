import { test, expect, type Page } from "@playwright/test";

/**
 * Diagnostic only — not a regression test, not committed to the suite.
 * Purpose: get network-level proof of whether/when
 * rpc_record_question_attempt or rpc_finish_practice_session return a
 * revision_queue_open_unique conflict, and correlate that with the actual
 * HTTP timing (does persistAttemptLive's fire-and-forget call overlap with
 * the finish-time replay for the SAME question?).
 */

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
async function currentQuestionText(page: Page): Promise<string> {
  return (await page.locator("div.leading-relaxed").first().innerText()).trim();
}
async function optionButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByText(letter, { exact: true }).locator("..");
}

test("diagnostic: answer wrong then immediately End Session -- capture RPC-level evidence", async ({ page }) => {
  const calls: Call[] = [];
  trackRpc(page, calls);

  await openMode(page, "Subject Practice");
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const qText = await currentQuestionText(page);
  // Answer with A, then IMMEDIATELY End Session with no wait -- this is the
  // exact pattern that should race the fire-and-forget live call against the
  // finish-time replay for the same question, per the SQL trace.
  await (await optionButton(page, "A")).click();
  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  // Let any trailing in-flight responses land before we inspect.
  await page.waitForTimeout(2000);

  console.log(`\n=== Question: "${qText}" ===`);
  console.log(`=== Captured ${calls.length} RPC calls ===`);
  for (const c of calls) {
    const dur = c.finishedAt ? c.finishedAt - c.startedAt : null;
    console.log(
      `${c.name} | start=${c.startedAt} | dur=${dur}ms | status=${c.status} | body=${c.body?.slice(0, 300)}`
    );
  }

  // Overlap check: did any two calls' [startedAt, finishedAt] windows overlap?
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i], b = calls[j];
      if (a.finishedAt == null || b.finishedAt == null) continue;
      const overlap = a.startedAt < b.finishedAt && b.startedAt < a.finishedAt;
      if (overlap) {
        console.log(`OVERLAP: ${a.name}[${a.startedAt}-${a.finishedAt}] and ${b.name}[${b.startedAt}-${b.finishedAt}]`);
      }
    }
  }

  const errors = calls.filter((c) => c.status != null && c.status >= 400);
  console.log(`=== Error responses: ${errors.length} ===`);
  for (const e of errors) console.log(JSON.stringify(e));
});
