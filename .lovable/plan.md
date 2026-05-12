## Battleground — Premium Academic Competition Feature

A new gamified section in the Student Panel where students join live quiz battles, challenge classmates, climb leaderboards, earn XP/badges, and track subject-wise performance. Built mobile-first with animated, premium visuals.

### Scope (V1)

A complete, working battleground with real backend persistence — not a mock. Students can create/join MCQ battles tied to their class, answer timed questions, see live leaderboards, earn XP & badges, and view a gamified profile with subject insights.

### User Flow

```
Student Dashboard
   └─ "Battleground" (new nav item)
        ├─ Arena (Home)         → Live & upcoming battles, daily challenge, hero stats
        ├─ Challenges            → Create/Challenge classmates, browse public class battles
        ├─ Battle Room           → Live MCQ battle with timer + live leaderboard
        ├─ Leaderboard           → Class & global rankings, top 3 podium
        ├─ Achievements          → Badges (Bronze→Platinum), XP level, streaks
        └─ My Stats              → Subject strengths/weaknesses, win history, progress rings
```

### Backend (Lovable Cloud)

New tables:
- **battles** — id, class_id, creator_id, title, subject, topic, type (mcq/rapid/timed), status (scheduled/live/finished), starts_at, duration_sec, question_count, is_public, created_at
- **battle_questions** — id, battle_id, order_index, question, options (jsonb), correct_index, points
- **battle_participants** — id, battle_id, student_id, joined_at, score, correct_count, time_taken_ms, finished_at, rank
- **battle_answers** — id, participant_id, question_id, selected_index, is_correct, time_ms
- **student_xp** — student_id (PK), xp, level, current_streak, longest_streak, total_battles, wins, last_battle_at
- **student_badges** — id, student_id, badge_code, tier (bronze/silver/gold/platinum), earned_at
- **daily_challenges** — id, date, title, subject, target_type, target_value (seeded daily; per-student progress derived)

Views/RPCs:
- `rpc_join_battle(battle_id)` — inserts participant, validates class membership
- `rpc_submit_answer(participant_id, question_id, selected_index, time_ms)` — scores, updates leaderboard
- `rpc_finish_battle(participant_id)` — finalizes rank, awards XP, checks badge unlocks
- `rpc_subject_insights(student_id)` — returns per-subject accuracy from battle_answers + marks
- Realtime enabled on `battle_participants` & `battle_answers` for live leaderboard

RLS:
- battles: SELECT for classmates if `is_public=true` and same class; admin/teacher full
- participants/answers: student manages own; classmates can read scores of public battles in their class
- xp/badges: self read, admin write via RPC

Question seeding: For V1, battle creator picks subject + topic and we generate a small built-in question bank stored in `battle_questions` (creator-supplied via a simple form, or auto-pulled from a seed table). Keeps it self-contained.

### Frontend

Routes (all under student panel):
- `/student/battleground` — Arena home
- `/student/battleground/challenges`
- `/student/battleground/create`
- `/student/battleground/battle/:id` — battle room (live)
- `/student/battleground/leaderboard`
- `/student/battleground/achievements`
- `/student/battleground/stats`

Key components:
- `BattleCard` — animated gradient card, glow, countdown timer, join button
- `LeaderboardLive` — realtime ranks with rank-change animation, top 3 podium, current-user highlight
- `BattleRoom` — full-screen quiz UI: timer ring, question, 4 option cards, instant feedback
- `XPRing` / `LevelBadge` — animated SVG progress ring
- `BadgeCard` — tier-colored (bronze/silver/gold/platinum) with shine
- `SubjectInsightCard` — strong/weak bars per subject from `marks` + battle accuracy
- `StreakFlame` — daily streak indicator
- `DailyChallengeBanner` — hero call-to-action

Design system:
- Reuse existing semantic tokens; add battleground-specific gradients + tier colors as CSS vars in `index.css`
- Animations: fade-in, scale-in, custom keyframes for rank-up pulse, glow, countdown
- Mobile-first; bottom-sheet style modals for join/create on small screens

### Files

**New**:
- `supabase/migrations/<timestamp>_battleground.sql`
- `src/pages/student/Battleground.tsx` (Arena home)
- `src/pages/student/battleground/Challenges.tsx`
- `src/pages/student/battleground/CreateBattle.tsx`
- `src/pages/student/battleground/BattleRoom.tsx`
- `src/pages/student/battleground/Leaderboard.tsx`
- `src/pages/student/battleground/Achievements.tsx`
- `src/pages/student/battleground/MyStats.tsx`
- `src/components/battleground/BattleCard.tsx`
- `src/components/battleground/LeaderboardLive.tsx`
- `src/components/battleground/XPRing.tsx`
- `src/components/battleground/BadgeCard.tsx`
- `src/components/battleground/SubjectInsightCard.tsx`
- `src/components/battleground/CountdownTimer.tsx`
- `src/components/battleground/StreakFlame.tsx`

**Edited**:
- `src/pages/StudentDashboard.tsx` — add Battleground nav entry + routes, hero "Enter Battleground" tile
- `src/index.css` / `tailwind.config.ts` — gradients, tier colors, battleground keyframes

### Out of scope for V1 (can extend later)
- Class-vs-class team battles (single-player ranked battles only in V1)
- Push notifications for battle invites
- AI-generated questions (creator supplies questions in V1)
- Anti-cheat / proctoring

Approve to proceed and I'll run the migration, then build the UI.