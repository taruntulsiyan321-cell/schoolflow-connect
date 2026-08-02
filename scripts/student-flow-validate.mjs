/**
 * Issue 12 — End-to-end student flow contract validation (static).
 * Verifies the architectural spine of the student journey is wired to SSOT modules.
 * Does not hit a live DB; fails the release gate when contracts regress.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`missing file: ${rel}`);
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

function mustInclude(rel, patterns, label) {
  const text = read(rel);
  if (!text) return;
  for (const p of patterns) {
    const re = typeof p === "string" ? new RegExp(p) : p;
    if (!re.test(text)) failures.push(`${label || rel}: missing ${re}`);
  }
}

function mustNotInclude(rel, patterns, label) {
  const text = read(rel);
  if (!text) return;
  for (const p of patterns) {
    const re = typeof p === "string" ? new RegExp(p, "i") : p;
    if (re.test(text)) failures.push(`${label || rel}: forbidden ${re}`);
  }
}

// Flow spine: Login → Profile/Context → Practice → Analysis → Recovery → XP → Nova
mustInclude("src/academic/services/assertStudentContext.ts", [
  /export function assertStudentContext/,
  /export function evaluateStudentContext/,
  /export function studentShellReady/,
]);

mustInclude("src/pages/StudentDashboard.tsx", [
  /studentShellReady/,
  /useAcademicContext|AcademicContext/,
]);

mustInclude("src/gurukul/StudentContext.tsx", [/export function useGurukulStudent/]);

mustInclude("src/gurukul/pages/Practice.tsx", [
  /PracticeService|from ["']@\/academic/,
  /useAcademicContext/,
]);

mustInclude("src/gurukul/pages/Analysis.tsx", [/useAcademicContext|from ["']@\/academic/]);

mustInclude("src/gurukul/pages/Recovery.tsx", [/useRecoveryZone|Recovery|from ["']@\/academic/]);

mustInclude("src/gurukul/pages/Revision.tsx", [/Revision|from ["']@\/academic|useAcademic/]);

mustInclude("src/hooks/useStudentXp.ts", [/student_xp|ProgressionService|total_xp/]);

mustInclude("src/gurukul/pages/AICoach.tsx", [
  /askAiCoach|gatewayClient/,
  /productFeatureFlags/,
]);

mustInclude("src/gurukul/pages/DoubtPortal.tsx", [
  /DoubtService/,
  /listDoubtAttachControls|productFeatureFlags/,
  /getNcertChapters/,
]);

mustInclude("src/lib/productFeatureFlags.ts", [
  /COMING_SOON_LABEL/,
  /UNAVAILABLE_FEATURE_MODE/,
  /listDoubtAttachControls/,
]);

// Parent / teacher surfaces must remain Academic Engine consumers for shared metrics
mustInclude("src/gurukul-parent/Dashboard.tsx", [/useAcademicContext|from ["']@\/academic/]);
mustInclude("src/gurukul-teacher/Dashboard.tsx", [/useAcademicContext|from ["']@\/academic/]);

// Banned demo / "not available" hardcodes on doubt path
mustNotInclude("src/gurukul/pages/DoubtPortal.tsx", [
  /not available yet/i,
  /FALLBACK_SUBJECTS/,
  /Arjun\s+Sharma/,
  /from ["']@\/gurukul\/data\/mock["']/,
]);

mustNotInclude("src/gurukul/pages/AICoach.tsx", [
  /not available yet/i,
  /from ["']@\/gurukul\/data\/mock["']/,
]);

if (failures.length) {
  console.error("student-flow-validate FAILED");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("student-flow-validate OK (contract spine intact)");
