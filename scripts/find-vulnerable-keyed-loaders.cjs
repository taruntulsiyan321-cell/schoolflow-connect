/**
 * Audit helper: find hand-rolled loaders that can render one subject's data
 * under another subject's heading.
 *
 * The vulnerable shape, proven in src/hooks/useKeyedResource.test.tsx:
 *
 *   useEffect(() => {
 *     if (!ready || !ctx) return;   // returns BEFORE resetting any state
 *     ...load(studentId)...
 *   }, [ready, ctx, studentId]);    // keyed on an identity
 *
 * When the identity changes while the guard is false, nothing is reset and the
 * previous subject's data stays on screen. A loader that resets state before
 * the guard (or has no guard) is not reported.
 */
const fs = require("fs");
const path = require("path");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(p);
  }
})("src");

const KEYED =
  /\b(studentId|childId|classId|selectedStudentId|attendanceStudentId|examId|subjectId)\b/;

const findings = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");

  /*
   * A component using the identity-keyed load gate is already protected: the
   * gate resets on a key change, so the spinner reappears and stale data is
   * not presented as the new subject's. An UNKEYED gate is not protected —
   * that is the defect the key was added for.
   */
  const gateCall = /useInitialLoadGate\(([^)]*)\)/.exec(src);
  if (gateCall && gateCall[1].trim() !== "") continue;

  // A render-time identity reset protects a hand-rolled loadedRef the same way.
  if (/useResetOnIdentityChange\(/.test(src)) continue;

  const re = /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[([^\]]*)\]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1];
    const deps = m[2];
    if (!KEYED.test(deps)) continue;

    const guard = /if\s*\([^)]*\)\s*return;/.exec(body);
    if (!guard) continue;

    // `if (cancelled) return;` is a cancellation check inside the async body,
    // not an early guard that skips state resets.
    if (/^if\s*\(\s*cancelled\s*\)/.test(guard[0])) continue;

    // Anything that resets state before the guard makes it safe — including
    // the load gate's own helpers, which take setLoading as an argument.
    const beforeGuard = body.slice(0, guard.index);
    if (/set[A-Z]\w*\(/.test(beforeGuard)) continue;
    if (/(begin|end)Loading\(\s*set[A-Z]\w*\s*\)/.test(beforeGuard)) continue;

    const line = src.slice(0, m.index).split("\n").length;
    const rel = file.split(path.sep).join("/");

    /*
     * Two different severities, and conflating them makes the report useless:
     *
     *  UNPROTECTED — the effect never clears prior state at all. Any change of
     *    identity leaves the previous subject's data rendered until the fetch
     *    returns.
     *
     *  GUARD-GAP — the effect does reset state, but only *after* a bail-out
     *    guard. Correct on the normal path; leaks only when the guard is false
     *    at the same moment the identity changes (an auth/context re-resolve
     *    mid-switch). Narrow, but real.
     */
    const afterGuard = body.slice(guard.index);
    let resetsAfterGuard = /set[A-Z]\w*\(/.test(afterGuard.split(/await |\.then\(/)[0]);

    /*
     * Many effects delegate to a locally-defined loader:
     *
     *   useEffect(() => { if (!ready || !ctx) return; void loadRoster(); }, [...]);
     *
     * The reset lives inside that callback, not in the effect body, so a
     * body-only scan mislabels these as UNPROTECTED. Follow one level: if the
     * effect just calls a local function, judge that function instead.
     */
    if (!resetsAfterGuard) {
      const delegate = /\bvoid\s+([A-Za-z_$][\w$]*)\(\)|\b([A-Za-z_$][\w$]*)\(\)\s*;/.exec(afterGuard);
      const name = delegate && (delegate[1] || delegate[2]);
      if (name) {
        const defRe = new RegExp(
          `const ${name}\\s*=\\s*(?:useCallback\\()?\\s*async[\\s\\S]{0,4000}`,
        );
        const def = defRe.exec(src);
        if (def && /set[A-Z]\w*\(/.test(def[0].slice(0, 1200))) resetsAfterGuard = true;
      }
    }

    findings.push({
      rel,
      line,
      deps: deps.trim().replace(/\s+/g, " "),
      guard: guard[0],
      severity: resetsAfterGuard ? "GUARD-GAP" : "UNPROTECTED",
    });
  }
}

const unprotected = findings.filter((f) => f.severity === "UNPROTECTED");
const guardGap = findings.filter((f) => f.severity === "GUARD-GAP");

console.log(
  `${findings.length} keyed loader(s) flagged — ` +
    `${unprotected.length} UNPROTECTED, ${guardGap.length} GUARD-GAP\n`,
);

for (const [label, group, note] of [
  ["UNPROTECTED (no state reset at all — fix these first)", unprotected,
   "Any identity change leaves the previous subject's data on screen."],
  ["GUARD-GAP (resets, but only after a bail-out guard)", guardGap,
   "Leaks only if the guard is false at the moment the identity changes."],
]) {
  if (group.length === 0) continue;
  console.log(`${label}\n  ${note}\n`);
  for (const f of group) {
    console.log(`  ${f.rel}:${f.line}`);
    console.log(`      guard: ${f.guard}`);
    console.log(`      deps:  [${f.deps}]`);
  }
  console.log("");
}
