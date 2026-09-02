/**
 * PREFLIGHT — has the integration branch moved under this working tree?
 *
 *   node scripts/check-branch-divergence.mjs
 *   node scripts/check-branch-divergence.mjs --self-test
 *
 * WHY THIS EXISTS
 *
 * Twice a parallel session has built a whole chunk that another session had
 * already built and pushed, and both times the duplicate was the one thrown
 * away:
 *
 *   Chunk 10 batch 2   f63cea4 vs e56adea — same four modules, same filenames
 *   Chunk 10.5 step 1  0447691 vs 20260901100000_chunk105 — same three columns
 *
 * Neither was a mistake of judgement. Both sessions did correct work. The
 * failure was that a worktree on its own branch looks completely calm while
 * `main` moves: `git log` in here shows your commits, `git status` is clean, and
 * nothing anywhere says the ground has shifted.
 *
 * The documents now say "run one session at a time". That is a note in a file,
 * and the sibling preflight in this directory already has the answer to notes
 * in files, in its own header: **"remember to check" is not a mechanism.**
 * So this is the mechanism.
 *
 * WHAT IT REPORTS, AND WHY BEING BEHIND IS ENOUGH TO FAIL
 *
 * Being behind `main` is not itself a defect — it is the CONDITION under which
 * duplicated work becomes invisible, which is the thing that actually cost the
 * time. So any distance behind fails, and the overlap is reported on top of it
 * because that is what says how likely a collision already is.
 *
 * Overlap is computed against every file this branch has touched — in its own
 * commits AND in the working tree — because uncommitted work collides just as
 * expensively as committed work, and it is the state a session is usually in
 * when it discovers the problem.
 *
 *   0   CLEAN     nothing on the base branch that this tree does not have
 *   1   BEHIND    the base has moved; reconcile before building anything
 *   2   BLOCKED   the check could not run (not a git repo, no base branch)
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes("--self-test");
const baseArg = argv.find((a) => a.startsWith("--base="));
const BASE = baseArg ? baseArg.slice("--base=".length) : "main";

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * The comparison, as data. Pure enough to drive from a throwaway repository,
 * which is what makes the self-test possible at all.
 */
export function divergence(cwd, base) {
  const head = git("rev-parse --abbrev-ref HEAD", cwd);
  let ahead = 0;
  let behind = 0;
  try {
    ahead = Number(git(`rev-list --count ${base}..HEAD`, cwd));
    behind = Number(git(`rev-list --count HEAD..${base}`, cwd));
  } catch {
    return { ok: false, reason: `no such base branch: ${base}` };
  }

  // Files this branch has touched: its own commits, plus anything uncommitted.
  const mergeBase = git(`merge-base HEAD ${base}`, cwd);
  // NOT `git status --porcelain`. Its format is `XY PATH` — two status columns
  // then a space — and an unstaged modification leaves the first column blank,
  // so the line begins with a space. The helper above trims, which ate that
  // space, and a fixed `slice(3)` then cut three characters into the FILENAME:
  // ` M src/shared.ts` became `rc/shared.ts`, matched nothing, and the overlap
  // came back empty. The self-test caught it; a gate checked in one direction
  // only would have shipped it.
  //
  // These two give clean paths and need no column arithmetic: tracked changes
  // against HEAD, staged or not, plus untracked files.
  const mine = new Set(
    [
      ...(ahead > 0 ? git(`diff --name-only ${mergeBase}..HEAD`, cwd).split("\n") : []),
      ...git("diff --name-only HEAD", cwd).split("\n"),
      ...git("ls-files --others --exclude-standard", cwd).split("\n"),
    ].map((f) => f.trim()).filter(Boolean),
  );

  const theirs = behind > 0
    ? git(`diff --name-only ${mergeBase}..${base}`, cwd).split("\n").filter(Boolean)
    : [];

  const overlap = theirs.filter((f) => mine.has(f)).sort();

  return { ok: true, head, base, ahead, behind, overlap, theirCount: theirs.length };
}

/* ── self-test: build a real divergence and prove the gate sees it ───────── */

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "divergence-selftest-"));
  const cases = [];
  try {
    git("init -q -b main", dir);
    git('config user.email "t@t"', dir);
    git('config user.name "t"', dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "shared.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "only-mine.ts"), "export const b = 1;\n");
    git("add -A", dir);
    git('commit -q -m base', dir);

    // A branch that is level with main.
    git("checkout -q -b feature", dir);
    let d = divergence(dir, "main");
    cases.push({
      name: "level with the base: no divergence",
      pass: d.ok && d.behind === 0 && d.overlap.length === 0,
      got: d,
    });

    // Branch commits — ahead only. Still not a divergence.
    writeFileSync(join(dir, "src", "only-mine.ts"), "export const b = 2;\n");
    git("add -A", dir);
    git('commit -q -m mine', dir);
    d = divergence(dir, "main");
    cases.push({
      name: "ahead of the base only: still no divergence",
      pass: d.ok && d.ahead === 1 && d.behind === 0,
      got: d,
    });

    // Base moves, touching a file the branch has NOT touched.
    git("checkout -q main", dir);
    writeFileSync(join(dir, "src", "shared.ts"), "export const a = 2;\n");
    git("add -A", dir);
    git('commit -q -m theirs', dir);
    git("checkout -q feature", dir);
    d = divergence(dir, "main");
    cases.push({
      name: "base moved, no shared file: BEHIND, overlap empty",
      pass: d.ok && d.behind === 1 && d.overlap.length === 0,
      got: d,
    });

    // The real case: both touched the same file.
    writeFileSync(join(dir, "src", "shared.ts"), "export const a = 3;\n");
    git("add -A", dir);
    git('commit -q -m "mine, same file"', dir);
    d = divergence(dir, "main");
    cases.push({
      name: "both touched the same file: BEHIND with overlap — the case that cost the work",
      pass: d.ok && d.behind === 1 && d.overlap.includes("src/shared.ts"),
      got: d,
    });

    // Uncommitted work counts as touched too.
    git("checkout -q -B feature2 HEAD~1", dir);
    writeFileSync(join(dir, "src", "shared.ts"), "export const a = 4;\n");
    d = divergence(dir, "main");
    cases.push({
      name: "UNCOMMITTED change to a file the base also changed: still overlap",
      pass: d.ok && d.behind === 1 && d.overlap.includes("src/shared.ts"),
      got: d,
    });

    // A base branch that does not exist must BLOCK, not pass.
    d = divergence(dir, "no-such-branch");
    cases.push({
      name: "missing base branch: blocked, not a silent pass",
      pass: d.ok === false,
      got: d,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let bad = 0;
  for (const c of cases) {
    if (!c.pass) bad += 1;
    const detail = c.got.ok
      ? `ahead=${c.got.ahead} behind=${c.got.behind} overlap=${c.got.overlap?.length ?? 0}`
      : `blocked: ${c.got.reason}`;
    console.log(`  ${c.pass ? "ok   " : "FAIL "} ${c.name}  ->  ${detail}`);
  }
  console.log(
    bad === 0
      ? `\nall ${cases.length} self-test case(s) behaved. The gate fires on a base that has\nmoved, counts uncommitted work as touched, and blocks rather than passing when\nthe base branch does not exist.`
      : `\n${bad} self-test case(s) FAILED. The gate is not trustworthy.`,
  );
  return bad === 0 ? 0 : 1;
}

/* ── run ──────────────────────────────────────────────────────────────────── */

if (SELF_TEST) {
  process.exitCode = selfTest();
} else {
  let d;
  try {
    d = divergence(process.cwd(), BASE);
  } catch (err) {
    console.error("BLOCKED: the divergence preflight could not run.");
    console.error(`  ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    console.error("  Not a finding — nothing was compared.");
    process.exitCode = 2;
    d = null;
  }

  if (d && !d.ok) {
    console.error("BLOCKED: the divergence preflight could not run.");
    console.error(`  ${d.reason}`);
    console.error("  Not a finding — nothing was compared.");
    process.exitCode = 2;
  } else if (d) {
    console.log(`${d.head} vs ${d.base}: ${d.ahead} ahead, ${d.behind} behind.`);

    if (d.behind === 0) {
      console.log("CLEAN: the base branch has nothing this tree does not have.");
      process.exitCode = 0;
    } else {
      console.log("");
      console.log(`BEHIND: ${d.base} has ${d.behind} commit(s) this tree does not have,`);
      console.log(`        touching ${d.theirCount} file(s).`);
      if (d.overlap.length) {
        console.log("");
        console.log(`        ${d.overlap.length} of them are files THIS BRANCH has also touched:`);
        for (const f of d.overlap.slice(0, 20)) console.log(`          ${f}`);
        if (d.overlap.length > 20) console.log(`          … and ${d.overlap.length - 20} more`);
        console.log("");
        console.log("        That is the shape both duplications took: same files, different");
        console.log("        commit subjects. Compare the FILE LISTS before assuming the work");
        console.log("        is distinct — neither collision was visible from the subjects.");
      }
      console.log("");
      console.log(`  Reconcile first:  git log --oneline HEAD..${d.base}`);
      console.log(`                    git diff --stat HEAD..${d.base}`);
      console.log(`  then rebase or reset onto ${d.base} before building anything further.`);
      process.exitCode = 1;
    }
  }
}
