# FOUNDATION BUILD — Database, Rules, and Isolation

This builds the foundation the whole app sits on. Get this wrong and every panel
inherits the bug.

**Read `locked-decisions.md` in full before starting. It is the source of truth.
Where this document and that document disagree, stop and ask.**

---

## HOW TO WORK — READ THIS FIRST

**Work in chunks. One chunk at a time. Do not run ahead.**

For every chunk:

1. Read the chunk in full
2. Report what you are about to create, and anything that conflicts with existing
   code or schema
3. Build it
4. Run that chunk's verification block
5. **Paste the verification output**
6. **STOP. Wait for approval. Do not begin the next chunk.**

**Rules that apply to every chunk:**

- **Never guess.** If a decision is not written down, stop and ask. Do not invent
  a rule, a threshold, an interval, or a default.
- **Never fabricate data.** No hardcoded numbers, no placeholder rows, no
  "example" values in application code.
- If something cannot be built as specified, **stop and say so.** Do not build a
  near-miss.
- Report every assumption you make, however small.
- Migrations must be reversible. One migration file per chunk.

---

## GLOBAL RULES — enforced in every chunk

### G1. Isolation

Every table carries `institution_id` **except** the shared tables named in G2.
Row Level Security is enabled on every table. Policies are enforced by Postgres,
never by application code.

The active institution comes from the session's active membership (Chunk 1).
No query may reach across institutions.

### G2. The only shared tables

These are global and carry **no** `institution_id`:

- `accounts`, `account_identifiers`
- `memberships` (this is the join between global identity and an institution)
- `boards`, `curriculum_classes`, `curriculum_subjects`, `chapters`, `topics`
- `questions`, `question_tags`
- `super_admin_access_log`

**Everything else is institution-scoped.** If you find yourself creating a table
without `institution_id` that is not on this list, stop.

### G3. Academic year

Every institution-scoped table that records an event or a record carries
`academic_year_id`. Add it now even though only one year exists. Retrofitting it
later means backfilling every table.

### G4. Null is not zero

- A mark that was not entered is `NULL`. It is never `0`.
- Any column that could be "not recorded yet" must be nullable.
- No check constraint may force a `0` default on a measurement column.
- Aggregates exclude `NULL`, never coalesce it to zero.

### G5. No stored aggregates

Attendance percentages, completion rates, averages, ranks, leaderboards, counts —
**none are stored**. All are computed on read in the metric layer (Chunk 10).

If you find yourself adding a column like `attendance_percentage`, stop.

### G6. Soft delete

| Entity | Retention | Restorable by |
|---|---|---|
| Test | 7 days | Admin |
| Homework | 7 days | Admin |
| Student | 30 days | Admin |
| Teacher | 30 days | Admin |
| Resource | **None — hard delete** | Nobody |

Soft-deleted rows carry `deleted_at`, `deleted_by`, and are excluded from every
query by default via the RLS policy or a view — not by application filtering.

### G7. Audit

Every write by an admin is logged in `audit_log`. Every super admin access to
institution data is logged in `super_admin_access_log` and notifies the school.

### G8. Standing gates — run after EVERY chunk

Not per-chunk verification, which tests what that chunk built. These run every
time, and they catch what a chunk broke somewhere else.

| Gate | Command | Must be |
|---|---|---|
| Types | `tsc` | 0 errors |
| Build | `npm run build` | clean |
| Tests | full suite | all passing |
| DB integrity | repo integrity checker | 0 failures |
| Tenant-scope lint | lint-tenant-scope | pass |
| Leak survey | cross-institution survey | 0 leaking pairs |
| **Seed** | `npm run db:seed` **in a rolled-back transaction** | executes end to end |
| Live smoke | open each role's main screens | loads, no console errors, no `undefined%`, **no 5xx** |
| Query timing | heaviest query per touched table, per role | reported; nothing within 2× the statement timeout |

**On the smoke gate and passwords:** do not type passwords into login forms, even
for seeded demo accounts. Authenticate **programmatically** instead — mint a
session for each role via the auth admin API or a signed test JWT, set it, and
drive the screens from there. This is more reliable than form entry, works
unattended, and keeps credentials out of the loop entirely. If a role's session
cannot be created programmatically, report the gate as **incomplete** rather than
passed.

**The seed gate exists because it was broken four independent ways and nobody
noticed.** Three of those breaks predated the foundation work, which means no
fresh environment had been created in months. A broken seed is invisible until
the day it matters most — a new developer, a staging rebuild, a recovery.

**Report the output of every gate, every chunk.** A gate that regressed is a
finding even when the chunk's own verification passed.

**A skipped check is not a passing check.** Found live: the smoke gate reported
"5 skipped / PASS" without `SMOKE_SESSIONS` and exited 0 — asserting nothing
while reporting success. Same shape as a swallowed catch, one level up.
A gate that cannot run must **fail**, not skip.

**Every gate needs a negative control.** Prove it can fail: break the thing it
guards, confirm it reports failure, restore. A gate never seen to fail is a gate
never seen to work.

**Scale fixtures belong in their own institution.** Do not inflate the demo
school to give the timing gate volume — that trades a readable demo for a working
gate. Seed a second institution at realistic scale instead: the gate gets its
numbers, the demo school stays legible, and cross-institution isolation is
exercised at volume for free.

**The seed must cover every table the gates measure.** `tests`, `test_marks` and
`report_cards` hold zero rows, so the timing gate measures nothing for them —
blind precisely where the newest tables are. Seed realistic volume into every
table a gate inspects, or the gate is decorative there.

**Capture artifacts on every gate failure, including intermittent ones.** A
failure seen once and lost cannot be diagnosed, and reporting it as unexplained —
while correct — leaves it open. Configure retries to preserve traces, screenshots
and console output on first failure, so the next occurrence is diagnosable rather
than merely noted.

**If a gate fails for a reason that predates your work, say so and prove it** —
timestamps, ledger position, or the commit that introduced it. Do not silently
inherit someone else's failure, and do not claim one is pre-existing without
evidence.

### G12. A policy that times out is a broken feature

**Found live:** the parent panel returned **HTTP 500 in production** — 33 seconds
against an 8-second statement timeout, on ten visible rows. Not slow. Broken.

**Root cause, one pattern repeated 31 times across 17 tables:** a policy that
reaches another RLS-protected table pays that table's **entire policy stack, per
candidate row.** `EXISTS (SELECT 1 FROM students …)` re-evaluates `students`'
policies for every row considered. A single count over `students` as a parent
cost 375 ms; multiplied per row, it timed out.

**This gets worse with every chunk.** Each new table adds policies; each policy
that reaches a protected table multiplies. Chunk 1's role binding is what turned
cheap column comparisons into expensive lookups — the cost was created by
correct work, and only surfaced when something finally measured it.

**Rules:**

- **A policy must not nest RLS.** Where a policy needs a fact from another
  protected table, resolve it through a `SECURITY DEFINER` helper so the inner
  table's stack runs once, not per row.
- **A helper that bypasses RLS must re-state every guarantee it bypassed** —
  active role, active local person, institution — and assert them. Otherwise the
  optimisation becomes a privacy hole. `can_manage_homework` shipped with no
  institution check on its `created_by` arm; a teacher who changed schools could
  still manage homework from the old one.
- **Duplicate permissive policies are pure cost.** `homework_submissions` carried
  ten, five of them duplicates. G9's two-sources-of-truth, showing up as latency.
- **Measure, then measure again.** The first fix took 33s → 14.5s — still a 500.
  The remaining cost had moved into a policy written during the fix. Never assume
  a fix landed; re-run the timing. In Chunk 6 the first two fixes moved nothing at
  all — 855ms → 855ms, 1128ms → 1138ms — and only measurement revealed it.
- **Dispatch on role before evaluating arms.** An `OR` chain evaluates every arm
  until one returns true, so a parent pays `teacher_teaches_class` (18.5ms) and
  `is_my_student_record` (19.2ms) on every row before reaching their own. Check
  the active role first — `active_membership_role()` costs 0.06ms because it
  takes no argument and is cached per statement. This was the entire fix:
  1138ms → 496ms.
- **Demo data hides this.** 14ms/row is invisible at 26 rows and ~2.8s at 200.
  **Report per-row cost, not just total**, and state what it becomes at realistic
  volume. A figure comfortably under the gate today is a 500 next term.

**Per chunk:** for every table the chunk touches, time the heaviest realistic
query **as each role that can read it**, and report the numbers. Anything within
2× of the statement timeout is a finding, not a footnote.

### G11. A test must pass for the reason it claims

**Found live:** `CHUNK4_VERIFY` item 7 ran `RESET ROLE` without clearing the JWT
claims, so the "admin edits attendance" check executed as **table owner with RLS
bypassed** — while `auth.uid()` still returned the principal. It proved neither
that admin edits work nor that policy permits them, and recorded the principal as
the editor **one line after item 6 proved the principal cannot edit.**

**A test that reports success for the wrong reason is worse than a failing one.**
A failure gets investigated. A false pass closes the question.

**Rules:**

- **State what each check proves**, and confirm the mechanism actually exercises
  it. "Rows were updated" is not proof that policy allowed it.
- **A negative result must be distinguishable from an inability to act.**
  "0 rows updated" looks identical to "cannot read the table at all" — assert
  both halves, as the Chunk 4.6 read/write check does.
- **Never verify under a role that bypasses RLS**, unless the point is to prove
  the bypass. Confirm the effective role and `auth.uid()` inside the test.
- **When two checks in one file contradict each other, one of them is broken.**
  Investigate rather than reporting both as passing.
- **Verification files rot.** A schema change can make one unrunnable or silently
  vacuous. Re-run prior chunks' verification files as part of G8, and report any
  that no longer execute.
- **Assert the guarantee, not a snapshot.** Found live: `CHUNK2_VERIFY` asserted
  "18 foreign keys exist" when the actual guarantee was *"do not re-point the
  existing FKs."* Two later left deliberately, so a correct build failed a
  correct test. Its topics assertion had the same shape — it encoded "no topics
  table ever" when the rule was "don't derive one from the legacy bank."
  A snapshot test fails on legitimate change, and the pressure is then to weaken
  or delete it. **Write what must remain true, not what happens to be true
  today.**
- **When rewriting, verify against the OLD behaviour, not the new code.**
  A rewrite check that compares the new implementation to its own logic proves
  only that it is self-consistent. Reproduce the predicate being replaced as
  ground truth and compare sets against it. Found live: `CHUNK67_BATCH2_VERIFY`
  item 3 reconstructed the old nested `EXISTS` and proved teacher 158 = 158 —
  the set survived, rather than the new code agreeing with itself.
- **Capture each item's baseline; never reuse a shared variable.** Found live:
  `CHUNK66_VERIFY` item 8 — the negative control — compared against `_expected`,
  which item 5 had overwritten with the teacher's set. It passed only because
  2546 > 26 happened to be true, and failed correctly the moment the fixture
  moved and it became 26 > 26. **The check that exists to catch tests passing for
  the wrong reason was doing exactly that.** Each item captures what it needs at
  the point it needs it.
- **This rule applies to your own tooling.** A verification runner that
  misreports is the same defect class. Classify on structural signals — SQLSTATE,
  exit codes — never on matching report wording.

### G10. No swallowed failures

**A bare `catch {}` is a bug that hides bugs.**

Found live: `awardSafe` swallowed every XP award failure. A CHECK constraint
whitelisted 4 source types while the app emitted 11, so **nine of eleven paths
failed on every call** — for four days — while the UI displayed
"Attendance submitted". The only evidence was that `progression_history`
contained one kind of row, and nobody was looking.

**This is worse than a visible bug.** A visible bug is fixed the same day. A
swallowed one runs until someone happens to query the table.

**Rules:**

- **No empty catch blocks anywhere.** A caught error is logged with enough
  context to identify it, or re-thrown.
- **"Safe" wrappers must still report.** A function whose job is to not crash the
  caller still surfaces the failure — a log line, a counter, a monitored event.
  Silence is not safety.
- **A success message must mean success.** Never render "saved" or "submitted"
  on a path where the write may have failed.
- **Constraint whitelists must match what the code emits.** Where a CHECK
  constrains a set of values, enumerate every value the application actually
  produces and prove the two agree. Keep the whitelist; widen it to the truth.

**Per chunk:** grep for empty catch blocks and unlogged catches in the code paths
that chunk touches, and report the count. Zero is the target; anything else is
named and justified.

**In Chunk 11:** sweep the whole repo. Also enumerate every CHECK constraint over
a value set and prove it matches the emitted values.

### G9. Watch for two sources of truth

**This has been the root cause three times.** Every time, the same shape: two
places hold the same fact, one is authoritative, nobody maintains the other, and
no error is ever raised.

| Found | Authority | Stale copy |
|---|---|---|
| Chunk 1.5 | `memberships` | `user_roles` |
| Chunk 3 | `student_enrolments.roll_number` | `students.roll_number` |
| Chunk 3 | RLS policies | the service-role path around them |

**In every chunk, ask explicitly: does anything here duplicate a fact that lives
somewhere else?** If yes, name the authority, converge the other, and **drop the
stale one.** Leaving a deprecated column commented is what lets a new call site
be written against it next month.

Report this as its own line in every chunk report, even when the answer is none.

---

# CHUNK 0 — PREFLIGHT (no code)

**Build nothing. Report only.**

1. List every existing table and column in the database.
2. For each, state whether it has `institution_id` and whether RLS is enabled.
3. List every table that will need to change to meet G1–G7.
4. Report whether these exist: a curriculum tree, a question bank, a tag set on
   questions, attendance submission records (distinct from per-student rows),
   enrolment dates, homework due dates, exam max marks and pass marks.
5. List every hardcoded number found in application code, with file and line.
6. List every place the same metric is computed more than once.
7. Propose your migration order and flag anything in this document that
   contradicts existing code.

**STOP. Wait for approval.**

---

# CHUNK 1 — TENANCY AND IDENTITY

The foundation of everything. Nothing else can be built correctly first.

### Tables

**`institutions`**
`id · name · board_id · session_start_date · session_end_date · status
(active/suspended/deleted) · suspended_at · created_at`

Session dates are **per institution**. Never hardcode them; every reporting
window reads from here.

**`academic_years`**
`id · institution_id · label · start_date · end_date · is_current`

**`accounts`** — global, no institution
`id · created_at · status`

**`account_identifiers`** — global
`id · account_id · type (phone/email) · value · verified_at`
Unique on `(type, value)`.

**Identifiers belong to accounts.** Registering an identifier that already exists
attaches the new membership to the existing account. It does not create a second
account.

**`memberships`** — global, the bridge to an institution
`id · account_id · institution_id · role (student/parent/teacher/principal/admin)
· local_person_id · status (pending/active/declined/revoked) · invited_by ·
invited_at · responded_at`

- An account may hold **any number** of memberships, in any combination:
  same role at two schools, different roles at two schools, two roles at the
  same school.
- `local_person_id` points at the row in that institution — `teachers.id`,
  `students.id`, `guardians.id`. **These are never merged.** The same human as
  teacher and parent at one school has two memberships and two local records.
- A membership grants nothing until `status = 'active'`.

**`sessions`**
`id · account_id · active_membership_id · created_at · expires_at`

**Exactly one active membership per session. Never two.** Switching replaces it.

**`invitations`** — an admin entering an identifier creates a pending membership.
Declining sets `status = 'declined'`, notifies the admin, and expires the invite.
This is the protection against a mistyped number belonging to someone at another
school.

**`super_admins`**, **`super_admin_access_log`**
`id · super_admin_id · institution_id · accessed_at · what_was_accessed ·
reason · school_notified_at`

**`super_admins` is a dedicated global table, not the existing `app_role`
enum value.** Super admin sits above every institution; it is not a role scoped
to one school the way student/teacher/parent/admin are, so it does not belong in
a per-membership role enum. Migrate any account currently marked
`app_role = 'super_admin'` into a `super_admins` row as part of this chunk, and
stop granting the old enum value going forward. Report how many accounts are
migrated.

### RLS

- Enable RLS on **every** table created in this chunk and all later chunks.
- The policy predicate is
  `institution_id = current_setting('app.active_institution')::uuid`
  where the setting is derived from the session's active membership.
- Global tables (G2) have their own policies — accounts and identifiers readable
  only by their owner; curriculum and questions readable by all authenticated
  users.
- **Super admin bypass exists but writes to `super_admin_access_log` on every
  access and triggers a school notification.**

### Verification — paste the output

```sql
-- 1. Every institution-scoped table has institution_id
-- 2. RLS is enabled on every table
-- 3. No policy is permissive-by-default
```

Then prove, with queries:

1. A session scoped to School A **cannot** read any row of School B — attempt it
   and show the empty result.
2. An account with memberships at two schools sees only the active one's data.
3. A pending membership grants **zero** access — attempt a read and show it fails.
4. A declined invitation leaves no access and notifies the admin.
5. The same human as teacher and parent at one school has two memberships and two
   distinct `local_person_id` values, and switching changes what is visible.
6. Super admin access writes a log row and a school notification.

**STOP. Wait for approval.**

---

# CHUNK 1.5 — CONVERGE `user_roles` (do this before Chunk 2)

**A live permission bypass, not cleanup.**

RLS now resolves roles through `memberships`. **31 functions still read
`user_roles` directly with global-role semantics** — including
`admin_assign_role`, `chat_can_dm`, `get_auth_context`.

Until these converge, a role revoked in `memberships` **stays granted** in those
functions. Two sources of truth, one of which nobody is maintaining.

### Do

1. List all 31 functions, with what each grants and which role values it reads.
2. Rewrite each to resolve through the active membership, not `user_roles`.
3. `user_roles` becomes read-only — no new writes from any path.
4. Report every client call site still reading `user_roles`.

### Verify

1. Revoke a membership. Prove **every one of the 31 functions** now denies —
   test each, do not sample.
2. A user with a stale `user_roles` row and no active membership gets nothing.
3. A user active at School A but not School B is denied by every function while
   switched to B.
4. `super_admin` is resolved from the `super_admins` table, never from
   `app_role`.

**STOP. Wait for approval.**

---

# CHUNK 1.6 — CLOSE THE PRACTICE PRIVACY BREACH (before Chunk 2)

**Live in production now.** Locked decision 10.8 states practice is private to
the student — no teacher, parent, principal, admin, or aggregate. Production
violates this today.

Known violations:
- `student_mistakes` — `SELECT` policies granting teacher, principal, admin
  **and** parent
- `concept_mastery` — same
- `rpc_teacher_concept_analytics()` — serves class-level practice aggregates to
  teachers

### Do

1. **Report every screen and call site that depends on these first.** Do not
   remove anything before that list is produced and reviewed.
2. Remove the offending policies. Practice tables become student-only.
3. Remove or gut `rpc_teacher_concept_analytics()`.
4. Leave the broken screens broken and list them. **Do not silently substitute
   another data source to keep them working** — that would reintroduce the leak
   through a different door.

### Verify

1. Teacher, parent, principal and admin sessions each return **zero rows** from
   `student_mistakes` and `concept_mastery`.
2. The student returns their own rows only.
3. No RPC, view, or function anywhere exposes practice data to another role —
   search exhaustively, not just these three.
4. XP remains readable for the section leaderboard. **That is the one deliberate
   exception:** effort is public, the content of mistakes is not.

**STOP. Wait for approval.**

---

# CHUNK 2 — CURRICULUM AND ACADEMIC STRUCTURE

### Global curriculum (no institution_id)

**`boards`** — `id · name`
**`curriculum_classes`** — `id · board_id · label` (Class 1..12)
**`curriculum_subjects`** — `id · curriculum_class_id · name`
**`chapters`** — `id · curriculum_subject_id · name · sequence`

**No `topics` table in this chunk.** The audit found no curriculum tree:
21,696 questions keyed on free text, 523 chapters, **11,917 distinct topic
strings**. That is a per-question descriptor, not a taxonomy.

**Chapter is the stable unit.** Everything downstream — questions, the mistake
book, custom sessions, analysis — keys on **`chapter_id`**, never on a name
string. This is sufficient because custom practice sessions are already
configured per chapter.

The free-text topic string stays on the question as an **unmapped label**. It is
never used for tracking, grouping or trends. A `topics` table can be added later
without breaking anything.

**Before seeding: check the 523 chapter names for near-duplicates and report the
count.** The same fragmentation risk exists at chapter level.

Maintained by super admin.

### Institution structure

**The existing `classes` table is already section-grain** — live rows are
`name="12", section="A"`, one row per class-section — and **18 tables carry a
foreign key to it**, every one of them semantically pointing at a section.

**Do not re-point those 18 FKs. Add a parent above instead.**

**`class_groups`** — NEW, the class level
`id · institution_id · academic_year_id · curriculum_class_id · label`

**`classes`** — EXISTING, stays section-grain, gains one column
`+ class_group_id`

Every existing FK keeps working untouched. The hierarchy now exists:
`class_groups (Class 12) → classes (12-A, 12-B, 12-C)`.

**Naming debt, accepted deliberately:** a table called `classes` holds sections.
Renaming it to `sections` is worth doing, but as its own isolated migration with
a compatibility view — **not in this chunk**, where it would tangle with new
tables. Note it and move on.

Wherever this document says "section", it means a row in `classes`.

**`section_subjects`** — **the canonical identity for all teaching**
`id · institution_id · section_id (→ classes.id) · curriculum_subject_id`

Note for Chunk 6: **`marks` has no subject column** — only `exam_id`,
`student_id`, `marks_obtained`. Per-subject marks must anchor on
`section_subjects`.

**Subjects attach to the section, not the class.** Sections of the same class may
study different subjects.

**Every homework, test, and exam-subject hangs off exactly one
`section_subject_id`.** They do not each store their own class and section — that
is how mixing happens. One identity, inherited.

**`teacher_assignments`**
`id · institution_id · section_subject_id · teacher_id · is_primary ·
start_date · end_date`

- **Multiple teachers per section-subject are allowed.** All are shown; the
  principal picks who to message.
- Assignment can change mid-year — hence `start_date` and `end_date`, never a
  single current teacher column.

### Constraints

- A student's section must match the section of any record attached to them.
  Enforce with a constraint or a trigger — **reject at write time**, do not
  discover later.

### Verification

1. Create two sections of one class with **different** subject lists. Show both.
2. Attach three teachers to one section-subject. Show all three returned.
3. End one teacher's assignment mid-year, start another. Show history preserved.
4. Attempt to attach homework to a section-subject in another institution — show
   it is rejected.
5. Show that chapters have stable IDs and **nothing downstream stores a topic
   name string** for tracking purposes.
6. Report the near-duplicate count among the 523 chapter names.
7. Show all 18 existing FKs still resolve, untouched.

**STOP. Wait for approval.**

---

# CHUNK 3 — PEOPLE

**`students`**
`id · institution_id · academic_year_id · admission_number · full_name ·
section_id · enrolment_date · exit_date · status · deleted_at · deleted_by`

- **`admission_number` is permanent** and never changes.
- **`roll_number` lives in `student_enrolments`, not here** — it is per year and
  may be reused.

**`student_enrolments`**
`id · institution_id · student_id · academic_year_id · section_id ·
roll_number · from_date · to_date`

- Unique `(section_id, academic_year_id, roll_number)`.
- **Section change mid-year: history moves with the student.** Close the current
  enrolment row, open a new one. Records already written keep pointing at the
  student, so past class averages recompute — this is accepted and known.

**`guardians`**
`id · institution_id · full_name · relation (mother/father) · phone · email`

**`student_guardians`** — `student_id · guardian_id · is_primary`

- Mother and father. A guardian may have several children in one school —
  **one membership, child picker.**
- **When a student exits, guardian access is removed immediately.**

**`teachers`**
`id · institution_id · full_name · phone · email · status · deleted_at ·
deleted_by`

**`student_remarks`**
`id · institution_id · student_id · teacher_id · body · created_at ·
edited_at · deleted_at`

- Written **only by teachers who teach that student.** Enforce in policy.
- **Parent sees it immediately** when written.
- Teacher may edit or delete their own at any time — **an edit sets `edited_at`
  and that marker is shown**, because the parent may already have read it.
- Principal sees remarks inside a student's drill-down. **No notification.**

### Verification

1. Create a mid-term joiner. Show `enrolment_date` set and no attendance expected
   before it.
2. Move a student between sections. Show two enrolment rows and no data loss.
3. Reuse a roll number in a different section — allowed. In the same section and
   year — rejected.
4. A guardian with two children: one membership, both children reachable.
5. Exit a student. Show guardian access removed immediately.
6. A teacher who does not teach a student attempts a remark — rejected by policy.
7. Edit a remark. Show `edited_at` populated and surfaced.

**STOP. Wait for approval.**

---

# CHUNK 3.5 — REMOVE LIBRARY AND STAFF ATTENDANCE

These features are on the forbidden list (§1) and were never part of this
product. `library_books`, `library_checkouts` and `staff_attendance` are live
with data, and the unapplied `20260823100000_drop_school_ops_unused` migration is
the last integrity-gate failure.

**Remove them completely. No trace should remain that these features existed.**

### Do

1. **Report first:** row counts in each table, and every file, type, route,
   component, RPC and policy that references them. Do not delete before that
   list is produced.
2. Export the three tables to a file and hand it over — cheap insurance, and the
   data is gone after this.
3. Apply the drop migration.
4. Remove **every** reference: code, generated types, routes, components, nav
   items, RPCs, policies, seed data, tests, and any leftover migration
   referencing them.
5. Search for the strings `library`, `checkout`, `staff_attendance` across the
   whole repo and report anything remaining.

### Verify

- [ ] The three tables no longer exist
- [ ] Zero references anywhere in the repo, including generated types
- [ ] No dead route or nav item
- [ ] Integrity gate back to zero failures from this cause
- [ ] Build clean, all tests pass

**STOP. Wait for approval.**

---

# CHUNK 4 — ATTENDANCE

**This chunk contains the single most important table in the system.**

**`attendance_submissions`**
`id · institution_id · academic_year_id · section_id · date · submitted_by ·
submitted_at · edited_by · edited_at`

**Unique on `(section_id, date)`.**

**The absence of a row here is what "not marked" means.** Do not infer marking
from the presence of per-student rows. That inference is the cause of `0.0%`
rendering as a red catastrophe, of headers reading `0 present · 0 absent · 77%`,
and of thresholds firing on classes with no data.

**`attendance_records`**
`id · institution_id · submission_id · student_id · status (present/absent)`

Present/absent only. No late, no half-day.

**`attendance_audit`** — EXISTING TABLE, do not create a second one
`id · submission_id · student_id · old_status · new_status · edited_by ·
edited_at`

### Rules

- **Class teacher marks**, once per day per section. **Teachers can never edit
  after submitting.**
- **Admin may mark on any day, and is the only role that may edit — with no time
  limit.** Admin picks a class and a date, any date, and edits.
- **There is no edit window and no lock table.** `attendance_locks` is deleted.
  Nobody closes a day early; nothing expires. This supersedes the earlier
  24-hour rule.
- **Principal may never mark or edit.** Enforce in policy, not the UI.
- **Nothing is ever final**, so there is **no provisional/final distinction.**
  Any edited day carries a visible marker; tapping it shows what changed, who
  changed it and when, from `attendance_audit`.
- **Unmarked today** → not marked; appears on the dashboard as needing attention.
  **Unmarked after the day has closed** → treated as a holiday and **excluded
  from the denominator.** Derived from the absence of a submission plus the date
  being past — no holidays table.
- Percentage is calculated across the **whole year**, from the institution's
  session start.

### Verification

1. A section with no submission returns `not_marked` — **not** `0%`.
2. A section with a submission and all absent returns `0%` — a genuine zero.
   Show these two are distinguishable.
3. School figure = present ÷ students in **sections that submitted**. Prove
   unmarked sections are excluded from the denominator, not counted absent.
4. Prove the school figure is **not** the mean of section percentages: build one
   section of 12 and one of 58 and show the weighting is by student.
5. Principal attempts to mark — rejected by policy.
6. Principal attempts to edit — rejected by policy.
7. Admin edits a day from **three months ago** — allowed, no window. Records old
   value, new value, who, when.
8. That day now carries an **edited marker**, and the detail resolves from
   `attendance_audit`.
9. A teacher attempts to edit their own submission — **rejected by policy.**
10. `attendance_locks` does not exist anywhere: no table, no view, no policy, no
    code reference.
11. A past date with no submission is excluded from the denominator as a holiday.
12. **Mid-term joiner — RESOLVED, see §10.27.** Attendance counts from
   `enrolment_date`, never from session start. Prove it: seed a joiner at day 20
   whose section submitted 42 days (22 after enrolment), present on 20. Must
   read **91%**, not 48%.
13. **No attendance flag fires before `MIN_ENROLLED_DAYS_FOR_FLAGS` (10) enrolled
    school days.** Seed a student enrolled 3 days with 1 absence — 67%, below
    threshold, and **must not be flagged.**
14. A leaver counts to `exit_date`, is **invisible on every live screen**, and
    **their record is retained** — deleted only through the ordinary year-end
    admin decision. Prove the record survives an exit and that no live query
    returns them.

**STOP. Wait for approval.**

---

# CHUNK 4.5 — CONVERGE `roll_number`

**A split-brain, the same shape as `user_roles`.**

`students.roll_number` is deprecated but still read by **26 files and 4 SQL
functions**. The authority is `student_enrolments.roll_number`, which is per
student **per academic year** — correct, because roll numbers change annually and
are reused.

While both exist, a roll number that changes at year rollover updates in one
place and goes stale in the other. **No error is raised.** Those 26 call sites
simply display last year's number, and nobody notices.

### Do

1. List all 26 files and 4 functions, with what each does with the value.
2. Point every one at `student_enrolments`, scoped to the current academic year.
3. **Drop `students.roll_number`.** Leaving it commented-deprecated is what
   allows a new call site to be written against it next month.
4. Report any call site that cannot be converged, and why.

### Verify

1. Grep for `students.roll_number` — **zero results**, including in generated
   types.
2. Change a student's roll number for a new academic year. Prove **every** screen
   shows the new one and none shows the old.
3. Prove the same student's *previous* year's roll number is still retrievable
   from history.
4. Roll number uniqueness still enforced per section per year.

**STOP. Wait for approval.**

---

# CHUNK 5 — HOMEWORK

**`homework`**
`id · institution_id · academic_year_id · section_subject_id · created_by ·
chapter_id (nullable) · topic_id (nullable) · description · assigned_date ·
**due_date** ·
submission_mode (none/digital/upload) · closes_at · deleted_at · deleted_by`

- **`due_date` is mandatory.** Without it the completion rate cannot be computed.
- **Always the whole section.** No per-student assignment.
- `submission_mode` is chosen by the teacher: `none` (notebook work, teacher
  ticks), `digital` (in-app answers), `upload` (photo/PDF).
- Digital mode is only permitted where the questions are structured. A photo
  worksheet cannot be answered in-app.
- **Submission locks at `due_date`.** No late submission.
- **The teacher may also close it early.** Closing — by due date or by the
  teacher — is what generates the report.
- Students who have not submitted at closure are **marked not completed.**
- **Closed is final. No reopening.**
- **Chapter is picked from a list filtered to the teacher's own subject and
  class**, never typed. Topic is picked per question from that chapter's existing
  topics, or added when nothing fits. See §10.22.
- Soft delete, 7 days.

**`homework_questions`** — for digital mode
`id · institution_id · homework_id · question_id · sequence`

**`homework_submissions`**
`id · institution_id · homework_id · student_id · submitted_at · file_url ·
text_body`

**`homework_answers`** — for digital MCQ homework only
`id · institution_id · homework_id · student_id · question_id · chapter_id ·
topic_id · answer · is_correct · time_taken_seconds`

**School data, not practice.** Visible to teacher, principal, the student, and
the parent for their own child. Never stored in a practice table.

**`homework_completions`**
`id · institution_id · homework_id · student_id ·
status (completed / not_completed / absent) ·
marked_by · marked_at · comment`

- **Three stored statuses, not four and not a boolean.**
- **`not_yet_due` is NOT a stored value.** It is the absence of a row, derived
  from `due_date` vs now. Storing it would violate G5 — same pattern as "no
  attendance submission means not marked, not 0%".
- `absent` must be reportable separately from `not_completed`.
- Teacher may leave a **comment**; the parent sees it.

### Auto-grading

**If a stored correct answer exists, grade automatically. Otherwise the teacher
grades manually.** One field decides it. The teacher may override any auto-grade.

### Completion rate

`completions ÷ students assigned`, across homework **whose due date has passed**,
within a rolling 7-day window of due dates.

**Homework not yet due is excluded from the calculation entirely** — it must
never read as `0%` and drag a class down for work nobody has failed to do.

### Verification

1. Homework due tomorrow: shows `not_yet_due`, is **excluded** from the rate.
2. Homework due yesterday: included.
3. A student absent on the due date: counted separately from not-completed.
4. Submission attempted after `due_date`: rejected.
5. Digital homework with an answer key: auto-graded on submission.
6. Without a key: stays unmarked until the teacher acts.
7. Teacher overrides an auto-grade; the override is recorded.
8. Delete homework; restorable for 7 days; gone after.

**STOP. Wait for approval.**

---

# CHUNK 6 — TESTS, EXAMS, REPORT CARDS

**`tests`**
`id · institution_id · academic_year_id · section_subject_id · created_by ·
topic (free text) · date · max_mark · status (draft/submitted) ·
submitted_at · deleted_at`

**`test_marks`**
`id · institution_id · test_id · student_id · **mark (NULLABLE)** ·
uploaded_at`

**`mark` is nullable. NULL means not marked. It is never zero, and it is excluded
from every average, highest, lowest and below-threshold count.**

**`exams`**
`id · institution_id · academic_year_id · section_id · created_by · name (free
text) · max_mark · pass_mark · previous_exam_id · created_at`

- **Created by the class teacher, for their own section only.**
- Name is free text. Max mark and pass mark are set by the creator and are the
  same across all subjects **within that exam**, but differ between exams.
- `previous_exam_id` enables movement between exams.

**`exam_subjects`**
`id · exam_id · section_subject_id · scheduled_at · uploaded_by · uploaded_at`

Subject-wise timetable, entered by the teacher, visible to students.

**`exam_marks`**
`id · institution_id · exam_subject_id · student_id · **mark (NULLABLE)**`

**Uploaded by the subject teacher for their own subject.**

### Marks entry

Whole class entered in a grid, **saved as draft**, reviewed, submitted once.
**After submission only admin may edit.** Enforce in policy.

### Thresholds

**Pass/fail is computed against that exam's own `pass_mark`. Never a literal 40.**
A 20-mark unit test cannot use a raw 40 threshold.

### Cross-section comparison

**All cross-section figures are percentages** — sections sit different papers
with different max marks. Raw marks appear only on the student's own screens.
Comparison is at **subject level**, not exam level.

**`report_cards`**
`id · institution_id · exam_id · student_id · generated_at · pdf_url`

- **Generated only when every subject in the exam has marks uploaded.** Never
  partial.
- Contains subject marks, total, and teacher remarks.
- **Sent to parents automatically, with no approval step.**
- Parents can download the PDF.

**Rank** is computed per exam, **within the student's own section only**, and is
**not stored** (G5). Sent to parents in the exam report. Never in the weekly
summary.

### Verification

1. A test with no marks uploaded: every figure `—`, **not** `0`.
2. A student with `NULL` mark: excluded from average, highest, lowest, below-pass.
   Show `2 students not marked` surfaced.
3. Pass threshold uses `exam.pass_mark`. Build a 20-mark exam with pass 8 and
   prove no literal 40 appears anywhere.
4. Two sections with different max marks: comparison returns percentages.
5. Teacher edits marks after submission — rejected. Admin edits — allowed and
   logged.
6. Report card with one subject missing — **not** generated.
7. All subjects uploaded — generated and sent.
8. Rank computed within section only; prove no cross-section rank exists.

**STOP. Wait for approval.**

---

# CHUNK 6.5 — CONVERGE `exam_group_id`

**G9 again. Two things express "one event, several subjects" at different
grains.**

**Authority: `exams` + `exam_subjects`.** §10.22 defines an exam as one sitting
created by the class teacher, with one max mark and pass mark across its
subjects and a subject-wise timetable. That is exactly this shape.

`exams.exam_group_id` is the earlier half-built version of the same idea.

**Handle it carefully.** It was dropped once inside another chunk with no written
rationale, and the failure was silent: every `if (exam.examGroupId)` became
false, so finalising one subject stopped finalising its group and **nothing
threw.** It is read by `createClassExamGroup`, the admin Examinations screen, the
teacher live panel, and three `marksService` paths.

### Do

1. List every read and write of `exam_group_id`, with what each does.
2. Repoint each to resolve the sitting through `exam_subjects`.
3. **Drop the column.** Not deprecated, not commented.
4. Report any path that cannot converge, and why.

### Verify

1. `exam_group_id` appears nowhere — schema, functions, client, generated types.
2. **Finalising one subject finalises its sitting**, through `exam_subjects`.
   Assert the behaviour, not the absence of an error — that is how it broke
   silently last time.
3. A multi-subject sitting holds one mark per student **per subject**.
4. Existing exams keep their groupings; no marks moved.

**STOP. Wait for approval.**

---

# CHUNK 6.6 — RESTRUCTURE `can_read_mark`

**Not deferrable. The demo data is what makes it look deferrable.**

`marks` as a parent costs **24.61 ms per candidate row**. Candidates scale with
**total marks in the school**, not with the rows the parent can see.

| Marks in school | Cost | Result |
|---|---|---|
| 26 (demo today) | 0.6 s | fine |
| 200 | 4.9 s | under the 8 s timeout |
| **2,500** (210 students × 6 subjects × 2 exams) | **~60 s** | **HTTP 500** |

A real school is past the timeout on a parent's first login. This is the identical
failure the parent panel already had — found in production then, found before it
now.

**Root cause:** `can_read_mark` takes two per-row arguments, so Postgres
re-invokes the entire function per row. Contrast `active_membership_role()` at
0.06 ms, which takes no argument and is cached per statement.

### Do

1. Restructure so the expensive resolution happens **once per statement**, not
   once per row — argument-free cached helpers, or a set-based pre-resolution the
   policy joins against.
2. Keep role dispatch first (G12).
3. **Re-state every guarantee any `SECURITY DEFINER` helper bypasses** — active
   role, active local person, institution — and assert them.
4. Preserve the super-admin arm explicitly. A super admin acting in a granted
   institution has no membership row, so dispatching on
   `active_membership_role()` alone silently revokes them.

### Verify

1. Seed **2,500+ marks** and measure as parent, student, teacher, principal,
   admin. **No path may exceed 2 s.**
2. Per-candidate cost reported for each role, and what it becomes at 10,000 rows.
3. Every isolation guarantee still holds — re-run the leak survey and the
   cross-role checks. **A performance fix that opens a hole is a worse bug.**
4. Super admin can still read and upload in a granted institution.

**STOP. Wait for approval.**

---

# CHUNK 6.7 — REWRITE THE TENANT FENCES

**The systemic finding. One of these is a live 500 today.**

Chunk 6.6 fixed `marks` and found the same per-row shape in **234 policies
across 104 tables**. Measured, not projected:

| Table | Cost as parent | Status |
|---|---|---|
| `academic_events` (4,335 rows) | **75 s** | **Live 500 right now** |
| `attendance` | 4.7 s | Over half the 8 s budget |
| `notifications` | 4.1 s | Over half the budget |

**Root cause:** the RESTRICTIVE tenant fence calls `same_school(school_id)` per
row at 2.73 ms. Multiplied by candidates, it dominates everything.

**Proven not to work — do not retry it.** Rewriting `same_school()` as a
non-SECDEF wrapper to get it inlined fixes nothing: Postgres will not inline a
SQL function whose body contains a subquery. Measured at 8.0 s → **16.2 s**,
worse. Tested inside a rolled-back transaction; production never saw it.

**What did work in 6.6:** set-returning helpers behind `IN (SELECT …)` so the
policy stops calling a per-row function, plus rewriting the fence itself.
50.1 s → 26.5 ms.

### This is a change to the isolation boundary. Treat it as one.

Not a performance chunk that happens to touch policies. **A performance fix that
opens a hole is worse than the latency it removed.**

### Do

1. **Report first.** All 234 policies, all 104 tables, grouped by shape. Which
   can share one rewritten fence, which are genuinely different.
2. Rewrite in batches by shape, not all at once.
3. **After each batch:** full leak survey, cross-role checks, and the
   normal-access counter-check — tightening can over-fence as easily as
   under-fence.
4. Order by measured cost. `academic_events` first: it is broken now.

### Verify

1. **Set equality, not counts**, per role per table. Counts pass if two
   children's records are swapped.
2. **Negative control on each batch** — open a policy, confirm the check catches
   it, close it.
3. Every path under 2 s at fixture volume, with the projection to 10,000 rows.
4. Leak survey 0. Normal access byte-identical.
5. Super-admin arm preserved — an account acting in a granted institution has no
   membership row, so role dispatch alone silently revokes it.

**STOP after each batch. This is the isolation layer.**

---

# CHUNK 7 — SPLIT INTO 7A, 7B, 7C

**As originally written this chunk is three things: a question bank, a privacy
surface, and an entire learning engine. Build them separately.**

Read `docs/rls-policy-pattern.md` before writing any policy in any of them.

| | Scope | Why separate |
|---|---|---|
| **7A** | Question bank, `topics`, chapter keying, tags and the board/class filter | Content only. No student data, no privacy surface. |
| **7B** | Practice tables, privacy enforcement, XP, leaderboards | **The highest-risk privacy work in the project.** |
| **7C** | Recovery, revision, analysis — `recovery-revision-analysis-spec.md` | A product, not a chunk. Depends on AI generation. |

**7B deserves the most caution of any chunk so far.** Chunk 1.6 removed practice
leaks from tables that already existed; 7B *creates* the tables those leaks were
in. Every privacy rule in §10.8 lands here, and the Nova finding proved that
policy-level auditing alone does not see edge functions or service-role paths.

**7C should not start until 7B's privacy verification passes**, and its AI
generation needs its own decisions — cost per session, cache hit rate, what
happens when generation fails mid-session. Those are not schema questions.

---

# CHUNK 7A — QUESTION BANK AND CURRICULUM

### Question bank — global, shared across all schools

**`questions`**
`id · chapter_id · topic_label (free text, unmapped) · board_id ·
curriculum_class_id · difficulty · type · body · options ·
correct_answer (NULLABLE) · status (active/retired) ·
replaced_by_question_id · source_question_id (NULLABLE) ·
variant_tier (NULLABLE, 1 or 2) · created_at`

**`source_question_id` and `variant_tier`** exist because recovery generates
variants of a student's own wrong questions (see
`recovery-revision-analysis-spec.md` §4.2a). A variant is an ordinary bank
question that records what it was derived from.

**No `topic_id`.** Chapter is the stable unit (§10.10). `topic_label` is the
legacy free-text string, kept for display, **never used for grouping,
triggering or trends.**

- **Shared across every school.** No `institution_id`.
- Tagged by **board · class · subject · chapter · topic · difficulty · type**.
  Filtering by these tags is what prevents a Class 5 student receiving
  out-of-class or wrong-board content. **Enforce the filter in the query layer,
  not the UI.**
- `correct_answer` present → auto-gradable. Absent → manual.

**`question_reports`**
`id · question_id · reported_by_account_id · reason · body · created_at`

- One persistent report control in the practice UI captures the question on
  screen.
- Goes to **the AI and super admin. Never to the school** — practice stays
  private.
- **The AI rewrites automatically. A rewrite creates a NEW question and retires
  the old one — never overwrites in place.** A retired question may sit in a
  student's mistake book; replacing its content would serve them something they
  never got wrong.

### Verification — 7A

1. A Class 5 CBSE student cannot be served a Class 8 or ICSE question **through
   any path**: client query, RPC, edge function, or service-role call.
   **Enumerate every reader of the bank and prove each one filters.** Found live
   in this chunk: `rpc_dpp_pick_from_bank` had no board or class filter at all,
   and `rpc_generate_battle` passed whenever either side was NULL — a Class 5
   student could draw Class 12 questions. `SECURITY DEFINER` means the policy
   never runs.
2. A retired question is never served, and is still readable where it already
   sits in a mistake book.
3. An active question cannot exist without `chapter_id` and `class_level` —
   structural, so the next import cannot reintroduce the gap.
4. `INSERT … RETURNING` works from the client. PostgreSQL evaluates SELECT
   policies on the new row, and supabase-js chains `.select()` onto `.insert()`,
   so a table with no read arm fails 42501 from the UI while passing every policy
   test that avoids RETURNING.
5. `topics` exists and is **empty**. It is grown only by teachers picking or
   adding (§10.22). Seeding it from the 11,917 legacy strings is what §10.10
   forbids.
6. The board filter is built but **cannot be exercised** — the bank holds one
   board. Report this as unverified rather than passing it silently. Seeding a
   few dozen questions under a second board would make it testable.

**STOP. Wait for approval.**

---

# CHUNK 7B — PRACTICE TABLES AND PRIVACY

**The highest-risk chunk in the project.**

Chunk 1.6 removed practice leaks from tables that already existed. **7B creates
the tables those leaks were in.** Every privacy rule in §10.8 lands here.

Read `docs/rls-policy-pattern.md` before writing any policy.

### Tables

**`practice_sessions`**
`id · institution_id · student_id · mode · started_at · ended_at ·
attempted_count · correct_count`

**Session totals only. No per-question record of correct answers.**

**`practice_mistakes`** — the mistake book
`id · institution_id · student_id · question_id · chapter_id ·
first_wrong_at · times_wrong · last_attempted_at ·
status (open/cleared) · cleared_at`

**`practice_skipped`**, **`practice_bookmarks`**
`id · institution_id · student_id · question_id · created_at`

Bookmarks also cover homework and resources.

**`practice_xp`**
`id · institution_id · student_id · question_id · points · earned_at`

**`chapter_tally`** — required by 7C, created here
`id · institution_id · student_id · chapter_id · session_id · attempted ·
correct · created_at`

One row per chapter per session, never per question.

### The governing storage rule

**Only what went wrong is stored per question — wrong, skipped, bookmarked.
Never a per-question record of correct answers. Strong areas are never surfaced
anywhere in the app.**

### Separation — structural, not a flag

Test and homework answers are **school data**; practice answers are **private**.
Separate tables, source built into the structure. `homework_answers` and
`test_answers` live in Chunks 5 and 6. **Nothing in 7B holds a mark from a
teacher-set assessment.**

### Privacy — the part that must not be got wrong

**Practice is readable by the student and nobody else.** Not teacher, parent,
principal, admin, or any aggregate.

**Exception, deliberate:** XP feeds the section leaderboard. Effort is public;
the content of mistakes is not. Public: XP, level, league, streak, homework
completion. Private: session counts, practice rate, mistakes, skipped,
bookmarks, everything per question.

### Verification — policies are not enough

**Policy-level auditing does not see `SECURITY DEFINER` bodies, edge functions,
or service-role calls.** Nova served a child's mistake book to their parent
through exactly that gap, with correct policies. `rpc_dpp_pick_from_bank` did the
same in 7A.

1. **Enumerate every edge function and every service-role call site**, and for
   each state what practice data it can reach and who can invoke it.
   `supabase/functions/_shared/aiRouter.ts` reads the bank today and is the
   highest-risk shape. **Do this in 7B, not Chunk 11.**
2. Teacher, parent, principal, admin sessions each return **zero rows** from
   every practice table.
3. A student returns their own rows only — **set equality against ground truth,
   not counts.**
4. **Negative control:** open one policy, confirm the checks catch it, close it.
5. No RPC, view, function or edge path exposes practice data to another role.
6. XP remains readable for the leaderboard while mistakes stay private.
7. No table stores which questions a student answered correctly.
8. Timing per role at fixture volume, projected to 10,000 rows.

**STOP. Wait for approval.**

---

# CHUNK 7C — RECOVERY, REVISION, ANALYSIS

**A product, not a chunk.** Do not start until 7B's privacy verification passes.

**`recovery-revision-analysis-spec.md` is the source of truth.** Read it in full.
Do not infer any rule not in it; every constant lives in its §10.

### Tables

**`chapter_state`** — one row per student per chapter
`student_id · chapter_id · state · recovered_at · next_revision_at ·
revision_stage · consecutive_revision_passes · last_recovery_readiness`

States: `untouched · has_mistakes · in_recovery · recovered · revision_due ·
revision_failed`

**`recovery_sessions`**
`id · student_id · chapter_id · started_at · completed_at ·
tier0_correct · tier0_total · tier1_correct · tier1_total ·
tier2_correct · tier2_total · tier3_correct · tier3_total ·
procedural_rate · conceptual_rate · readiness · outcome`

**Per-tier counts, never one total.** The diagnostic value is entirely in the
split — procedural passing while conceptual fails is the most common real result.

**`revision_sessions`**
`id · student_id · chapter_id · stage · correct · total · passed ·
started_at · completed_at · triggered_by (recovery/engagement)`

### Decisions still needed before building the AI path

These are **not schema questions** and must be answered first:

- Cost per generated session, and the acceptable ceiling
- Expected cache hit rate, and what happens when it is lower
- **What happens when generation fails mid-session** — the spec says a variant
  that cannot be generated is skipped, not faked, and the session runs short and
  says so. Confirm that is still the answer.

### Verification

1. `chapter_tally` writes one row per chapter per session — a session spanning
   three chapters writes exactly three rows.
2. Recovery stores four separate tier results, not a single score.
3. A generated variant is saved with `source_question_id` and `variant_tier`, and
   **is servable to other students.**
4. **Bank checked before generating** — run recovery twice on the same wrong
   question and show the second used cache.
5. Revision clock starts on **engagement**, not only after recovery: a session of
   10+ questions with no mistakes still sets `next_revision_at`.
6. Re-engaging resets the clock.
7. No constant from spec §10 appears as a literal in any component.
8. Every 7B privacy guarantee still holds — re-run its full verification.

**STOP. Wait for approval.**

---

# CHUNK 8 — COMMUNICATION, REQUESTS, NOTIFICATIONS

**`messages`** / **`message_threads`**
Participants per role rules:

| Role | May message |
|---|---|
| Student | Teachers who teach them · class teacher · principal · students of their own class |
| Parent | Teachers who teach their child · class teacher · principal |
| Teacher | Parents directly · students they teach |
| Principal | Students, parents, teachers |

**`message_reports`** — student-to-student messages are private but reportable.
**Reviewed by the class teacher only.** Not principal, not super admin.

**`announcements`** — created by the principal and by teachers for their own
sections. Two-way; replies threaded.

**`leave_requests`**
`id · institution_id · subject_type (student/teacher) · subject_id ·
raised_by · start_date · end_date · reason · created_at`

**`leave_decisions`**
`id · leave_request_id · decided_by · role · decision · reason · decided_at`

- **Teacher leave** → principal decides.
- **Student leave** (raised by student or parent) → goes to **both the class
  teacher and the principal.** Either may act. Resolved by whoever responds
  first; the second may still comment.
- **Both decisions are stored and displayed as they are** — "Approved by class
  teacher · Rejected by principal". **No single combined verdict is computed.**

**`complaints`**
`id · institution_id · raised_by_guardian_id · body · status · resolved_by ·
resolved_at`

- **Only parents may raise a complaint.** Teachers may not.
- Goes to the **principal**, who resolves it.
- Not anonymous. Parent sees the **outcome only**.

**`inquiries`**
`id · institution_id · raised_by · body · answer · answered_by · answered_at`

- Raised by **existing parents and teachers**.
- **Both admin and principal see it.**
- **One question, one answer. Not a thread.**

**`notifications`** and **`notification_preferences`**

| Recipient | Notified of |
|---|---|
| Student | Homework · marks published · leave decision · announcements · pending recovery/revision · **daily practice reminder** |
| Parent | Marks · test results · exam results · homework published · **absence, same day on submission** · **attendance correction** · remarks written · report card ready · weak-concept alerts · **weekly AI summary** |
| Teacher | Leave decision · messages · announcements |
| Principal | Attendance not marked · new complaints and inquiries · marks overdue · leave requests. **No remark notifications.** |

- **Reminders can be switched off. Marks, homework and leave decisions cannot.**
  A student who cannot silence a daily nudge will mute the app at OS level and
  lose the important notifications too.
- **Weak-concept alerts derive from tests and exams only. Never from practice.**
- The **weekly AI summary** contains school data only — homework, marks,
  attendance. **No practice data.** Sends automatically, no human check.
  **The AI writes prose around figures produced by the metric layer. It must not
  compute figures itself.**

### Verification

1. Each role's messaging permissions enforced in policy. Attempt one violation
   per role and show rejection.
2. A student messages a student in another section — rejected.
3. Report a student message: reaches the class teacher only. Prove principal and
   super admin cannot see it.
4. Student leave with two conflicting decisions: both stored, both displayed, no
   combined verdict computed.
5. Teacher attempts to raise a complaint — rejected.
6. Absence alert fires on submission; correction fires on edit.
7. Reminder preference off: reminder suppressed, marks notification still sent.
8. Weekly summary payload contains **no** practice data. Show the query.

**STOP. Wait for approval.**

---

# CHUNK 9 — RESOURCES, TRASH, AUDIT, YEAR-END

**`resources`**
`id · institution_id · uploaded_by_teacher_id · title · file_url ·
type (pdf/image) · target_class_id · target_section_id · created_at`

- **Uploaded by teachers only** — not admin, not principal.
- **PDF and image only.**
- Targeted at a class or a section, **restricted to sections the teacher teaches.**
- **No view tracking of any kind.** No opens, no counts. Do not create the table.
- **Hard delete by the uploader. No trash.**

**`trash`** — soft-delete registry
`entity_type · entity_id · deleted_at · deleted_by · restore_before`

Retention per G6. A scheduled job purges after expiry.

**`audit_log`**
`id · institution_id · actor_membership_id · action · entity_type · entity_id ·
old_value · new_value · created_at`

- Logs **every admin action**, especially attendance edits, mark edits, account
  creation, deletions and restores.
- **Visible to admin only.** Not principal, not super admin.

**Year-end**
Super admin notifies the school admin → admin exports everything → admin deletes.
**Admin may delete records as well as practice data.** Super admin is informed on
completion. Practice data is the bulk of the volume.

### Verification

1. Teacher uploads to a section they do not teach — rejected.
2. Resource deleted — gone immediately, not in trash, not restorable.
3. No view-tracking table exists anywhere.
4. Delete a test → in trash → restore → delete → purge after 7 days.
5. Delete a student → in trash 30 days → restore works.
6. Principal attempts to read `audit_log` — rejected.
7. Year-end export produces a complete archive; deletion removes what was chosen.

**STOP. Wait for approval.**

---

# CHUNK 10 — THE METRIC LAYER

**The single highest-value chunk. Almost every bug so far traces to the same
metric being computed in more than one place.**

### Rules

- **One function per metric.** In the data layer. Nowhere else.
- **Components render. They never calculate.**
- Every function returns **value plus state**:
  `{ value, state: 'ok' | 'no_data' | 'not_marked', basis }`
  where `basis` states what the figure was computed from, e.g.
  `"5 of 6 subjects"`.
- **No component may contain a threshold literal.** Import from one module.

### Thresholds module — one file, imported everywhere

```
ATTENDANCE_LOW          = 80        // percent
CONSECUTIVE_ABSENCE     = 3         // days running
CHRONIC_ABSENCE         = 80        // percent across the year
HOMEWORK_LOW            = 60        // percent
MARKS_LOW               = exam.pass_mark    // never a literal
MARKS_OVERDUE           = 7         // days after the exam
CLASS_FLAGGED_ON_MARKS  = 25        // percent of students below pass
HOMEWORK_WINDOW         = 7         // rolling days of due dates
REPORTING_WINDOW        = session_start_date → today
```

### Functions to build

Attendance: student · section · school-today · trend · consecutive runs ·
chronic list · day-of-week · absence concentration
Homework: section rate · student rate · by subject · missed-while-absent
Marks: test average · exam average · subject average · distribution bands ·
below-pass count · movement between exams · rank within section
Activity: homework assigned · tests conducted · marks pending · attendance
marking record
Comparison: sibling section values for every figure above

### Hard requirements

- **School attendance = present ÷ students in sections that submitted.** Never
  the mean of section percentages.
- **Unmarked sections excluded from the denominator**, never counted absent.
- **Homework counts only past-due work.**
- **Cross-section figures are percentages.**
- **No threshold fires where record count or student count is zero.**
- **No function stores its result.**

### Verification

Build golden-number tests: fixed seed, known expected values, one test per
function. Then prove:

1. Every metric is computed in **exactly one** place. Grep and show the count.
2. No component contains a threshold literal. Grep for `80`, `60`, `40`, `7`,
   `25` in component code and show zero results.
3. Every function returns a state, and `no_data` is distinguishable from a zero
   value.
4. Changing a threshold in one file changes every screen.

**STOP. Wait for approval.**

---

# CHUNK 11 — VERIFICATION SWEEPS

Three automated sweeps. **They must fail before the fixes and pass after.**
Do not hand-test 210 students.

**Sweep 1 — Golden numbers.** Fixed seed, known expected values, one test per
metric. Any drift fails.

**Sweep 2 — Null sweep.** Crawl every screen and API response. **Fail on `0`,
`0%`, `NaN`, `null`, `undefined`, `N/A` anywhere a record is absent.**

**Sweep 3 — Fresh environment.** Drop everything, replay every migration from
zero, run the seed, and bring the app up. **This is the only proof that the
schema is reproducible.** A migration that only works against the current
database is not a migration; it is a one-off edit that happens to be in a file.

**Sweep 5 — Escape hatches and stale claims.**

**Type escapes.** Found live: `supabase as unknown as { from: ... }` in
`OperationalCases.tsx`. `ReturnType` on the overloaded `.from` collapses to a
union of every table, so every query through it typed as "all rows at once" — the
type system was silently switched off for that path and a schema change was the
only thing that surfaced it.

- Enumerate every `as unknown as`, `as any`, `@ts-ignore` and
  `@ts-expect-error` in the repo.
- For each: what is it hiding, and can it be removed rather than widened.
- **Removing beats widening.** A widened cast still defeats the checker.

**Views and definers.** Every view and every `SECURITY DEFINER` function:
confirm `security_invoker = true` on views, and that definers fence themselves.
A view without it inherits its owner's rights and becomes a hole around every
policy on its base tables.

**Stale claims in user-facing copy.** Found live: the landing page shows a
"1 Leave" counter for a status the product no longer has. Sweep marketing copy,
empty states, placeholder data, help text and the roadmap for anything naming a
feature that does not exist. A school evaluating the product reads these as
promises.

**Sweep 6 — Isolation sweep.** For every table and every role:
- Attempt cross-institution read → must fail
- Attempt cross-role read → must fail
- Attempt to read another student's practice → must fail
- Attempt to read another child's data as a parent → must fail
- Attempt every write each role is forbidden → must fail

**Sweep 3 is the one that protects children's data. It must be exhaustive.**

### CRITICAL — RLS is not the whole fence

**Row Level Security applies to `authenticated` and `anon`. It does not apply to
`service_role`, to `SECURITY DEFINER` functions, or to anything running with
`rolbypassrls`.**

A real breach found exactly this way: the AI chat edge function assembled its
facts bundle using the service role, so RLS never ran, and a child's practice
mistake book was served to their parent and teacher — through a door that
policy-level auditing cannot see. Policies were correct. The data still leaked.

**Every isolation and privacy check must therefore cover all four paths:**

| Path | Fenced by | Must be checked |
|---|---|---|
| Client via `authenticated` | RLS | Policy tests |
| `SECURITY DEFINER` function | **Itself only** | Read the body; confirm it fences |
| **Edge function / service role** | **Nothing** | **Read every one. RLS will not save you.** |
| Any `rolbypassrls` role | Nothing | Enumerate and justify each |

**Enumerate every edge function and every service-role call site, and for each
state what data it can reach and who can invoke it.** An edge function that
assembles data for an AI prompt is the highest-risk shape there is: it reads
broadly by design, and its output goes to whoever asked.

**A privacy rule verified only at the policy layer is not verified.**

### Final report

- Every chunk's verification output
- Every assumption made, with the decision it rests on
- Every open decision encountered and not invented
- Every place the existing code had to change
- Confirmation that nothing outside `locked-decisions.md` was invented

**STOP.**

---

# WHAT IS NOT IN THIS BUILD

Do not implement, do not scaffold, do not guess:

- **Recovery, revision and analysis logic** — parked, undecided
- **Topic tally** — parked
- **XP formula** — points per correct answer and difficulty weighting undecided
- **Mid-term joiner attendance denominator** — undecided; surface, do not invent
- **Any AI feature beyond the tables** — question generation, rewrites and the
  weekly summary are specified as data flows only

If a chunk requires one of these to proceed, **stop and ask.**
