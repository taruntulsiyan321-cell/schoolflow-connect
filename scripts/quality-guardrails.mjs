/**
 * Issue 13 — Engineering guardrails.
 * Detects placeholder/generic labels, UTF mojibake markers, and presentation leaks
 * on mounted student product paths. Complements quality-scan.mjs.
 */
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
  "src/lib/productFeatureFlags.ts",
  "src/lib/productFeatureFlags.test.ts",
]);

const SCAN_ROOTS = [
  "src/gurukul/pages",
  "src/gurukul/hooks",
  "src/gurukul/components/Layout.tsx",
  "src/gurukul/StudentContext.tsx",
  "src/pages/StudentDashboard.tsx",
  "src/components/student",
  "src/hooks/useStudentXp.ts",
  "src/hooks/useRecoveryZone.ts",
  "src/hooks/useConceptMastery.ts",
  "src/hooks/useAnalysisPageData.ts",
];

/** Generic entity labels that must not be used as *data* fallbacks in product UI. */
const GENERIC_DATA_FALLBACKS = [
  /\?\?\s*["']Subject["']/,
  /\?\?\s*["']Topic["']/,
  /\?\?\s*["']Daily["']/,
  /\?\?\s*["']General["']/,
  /\|\|\s*["']Subject["']/,
  /\|\|\s*["']Topic["']/,
  /\|\|\s*["']General["']/,
];

const PLACEHOLDER_COPY = [
  /\bLorem\s+ipsum\b/i,
  /\bTODO:\s*demo\b/i,
  /\bfake\s+student\b/i,
  /\bdummy\s+recommendation/i,
  /not available yet/i,
];

const UTF_MOJIBAKE = [/à¤/, /Ã¢/, /â€/, /Ã©/];

const failures = [];

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
  if (/\.test\.(ts|tsx)$/.test(relPath)) return true;
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return false;
  return /DESIGN-ONLY/i.test(fs.readFileSync(abs, "utf8").slice(0, 600));
}

{
  const pm = fs.readFileSync(path.join(root, "src/lib/presentationMode.ts"), "utf8");
  if (!/export\s+const\s+PRESENTATION_MODE\s*=\s*false\s*;/.test(pm)) {
    failures.push("PRESENTATION_MODE must be false");
  }
}

{
  const ff = fs.readFileSync(path.join(root, "src/lib/productFeatureFlags.ts"), "utf8");
  if (!/COMING_SOON_LABEL\s*=\s*["']Coming Soon["']/.test(ff)) {
    failures.push("COMING_SOON_LABEL must be Coming Soon");
  }
}

const files = [];
for (const g of SCAN_ROOTS) walk(path.join(root, g), files);

for (const abs of files) {
  const r = rel(abs);
  if (isAllowlisted(r)) continue;
  const text = fs.readFileSync(abs, "utf8");
  const codeish = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const re of PLACEHOLDER_COPY) {
    if (re.test(codeish)) failures.push(`${r}: placeholder copy ${re}`);
  }
  for (const re of UTF_MOJIBAKE) {
    if (re.test(text)) failures.push(`${r}: UTF mojibake marker ${re}`);
  }
  // Generic data fallbacks — skip Practice mode picker badges (label:"Subject Practice")
  if (!/pages\/Practice\.tsx$/.test(r)) {
    for (const re of GENERIC_DATA_FALLBACKS) {
      if (re.test(codeish)) failures.push(`${r}: generic data fallback ${re}`);
    }
  }
}

if (failures.length) {
  console.error("quality:guardrails FAILED");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log(`quality:guardrails OK (${files.length} files)`);
