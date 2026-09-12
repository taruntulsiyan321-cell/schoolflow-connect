import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The teacher and parent panels after adopting the Autonomous Design.
 *
 * Captures every screen and measures the same things the principal survey does,
 * plus a WCAG contrast check — re-skinning a panel from a light palette to a
 * warm-paper one is exactly the move that produces dark-on-dark text, and this
 * codebase has shipped that four times.
 */

type Screen = {
  path: string;
  /**
   * Open the first conversation before measuring.
   *
   * The chat composer does not exist until a thread is selected, and the
   * composer is where the worst defect on this screen lived: a `text-white`
   * textarea on a transparent field over a light panel, so every character
   * typed was invisible. Measuring the closed screen reports one field (the
   * search box) and a clean result, which is how that shipped past this survey
   * twice. Opening a thread is what makes the check able to fail.
   */
  openFirstThread?: boolean;
};

type Panel = { role: string; email: string; landing: RegExp; screens: Screen[] };

const PANELS: Panel[] = [
  {
    role: "teacher",
    email: "priya.sharma@wisdomcampus.com",
    landing: /\/teacher/,
    screens: [
      { path: "/teacher" },
      { path: "/teacher/classes" },
      { path: "/teacher/doubts" },
      { path: "/teacher/communication" },
      { path: "/teacher/announcements" },
      { path: "/teacher/resources" },
      { path: "/teacher/leave" },
      { path: "/teacher/profile" },
    ],
  },
  {
    role: "parent",
    email: "patel.parent@wisdomcampus.com",
    landing: /\/parent/,
    screens: [
      { path: "/parent" },
      { path: "/parent/children" },
      { path: "/parent/announcements" },
      { path: "/parent/messages", openFirstThread: true },
      { path: "/parent/notifications" },
      { path: "/parent/profile" },
    ],
  },
];

const MIN_RATIO = 3.0;

/**
 * Measures one rendered screen. Hoisted to module scope, closing over nothing,
 * so the same probe can run twice against one screen — before and after a
 * conversation is opened — instead of being duplicated inline.
 */
function probe(minRatio: number) {
  function parse(c: string): number[] | null {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v.trim()));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function lum([r, g, b]: number[]) {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function over(fg: number[], bg: number[]) {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  }
  /**
   * The effective background behind an element, composited through every
   * translucent ancestor.
   *
   * Returns null when a gradient is reached before the stack is opaque: the
   * `background` shorthand zeroes `background-color`, so reading the colour off
   * a gradient element reports transparent and the measurement comes out as a
   * false failure on perfectly legible text. A gradient under an already-opaque
   * stack is irrelevant and does not disqualify the reading.
   */
  function bgOf(el: Element): number[] | null {
    let node: Element | null = el;
    const stack: number[][] = [];
    let covered = 0;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        if (covered >= 0.9) break;
        return null;
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        stack.push(c);
        covered = covered + (1 - covered) * c[3];
        if (covered >= 0.999) break;
      }
      node = node.parentElement;
    }
    let base = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
  function ratioOf(fg: number[], bg: number[]) {
    const solid = over(fg, bg);
    const l1 = lum(solid), l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const bad: string[] = [];
  const fonts = new Map<string, number>();
  const radii = new Map<string, number>();
  let checked = 0;

  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.15) continue;
    if (cs.borderRadius && cs.borderRadius !== "0px") {
      const rad = cs.borderRadius.split(" ")[0];
      radii.set(rad, (radii.get(rad) ?? 0) + 1);
    }
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? "").trim())
      .join("")
      .trim();
    if (!own) continue;
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    fonts.set(fam, (fonts.get(fam) ?? 0) + 1);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const ratio = ratioOf(fg, bg);
    checked++;
    if (ratio < minRatio) {
      bad.push(`${Math.round(ratio * 100) / 100}:1 "${own.slice(0, 40)}" ${cs.color} on rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`);
    }
  }

  // Form fields, separately — the loop above cannot see them.
  //
  // It measures elements that own a text node, and an empty input owns none. So
  // a field whose `color` is unreadable against its own surface is invisible to
  // the probe until someone types into it, which no probe does.
  let fields = 0;
  // Every field is listed, not only the failing ones. When this pass was added
  // it reported a clean result against a deliberately reinstated `text-white`
  // textarea, and "fields=2, failing=0" gave no way to tell whether the field
  // was measured and passed, skipped as unmeasurable, or never matched at all.
  const fieldList: string[] = [];
  for (const el of Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))) {
    const r = (el as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(el);
    const type = (el as HTMLInputElement).type;
    const hint = el.getAttribute("placeholder") || el.getAttribute("name") || type || el.tagName.toLowerCase();
    if (type === "checkbox" || type === "radio" || type === "range" || type === "color") continue;
    if (r.width < 2 || r.height < 2) { fieldList.push(`"${hint}" SKIPPED zero-size`); continue; }
    if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.15) { fieldList.push(`"${hint}" SKIPPED hidden`); continue; }
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg) { fieldList.push(`"${hint}" SKIPPED unparsed colour ${cs.color}`); continue; }
    if (!bg) { fieldList.push(`"${hint}" SKIPPED background is a gradient`); continue; }
    const ratio = ratioOf(fg, bg);
    fields++;
    fieldList.push(`"${hint}" ${Math.round(ratio * 100) / 100}:1 ${cs.color} on rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`);
    if (ratio < minRatio) {
      bad.push(`${Math.round(ratio * 100) / 100}:1 FIELD "${hint}" ${cs.color} on rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`);
    }
  }

  const top = (m: Map<string, number>, n = 4) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} x${v}`);
  return { chars: (document.body.innerText ?? "").length, checked, fields, bad, fieldList, fonts: top(fonts), radii: top(radii, 5) };
}

/**
 * One test per panel, not one loop over both.
 *
 * The loop signed in as the teacher, called `clearCookies()`, and tried to sign
 * in as the parent — but Supabase keeps its session in localStorage, which
 * cookies do not touch. `/auth` redirected straight back into the teacher panel
 * and the run sat for fifteen minutes waiting for a login form that could not
 * render. A separate test gets a separate browser context, which is clean by
 * construction rather than by remembering to wipe the right store.
 */
for (const panel of PANELS) {
test(`the ${panel.role} panel wears the design`, async ({ page }) => {
  test.setTimeout(900_000);
  const findings: string[] = [];
  const report: string[] = [];
  const renders: { path: string; chars: number; checked: number; fields: number }[] = [];

  await page.goto("/auth");
  await page.getByLabel("Email or Mobile").fill(panel.email);
  await page.locator("#signin-password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(panel.landing, { timeout: 30000 });

  for (const screen of panel.screens) {
    const { path } = screen;
    await page.goto(path);
    await page.waitForTimeout(6000);

    const states: { label: string; info: Awaited<ReturnType<typeof probe>> }[] = [];
    states.push({ label: path, info: await page.evaluate(probe, MIN_RATIO) });

    if (screen.openFirstThread) {
      const contact = page.locator(".chat-sidebar button:has(.chat-avatar)").first();
      // A panel with no conversations is a legitimate empty state, not a
      // failure — but say so, so a silently-skipped state is never read as
      // covered.
      if (await contact.count()) {
        await contact.click();
        await page.waitForTimeout(4000);
        states.push({ label: `${path} (thread open)`, info: await page.evaluate(probe, MIN_RATIO) });
      } else {
        report.push(`${path.padEnd(26)} NOTE: no conversation to open, composer not measured`);
      }
    }

    for (const { label, info } of states) {
      renders.push({ path: label, chars: info.chars, checked: info.checked, fields: info.fields });
      report.push(
        `${label.padEnd(26)} chars=${String(info.chars).padEnd(5)} checked=${String(info.checked).padEnd(4)} fields=${String(info.fields).padEnd(3)} failing=${info.bad.length}\n` +
        `    fonts: ${info.fonts.join(" | ")}\n` +
        `    radii: ${info.radii.join(" | ")}` +
        (info.fieldList.length ? `\n    fields: ${info.fieldList.join("\n            ")}` : ""),
      );
      for (const b of info.bad) findings.push(`${label}  ${b}`);
    }
    await page.screenshot({ path: `test-results/staff${path.replace(/\//g, "_")}.png` });
  }

  console.log(report.join("\n"));
  if (findings.length) console.log("\nCONTRAST FINDINGS:\n" + [...new Set(findings)].join("\n"));

  // CONTROL — and it has to be about CONTENT, not screen count.
  //
  // This first read `expect(report.length).toBe(paths.length)`, which counts
  // screens VISITED. A TypeScript error had blanked the whole app and all six
  // screens rendered 0 characters; the contrast list was empty because there
  // was nothing to measure, and the run passed. A control that a blank page
  // satisfies is not a control.
  const empty = renders.filter((r) => r.chars < 150).map((r) => `${r.path} (${r.chars} chars)`);
  expect(empty, `${panel.role}: these screens rendered nothing:\n${empty.join("\n")}`).toEqual([]);
  const measured = renders.reduce((n, r) => n + r.checked, 0);
  expect(measured, `${panel.role}: too few text nodes measured to conclude anything`).toBeGreaterThan(150);

  // Positive control for the field pass: a selector that matches nothing would
  // report zero unreadable fields and look identical to a clean run.
  const fieldsSeen = renders.reduce((n, r) => n + r.fields, 0);
  expect(fieldsSeen, `${panel.role}: the form-field pass measured nothing, so it proved nothing`).toBeGreaterThan(0);

  expect([...new Set(findings)], `text below ${MIN_RATIO}:1:\n${[...new Set(findings)].join("\n")}`).toEqual([]);
});
}
