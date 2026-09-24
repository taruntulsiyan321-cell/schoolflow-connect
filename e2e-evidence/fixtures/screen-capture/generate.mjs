/**
 * Generate §12 screen-capture fixtures (PW-shaped screens).
 * Regenerate: node e2e-evidence/fixtures/screen-capture/generate.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join("e2e-evidence", "fixtures", "screen-capture");
mkdirSync(OUT, { recursive: true });

const { chromium } = await import("playwright");
const browser = await chromium.launch();

async function shot(name, width, height, html) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#f8fafc">${html}</body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
}

await shot(
  "must-wrong-instant.png",
  420,
  760,
  `<div style="padding:16px">
    <div style="opacity:.7;font-size:12px">Physics Wallah · Instant</div>
    <h3 style="margin:12px 0 8px">Q. Which is a function of management?</h3>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #ef4444">A. Cooking <span style="float:right;color:#ef4444">Your answer ✗</span></div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #22c55e">B. Planning <span style="float:right;color:#22c55e">Correct ✓</span></div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">C. Painting</div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">D. Singing</div>
    <p style="color:#ef4444;margin-top:16px;font-weight:700">Incorrect</p>
   </div>`,
);

await shot(
  "must-wrong-review.png",
  420,
  760,
  `<div style="padding:16px">
    <div style="opacity:.7;font-size:12px">Test review · Question 3/10</div>
    <h3 style="margin:12px 0 8px">Q. Efficiency means:</h3>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">A. Doing the right things</div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #ef4444">B. Wasting resources <span style="float:right;color:#ef4444">Your answer</span></div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #22c55e">C. Doing things right with minimum resources <span style="float:right;color:#22c55e">Correct</span></div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">D. Avoiding goals</div>
    <p style="color:#ef4444;margin-top:16px">Wrong · Solution unlocked</p>
   </div>`,
);

await shot(
  "must-not-correct.png",
  420,
  760,
  `<div style="padding:16px">
    <div style="opacity:.7;font-size:12px">Physics Wallah · Instant</div>
    <h3 style="margin:12px 0 8px">Q. Coordination in management means:</h3>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">A. Ignoring departments</div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #22c55e">B. Integrating activities towards goals <span style="float:right;color:#22c55e">Your answer ✓ Correct</span></div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">C. Random decisions</div>
    <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">D. Avoiding communication</div>
    <p style="color:#22c55e;margin-top:16px;font-weight:700">Correct</p>
   </div>`,
);

await shot(
  "must-not-teacher-lecture.png",
  420,
  760,
  `<div style="padding:16px">
    <div style="background:#7c3aed;padding:8px 12px;border-radius:8px;font-size:13px">LIVE CLASS · Sir is solving on board</div>
    <h3 style="margin:16px 0 8px">Teacher: Let us solve — Nature of Management</h3>
    <p style="line-height:1.5">Sir: Option B is right because management is a continuous process. Watch carefully…</p>
    <div style="margin-top:20px;height:120px;background:linear-gradient(90deg,#334155,#1e293b);border-radius:8px;display:flex;align-items:center;justify-content:center;opacity:.8">▶ Lecture video playing</div>
    <p style="margin-top:12px;opacity:.7;font-size:13px">No student answer · No Your answer marker</p>
   </div>`,
);

await shot(
  "must-not-score-only.png",
  420,
  760,
  `<div style="padding:24px;text-align:center">
    <div style="opacity:.7;font-size:12px">Test submitted</div>
    <h1 style="font-size:48px;margin:24px 0 8px">62/100</h1>
    <p>You scored 62 marks</p>
    <p style="opacity:.7;margin-top:24px">Tap “View solutions” to see which questions you got wrong</p>
   </div>`,
);

// §12.3 — stem copied from a live embedded CUET bank row (bank-match-stem.json).
const stemPath = join(OUT, "bank-match-stem.json");
if (existsSync(stemPath)) {
  const stem = JSON.parse(readFileSync(stemPath, "utf8"));
  const q = String(stem.question_text || "").replace(/</g, "&lt;");
  await shot(
    "must-bank-match.png",
    420,
    760,
    `<div style="padding:16px">
      <div style="opacity:.7;font-size:12px">Physics Wallah · Instant</div>
      <h3 style="margin:12px 0 8px;font-size:16px;line-height:1.4">${q}</h3>
      <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #ef4444">A. (1)(2)(4)(3) <span style="float:right;color:#ef4444">Your answer ✗</span></div>
      <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px;border:2px solid #22c55e">B. (2)(1)(4)(3) <span style="float:right;color:#22c55e">Correct ✓</span></div>
      <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">C. (2)(4)(1)(3)</div>
      <div style="background:#1e293b;padding:10px;margin:6px 0;border-radius:8px">D. (1)(4)(2)(3)</div>
      <p style="color:#ef4444;margin-top:16px;font-weight:700">Incorrect</p>
     </div>`,
  );
}

await browser.close();

writeFileSync(
  join(OUT, "README.md"),
  [
    "# Screen-capture evidence fixtures",
    "",
    "Binding: docs/screen-capture-mistakes-spec.md §12",
    "",
    "Regenerate: `node e2e-evidence/fixtures/screen-capture/generate.mjs`",
    "",
  ].join("\n"),
);

console.log("wrote fixtures to", OUT);
