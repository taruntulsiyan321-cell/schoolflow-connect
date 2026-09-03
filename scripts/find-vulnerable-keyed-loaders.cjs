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
  const re = /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[([^\]]*)\]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1];
    const deps = m[2];
    if (!KEYED.test(deps)) continue;

    const guard = /if\s*\([^)]*\)\s*return;/.exec(body);
    if (!guard) continue;

    // Anything that resets state before the guard makes it safe.
    if (/set[A-Z]\w*\(/.test(body.slice(0, guard.index))) continue;

    const line = src.slice(0, m.index).split("\n").length;
    const rel = file.split(path.sep).join("/");
    findings.push({
      rel,
      line,
      deps: deps.trim().replace(/\s+/g, " "),
      guard: guard[0],
    });
  }
}

console.log(
  findings.length + " keyed loader(s) whose guard returns before any state reset:\n",
);
for (const f of findings) {
  console.log(`  ${f.rel}:${f.line}`);
  console.log(`      guard: ${f.guard}`);
  console.log(`      deps:  [${f.deps}]`);
}
