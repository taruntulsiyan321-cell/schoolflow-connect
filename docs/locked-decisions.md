# Locked Decisions — Gurukul

Every decision settled so far. Nothing here is a suggestion; treat it as fixed
unless explicitly changed later. Where something is still open it is marked
`OPEN`.

---

## 1. Tenancy

- Multi-institution. One Supabase project.
- **Row Level Security on `institution_id`, present on every single table.**
  Policies enforced by Postgres, not application code.
- Designed so any single school can be lifted into its own project later if a
  customer demands physical separation.
- **Super admin** exists, above all schools. See 10.20 — has unrestricted
  academic access for support, logged and notified to the school.
- School stops using the app: **same mechanism as suspension — see §10.20.**
  All users locked out immediately; data kept intact and reactivatable for 30
  days, then deleted.

## 2. Identity and login

- **Identifiers belong to an account.** An account may hold a phone, an email, or
  both. Registering an identifier already on an account attaches to that account
  rather than creating a new one.
- Login by **phone + OTP** and **email + OTP**.
- **Membership** = person + institution + role + local record + status.
  An account may hold any number of memberships.
- Every combination is supported and none is special-cased: same role at two
  schools, different roles at two schools, two roles at the same school.
- **One active membership per session. Never two.** Switching replaces the active
  membership; the database only ever sees one institution and one role.
- **Each membership points to a separate local record.** Teacher #44 and
  guardian #912 may be the same human; the records are never merged.
- **Invitation model.** Admin enters an identifier → creates a **pending**
  membership → nothing is visible until the person accepts.
  Options presented: Accept · Decline · This isn't me.
- Declined invitation: notify the admin, invite expires. This is the protection
  against a mistyped phone number belonging to someone at another school.
- **Panel picker** appears only when an account holds more than one membership.
  One membership goes straight in. Last choice remembered; switcher in the menu.
- Notifications and badges show the **active role only**. Never blended.
- **Manual linking** as a safety net: log in with one identifier, add the other,
  verify by OTP, accounts merge. Needed only when no identifier overlaps.
- Auto-linking by name is forbidden — two people named the same would merge.
- Parent with several children at one school: **one membership, child picker.**
- Student leaves the school: parent access removed **immediately**.

## 3. Academic year

- **No terms.** Reporting is whole-year.
- Session start and end dates are **per-school settings**, never hardcoded —
  they vary school to school.
- `academic_year` on every record, from day one, even though only one year of
  data exists now.

## 4. Students

- **Admission number** — permanent, never changes.
- **Roll number** — per academic year, may be reused.
- Enrolment date and exit date stored.
- Section change mid-year: **history moves with the student.**
  Known consequence: past class averages change retroactively.
- Students have their own login.
- Parents: mother and father.

## 5. Attendance

- **Present / absent only.** No late, no half-day.
- Marked **once per day per section** by the class teacher.
- **Admin can mark and edit across all classes.**
- **No edit window. CHANGED — this supersedes the earlier 24-hour rule.**
  Once the class teacher submits, **teachers can never edit.** The **admin can
  edit any date at any time**: pick the class, pick the date, edit.
- **`attendance_locks` is deleted.** There is no lock table and no lock action.
  Nobody closes a day early; nothing expires. One rule: teacher submits, only
  admin edits, forever.
  Rationale: an explicit lock row and a computed window were two things both
  answering "is this editable" — G9's shape. The simpler rule needs neither.

**Consequence, accepted:** nothing is ever final, so a figure the principal saw
in August can differ in March.
- **The dashboard's provisional/final distinction is removed.** The trend line
  shows all days, not only "final" ones.
- **Any edited day carries a visible marker.** Tapping it shows what changed, who
  changed it and when — `attendance_audit` already records this.
- Without that marker a number would move with no explanation, which is what
  destroys trust in the figure.
- **A submission record is written separately** from the per-student rows:
  section, date, submitted-by, submitted-at. Unique on (section, date).
  Absence of this row is what "not marked" means.
- **Unmarked today** → shows as not marked, appears on the dashboard.
  **Unmarked after the day closes** → treated as a holiday, excluded from the
  denominator.
- Percentage calculated over the **whole year**.
- School attendance = present ÷ students in sections that submitted.
  Never the mean of section percentages. Unmarked sections excluded.

## 6. Homework

- Always assigned to the **whole section**. Never to selected students.
- Both **assigned date** and **due date** stored.
- **Only past-due homework counts** toward any completion rate.
- **Three stored statuses: `completed` · `not_completed` · `absent`.**
  **`not_yet_due` is NOT stored** — it is the state when no completions row
  exists, derived from `due_date` vs now. Storing it would violate G5, and it is
  the same pattern as "no attendance submission means not marked, not 0%".
- Missed-while-absent always shown separately from not-completed.
- Completion rate = completions ÷ students assigned, rolling 7 days of due dates.

## 7. Tests and exams

- **Maximum mark and pass mark are stored per exam**, the same across all
  subjects within that exam, but different between exams.
- Below-threshold is computed against **that exam's own pass mark**, never a
  fixed 40. A 20-mark unit test cannot use a raw 40 threshold.
- A null mark means **not marked**. It is never zero, is excluded from averages,
  highest, lowest and below-threshold counts.
- Exams link to the previous exam so movement is computable.
- **Deletion goes to trash for 7 days**, restorable by admin, then permanent.

## 8. Subjects and teachers

- **Subjects attach to the section**, not the class — sections can differ.
- **Multiple teachers per section-subject** are allowed.
- All teacher names shown; the principal picks who to message.
- Homework and tests are credited to **whoever created them**.
- Teacher assignment for a section-subject can change mid-year.

## 9. Thresholds — one module, never hardcoded

```
ATTENDANCE_LOW          = 80    // percent
CONSECUTIVE_ABSENCE     = 3     // days running
HOMEWORK_LOW            = 60    // percent
MARKS_LOW               = exams.passing_marks  // never a literal.
                                    // NULL on 5 of 18 exams → no_data, no flag.
// CHRONIC_ABSENCE removed: it duplicated ATTENDANCE_LOW over the same window.
REPORTING_WINDOW        = academic_years (is_current) — authoritative.
                                    // schools.session_start_date converges away.
MARKS_OVERDUE           = 7     // days after the exam
CLASS_FLAGGED_ON_MARKS  = 25    // percent of students below pass
MIN_ENROLLED_DAYS_FOR_FLAGS = 10   // before any attendance flag fires
HOMEWORK_WINDOW         = 7     // rolling days of due dates
```

## 10. Principal panel

**Cannot do:**
- **Cannot mark or edit attendance.** Cannot upload or edit marks.
- **Cannot create or edit any record except announcements.**
- **Cannot see student practice data.** Practice is private from every role.
- Cannot see the audit log — admin only.

**Can do:**
- Sees **every class and section** in the school.
- Approves and rejects leave, with a reason on reject.
- **Resolves complaints.**
- Creates announcements; sends and receives replies.
- **Messages students and parents directly**, as well as teachers.
- **Exports reports as PDF and Excel.**
- Sees the **top of each leaderboard** only — not the full ranking students see.
- **Sees teacher remarks on a student**, within that student's drill-down. No
  notification is sent when a remark is written.

**Notifications:** attendance not marked · new complaints and inquiries · marks
overdue · leave requests. **No remark notifications.**

**Design consequence:** every problem row's action is *message the responsible
teacher*. No screen offers the principal an action they lack permission for.

## 10.5 Teacher panel

**Attendance**
- Class teacher marks daily, once per section.
- Admin can mark on any day (e.g. class teacher absent) and is the only role that
  can edit.
- Principal never marks and never edits.

**Homework**
- Created by the teacher, always for the whole section.
- Carries a **topic**, entered as free text.
- Teacher selects the submission mode per assignment:
  `no upload` (notebook work, teacher ticks) · `digital answer` · `image/PDF upload`.
- Digital answering is only offered where the question is structured (MCQ,
  fill-in-blank). A photo worksheet cannot be answered in-app.
- **Auto-grade rule: if a stored correct answer exists, grade automatically;
  otherwise the teacher grades manually.** Teacher can override any auto-grade.
- **Correction from the build:** every one of the 21,696 bank questions has an
  answer key (`correct_index` is NOT NULL), so the manual branch is unreachable
  for bank-sourced questions. **The real ungraded case is a free-response
  answer**, which stays NULL until a teacher acts.
- Student submits → teacher inspects → teacher ticks. Photo, PDF and typed text
  all accepted.
- Deletable, to trash for 7 days.

**Tests**
- Subject teachers create tests for the subjects they teach.
- Carries a topic, free text.
- Deletable, to trash for 7 days.

**Marks entry**
- Whole class entered in a grid, **saved as draft**, reviewed, then submitted once.
- After submission, **only admin can edit.**

**Exams**
- **The class teacher creates the exam for their own section only.**
- Exam name is free text. Dates, maximum mark and pass mark are set by the
  creator, and may differ between sections.
- Subject-wise timetable entered by the teacher; visible to students.
- **Exam marks uploaded by the subject teacher for their own subject.** A class
  teacher who also teaches a subject uploads that subject's marks.

**Cross-section comparison**
- Because max marks differ between sections, **all cross-section figures are
  percentages.** Raw marks appear only on the student's own screens.
- Comparison is at **subject level**, not exam level — every Maths mark in 12-A
  this year against every Maths mark in 12-B. Free-text exam names therefore do
  not break it. Exam-to-exam matching is not supported and not needed.
- Drill-down: subjects side by side → tap a subject → both sections' averages →
  bands → named students.

**Practice**
- **Self-directed only, and completely private to the student.** No teacher, no
  parent, no principal, no aggregate, no AI use by the school.
- "Teacher-assigned practice" does not exist as a separate thing — that is
  homework.

**Visibility**
- A teacher sees **all academic data for students in sections they teach** — all
  subjects, attendance, homework. Not subject-limited.
- **View-only outside their own subject.** Editing is restricted to their subject.
- No access to students in sections they do not teach.
- **A teacher cannot see another teacher's activity.**
- Class teacher sees all subjects for their section.

**Other**
- Teacher gets the same analysis screens as the principal, for their own sections.
- Teachers message parents directly.
- **Teachers cannot raise complaints.** Only parents can.
- Teacher leave → approved by the principal.

**Teacher leaving**
- Student data is unaffected — marks, attendance and completion records are
  attached to the student and section-subject, not the teacher.
- **History keeps the original creator's name.** Homework created by Mr. Sharma
  still shows Mr. Sharma after he leaves.
- A new teacher is assigned to the section-subject and takes over from that date.
- Membership ends, account deactivated, access removed immediately.

## 10.6 Leave requests

- **Teacher leave** → principal approves or rejects.
- **Student leave** → goes to **both the class teacher and the principal.**
  Either can act. Resolved by whoever responds first; the second can still
  comment.
- **Both decisions are displayed as they are** — "Approved by class teacher ·
  Rejected by principal". No single combined verdict is shown.

## 10.7 Year-end

- Super admin notifies the school admin at year end.
- Admin exports everything: teacher activity, homework, tests, marks, attendance.
- Admin then deletes. **Admin can delete records as well as practice data.**
- Super admin is informed once complete.
- Practice data is the bulk of the volume and the main target of deletion.

## 10.8 Practice (student panel)

- **Self-directed only. Completely private to the student.** No teacher, no
  parent, no principal, no aggregate, no school-side AI use.
- "Teacher-assigned practice" does not exist — that is homework.

**Privacy overrides existing screens — confirmed decision.**
Production currently violates this: `student_mistakes` and `concept_mastery`
carry live `SELECT` policies granting teacher, principal, admin **and** parent
access, and `rpc_teacher_concept_analytics()` serves class-level practice
aggregates to teachers. **Privacy wins.** Remove those policies and that RPC.
Teacher and parent screens built on them will break, and that is accepted —
it is a product decision, not a migration detail. Report every screen affected
before removing.

**Transient vs durable — the rule that resolves battles, DPPs and recovery.**

A session cannot be scored without knowing which answers were right. So:

- **While a session is in flight**, per-question correctness may exist. It is
  working state.
- **When the session closes, it must not persist.** What survives is:
  session or tier **totals**, plus rows for **wrong, skipped and bookmarked**.

This applies identically to every practice-shaped surface — ordinary practice,
**battles**, **DPPs**, and **recovery sessions**. A battle is student-initiated
and not teacher-assigned, so it is practice, not assessment. Its durable record
is the score, the XP and the mistakes — never a per-question list of what the
student got right.

**The exception remains school data.** Homework and test answers may record
per-question correctness permanently, because a teacher set them and a mark is
the point. That distinction is structural (§10.23), not a flag.

**Battles — including teacher-created ones.**
Teachers can set up battles for their class. **Teacher creation does not make a
battle school data**: the test is that a teacher set it *and a mark is the
point*. A battle produces XP and a winner, not marks.

- The creator sees the **same public half as everyone**: participation, score,
  winner, XP. **Never** per-student accuracy, skipped counts, or a derived
  "struggling" judgement about a named child.
- **Item difficulty is allowed at a participant floor.** Per-question
  attempts-and-correct **across participants** may be shown only when the battle
  had **5 or more participants**. Below that it identifies individuals — in a
  two-person battle it is simply two students' answers with a chart around them.
- A class battle clears the floor, so a teacher sees *"the class struggled on
  question 7"*. A duel does not, so nothing is shown. One rule, right answer in
  both cases.
- **Compute the aggregate at battle finish, store the aggregate, then purge the
  per-question rows.** Item difficulty survives; per-student correctness does
  not. This is the transient rule applied, and it also fixes the stats reading 0%
  after a battle ends.

**What is stored — the governing rule:**
- **Only what went wrong.** Per-question records exist for **wrong**, **skipped**
  and **bookmarked** answers only.
- **No per-question record of correct answers.**
- Session totals are stored (attempted, correct count) so accuracy can be shown.
- **Strong areas are never shown anywhere in the app.** The product surfaces
  weaknesses only.

**RULING — where the line falls between a number and a strength display.**

A figure is not forbidden for being high. Accuracy per chapter can read 92% and
that is fine. What is forbidden is **presenting a figure as an achievement, or
filtering a list to the best of them.**

| Allowed | Forbidden |
|---|---|
| A metric shown for **every** subject or chapter, high and low alike | A list **filtered** to the highest — "Strong topics", "Stronger areas" |
| A neutral label — *accuracy*, *completion*, *score* | An achievement label — *mastery*, *mastered*, *proficient*, *strong*, *excellent* |
| "On track" as a band describing the **figure** | Any band describing the **child** |

**Applied to the per-subject "MASTERY %" figure:** the number stays, shown for
every subject including the weak ones. **The word goes** — rename it to something
that describes the measure rather than the achievement. "Mastery 78%" tells a
student they have mastered it; "Accuracy 78%" tells them what happened.

**And nothing may compute a strength value and discard it.** A value assembled
upstream and silenced at the consumer is one refactor from being rendered again.
Close it at the source, including in any AI context builder or prompt.
- Recorded per question: right/wrong, time taken, skipped, bookmarked.

**Modes:**
- Quick practice — pick subject and topic
- Custom session — see below
- Redo my mistakes
- Bookmarked questions
- Skipped questions
- By difficulty
- AI-suggested, from the student's own weak areas

**Recovery, revision and analysis:** fully specified in
**`recovery-revision-analysis-spec.md`**. That document is the source of truth
for triggers, session composition, thresholds, scheduling and what analysis
shows. Headlines:
- **Recovery** builds from the student's **own wrong questions**, laddered across
  four transfer tiers — original, different values, different framing, different
  application. AI generates tiers 1 and 2; every variant is saved to the shared
  bank so the cache warms and cost falls.
- **Readiness is two numbers, never blended** — procedural and conceptual.
  Procedural passing while conceptual fails is the most common real result.
- **Revision starts on any substantial engagement with a chapter**, not only
  after recovery, at 7 / 21 / 60 days. Re-engaging resets the clock.
- **The chapter tally is required** — one row per chapter per session. Analysis
  cannot be built without a denominator.

**Custom session:**
- Configured **per chapter**, as a list of rows, not one global setting:
  chapter · number of questions · difficulty.
  E.g. hard questions from Cash Flow and easy from Partnership, in one session.
- Also settable: total number of questions, time limit.
- AI generates the questions. **Where difficulty is specified, AI must obey it;
  where it is not, AI chooses.**

## 10.9 Question bank

- **Centralised and shared across all schools and all users.** AI-generated
  questions are saved to it and reused.
- Every question is tagged: **board · class · subject · chapter · topic ·
  difficulty**, plus whatever tags already exist (pending audit).
- **Filtering by tag is what keeps content appropriate** — a Class 5 student is
  only ever served Class 5 content for their own board. Nothing outside their
  class, subject, chapter or topic.

## 10.10 Curriculum

- Intended structure: **board → class → subject → chapter → topic.**
- **One board per school.**

**RESOLVED by audit: no curriculum tree exists.** `question_bank` holds 21,696
rows keyed on free text — 15 subjects, 523 chapters, and **11,917 distinct topic
strings** (~23 per chapter). The topic column is a per-question descriptor, not
a taxonomy.

**Decision: chapter is the stable unit for now.**
- Seed the tree from the **523 chapters**. Everything downstream — mistake book,
  custom sessions, analysis — keys on `chapter_id`.
- This is sufficient because **custom practice sessions are already configured
  per chapter** (10.8), so chapter is the operative grain for the main feature.
- The free-text topic string stays on the question as an **unmapped label**.
  It is never used for tracking, grouping or trends.
- A real `topics` table can be added later without breaking anything, because
  `chapter_id` remains stable.
- **Before seeding, check the 523 chapter names for near-duplicates and report
  the count.** The same fragmentation problem ("Cash Flow" vs "Cash flow
  statement") could exist at chapter level.

**Rationale:** curating 11,917 strings is a data project in its own right and
would block everything else. Inventing a tree from them would fragment every
trend — the exact failure the stable-ID rule exists to prevent.

## 10.11 Resources

- **Per school only. Never centralised.** Distinct from the question bank.
- **Uploaded by teachers only** — not admin, not principal.
- Types: **PDF/document and image** only.
- Targeted at a **specific class or a specific section**.
- A teacher may only upload to **sections they teach**.
- **No view tracking of any kind.** Not who opened it, not a view count.
- Deletable by the uploader. **Permanent deletion — no trash.**

## 10.12 Student panel

**Homework**
- **Cannot be submitted after the due date.** Submission locks at the due date.
- Completion rate is measured **at the due date**. One number, no on-time vs
  final split.
- Teacher can leave a **comment** when checking.

**Marks**
- Student sees **only their own marks.** No class average, no rank, no comparison.

**Attendance**
- Student sees their **day-by-day record**, in full.

**Bookmarks**
- Practice questions, homework, and resources can all be bookmarked.

**Messaging**
- A student may message: **teachers who teach them**, their class teacher, the
  principal, and **students of their own class**.
- Student-to-student messages are **private but reportable**.
- **Reported messages are reviewed by the class teacher only.** Not the
  principal, not super admin — super admin never sees personal data.

**Notifications**
- Sent for: new homework, marks published, leave decision, announcements,
  pending recovery or revision, and a **daily practice reminder** with a
  motivational line.
- **Reminders can be turned off. Marks, homework and leave decisions cannot.**
  Rationale: a student who cannot silence a daily nudge will mute the app at OS
  level and lose the important notifications too.

**Question reporting**
- A **single persistent report control** in the practice UI, not one per
  question. It captures whichever question is on screen.
- Report goes to **the AI and super admin** — never to the school, so practice
  stays private.
- Because the bank is central, a bad question is wrong for every school at once.

## 10.13 Report card

- **Auto-generated per exam**, and sent to parents automatically.
- **Generates only when all subjects have marks uploaded.** Never partial.
- Contains: subject marks, total, and teacher remarks.
- **Parents can download it as PDF.**
- **No approval step.** Sends immediately on generation.
  Known risk: an incorrect mark reaches parents before anyone can catch it, and
  only admin can edit marks after submission.

## 10.14 Student remarks

- Dated notes written on a student's profile, e.g. behaviour.
- **Written only by teachers who teach that student.**
- Stored with the teacher's name and date.
- **Parent sees a remark immediately when written**, not only at report card
  time. Remarks are also bundled into the report card.
- **Teacher can edit or delete their own remark at any time.**
  Note: since parents see remarks immediately, an edit or deletion after the
  fact should leave an `edited` marker to avoid disputes.

## 10.15 Parent panel

**Visibility**
- Parent sees **everything the student sees except practice.**
- Sees the child's actual homework submission and the teacher's comment.
- Sees the full calendar and exam timetable.
- **Sees the child's rank per exam** — see 10.17.
- Sees remarks immediately when written.

**Actions**
- Apply for leave on behalf of the child → decided by **class teacher and
  principal**, same as student leave.
- Raise a complaint → goes to the **principal**. Not anonymous; the principal
  sees who raised it. Parent sees the **outcome only**, not the handling.
- Message **teachers who teach their child, the class teacher, and the
  principal.**

**Notifications**
- Marks published · test results submitted · exam results · homework published ·
  remarks written · report card ready · weak-concept alerts.
- **Absence alert sent the same day, as soon as the teacher submits attendance.**
- **If attendance is later corrected, a correction notification is sent.**
- **Weak-concept alerts are derived from tests and exams only.** Never from
  practice — practice must stay private.
- Parents do **not** get the daily practice reminder. They get a weekly summary
  instead.

**Weekly AI summary**
- **School data only** — homework, marks, attendance. **No practice data.**
- Written by AI as a personalised message.
- **Sends automatically, no human check.**
- Requirement: the AI writes prose around figures produced by the metric layer.
  It must not compute figures itself, or it will eventually state an invented
  number to a parent as fact.

## 10.16 Leaderboards

Five separate leaderboards, all **scoped to the student's own section**:

1. Attendance
2. Homework completion
3. Exam marks
4. Per-test marks — a leaderboard is created when a teacher submits test marks
5. **Practice XP** — earned for correct answers during practice

- **Full ranking, visible to all students in the section.** Not top-N.
- Practice XP is treated as effort rather than private content: the mistake book
  and wrong answers stay private, but activity volume is public.

**The effort exception — exactly what is public:**
- **Public:** XP, level, league, **streak**, homework completion.
- **Private:** practice session counts, practice rate, mistakes, skipped,
  bookmarks, concept mastery, revision queue, and every per-question record.
- Streak is public by decision even though no leaderboard requires it.

**Known risk, accepted:** full ranking names the bottom of the section publicly,
including on attendance. A child with a chronic illness or a difficult home
situation is visible to every classmate as last. Worth raising with a school
before rollout.

## 10.17 Rank

- Calculated **per exam**, once all subjects' marks are submitted.
- **Within the student's own section only.** Sections sit different papers with
  different maximum marks, so cross-section rank would be meaningless.
- Sent to parents in the **exam report**. **Never in the weekly summary.**
- Students see position through the section leaderboards.

## 10.18 Admin panel

**Admin is effectively the top of the school.** Creates the principal, creates
other admins, and is the only role that can edit attendance and marks after
submission.

**Can do:**
- Create students, teachers and classes
- **Assign teachers to sections**
- Create the **principal** account
- Create **other admin** accounts (multiple admins per school)
- **Mark attendance on any day, and edit it** — the only role that can edit
- **Edit marks after submission** — the only role that can
- Restore items from trash
- Set the **session start and end dates**
- Handle inquiries
- Export and delete year-end data

**Cannot do:**
- **No academic analysis screens.** Admin sees individual records — necessary in
  order to edit them — but no analysis, no class comparison, no dashboards.

**Account creation chain:**
`Super admin → school admin → principal, teachers, students, parents`
Admin can also create further admins.

**Deletion of a student or teacher:**
- Never hard-deleted. Held for **30 days**, restorable by **admin only**, then
  permanent.

**Audit log:**
- **Full log of who changed what**, covering every admin action.
- **Visible to admin only.** Rationale given: multiple admins act as a check on
  each other.
- Known limitation, accepted: the audited party is the only party who can see
  the log. No external oversight of mark or attendance edits.

## 10.19 Inquiries

- An inquiry is a question from an **existing parent or teacher** — not an
  admission enquiry from outside.
- Functionally a message, but **routed to admin**.
- **Both admin and principal see it.**
- **One question, one answer.** Not a thread.
- Distinct from a **complaint**, which only a parent can raise and which goes to
  the principal.

## 10.20 Super admin

**Can do:**
- Create and remove schools
- Create school admin accounts
- See usage and billing
- **Manage the central question bank**
- **Manage the curriculum tree**
- Send year-end deletion notices
- Suspend a school

**Access to school data:**
- **Unrestricted access to academic data, for support.**
- **Every access is logged, and the school is notified.**
- **Access expires automatically: 60 minutes per grant, 8 hours per day maximum.**
  Re-requesting is allowed and is itself logged. Rationale: without expiry, a
  session opened to fix one support ticket stays open indefinitely, and a
  compromised super admin account reaches every school's data.
- **The access-log row is the grant.** Unlogged super admin access is not
  expressible in the schema — there is no path to data without a log entry.
- This overrides the earlier "accounts and billing only" position.
- Note: this is the single largest concentration of risk in the system — one
  credential can reach every child's record in every school. Logging and
  notification are the mitigation.

**Suspension:**
- All users locked out immediately.
- Data kept intact and reactivatable for **30 days**, then deleted.

## 10.21 Reported questions

- A **single persistent report control** in the practice UI captures whichever
  question is on screen.
- Reports go to **the AI and super admin**, never to the school.
- **The AI handles reports automatically and rewrites the question.**
- **A rewrite creates a NEW question; the old one is retired, not overwritten.**
  Reason: a retired question may sit in a student's mistake book. Replacing its
  content in place would mean "redo my mistakes" serves them something they never
  got wrong.
- Retired questions stop being served but remain intact for existing references.
- **Rewrites go live without human approval.**

## 10.22 Chapter and topic on teacher-created content

**Chapter is picked, never typed.**
- When a teacher creates homework or a test, they pick the chapter from a list.
- The list is **filtered to their own subject and that class** — a teacher of
  Class 12 Accountancy sees only Class 12 Accountancy chapters. This falls out
  of the curriculum tree; nothing extra is needed.
- Homework may also carry a free-text label where no chapter fits, since
  homework analysis rolls up to chapter anyway.

**Topic is picked from the chapter's existing topics, or added.**

**Where the topic lives depends on the kind of homework** (see 10.24):

| Kind | Topic sits on |
|---|---|
| MCQs in the app | **Each question.** Per question, not per test. |
| Image worksheet | **The homework itself** — there are no questions to hang it on |
| Typed instructions | **The homework itself** — same reason |

Tests always carry topic **per question**, since a test always has questions.
A chapter is required wherever a topic is set; a topic only means something
inside its chapter, and that pairing is enforced.
- The teacher sees topics already used in that chapter and picks one, or adds a
  new one only when nothing fits.
- **AI-generated questions follow the same rule** — pick an existing topic where
  one fits, create a new one only when none does.
- Rationale: typing freehand splits a single test's own analysis
  ("Cash Flow" on six questions, "Cash flow" on four). Picking makes the list
  cleaner with every use instead of dirtier, and builds a real taxonomy from the
  people who teach the subject — with no curation project.

**Known rough edge:** questions pulled from the legacy bank carry the old
free-text labels, so a test mixing bank questions with self-written ones has
inconsistent topic names across those two groups. Chapter rollup is unaffected.

**Scope:** topic analysis applies to **homework and tests only.**
**Exams get subject-level analysis only** — which subject is weak, never which
topic. This also avoids a schema constraint: `marks` has no subject column today.

## 10.23 Test and homework mistakes are NOT practice

**This distinction must be structural, not a code check.**

| Source | Rule |
|---|---|
| Mistake on a teacher's test or homework | **School data.** Teacher, principal and parent may see it. |
| Mistake in self-directed practice | **Private to the student.** Nobody else, ever. |

Same kind of information, opposite rules. **Test and homework answers must be
stored separately from practice records**, with the source built into the
structure. Storing both in one table makes the privacy rule unenforceable — which
is how `question_records` ended up readable by parents and class teachers.

## 10.24 Homework — the three kinds

What the teacher gives determines what can be analysed. **The app can only
analyse what it holds as structured questions with answers.**

| Teacher gives | App holds | Student does | Report |
|---|---|---|---|
| **MCQs in the app**, with answer key | Questions and answers | Answers in app, auto-graded | **Full analysis** — topics, mistakes, timing |
| **An image** of a worksheet | A picture only | Uploads photo or PDF back | **Completion only** |
| **Typed instructions** | Text only | Teacher decides: upload, or nothing to submit | **Completion only** |

In the third case the teacher chooses whether anything is submitted at all —
sometimes it is "do this, I'll check in class."

**Closing:**
- Closes **automatically at the due date**, or **the teacher closes it early.**
- **Whichever happens, closing generates the report.**
- Students who have not submitted when it closes are **marked not completed.**
- **Closed is final. No reopening.**

## 10.25 Reports

Two shapes, because two kinds of data.

**Test report** — performance
- Class average · weakest topics ranked · average time per question
- Full student list with marks
- Tap a student → their actual wrong answers, with the topic on each
- **Generated automatically as soon as grading completes**

**Homework report** — completion
- Who completed, who did not, who was absent
- Teacher's marking and comments
- **Digital MCQ homework additionally gets the full test-report analysis** — it
  produces identical data, so it reuses the same report. Nothing built twice.
- **Generated on closure**, whether that is the due date or the teacher closing
  early

**Visible to:** teacher · principal · the student themselves ·
**parent, for their own child's part only.**

**Timing sections only exist for digitally submitted work.** A photo upload has
no per-question timing — that section renders as absent, never as zero.

## 10.26 Student cumulative record

Every student's profile shows their whole picture across **all subjects and all
teachers**: homework completed, homework missed, tests taken, marks, attendance.

**These counts are computed at read time, never stored.** A stored counter drifts
the moment a homework is deleted or a submission corrected, and nothing catches
it. See G5.

## 10.27 Enrolment, joiners and leavers

**Mid-term joiner — RESOLVED. Attendance counts from `enrolment_date`.**

A student joining on day 20 of a 45-day term, whose section submitted on 42 days
overall (22 of them after they joined), present on 20:
- **From enrolment: 20 ÷ 22 = 91%** ✓
- From session start: 20 ÷ 42 = 48% ✗ — they would be flagged as a chronic
  absentee on their second day

This needs no special-casing: attendance is **counted from records, never
averaged from percentages**, so a joiner is simply not in the denominator on days
before they enrolled. The existing formula already handles it.

**Minimum enrolment before flags apply: 10 school days.**

```
MIN_ENROLLED_DAYS_FOR_FLAGS = 10
```

A student enrolled three days with one absence reads 67% — below threshold, but
meaningless. **No attendance threshold fires until the student has 10 enrolled
school days.** Same principle as G4: too little data is not a bad result.

**Leavers — no separate rule.**
- The moment a student exits they become **invisible on every live screen**: not
  in today's attendance, class lists, averages, watchlists, or any current
  figure.
- **Their record stays in the database.** Transfer certificates still work, past
  reports still reconcile, and a parent asking a year later still gets an answer.
- **Their data is deleted only through the ordinary year-end decision** (10.7),
  along with everything else. It is included in the admin's export.
- There is **no leaver retention timer** and no separate deletion path. One
  deletion policy, one moment, one decision-maker.

Leavers count to `exit_date` in the same way joiners count from `enrolment_date`.

## 11. Universal rules

- **No school-wide averages across classes.** Class 5 and Class 12 are not
  comparable. Analysis is per class.
- **No subject-wise attendance.** Attendance is daily and class-wide.
- **Drill-down law:** every name, count, percentage and badge is clickable and
  opens the thing behind it. Every chain ends in named people.
- **Null contract:** no data renders `—`. `0` never substitutes for missing.
  No threshold fires on zero records.
- **No metric is computed in more than one place.** One function per metric, in
  the data layer. Components render, never calculate.
- **No derived value is stored.** All aggregates computed on read.
- Forbidden throughout: teacher scores or rankings,
  blended class or performance scores, attendance-vs-marks correlation, fees,
  transport, library, syllabus coverage, discipline points, health records.

---

## Still open

- **RESOLVED** Mid-term joiner denominator — see §10.27. Counts from
  `enrolment_date`; flags wait for 10 enrolled school days.
- `OPEN` Student panel tab list and existing screens — pending audit
- `OPEN` Existing question bank tag set — pending audit
- `OPEN` What the AI layer is for, beyond question generation and the weekly
  parent summary
- `OPEN` XP formula — how many points per correct answer, and whether difficulty
  weights it
- **RESOLVED** Recovery, revision and analysis — full specification in
  `recovery-revision-analysis-spec.md`.
- **RESOLVED, and UN-PARKED** Chapter tally — required by analysis, at **chapter**
  grain not topic. One row per chapter per session. Without a denominator the
  mistake book cannot be read: 8 open mistakes means nothing until you know
  whether that is out of 20 questions or 200.
- `OPEN` XP for clearing a chapter or passing revision — recommendation is
  **no**, XP for correct answers only, so self-certification cannot be farmed.
