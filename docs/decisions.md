# Build decisions log

Decisions taken *during* the foundation build, where the spec was silent,
self-contradictory, or contradicted by the live schema.

`locked-decisions.md` is the source of truth for product decisions.
This file records what was decided at the keyboard and why, so that a rule
nobody can trace later does not end up being obeyed by accident.

Each entry states the conflict, the decision, the precedent it follows, and
what would have to change for it to be revisited.

---

## D1 — Late homework submission: enforce the lock, keep the history

**Date:** 2026-08-26 · **Chunk:** 5 · **Decided by:** Claude Code, under
delegation ("use it yourself from the foundation")

**The conflict.** `foundation-build-prompt.md` Chunk 5 states: *"Submission locks
at `due_date`. No late submission."* The live schema disagrees on every point —
`homework_submissions.is_late` exists, a trigger (`tg_homework_compute_is_late`)
computes it server-side, `status = 'late'` is a live value, and **9 of 116
submission rows are already marked late.** Late submission was not merely
possible; it happened.

**Decision.**

1. **Enforce the lock at write time.** A submission after `due_date` is rejected
   by the database, not filtered by the UI.
2. **Stop computing `is_late` for new rows.** Under the lock it can only ever be
   `false`, so continuing to compute it is a mechanism answering a question that
   can no longer arise.
3. **Leave the 9 existing rows and the column alone.** They are a true record of
   what happened under the previous rule.

**Precedent followed.** Two, both already settled in this build:

- *Legacy `marks` zeros* (foundation-build-decisions): make the column nullable,
  **leave every pre-existing row alone, never bulk-convert.** A historical value
  that was true when written is not corrected retroactively.
- *Chunk 4.7, the attendance lock*: when a rule and a mechanism both answered
  one question, the redundant **mechanism** was removed while the **history**
  (`attendance_audit`) was preserved intact.

Applying both: the rule wins going forward, the mechanism stops, the record
stays. Deleting the column would discard evidence; keeping the trigger would
maintain a field that can never again be true.

**What would revisit this.** A product decision to permit late submission —
at which point the column and trigger are already there, and only the write-time
rejection would need lifting. That asymmetry is deliberate: this decision is
cheap to reverse and expensive to have gotten wrong in the other direction.

**Flagged for the doc:** Chunk 5's column list for `homework` omits
`chapter_id`, but §10.22 says *"When a teacher creates homework or a test, they
pick the chapter from a list."* Homework cannot roll up to chapter without it.
Added as nullable — §10.22 also allows a free-text label where no chapter fits.
