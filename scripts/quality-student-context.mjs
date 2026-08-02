/**
 * quality:student-context — static E2E journey wiring checks.
 * Detects missing student context gates, PRESENTATION_MODE, and shell readiness.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustInclude(rel, patterns, label) {
  const text = read(rel);
  for (const re of patterns) {
    if (!re.test(text)) failures.push(`${rel}: missing ${label} (${re})`);
  }
}

// PRESENTATION_MODE must stay off
{
  const text = read("src/lib/presentationMode.ts");
  if (!/export\s+const\s+PRESENTATION_MODE\s*=\s*false\s*;/.test(text)) {
    failures.push("PRESENTATION_MODE must be false");
  }
}

// Shell readiness SSOT
mustInclude(
  "src/pages/StudentDashboard.tsx",
  [
    /studentShellReady/,
    /shellReady=\{shellReady\}/,
    /useAcademicContext/,
    /progressionLoaded/,
  ],
  "student shell readiness",
);

mustInclude(
  "src/academic/services/assertStudentContext.ts",
  [/export function assertStudentContext/, /export function evaluateStudentContext/, /export function studentShellReady/],
  "assertStudentContext exports",
);

// Journey pages must gate academic loads on context readiness
const JOURNEY_PAGES = [
  "src/gurukul/pages/Analysis.tsx",
  "src/gurukul/pages/Practice.tsx",
  "src/gurukul/pages/Recovery.tsx",
  "src/gurukul/pages/Revision.tsx",
  "src/gurukul/pages/Battleground.tsx",
  "src/gurukul/pages/MistakeBook.tsx",
];

for (const rel of JOURNEY_PAGES) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push(`${rel}: missing journey page`);
    continue;
  }
  const text = read(rel);
  if (!/useAcademicContext/.test(text)) {
    failures.push(`${rel}: missing useAcademicContext`);
  }
  if (!/academicReady/.test(text)) {
    failures.push(`${rel}: missing academicReady gate`);
  }
}

// Dashboard must respect shellReady for progression chrome
{
  const text = read("src/gurukul/pages/Dashboard.tsx");
  if (!/useGurukulShellReady\s*\(/.test(text) && !/const\s+shellReady\s*=/.test(text)) {
    failures.push("src/gurukul/pages/Dashboard.tsx: missing useGurukulShellReady() assignment");
  }
}

if (failures.length) {
  console.error("quality:student-context FAILED");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("quality:student-context OK");
