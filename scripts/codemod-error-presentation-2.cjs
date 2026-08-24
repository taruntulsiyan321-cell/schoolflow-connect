/**
 * Second error codemod — the two shapes the first pass could not see.
 *
 * The first codemod matched `e instanceof Error ? e.message : "…"`. Two other
 * shapes carry the same raw PostgREST text to the user and were missed:
 *
 *   1. Destructured Supabase errors:
 *        toast({ description: bErr.message })
 *        toast({ description: error.message || "Please try again." })
 *
 *   2. Hand-rolled duck-typing:
 *        e && typeof e === "object" && "message" in e
 *          ? String((e as { message: string }).message)
 *          : "Could not join"
 *
 * Both become `toErrorMessage(err, "fallback")`.
 */
const fs = require("fs");
const path = require("path");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(p);
  }
})("src");

const BS = String.fromCharCode(92);

// 1. `<key>: <err>.message` optionally with `|| "fallback"`.
//    Only inside an object literal position (description/title/message keys).
const DESTRUCTURED = new RegExp(
  "(description|title|message):\\s*([A-Za-z_$][" + BS + "w$]*(?:Err|Error|error|err))\\.message" +
    "(?:\\s*\\|\\|\\s*(\"(?:[^\"" + BS + BS + "]|" + BS + BS + ".)*\"))?",
  "g",
);

// 2. Hand-rolled duck-typing, collapsed to one line first.
const DUCK = new RegExp(
  "([A-Za-z_$][" + BS + "w$]*)\\s*&&\\s*typeof\\s+\\1\\s*===\\s*\"object\"\\s*&&\\s*\"message\"\\s+in\\s+\\1" +
    "\\s*" + BS + "?\\s*String\\(\\(\\1\\s+as\\s*\\{\\s*message:\\s*string\\s*\\}\\)\\.message\\)" +
    "\\s*:\\s*(\"(?:[^\"" + BS + BS + "]|" + BS + BS + ".)*\")",
  "g",
);

let changedFiles = 0;
let sites = 0;
const touched = [];

for (const file of files) {
  const rel = file.split(path.sep).join("/");
  if (rel.startsWith("src/lib/presentation/")) continue;

  const original = fs.readFileSync(file, "utf8");
  let out = original;
  let local = 0;

  out = out.replace(DESTRUCTURED, (_m, key, errVar, fallback) => {
    local++;
    return `${key}: toErrorMessage(${errVar}, ${fallback ?? '"Please try again."'})`;
  });

  // Collapse the multi-line duck-typing into one line so the regex can see it.
  const collapsed = out.replace(
    /([A-Za-z_$][\w$]*)\s*&&\s*typeof\s+\1\s*===\s*"object"\s*&&\s*"message"\s+in\s+\1\s*\n\s*\?\s*/g,
    (m, v) => `${v} && typeof ${v} === "object" && "message" in ${v} ? `,
  ).replace(/\)\s*\n\s*:\s*("(?:[^"\\]|\\.)*")/g, (m, f) => `) : ${f}`);

  out = collapsed.replace(DUCK, (_m, errVar, fallback) => {
    local++;
    return `toErrorMessage(${errVar}, ${fallback})`;
  });

  if (local === 0 || out === original) continue;

  if (!/from "@\/lib\/presentation"/.test(out)) {
    const lines = out.split(/\r?\n/);
    let last = 0;
    for (let i = 0; i < Math.min(lines.length, 80); i++) if (/^import /.test(lines[i])) last = i;
    lines.splice(last + 1, 0, 'import { toErrorMessage } from "@/lib/presentation";');
    out = lines.join(original.includes("\r\n") ? "\r\n" : "\n");
  } else if (!/import \{[^}]*\btoErrorMessage\b[^}]*\} from "@\/lib\/presentation"/.test(out)) {
    out = out.replace(
      /import \{([^}]*)\} from "@\/lib\/presentation"/,
      (_mm, inner) => "import {" + inner.replace(/\s+$/, "") + ', toErrorMessage } from "@/lib/presentation"',
    );
  }

  fs.writeFileSync(file, out);
  changedFiles++;
  sites += local;
  touched.push(`${rel} (${local})`);
}

console.log(`files changed: ${changedFiles}`);
console.log(`sites rewritten: ${sites}`);
console.log(touched.join("\n"));
