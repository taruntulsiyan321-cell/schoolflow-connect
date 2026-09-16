// node stray.mjs <repo> [--delete]  — root-level untracked files that are shell-redirect debris (empty or cmd.exe help text)
import { execFileSync } from "child_process";
import { statSync, readFileSync, unlinkSync } from "fs";
import path from "path";
const repo = path.resolve(process.argv[2]);
const out = execFileSync("git", ["-C", repo, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" });
const untracked = out.split("\0").filter((e) => e.startsWith("?? ")).map((e) => e.slice(3));
const rootOnly = untracked.filter((f) => !f.includes("/"));
for (const f of rootOnly) {
  const full = path.join(repo, f);
  const size = statSync(full).size;
  const head = size ? readFileSync(full, "utf8").slice(0, 60).replace(/\s+/g, " ") : "";
  console.log(`${JSON.stringify(f)}\t${size} bytes\t${head}`);
  if (process.argv.includes("--delete")) {
    if (size > 4096) { console.log(`  KEPT (too large to be debris)`); continue; }
    unlinkSync(full);
    console.log("  deleted");
  }
}
console.log(`${rootOnly.length} root-level untracked file(s)`);
