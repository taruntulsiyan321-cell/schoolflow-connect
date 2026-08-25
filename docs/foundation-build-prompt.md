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
**`topics`** — `id · chapter_id · name · sequence`

**Topics must have stable IDs.** Everything downstream — questions, the mistake
book, analysis — keys on `topic_id`, never on a topic name string. Free-text
topics would fragment every trend.

Maintained by super admin.

### Institution structure

**`classes`** — `id · institution_id · academic_year_id · curriculum_class_id ·
label`

**`sections`** — `id · institution_id · class_id · label (A/B/C) ·
class_teacher_id`

**`section_subjects`** — **the canonical identity for all teaching**
`id · institution_id · section_id · curriculum_subject_id`

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
5. Show that `topics` have stable IDs and nothing downstream stores a topic name.

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

**`attendance_edits`**
`id · submission_id · student_id · old_status · new_status · edited_by ·
edited_at`

### Rules

- **Class teacher marks**, once per day per section.
- **Admin may mark on any day, and is the only role that may edit.**
- **Principal may never mark or edit.** Enforce in policy, not the UI.
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
7. Admin edits; `attendance_edits` records old value, new value, who, when.
8. A past date with no submission is excluded from the denominator as a holiday.
9. A mid-term joiner has no attendance expected before `enrolment_date`.
   **Do not invent a denominator rule for them — surface the fact and report it
   as an open decision.**

**STOP. Wait for approval.**

---

# CHUNK 5 — HOMEWORK

**`homework`**
`id · institution_id · academic_year_id · section_subject_id · created_by ·
topic (free text) · description · assigned_date · **due_date** ·
submission_mode (none/digital/upload) · closes_at · deleted_at · deleted_by`

- **`due_date` is mandatory.** Without it the completion rate cannot be computed.
- **Always the whole section.** No per-student assignment.
- `submission_mode` is chosen by the teacher: `none` (notebook work, teacher
  ticks), `digital` (in-app answers), `upload` (photo/PDF).
- Digital mode is only permitted where the questions are structured. A photo
  worksheet cannot be answered in-app.
- **Submission locks at `due_date`.** No late submission.
- Soft delete, 7 days.

**`homework_questions`** — for digital mode
`id · homework_id · question_id · sequence`

**`homework_submissions`**
`id · institution_id · homework_id · student_id · submitted_at · file_url ·
text_body`

**`homework_completions`**
`id · institution_id · homework_id · student_id ·
status (completed / not_completed / not_yet_due / absent) ·
marked_by · marked_at · comment`

- **Four statuses, not a boolean.** `absent` is derived by joining attendance on
  the due date, and must be reportable separately from `not_completed`.
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

# CHUNK 7 — QUESTION BANK AND PRACTICE

### Question bank — global, shared across all schools

**`questions`**
`id · topic_id · board_id · curriculum_class_id · difficulty · type ·
body · options · correct_answer (NULLABLE) · status (active/retired) ·
replaced_by_question_id · created_at`

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

### Practice — institution-scoped, student-private

**`practice_sessions`**
`id · institution_id · student_id · mode · started_at · ended_at ·
attempted_count · correct_count`

**Session totals only. There is no per-question record of correct answers.**

**`practice_mistakes`** — the mistake book
`id · institution_id · student_id · question_id · topic_id ·
first_wrong_at · times_wrong · last_attempted_at ·
status (open/cleared) · cleared_at`

**`practice_skipped`**, **`practice_bookmarks`**
`id · institution_id · student_id · question_id · created_at`

Bookmarks also cover homework and resources.

**`practice_xp`**
`id · institution_id · student_id · question_id · points · earned_at`

### The governing storage rule

**Only what went wrong is stored per question — wrong, skipped, bookmarked.
Never a per-question record of correct answers. Strong areas are never surfaced
anywhere in the app.**

### Privacy — enforce in policy, not the UI

**Practice is readable by the student and nobody else.** Not teacher, not parent,
not principal, not admin, not in any aggregate.

**Exception, deliberate:** XP feeds the section leaderboard. Effort is public;
the content of mistakes is not.

### Not in this chunk

**Recovery, revision and analysis logic is NOT DECIDED. Do not implement it. Do
not invent triggers, intervals, session sizes, or clearing rules.** Create the
tables above and stop. A `PARKED` marker in `locked-decisions.md` covers this.

Likewise the **topic tally** is parked. Do not create it.

### Verification

1. A teacher attempts to read a student's practice data — rejected by policy.
2. A parent attempts the same — rejected.
3. A principal attempts the same — rejected.
4. Confirm **no** table stores which questions a student answered correctly.
5. A Class 5 CBSE student cannot be served a Class 8 or ICSE question. Prove the
   filter is in the query.
6. Report a question; a new question is created and the old one retired; the
   mistake-book row still points at the original.
7. XP is readable for the leaderboard while mistakes remain private.

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

**Sweep 3 — Isolation sweep.** For every table and every role:
- Attempt cross-institution read → must fail
- Attempt cross-role read → must fail
- Attempt to read another student's practice → must fail
- Attempt to read another child's data as a parent → must fail
- Attempt every write each role is forbidden → must fail

**Sweep 3 is the one that protects children's data. It must be exhaustive.**

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
