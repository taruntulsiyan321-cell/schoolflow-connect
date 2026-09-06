#!/usr/bin/env node
/**
 * Fail if HEAD is not what `origin` has for this branch.
 *
 * WHY THIS EXISTS. Six sessions of work — the question_bank write fence, the
 * `embed` edge function, the short/long answer path, three-argument `has_role`,
 * `docs/gurukul-spec-rules.md`, `scripts/strip-demo-tenants.mjs` — sat on one
 * disk for weeks. A separate tool checked the branch out and got the tip from
 * six sessions earlier, because nothing had been pushed and nothing checked.
 *
 * BEHIND is the direction everyone checks. AHEAD is the dangerous one, and
 * nobody was checking it: an unpushed commit is one disk failure from gone, and
 * a DEPLOY whose source is unpushed is the same defect as a deploy whose source
 * was never committed. `ai-expand-questions` and `mcp` reached production that
 * way and their source exists on no branch to this day.
 *
 * It asks the REMOTE, with `git ls-remote`. A local `git log`, or a
 * `refs/remotes/origin/*` ref, proves only what this machine last heard — both
 * would have reported everything fine throughout the incident this guards
 * against.
 *
 *   node scripts/check-pushed.mjs            the current branch
 *   node scripts/check-pushed.mjs --all      every local branch
 *   node scripts/check-pushed.mjs --warn     report, exit 0 (for a soft gate)
 */
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const ALL = args.has("--all");
const WARN_ONLY = args.has("--warn");

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8" }).trim();
}

function remoteHeads() {
  // One network call. `ls-remote` is the only source that answers "what can
  // another machine fetch"; everything else answers "what did we last hear".
  const out = git("ls-remote", "--heads", "origin");
  const map = new Map();
  for (const line of out.split("\n")) {
    const m = line.match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function localBranches() {
  return git("for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean);
}

let heads;
try {
  heads = remoteHeads();
} catch (e) {
  console.error("BLOCKED: could not reach origin.\n  " + String(e.message).split("\n")[0]);
  console.error("\n  Not treated as a pass. 'I could not ask' must never look like 'nothing to push'.");
  process.exitCode = 1;
  process.exit();
}

const current = git("rev-parse", "--abbrev-ref", "HEAD");
const branches = ALL ? localBranches() : [current];

const problems = [];
for (const b of branches) {
  let local;
  try {
    local = git("rev-parse", b);
  } catch {
    continue;
  }
  const remote = heads.get(b);

  if (!remote) {
    problems.push({ b, kind: "NEVER PUSHED", detail: `${local.slice(0, 7)} exists only on this machine` });
    continue;
  }
  if (remote === local) continue;

  // Both exist and differ. Which way?
  let ahead = "?";
  let behind = "?";
  try {
    // The remote sha may not be in this repo if it was never fetched.
    git("cat-file", "-e", `${remote}^{commit}`);
    const counts = git("rev-list", "--left-right", "--count", `${remote}...${local}`).split(/\s+/);
    behind = counts[0];
    ahead = counts[1];
  } catch {
    problems.push({ b, kind: "DIVERGED", detail: `origin has ${remote.slice(0, 7)}, which this repo has never fetched` });
    continue;
  }

  if (Number(ahead) > 0 && Number(behind) > 0) {
    problems.push({ b, kind: "DIVERGED", detail: `ahead ${ahead}, behind ${behind} — reconcile deliberately, never force` });
  } else if (Number(ahead) > 0) {
    problems.push({ b, kind: "AHEAD", detail: `${ahead} commit(s) on this disk and nowhere else` });
  } else if (Number(behind) > 0) {
    problems.push({ b, kind: "BEHIND", detail: `${behind} commit(s) on origin not here` });
  }
}

if (problems.length === 0) {
  console.log(
    `PASS: ${branches.length} branch(es) match origin, confirmed by git ls-remote.\n` +
    `  Bounded: it proves the tips match, not that the work is correct.`,
  );
  process.exit(0);
}

console.error(`FAIL: ${problems.length} branch(es) are not landed on origin:\n`);
for (const p of problems) {
  console.error(`  ${p.kind.padEnd(13)} ${p.b}`);
  console.error(`  ${" ".repeat(13)} ${p.detail}`);
}
console.error(
  `\n  Rule 32: work is not landed until git ls-remote shows it. A commit on one\n` +
  `  machine is one disk failure from gone, and a deploy whose source is\n` +
  `  unpushed is the same defect as a deploy whose source was never committed.\n\n` +
  `    git push origin ${problems[0].b}\n\n` +
  `  A DIVERGED branch is reconciled deliberately — push it as\n` +
  `  <branch>-local-YYYYMMDD. Never force-push.`,
);
if (!WARN_ONLY) process.exitCode = 1;
