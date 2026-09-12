import { test } from "@playwright/test";

/** Close-up of the weekly-sessions ring on Home, for reviewing the arc itself. */
test("zoom the sessions ring", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/student");
  await page.waitForTimeout(9000);

  const box = await page.evaluate(() => {
    const label = [...document.querySelectorAll("span")].find((s) =>
      (s.textContent ?? "").trim().toUpperCase().startsWith("SESSIONS"),
    );
    const ring = label?.parentElement?.querySelector("svg")?.closest("div");
    const el = ring ?? label?.parentElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  if (!box) {
    console.log("ring not found");
    return;
  }
  console.log(JSON.stringify(box));
  await page.screenshot({
    path: "test-results/ring-zoom.png",
    clip: {
      x: Math.max(0, box.x - 24),
      y: Math.max(0, box.y - 24),
      width: box.width + 48,
      height: box.height + 48,
    },
  });
});
