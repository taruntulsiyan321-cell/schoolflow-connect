-- Gap closure pass, 2026-08-22: 13 of the 14 enum-like text columns flagged
-- in Phase 1 as having no DB-level CHECK constraint. Every value set below
-- was derived from actual write-site evidence (TS union types where they
-- exist -- HomeworkPriority, AnnouncementStatus, TeacherStatus -- or grepped
-- literal values at every real INSERT/UPDATE call site across migrations
-- and src/), unioned with everything currently live, never narrowed to only
-- what's live today (several of these columns have only 1-2 distinct values
-- live but a materially larger set of legitimate values used by code paths
-- that just haven't fired yet -- e.g. question_attempts.source has only
-- 'practice' live but 'battle'/'dpp'/'mistake_book' are real, confirmed
-- values from rpc_record_concept_mistake and Practice.tsx's retry flow).
--
-- notifications.type is deliberately EXCLUDED from this pass: it's used as
-- a free-form routing/categorization tag across dozens of call sites with
-- two different conventions in play (short words like 'homework' and
-- dotted event-style strings like 'attendance.risk_alert'), and a from-
-- scratch grep already turned up 40+ distinct values with no sign of a
-- closed set by design. An incomplete CHECK here has real odds of silently
-- breaking a working notification path the next time a rarer event type
-- fires -- worse than the gap it would close. Left open; flagging precisely
-- rather than silently endorsing it as fine.

ALTER TABLE public.approval_requests
  ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.battle_events
  ADD CONSTRAINT battle_events_kind_check
  CHECK (kind IN ('challenge', 'flawless', 'join', 'streak', 'win', 'badge'));

ALTER TABLE public.battle_invites
  ADD CONSTRAINT battle_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'declined'));

ALTER TABLE public.battles
  ADD CONSTRAINT battles_source_check
  CHECK (source IN ('bank', 'challenge', 'class', 'custom', 'featured_daily', 'featured_ncert', 'featured_weekly', 'mistake_book', 'open', 'quick', 'solo'));

ALTER TABLE public.concept_mastery
  ADD CONSTRAINT concept_mastery_classification_check
  CHECK (classification IS NULL OR classification IN ('weak', 'average', 'strong', 'mastered'));

ALTER TABLE public.exams
  ADD CONSTRAINT exams_status_check
  CHECK (status IN ('scheduled', 'ongoing', 'completed', 'cancelled'));

ALTER TABLE public.homework
  ADD CONSTRAINT homework_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

ALTER TABLE public.notices
  ADD CONSTRAINT notices_status_check
  CHECK (status IN ('draft', 'published', 'scheduled'));

ALTER TABLE public.progression_history
  ADD CONSTRAINT progression_history_source_type_check
  CHECK (source_type IN ('dpp_attempt', 'battle_participant', 'practice_session', 'recovery_assignment'));

ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source IN ('battle', 'dpp', 'practice', 'mistake_book'));

ALTER TABLE public.recovery_assignments
  ADD CONSTRAINT recovery_assignments_source_type_check
  CHECK (source_type IN ('practice', 'dpp', 'battle'));

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_assessment_type_check
  CHECK (assessment_type IN ('practice', 'dpp', 'battle'));

ALTER TABLE public.teachers
  ADD CONSTRAINT teachers_status_check
  CHECK (status IN ('active', 'inactive', 'suspended'));
