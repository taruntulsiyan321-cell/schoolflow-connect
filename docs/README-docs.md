# Project Documents

Three documents. Keep all three in `docs/`. They are not interchangeable and
none of them replaces another.

---

## 1. `locked-decisions.md` — the source of truth

**Read this before doing anything else.** Every rule, permission, formula and
constraint decided so far, across all six roles.

- Long-lived. Referenced by everything.
- **Where any other document disagrees with it, stop and ask.**
- When a decision changes, it is updated here **first**.
- Contains a "Still open" list at the bottom — items marked `OPEN` must never be
  guessed at.

Includes several places where a later decision overrode an earlier one — super
admin access, rank, principal permissions. Those are marked explicitly rather
than silently replaced, so the reasoning stays visible.

---

## 2. `foundation-build-prompt.md` — the build task

The chunked database and isolation build. Twelve chunks, each with a STOP gate.

- Consumed as work progresses. Chunks 1, 1.5, 1.6 and 2 are done.
- Each chunk: build → run its verification block → paste output → **stop for
  approval**.
- References `locked-decisions.md` throughout. It does not restate rules; it
  points at them.
- The global rules G1–G7 at the top apply to every chunk and are the things most
  easily lost.

---

## 3. `recovery-revision-analysis-spec.md` — the paid feature

Deep specification for the three practice logics. Separate from the others
because it is the product's differentiator and needed sustained design rather
than a paragraph.

- Owned by Chunk 7 of the build.
- Contains the transfer ladder, the readiness formula, the revision schedule,
  and what analysis may and may not show.
- **Every constant lives in §10 of that file**, in one module, tunable in one
  place. None may appear as a literal in a component.

---

## The rules that matter most

Scattered across the documents, but these are the ones that cause the most
damage when forgotten:

**Null is not zero.** A mark not entered is `NULL`, never `0`. No threshold fires
on zero records. "Not enough data" is a real, visible state — including for
trends.

**No metric is computed twice.** One function per metric, in the data layer.
Components render, never calculate. No threshold literal in any component.

**No stored aggregates.** Percentages, averages, counts and ranks are computed on
read. A stored counter drifts the moment a row is deleted.

**Practice is private.** Test and homework mistakes are school data. Practice
mistakes are not. They must be **separate tables**, with the source structural —
not a flag checked in code. Storing them together is how `question_records`
became readable by parents and class teachers.

**Isolation is enforced by Postgres, not application code.** RESTRICTIVE
policies, so no future policy can grant across institutions by forgetting a term.

**Never invent a rule.** If it is not written down, stop and ask. Every bug worth
having so far came from something being inferred rather than decided.
