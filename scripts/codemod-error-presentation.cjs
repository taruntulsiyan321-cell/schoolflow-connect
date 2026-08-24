/**
 * One-shot codemod: route caught errors through the presentation boundary.
 *
 *   e instanceof Error ? e.message : "Failed to load homework"
 *   ->
 *   toErrorMessage(e, "Failed to load homework")
 *
 * Only rewrites sites whose fallback is a string literal. The handful of
 * diagnostic sites (`console.warn(..., e instanceof Error ? e.message : e)`)
 * use a non-literal fallback and are deliberately left alone — raw driver text
 * belongs in the console, just never in the DOM.
 */
const fs = require("fs");
const path = require("path");

const ROOT = "src";
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p);
  }
})(ROOT);

const BS = String.fromCharCode(92);
// <expr> instanceof Error ? <same expr>.message : "literal" | 'literal'
const PATTERN = new RegExp(
  "([A-Za-z_$][" + BS + "w$]*(?:" + BS + ".[A-Za-z_$][" + BS + "w$]*)*)" +
    " instanceof Error " + BS + "? " + BS + "1" + BS + ".message : " +
    '("(?:[^"' + BS + BS + "]|" + BS + BS + ".)*\"|'(?:[^'" + BS + BS + "]|" + BS + BS + ".)*')",
  "g",
);

let changedFiles = 0;
let totalSites = 0;
const touched = [];

for (const file of files) {
  const unix = file.split(path.sep).join("/");
  if (unix.startsWith("src/lib/presentation/")) continue; // no self-import

  const original = fs.readFileSync(file, "utf8");
  let sites = 0;
  const rewritten = original.replace(PATTERN, (_m, expr, literal) => {
    sites++;
    return "toErrorMessage(" + expr + ", " + literal + ")";
  });
  if (sites === 0) continue;

  let out = rewritten;
  const hasModuleImport = /from "@\/lib\/presentation"/.test(out);
  const hasSymbol = /import \{[^}]*\btoErrorMessage\b[^}]*\} from "@\/lib\/presentation"/.test(out);

  if (!hasModuleImport) {
    const importRe = /^import [\s\S]*?;$/gm;
    let lastEnd = -1;
    let m;
    while ((m = importRe.exec(out)) !== null) lastEnd = m.index + m[0].length;
    const stmt = '\nimport { toErrorMessage } from "@/lib/presentation";';
    out = lastEnd >= 0 ? out.slice(0, lastEnd) + stmt + out.slice(lastEnd) : stmt.trimStart() + "\n" + out;
  } else if (!hasSymbol) {
    out = out.replace(
      /import \{([^}]*)\} from "@\/lib\/presentation"/,
      (_mm, inner) => "import {" + inner.replace(/\s+$/, "") + ", toErrorMessage } from \"@/lib/presentation\"",
    );
  }

  fs.writeFileSync(file, out);
  changedFiles++;
  totalSites += sites;
  touched.push(unix + " (" + sites + ")");
}

console.log("files changed: " + changedFiles);
console.log("sites rewritten: " + totalSites);
console.log(touched.join("\n"));
