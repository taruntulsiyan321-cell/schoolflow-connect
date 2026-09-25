# Custom Practice — the student's own upload

**Status:** Stage 1 landed 2026-09-24 (edge `custom-practice-upload`, private
tables, Custom Practice UI, mistake-book / Incorrect practice). This document
remains the source of truth; code cites it by section (`§4.2`), the way
`docs/recovery-revision-analysis-spec.md` is cited by the recovery engine.

**Sister spec:** `docs/screen-capture-mistakes-spec.md` — mistakes captured
from another app's screen. The two features produce the same thing (a private,
tagged question feeding the mistake book) and differ only in intake. **§2, §5,
§6 and §9 of this document are the shared rules**, and the screen-capture spec
cites them rather than keeping a second copy. Change them here, once.
One rule is deliberately NOT shared: promotion to the shared bank (§10) is
allowed here and is **off entirely** for screen capture — see that spec's §9.

Every fact marked *measured* was taken from the live database on 2026-09-24.
Everything else is a decision, and a decision can only be changed here.

---

## §1 What this is

An individual student — no school, preparing for one competitive exam — opens
**Custom Practice** and uploads a PDF or an image of their own: a question
paper, a worksheet, a page of notes, a photograph of a book.

The AI reads it, works out **what it actually is**, and Custom Practice then
offers only the modes that file can support. Whatever it holds becomes that
student's private material: they practise it, get it wrong, and it flows into
their mistake book, recovery, revision and analysis exactly as bank questions
do.

**What it is not.** It is not a way to grow the shared question bank. The
student's uploaded questions are theirs alone and are never published to
anyone. The single exception is §10.

---

## §2 The privacy rule

> **An upload, and everything extracted from it, belongs to the account that
> uploaded it and is visible to nobody else — no other student, no school, no
> teacher, no admin.**

This is the governing rule of the feature. Where §2 and any other section
appear to disagree, §2 wins.

Two consequences that decide the data model:

- **§2.1 Uploaded questions do NOT go in `public.question_bank`.** That table's
  defining property is that it is shared with every school and carries no
  `school_id` (7A: "Shared across every school. No institution_id"). Adding
  private rows to it would make every existing reader — policies, RPCs,
  matchers, the embedding drain — wrong unless each one is separately patched.
  That is the defect shape RULE 0 exists to prevent. Private questions get
  their own table (§3.2).

- **§2.2 Uploads do NOT go in `ai_kms_documents`.** *Measured:* its
  `tenant_scope` CHECK admits only `school | curriculum_network |
  global_approved`, and its `content_type` CHECK only `curriculum |
  teacher_notes | school_policy | exemplar | resource`. It is a school
  knowledge base built for sharing. Reusing it would mean widening both
  constraints and threading a privacy notion through a table whose entire
  purpose is the opposite. Same reasoning as §2.1.

---

## §3 Where an upload lives

### §3.1 The file

A private storage bucket, one folder per account, keyed on `auth.uid()`.

*Measured:* four private buckets already exist (`academic-files`,
`chat-attachments`, `doubt-attachments`, `doubt-images`), and the
per-user-folder convention is already enforced elsewhere by
`split_part(_object_name, '/', 1) = auth.uid()::text` (see
`homework_file_is_fixed`). Reuse that pattern; do not invent a new one.

### §3.2 The rows

Three new tables, all owner-scoped, all fenced on `school_id` like every other
learning table (an individual's `school_id` is their own space — see
`docs/` and the exam-account ruling):

- **`student_uploads`** — one row per uploaded file: owner, school, storage
  path, original filename, byte size, page/image count, the §4 verdict, the
  §4 confidence, status, timestamps.
- **`student_upload_questions`** — the questions extracted from an upload:
  upload id, owner, school, question text, options, correct answer, whether
  the key came from the file or from the AI (§6), explanation, difficulty,
  `topic_id`, `chapter_id`, sequence.
- **`student_upload_notes`** — the notes produced from an upload (§7): upload
  id, owner, school, `chapter_id`, `topic_id`, title, body, sequence.

RLS on all three: **`owner_id = auth.uid()`**, for select, insert, update and
delete. Not `same_school()` — that admits every member of a space, and while
an individual's space has exactly one member today, the rule must be true of
the row, not of a coincidence in the current data.

---

## §4 Classification — and the refusal

Before anything else, the AI answers one question about the upload: **what is
this?** Exactly one verdict per upload:

| verdict | meaning |
|---|---|
| `questions` | it holds questions |
| `notes` | it holds study material, not questions |
| `mixed` | both |
| `unusable` | neither — or unreadable |

### §4.1 The refusal is the feature

> "They can upload useless things also, so we don't do anything with that."

This is the section most likely to be built badly, and the one that decides
whether the feature feels outstanding or broken.

An AI asked "is this a question paper?" says yes almost every time. The
realistic failure is a student photographing their timetable, the app
confidently inventing five questions from it, tagging them to a chapter, and
those landing in the student's mistake book, recovery queue and accuracy —
permanently, with nothing telling them it was garbage.

So:

- **§4.2** The classifier returns a **confidence**, and below the threshold
  the verdict is `unusable` regardless of what else it said.
- **§4.3** An `unusable` upload produces **no questions, no notes, no tags, no
  practice mode, and no row in any downstream table**. It is kept (the student
  can see what they uploaded and delete it) and it is reported honestly: say
  the file could not be used for practice, and why in one line.
- **§4.4** An upload that yields **fewer than 3 usable questions** and no notes
  is `unusable`. A "practice session" of one invented question is worse than
  an honest refusal.

### §4.5 Proving the refusal

The classifier must be measured against material that **should** be refused,
not only against real question papers. The battery, at minimum: a timetable, a
blurry or dark photograph, a page of ordinary prose, a receipt or bill, a blank
page, and a screenshot of a chat.

A check that is only ever shown real question papers proves nothing. The suite
fails if any of those is accepted, and it must also include a real question
paper that IS accepted — otherwise a classifier that refuses everything would
pass.

---

## §5 Extraction and tagging

For a `questions` or `mixed` upload, each extracted question is tagged with:

- **difficulty** — the same vocabulary `question_bank.difficulty` uses;
- **topic** and **chapter**, resolved to **real rows**: `chapter_id` must be a
  live `public.chapters.id` and `topic_id` a live `public.topics.id` within the
  student's exam curriculum.

### §5.1 Why the ids matter

*Measured:* recovery and revision key on `chapter_id`
(`student_mistakes.chapter_id`), not on a chapter name. A free-text chapter
guess means those two screens have nothing to group by, and the feature is
half of what was asked for.

**Ruled 2026-09-25 — no question is left untagged.** A question without a
chapter reaches neither recovery nor revision, which demolishes what the
feature is for. Every question and note is filed under a chapter of the
student's **stream syllabus** (`exam_syllabus_chapters`; CUET Commerce is
Accountancy, Business Studies, Economics, Mathematics / Applied Mathematics,
English and the General Aptitude Test, chapters from the NTA 2026 syllabi):
the bank first (§5.2), otherwise the model chooses a syllabus chapter *of the
question's own subject* (`_shared/syllabusTagger.ts`).

A question whose subject is **outside the stream** — a Chemistry question a
commerce student opened by mistake — is not the student's CUET work and is
**not saved**; the student is told which subject it was. A wrong chapter is
still worse than none, which is why the subject decides first and a question
is never forced into another subject's chapter. The database refuses an
upload question, note or captured question without a chapter
(20261096000000).

### §5.2 Ask our own bank before asking the AI

*Measured 2026-09-24:* **26,153 questions in `question_bank` carry an
embedding, and all 4,267 CUET questions do** (`embed_status = 'embedded'`). A
vector search already exists: `match_question_bank(p_query_embedding vector,
p_class_level integer, p_school_id uuid, p_subjects text[], p_match_threshold
double precision, p_match_count integer)`.

An uploaded question is very often a question we already hold — past papers and
coaching sheets recycle the same items. So **embed the extracted question and
search the bank first. On a confident match, inherit that question's chapter,
topic and difficulty exactly.** Only with no match does the AI classify.

This is the cheapest way to satisfy §5.1: inheriting a known chapter is
*right*, where classifying is only ever *plausible*.

*Note for the builder:* `match_question_bank` takes `p_class_level` and
`p_school_id` — it was written for school students and needs an exam-scoped
path for CUET. The same note appears in the screen-capture spec §7.2; the two
features need the same thing, so build it once.

**A match does not make the question ours.** The student's uploaded copy stays
private under §2 either way; matching only borrows the tags.

---

## §6 Answer keys

**Ruled:** where the uploaded file carries the answer, that answer is used.
Where it does not, **the AI solves the question, and the question is marked as
AI-answered** wherever the student sees it — in practice, in the result, and
in the mistake-book entry it creates.

- **§6.1** The marker is not decoration. The student can say **"this answer is
  wrong"** on any AI-answered question. Doing so clears the mistake it created
  and removes that attempt from their accuracy.
- **§6.2** An AI-answered question is never eligible for promotion (§10).

Why this section exists: this repository has already shipped a wrong answer key
once. All 576 legacy `test_questions` rows stored a label where the code
expected a position, so no student could ever be marked right. A key the
student cannot question is the same defect with better manners.

---

## §7 Notes

For a `notes` or `mixed` upload, the AI produces **proper notes** from the
material: organised **topic-wise and chapter-wise**, against the same real
`chapter_id` / `topic_id` as §5, and readable on their own.

**§7.1** Notes are also practisable. The AI writes questions **from** the
notes, and those are practised exactly like uploaded questions — same privacy,
same tagging, same downstream flow. A student who uploads only notes can still
practise.

**§7.2** Questions generated from notes are AI-answered by definition, so §6
applies to all of them.

**§7.3** Notes never leave the student's space. No note, and nothing derived
from a note except a question variant under §10, is ever shared.

---

## §8 The modes Custom Practice offers

The modes on screen are a **function of the §4 verdict**, not a fixed list:

| verdict | modes offered |
|---|---|
| `questions` | practise all · practise by chapter · practise only the ones tagged hard |
| `notes` | read the notes · practise questions written from them |
| `mixed` | both of the above |
| `unusable` | none — §4.3's honest message instead |

A mode is never shown for material the upload does not contain. An empty mode
that leads to an empty session is the "loading shown as empty" defect in
another costume — see `src/lib/listState.ts`.

---

## §9 Downstream — what already works

*Measured 2026-09-24, and this is why the feature is cheaper than it sounds:*

- `question_attempts.generated_question` is `jsonb NOT NULL` — the whole
  question is snapshotted into the attempt.
- `question_attempts.bank_question_id` is **nullable**, and **4,800 attempts
  already exist with no bank row**.
- `student_mistakes` stores `question_text`, `options`, `correct_answer`,
  `explanation`, `subject`, `chapter`, `chapter_id`, `topic`, `difficulty`
  itself — it does not read the bank.

So the mistake book, recovery, revision and analysis need **no new plumbing** to
work on a question that is not in `question_bank`. What they need is §5's real
`chapter_id`.

**§9.1** An attempt on an uploaded question is written with
`source = 'upload'` and `source_id` = the upload's id. *Measured:* `source`
already carries `practice` and `mistake_book`; this follows the same pattern.

**§9.2** Uploaded-question results count in the **same** accuracy figure the
student already sees — one number, not two. `source` keeps the two separable
underneath, so the split can be shown later without re-deriving anything.

---

## §10 Promotion to the shared bank

> "Only the variants and the recovery questions, which are created, if they are
> useful, our system decides get added to the database."

**§10.1** The student's uploaded question is **never** promoted. Neither is any
note. Only a **variant or recovery question the system generated** from one can
enter `public.question_bank`.

**§10.2** Promotion is automatic and gated. A generated question is promoted
only if **all four** hold:

1. its source question resolved to a **real chapter** in the exam curriculum
   (§5) — not a free-text guess;
2. the variant **validates**: options present, exactly one correct key, and an
   explanation;
3. it is **not a near-duplicate** of a question already in the bank — use the
   existing `question_bank.embedding`, do not invent a second similarity path;
4. its source question was **not AI-answered** (§6.2).

A variant failing any gate simply stays private to that student. Nothing is
lost; it just does not spread.

**§10.3** *Measured:* `variant_generation_queue.source_question_id` is a
foreign key into `question_bank(id)`, so the existing variant pipeline cannot
be fed by a private question as it stands. This is the one piece of genuinely
new plumbing the promotion path needs — a second, nullable source column
pointing at `student_upload_questions`, with a CHECK that exactly one of the
two is set. Do not loosen the existing FK.

**§10.4** Provenance. Uploads will usually be someone else's copyrighted
material — coaching PDFs, past papers. Keeping them private is one thing;
pushing a derived variant out to every school is another, and it is the
promotion gate that carries that risk, not the upload. A promoted row records
that it came from a generated variant, so a decision to withdraw them later is
possible. **The owner accepted this on 2026-09-24.**

**§10.5 When variants are asked for, and what fills recovery meanwhile
(2026-09-25).** The owner-driven enqueue never had a caller, so no upload
variant was ever generated. Variants are now queued where bank variants are —
at the end of practice, for a chapter a recovery session is being prepared for
(20261105000000): an upload answered from its file gets its own; an
AI-answered upload gets none of its own (§6.2), but when it was matched to a
bank question at filing, that bank question's variants are asked for. Until
they exist, an upload's recovery rungs are filled from the bank — its own
variants first, then the matched bank question's, then the chapter's questions,
its topic first (`_recovery_step_pool`, 20261104000000).

---

## §11 Not in scope

- Anything for school accounts. This is the individual tab only.
- Promoting notes, or the student's own questions, in any form.
- A human review queue for promotion — §10.2 is automatic by ruling.
- Sharing an upload between two accounts, including two exams held by the same
  phone number.

---

## §12 Acceptance

Nothing here counts until it is measured, in the browser, as a real individual
student, against the live database. Every check needs something that can make
it fail.

1. **The refusal battery (§4.5)** — six files that must be refused, and one
   real question paper that must be accepted.
   *Measured 2026-09-24:* `node scripts/measure-custom-practice-12-1.mjs` as
   CUET exam account — 6/6 unusable with one-line reasons and zero downstream
   rows; accept paper → `ready/questions`, 6 questions. Fixtures under
   `e2e-evidence/fixtures/custom-practice/`. Playwright twin:
   `e2e-evidence/custom-practice.spec.ts` (testMatch).
2. **A question paper end to end** — upload, questions extracted and tagged to
   real chapters, practise them, answer one wrong deliberately; then that
   mistake appears in the mistake book, recovery counts its chapter, revision
   schedules it, and analysis stops saying "not recorded yet".
   *Measured 2026-09-24:* `node scripts/measure-custom-practice-12-2.mjs` as
   CUET exam account — wrong upload attempt → open mistake with
   `upload_question_id` / bank null → recovery tier 0 `from_upload` →
   `revision_queue` reason `upload_wrong` → `practice_accuracy_pct` recorded.
   Blocker fixed live: `20261082000000` extends `_recovery_chapter_is_for` so
   upload/capture-practised chapters are entitled (KI58 was bank-only).
   Playwright twin: `e2e-evidence/custom-practice.spec.ts` §12.2 (API path;
   full Practice UI still a separate harness gap).
3. **A notes file end to end** — upload, notes produced topic-wise and
   chapter-wise, questions written from them, practised.
   *Status 2026-09-24:* notes path wired (`persistNotes` + chapter resolve);
   browser E2E pending same harness as §12.2.
4. **The privacy fence** — a second account (the same phone, a different exam)
   can read none of it: not the file, not the questions, not the notes, not the
   attempts. Each "cannot see" paired with a "can see" on the same query as its
   owner, or the check proves nothing.
   *Blocked 2026-09-24:* only CUET is active for the harness phone; no
   `exam_second` without MSG91 OTP. Owner must mint
   `E2E_EXAM_SECOND_REFRESH_TOKEN` (no backdoor).
5. **The promotion gates** — one variant that passes all four gates and reaches
   the bank; and one variant failing **each** gate in turn that does not. Four
   negative cases, not one.
   *Measured 2026-09-24:* `node scripts/measure-upload-promotion-12-5-real.mjs`
   — PASS (1 positive + 4 negatives + dispatch upload body + §10.4 provenance).
   KI74 closed.
6. **The AI-answered marker (§6)** — visible in practice and in the mistake
   book; disputing it clears the mistake and removes the attempt from accuracy.
   *Status 2026-09-24:* dispute-by-`upload_question_id` shipped (750); browser
   accuracy before/after still pending the exam Playwright harness.

---

## §13 Settled (ruled 2026-09-24, measured against §12.1 battery)

### Confidence threshold (§4.2) — **ruled: 0.55**

Same number as `IMAGE_DOUBT_CONFIDENCE_THRESHOLD` / `CONFIDENCE_THRESHOLD` in
`refusalGates.ts`. Measured 2026-09-24 against the §4.5 / §12.1 battery
(`node scripts/measure-custom-practice-12-1.mjs`):

| Fixture | Verdict | Confidence path |
|---|---|---|
| refuse-timetable.png | unusable | refused (blank grid / no study content) |
| refuse-blurry-dark.png | unusable | refused (black / unreadable) |
| refuse-prose.png | unusable | refused (no readable study content) |
| refuse-receipt.png | unusable | refused (no study content) |
| refuse-blank.png | unusable | refused (blank page) |
| refuse-chat.png | unusable | refused (no readable study content) |
| accept-real-mcq-paper.pdf | ready / questions | **accepted**, 6 questions written |

All six refusals left **zero** rows in `student_upload_questions`,
`student_upload_notes`, `question_attempts`, and `student_mistakes`. The accept
paper is the positive control. 0.55 did not false-refuse the accept paper and
did not false-accept any refuse fixture in this battery.

### Model that reads uploads — **ruled: `qwen/qwen3.7-flash` via OpenRouter**

`custom-practice-upload` classifies through `_shared/modelRouter.ts`
(`MODEL = "qwen/qwen3.7-flash"`). Why not `ai-gateway`: production still holds
two `_shared` modules that exist in no branch, so **ai-gateway cannot be
deployed from this repo** until that is reconciled (KNOWN_ISSUES edge-drift).
A dedicated function avoids that blocker (§13 original note).

### Page / size / keep limits — **ruled; one home each**

| Limit | Value | Home (enforced) | Client |
|---|---|---|---|
| Bytes per object | 20 MiB (`20971520`) | `storage.buckets.file_size_limit` on `student-uploads` + edge re-check after download | `uploadLimits.UPLOAD_MAX_BYTES` / `studentUploadFile.ts` mirrors only |
| Pages per upload | 20 | `custom-practice-upload` after media load (`UPLOAD_MAX_PAGES`) | mirrors only |
| Uploads kept per account | 40 | BEFORE INSERT trigger `_student_uploads_enforce_keep_cap` (migration `20261076000000`) | mirrors only |

Constants live in `src/academic/services/uploadLimits.ts` and
`supabase/functions/custom-practice-upload/refusalGates.ts` (Deno cannot import
from `src/`). Changing a limit means changing the **server home** first.

### Still needs the owner

- **§12.4 second exam account:** live currently has only CUET as an active exam
  for the harness phone. Automating MSG91 OTP needs a real SMS or a backdoor —
  we do neither. Owner must mint `E2E_EXAM_SECOND_REFRESH_TOKEN` for the same
  phone on a second exam (when that exam exists) so the privacy fence can be
  measured as specified.
- Promoting **main** onto this branch tip — leave pushed until the owner says so.
