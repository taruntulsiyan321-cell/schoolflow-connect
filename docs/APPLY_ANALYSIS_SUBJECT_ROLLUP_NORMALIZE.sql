-- Apply helper: Analysis subject rollup with alias normalize + placeholder filter.
-- Mirrors supabase/migrations/20260802610000_analysis_subject_rollup_normalize.sql

CREATE OR REPLACE FUNCTION public._normalize_subject_label(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN NULL
    WHEN lower(btrim(raw)) IN ('subject', 'topic', 'daily', 'general', 'concept', 'chapter', 'mixed')
      THEN NULL
    WHEN lower(btrim(raw)) IN ('maths', 'math', 'mathematics') THEN 'Mathematics'
    WHEN lower(btrim(raw)) IN ('accounts', 'accountancy', 'accounting') THEN 'Accountancy'
    WHEN lower(btrim(raw)) IN ('bst', 'business studies', 'business studies (bst)') THEN 'Business Studies'
    WHEN lower(btrim(raw)) IN ('eco', 'economics') THEN 'Economics'
    WHEN lower(btrim(raw)) IN ('english', 'english core') THEN 'English'
    WHEN lower(btrim(raw)) IN ('hindi', 'hindi core') THEN 'Hindi'
    WHEN lower(btrim(raw)) = 'physics' THEN 'Physics'
    WHEN lower(btrim(raw)) = 'chemistry' THEN 'Chemistry'
    WHEN lower(btrim(raw)) = 'biology' THEN 'Biology'
    ELSE btrim(raw)
  END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_student_performance_charts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN jsonb_build_object(
    'subjects', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.accuracy DESC), '[]'::jsonb)
      FROM (
        SELECT
          public._normalize_subject_label(w.subject) AS name,
          ROUND(100.0 * SUM(w.correct) / NULLIF(SUM(w.attempts), 0), 1)::numeric AS accuracy,
          SUM(w.attempts)::int AS attempts
        FROM public._weak_topics_for_user(_uid) w
        WHERE public._normalize_subject_label(w.subject) IS NOT NULL
        GROUP BY public._normalize_subject_label(w.subject)
      ) t
    ),
    'weekly_activity', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', activity_date,
        'total', dpp_count + homework_count + battle_count + self_practice_count,
        'dpp', dpp_count,
        'battles', battle_count,
        'self_practice', self_practice_count
      ) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity
      WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28
    ),
    'dpp_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', date_trunc('day', submitted_at)::date,
        'score_pct', round(100.0 * score / NULLIF(max_score, 0), 1)
      ) ORDER BY date_trunc('day', submitted_at)), '[]'::jsonb)
      FROM public.dpp_attempts
      WHERE user_id = _uid AND status = 'submitted' AND submitted_at >= now() - interval '30 days'
    ),
    'practice_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', date_trunc('day', finished_at)::date,
        'score_pct', round(100.0 * correct_count / NULLIF(question_count, 0), 1),
        'chapter', chapter
      ) ORDER BY date_trunc('day', finished_at)), '[]'::jsonb)
      FROM public.practice_sessions
      WHERE user_id = _uid AND finished_at IS NOT NULL
        AND finished_at >= now() - interval '30 days'
        AND chapter IS NOT NULL
        AND lower(btrim(chapter)) NOT IN ('subject', 'topic', 'daily', 'general', 'concept', 'chapter', 'mixed')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_student_performance_charts() TO authenticated;
GRANT EXECUTE ON FUNCTION public._normalize_subject_label(text) TO authenticated;
