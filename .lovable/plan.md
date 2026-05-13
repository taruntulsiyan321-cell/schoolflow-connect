# Refinement Plan — Student & Teacher Panels + Battleground Scale-Up

This refines the existing ecosystem (no rebuild). Three workstreams shipped together.

---

## 1. Battleground Infrastructure (biggest backend change)

### New tables
- `question_bank` — `id, class_level (int 1-12, nullable for "any"), subject, chapter, topic, difficulty (easy|medium|hard), question, options (jsonb), correct_index, explanation, source, created_by, is_approved (bool)`
- `battle_topics` — curated `subject → chapters → topics` taxonomy used by the Create Battle picker.
- `battle_invites` — `battle_id, invited_user_id, status (pending|accepted|declined)` for class invites.
- Add to `battles`: `mode (solo|class|invite|teacher)`, `source (manual|bank)`, `class_level`, `chapter`, `difficulty`.

### New RPC
- `rpc_generate_battle(_battle_id uuid)` — pulls N random approved questions from `question_bank` matching class/subject/chapter/topic/difficulty filters, inserts into `battle_questions`. Called when creator chooses "Auto pool" mode.
- `rpc_create_quick_battle(_subject, _chapter, _difficulty, _count)` — creates battle + auto-fills questions in one shot for instant play.

### Seed content
Insert ~400-600 curated MCQs across:
- Math, Science, English, Social Studies, GK, Computer
- Class levels 6–12
- Easy/Medium/Hard
Stored via `supabase--insert`. This gives instant replayability without manual creation.

### RLS
- `question_bank`: read = authenticated; write = admin/teacher; approve = admin/principal.
- `battle_invites`: insert = battle creator; read = invitee or creator; update status = invitee.

### Frontend
- **Create Battle** revamp: tabs `[Quick Play] [Custom Pool] [Manual Questions] [Invite Friends]`.
  - Quick Play: pick subject + difficulty → instant battle from bank.
  - Custom Pool: subject → chapter → topic → difficulty → count.
  - Invite: multi-select classmates.
- **Arena**: separate "Live Now", "Open to join", "My invites", "Recent results" rails.
- **Results screen**: speed, accuracy, rank, weak-topic chips, class comparison bar.
- **Teacher Battleground tab** in Teacher Dashboard: launch class competition, view aggregate results, weak topics across class.

---

## 2. Student Panel Polish

### Dashboard (`StudentDashboard.tsx`)
- Reorganize into intelligent priority rails:
  1. **Today** — pending homework due today, upcoming exam, attendance status
  2. **Battleground hero** — current XP ring, streak, "Quick Battle" CTA, active invites count
  3. **Academic pulse** — recent marks, class rank delta, attendance %
  4. **Notices & alerts** — unread notices, fee dues
  5. **Class activity** — recent battle wins by classmates, new homework
- Reduce gradient/glow density: keep one hero gradient, switch other cards to `bg-card` + subtle border.

### Leaderboards (new `LeaderboardPage` enhancement)
Tabs: Overall · Attendance · Marks · Battleground Wins · Streak · Homework · Improvement · Consistency.
Each tab queries existing tables (attendance, marks, student_xp, homework_submissions) and ranks classmates.

### Badges & Profile
- Expand badge catalog (config in `src/lib/badges.ts`): ~25 badges across tiers (bronze/silver/gold/platinum/legendary) — Attendance King, Homework Warrior, Quiz Champion, Battleground Master, Subject Topper, Fast Solver, Streak Legend, etc.
- Add `equipped_badge` column to `student_xp`.
- Profile page shows: equipped badge prominently, badge collection grid, battle stats, attendance ring, subject strengths bar chart, class rank, streak flame.

### Class Ecosystem
- `StudentClassesPage` upgrade: classmates grid (avatars + equipped badges), class teacher card, mini-leaderboard, recent class battles, class notices.

### Visual maturity pass
- In `index.css` tone down `--shadow-battle` and `--shadow-glow` (lower opacity).
- Replace `bg-gradient-battle` on non-hero cards with `bg-card`.
- Standardize spacing scale: `p-4 / p-6` cards, `gap-4` grids, `space-y-6` sections.

---

## 3. Teacher Panel Polish

### Dashboard (`TeacherDashboard.tsx`)
Contextual cards in priority order:
1. **Today's classes** — timetable strip
2. **Action queue** — pending homework to grade, ungraded exams, leave requests count
3. **Battleground tab** — launch competition, recent class battle results
4. **Class pulse** — attendance % today, students absent, top performers, students needing attention
5. **Quick actions** — Mark Attendance, Upload Homework, Create Exam, Post Notice, Launch Battle

### Class Management
- Class detail page: students grid → click → student academic snapshot (attendance, marks trend, battle stats, homework status).
- Add "Launch Battle for this class" button.

### Visual polish
- Calm professional palette (less gradient), structured tables, consistent card sizing, breadcrumbs on detail pages.

---

## Technical / Files

### Migration (one)
- New tables: `question_bank`, `battle_topics`, `battle_invites`
- Alter `battles`: add `mode`, `source`, `class_level`, `chapter`, `difficulty`
- Alter `student_xp`: add `equipped_badge text`
- New RPCs: `rpc_generate_battle`, `rpc_create_quick_battle`
- RLS policies for all new tables

### Seed
- Bulk insert ~500 MCQs via `supabase--insert`

### New files
- `src/lib/badges.ts` — badge catalog + helpers
- `src/components/leaderboards/LeaderboardTabs.tsx`
- `src/components/student/DashboardRails.tsx`
- `src/components/teacher/ActionQueue.tsx`
- `src/pages/teacher/TeacherBattleground.tsx`
- `src/components/battleground/QuickPlay.tsx`, `InviteFriends.tsx`, `ResultsScreen.tsx`

### Edited files
- `src/index.css` — tone shadows
- `src/pages/StudentDashboard.tsx`, `TeacherDashboard.tsx`
- `src/pages/student/Battleground.tsx` (add Quick Play, invites, richer results)
- `src/pages/shared/LeaderboardPage.tsx`
- `src/pages/shared/StudentClassesPage.tsx`
- `src/pages/shared/StudentProfilePage.tsx`

---

## Out of scope (V1)
- AI question generation (bank is curated/seeded)
- Push notifications for invites (in-app only)
- Cross-class tournaments
- Anti-cheat / proctoring
- Custom badge artwork (use icon + tier color)

## Risks
- Question bank seeding is large — keeping it curated to ~500 to stay within migration size; can expand later.
- Existing `battles.creator_user_id` and RLS preserved; new columns are nullable with defaults.
