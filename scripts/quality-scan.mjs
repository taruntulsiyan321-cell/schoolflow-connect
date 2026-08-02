import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = new Set([
  "src/gurukul/data/mock.ts",
  "src/gurukul/pages/ConceptMastery.tsx",
  "src/gurukul/components/AnalyticsPage.tsx",
  "src/lib/presentationAnalytics.ts",
  "src/lib/presentationMode.ts",
  "src/gurukul/emptyStudent.ts",
  "src/components/student/dashboard/StudentMissionDashboard.tsx",
  "src/pages/student/StudentSuccessHome.tsx",
]);
const SCAN_GLOBS = [
  "src/pages/StudentDashboard.tsx",
  "src/gurukul/pages",
  "src/gurukul/hooks",
  "src/gurukul/components/Layout.tsx",
  "src/gurukul/components/shared.tsx",
  "src/components/student",
  "src/pages/student",
  "src/hooks/useStudentXp.ts",
  "src/gurukul-teacher",
  "src/gurukul-parent",
  "src/gurukul-principal",
  "src/gurukul-admin",
];
const DEMO_LITERALS = [/Arjun\s+Sharma/, /Priya\s+Nair/, /\b1382\b/, /Level\s+14/, /\bxp:\s*8420\b/];
const BAD_IMPORTS = [
  /from\s+["']@\/gurukul\/data\/mock["']/,
  /from\s+["']@\/lib\/presentationAnalytics["']/,
  /from\s+["'].*\/gurukul\/data\/mock["']/,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    if (/\.(ts|tsx|js|jsx)$/.test(dir)) out.push(dir);
    return out;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    walk(path.join(dir, name), out);
  }
  return out;
}
function rel(p) {
  return path.relative(root, p).replace(/\\/g, "/");
}
function isAllowlisted(relPath) {
  if (ALLOWLIST.has(relPath)) return true;
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return false;
  return /DESIGN-ONLY/i.test(fs.readFileSync(abs, "utf8").slice(0, 600));
}

const failures = [];
{
  const text = fs.readFileSync(path.join(root, "src/lib/presentationMode.ts"), "utf8");
  if (!/export\s+const\s+PRESENTATION_MODE\s*=\s*false\s*;/.test(text)) {
    failures.push("PRESENTATION_MODE must be false");
  }
}
const files = [];
for (const g of SCAN_GLOBS) walk(path.join(root, g), files);
for (const abs of files) {
  const r = rel(abs);
  if (isAllowlisted(r)) continue;
  const text = fs.readFileSync(abs, "utf8");
  for (const re of BAD_IMPORTS) if (re.test(text)) failures.push(r + ": banned import");
  const codeish = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const re of DEMO_LITERALS) if (re.test(codeish)) failures.push(r + ": demo literal " + re);
  if (/Math\.random\s*\(/.test(codeish) && !/LiveClassPanels\.tsx$/.test(r) && !/\.test\.tsx?$/.test(r)) {
    failures.push(r + ": Math.random on product path");
  }
}
if (failures.length) {
  console.error("quality:scan FAILED");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("quality:scan OK (" + files.length + " files)");
