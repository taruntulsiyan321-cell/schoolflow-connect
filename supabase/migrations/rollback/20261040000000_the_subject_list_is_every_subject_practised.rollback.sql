-- ROLLBACK for 20261040000000_the_subject_list_is_every_subject_practised.
--
-- READ THIS FIRST. This removes `by_subject` from
-- rpc_student_practice_analytics, which leaves the Subjects & Chapters tab
-- with no subject rows and an empty radar — the page reads that key directly.
--
-- It does NOT restore the previous behaviour, which was to read
-- rpc_student_performance_charts.subjects: that path was removed from the page
-- because it aggregates _weak_topics_for_user and therefore only sees subjects
-- whose attempts resolve to a topic in the bank. Measured, it showed one
-- subject of six.
--
-- To go back properly, revert the page alongside this. Rolling back the
-- function alone is only useful to drop the added key.

-- Re-applies 20261039000000's definition, which is this function without
-- by_subject. Kept as a file rather than re-derived so the rollback cannot
-- silently ship a third variant.
DO $$
BEGIN
  RAISE EXCEPTION 'apply supabase/migrations/20261039000000_the_attempt_record_answers_the_questions_analysis_asks.sql to restore the pre-by_subject definition; this file refuses to hold a second copy of it';
END $$;
