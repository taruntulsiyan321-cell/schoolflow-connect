# RULE 0 — remove, re-analyse, rewrite, reconnect

**This is the one hard rule of this repository. It applies to every change, in every session, before any other consideration. Read it as the first thing you do and follow it without being asked.**

When something is defective — a bug, a wrong colour, a stale file, a broken
behaviour, anything causing a problem — **you do not patch around it.**

You:

1. **Remove** the defective code entirely. The whole thing, not the visible symptom.
2. **Re-analyse** what it was actually doing, and find *every* connection point:
   every caller, importer, route, test, style consumer, database dependency.
3. **Rewrite** it from that understanding, with the change you wanted.
4. **Reconnect** all of it, and re-check every connection you found in step 2, so
   that nothing which worked before the rewrite is broken by it.

Then **delete the patch**, if one was written on the way. A rewrite that leaves
the workaround behind has two homes for the same decision, and the next session
will change the wrong one.

## What this forbids, specifically

- Adding an override that paints over a wrong rule instead of fixing the rule.
- Scoping a correction per-consumer (`.panel-a .thing { … }`) when the *thing*
  is what is wrong. Fix the thing; every consumer then gets it right for free.
- Fixing N call sites when one shared definition is the actual defect — and the
  reverse: changing a shared definition when the call sites genuinely disagree.
- Leaving dead code, dead variables, or dead CSS in place "just in case". If the
  rewrite does not need it, it goes.
- `!important`, or a more specific selector, used to win a fight with code you
  could have deleted.

## Why it exists

Patching preserves the original mistake and adds a second place to look. This
repository has repeatedly paid for that: an off-design stylesheet re-pointed
per-panel instead of rewritten; a token relationship fixed at sixty call sites
instead of once; a defect "fixed" while the file that caused it stayed. Each one
cost more to unwind later than the rewrite would have cost up front.

## The check that comes with it

A rewrite is not finished when it compiles. It is finished when the connection
points from step 2 are **re-verified by measurement** — the test run, the probe,
the survey — not by inspection and not by assumption.

Every check must be able to fail. If a check would still pass against an empty
page, a blank response, or a deleted feature, it is not a check: it proves
nothing and it will hide the next defect. Give it a positive control — something
that demonstrates the check *can* fail — and assert on content, never on the
count of things you visited.

## Report honestly

Never report a defect instead of fixing it. If you find one you cannot fix,
finish everything else in full, then say plainly what is left and why. If a test
fails, say so and show the output. Do not describe work as done until the
measurement says it is.
