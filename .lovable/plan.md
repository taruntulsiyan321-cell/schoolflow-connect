# DPP Ecosystem — Implementation Plan

A production-grade Daily Practice Problems system integrated into the existing Teacher and Student panels, reusing the question_bank, badges, and XP infrastructure already built for Battleground.

## Scope

**In:** Teacher DPP authoring (manual + bank pick + clone), assignment to classes, student attempt flow, auto-evaluation, private results, teacher analytics dashboard, integration with XP/badges/leaderboards.

**Out (future):** AI-generated questions, internet scraping, paid question packs, parent visibility, push reminders.

## Database

New tables (all RLS-protected):

```text
dpps
  id, title, subject, chapter, topic, class_id, created_by,
  difficulty, instructions, due_at, duration_sec, total_marks,
  negative_marking numeric default 0, is_published bool,
  question_count int, created_at, updated_at

dpp_questions
  id, dpp_id, order_index, kind ('mcq'|'multi'|'numerical'|'short'),
  question, options jsonb, correct jsonb, -- {indexes:[]} or {value, tolerance} or {text}
  marks int default 1, explanation text

dpp_attempts
  id, dpp_id, user_id, student_id, started_at, submitted_at,
  score numeric, max_score numeric, correct_count, total_count,
  time_spent_sec, status ('in_progress'|'submitted')
  unique(dpp_id, user_id)

dpp_answers
  id, attempt_id, question_id, response jsonb, is_correct bool,
  marks_awarded numeric, time_ms int
```

**RPCs:**
- `rpc_dpp_pick_from_bank(_dpp_id, _count, _difficulty?)` — copies questions from `question_bank` into `dpp_questions`.
- `rpc_dpp_submit(_attempt_id)` — evaluates all answers, computes score with negative marking, locks attempt, awards XP/badges.

**RLS rules:**
- `dpps`: read by class students + teachers of class + admin; write by creator teacher / admin.
- `dpp_questions`: read by anyone who can read parent dpp **and** (teacher/admin OR has submitted attempt OR dpp is currently active for student). Correct answers exposed only after submission via view/RPC.
- `dpp_attempts`: student reads own; teacher of class reads all for their dpps; admin all.
- `dpp_answers`: same as attempts.
- **Privacy:** results only visible to attempting student + teacher of the dpp's class + admin. No classmate read.

## Backend logic

`rpc_dpp_submit` evaluates per-question:
- mcq/multi → compare selected indexes to correct
- numerical → `abs(value - correct.value) <= correct.tolerance`
- short → exact case-insensitive match (manual override later)
- negative marking applied to wrong (not skipped)
- Awards `dpp.completion_xp = score` to `student_xp`, badges (`first_dpp`, `dpp_streak_7`, `dpp_perfect`).

## Frontend

### Teacher Panel — new routes under `/teacher`
- `src/pages/teacher/DppList.tsx` — list of created DPPs, filter by class/published status, "Create DPP" CTA.
- `src/pages/teacher/DppEditor.tsx` — tabbed: Details / Questions / Review & Publish.
  - Question composer with type switcher (MCQ/Multi/Numerical/Short).
  - "Pick from bank" drawer → calls `rpc_dpp_pick_from_bank`.
  - Clone from previous DPP.
- `src/pages/teacher/DppAnalytics.tsx` — per-DPP analytics: participation %, avg score, topper list, question-wise accuracy bar chart, hardest/easiest, completion-time histogram, weak-topic chips.

### Student Panel — new routes under `/student`
- `src/pages/student/DppHub.tsx` — three rails: Active (due), Upcoming, Completed (with score chip).
- `src/pages/student/DppAttempt.tsx` — single-question paginated runner with timer, palette, autosave per question, submit-confirm.
- `src/pages/student/DppResult.tsx` — score ring, accuracy, time, question-by-question with correct answer + explanation, weak-topic summary.

### Shared components
- `src/components/dpp/QuestionRenderer.tsx` — handles all 4 question kinds, read/attempt/review modes.
- `src/components/dpp/DppCard.tsx` — compact card used across hubs.
- `src/components/dpp/ScoreRing.tsx` — reuse XPRing pattern.

### Navigation
- Add "DPP" item to TeacherDashboard sidebar and StudentDashboard sidebar with hero tile on student dashboard ("Today's DPP").

## Design

Stay within existing semantic tokens. Calm institutional palette — no extra glow. Reuse `Card`, `Tabs`, `Progress`, `Button` from shadcn. Mobile-first attempt screen (single question per viewport, sticky timer + nav).

## Out of scope (call out explicitly)
- AI question generation (architecture leaves room: `dpp_questions.source` future column).
- Internet scraping.
- Manual short-answer grading workflow (auto-match only for v1).
- Push notifications for due DPPs.

## Deliverables checklist
1. Migration: 4 tables + 2 RPCs + RLS.
2. Teacher: list, editor (3 tabs), analytics page.
3. Student: hub, attempt runner, result page.
4. Sidebar entries + dashboard tiles for both roles.
5. Reuse XP/badges via `rpc_dpp_submit`.
