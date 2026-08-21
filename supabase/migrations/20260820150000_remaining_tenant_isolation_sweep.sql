-- Second-pass sweep: the original school_id/pg_policies join (used for bugs
-- 1-3 and the battle family) only matched policies containing the literal
-- substrings has_role/is_principal_or_admin/is_school_operator/is_admin. A
-- widened word-boundary sweep for "admin"/"principal" found the SAME
-- cross-tenant anti-pattern phrased differently: `EXISTS (SELECT 1 FROM
-- user_roles WHERE user_id = auth.uid() AND role = ANY(ARRAY['admin',
-- 'principal']))`. This form was invisible to the first sweep. Re-ran with
-- both phrasings excluded (plus get_my_school_id()/same_school() as known-
-- safe) to get a complete list. question_bank's "qb_staff_manage" and
-- "qb_teacher_insert" matched the broad regex but are CONFIRMED SAFE
-- (already scoped via `school_id = get_my_school_id()`) -- verified before
-- writing this file, not touched here.
--
-- Two tables (homework, library_checkouts) turned out to have a NEWER,
-- already-correctly-scoped policy sitting alongside an OLDER, unscoped
-- legacy policy granting the identical access -- classic incomplete-
-- migration sprawl. Since RLS policies OR together, the old unscoped policy
-- silently defeated the newer scoped one. Confirmed each old policy's
-- legitimate sub-case (e.g. a student's own-row read) is independently
-- covered by another still-existing policy before dropping it outright,
-- rather than rewriting it to duplicate the already-correct one.
--
-- dpp_questions/dpp_attempts/dpp_answers have the SAME missing-school_id-
-- on-insert root cause as the battle family (rpc_dpp_pick_from_bank,
-- rpc_dpp_start, rpc_dpp_submit all insert with an explicit column list that
-- never included school_id) -- currently masked by only 2 demo rows per
-- table having been created via a different path. Fixed here alongside the
-- RLS so the same "backfill trap" from the battle family can't recur (in
-- this case there's nothing to backfill -- 0 NULL rows currently -- but the
-- insert paths would have started producing NULLs on the very next real
-- student DPP attempt).

-- ── class_timetables ────────────────────────────────────────────────────
CREATE TRIGGER trg_class_timetables_set_school
  BEFORE INSERT ON public.class_timetables
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP POLICY IF EXISTS "timetable write" ON public.class_timetables;
CREATE POLICY "timetable write" ON public.class_timetables FOR ALL
  USING (
    (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
    OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id))
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_timetables.class_id)
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
    OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id))
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_timetables.class_id)
  );

-- ── device_tokens ───────────────────────────────────────────────────────
CREATE TRIGGER trg_device_tokens_set_school
  BEFORE INSERT ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP POLICY IF EXISTS "device_tokens admin read" ON public.device_tokens;
CREATE POLICY "device_tokens admin read" ON public.device_tokens FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

-- ── dpps ────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_dpps_set_school
  BEFORE INSERT ON public.dpps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP POLICY IF EXISTS "dpps admin all" ON public.dpps;
CREATE POLICY "dpps admin all" ON public.dpps FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

DROP POLICY IF EXISTS "dpps principal read" ON public.dpps;
CREATE POLICY "dpps principal read" ON public.dpps FOR SELECT
  USING (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id));

-- ── dpp_questions: fix insert paths first, then RLS ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_pick_from_bank(_dpp_id uuid, _count integer DEFAULT 5, _difficulty text DEFAULT NULL::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _d record; _n int := 0; _start int;
BEGIN
  SELECT * INTO _d FROM public.dpps WHERE id = _dpp_id;
  IF _d IS NULL THEN RAISE EXCEPTION 'DPP not found'; END IF;
  IF NOT (teacher_teaches_class(auth.uid(), _d.class_id) OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT COALESCE(MAX(order_index)+1, 0) INTO _start FROM public.dpp_questions WHERE dpp_id = _dpp_id;

  WITH picked AS (
    SELECT question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_d.subject)
      AND (_d.chapter IS NULL OR chapter ILIKE _d.chapter)
      AND (_difficulty IS NULL OR difficulty = _difficulty)
    ORDER BY random() LIMIT GREATEST(_count,1)
  ), ins AS (
    INSERT INTO public.dpp_questions (dpp_id, order_index, kind, question, options, correct, marks, explanation, school_id)
    SELECT _dpp_id, _start + (row_number() OVER ()) - 1, 'mcq'::dpp_question_kind,
           question, options, jsonb_build_object('indexes', jsonb_build_array(correct_index)),
           1, explanation, _d.school_id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  UPDATE public.dpps SET
    question_count = (SELECT count(*) FROM public.dpp_questions WHERE dpp_id = _dpp_id),
    total_marks = (SELECT COALESCE(SUM(marks),0) FROM public.dpp_questions WHERE dpp_id = _dpp_id)
  WHERE id = _dpp_id;
  RETURN _n;
END $function$;

DROP POLICY IF EXISTS "dppq admin all" ON public.dpp_questions;
CREATE POLICY "dppq admin all" ON public.dpp_questions FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    AND EXISTS (SELECT 1 FROM public.dpps d WHERE d.id = dpp_questions.dpp_id AND public.same_school(d.school_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    AND EXISTS (SELECT 1 FROM public.dpps d WHERE d.id = dpp_questions.dpp_id AND public.same_school(d.school_id))
  );

-- ── dpp_attempts: fix insert path first, then RLS ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_start(_dpp_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _aid uuid;
  _sid uuid;
  _max numeric;
  _cnt int;
  _published boolean := false;
  _class uuid;
  _status text;
  _school uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT
    COALESCE(is_published, false)
      OR lower(COALESCE(status, '')) = 'published',
    class_id,
    status,
    school_id
  INTO _published, _class, _status, _school
  FROM public.dpps
  WHERE id = _dpp_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test not found';
  END IF;

  IF NOT _published THEN
    -- Teachers / operators may still preview via service paths; students may not start.
    IF NOT (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    ) THEN
      RAISE EXCEPTION 'This test is not published yet';
    END IF;
  END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = auth.uid() LIMIT 1;
  IF _sid IS NOT NULL AND _class IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = _sid AND s.class_id = _class
    ) THEN
      -- Allow teachers starting preview attempts without class membership
      IF NOT (
        public.has_role(auth.uid(), 'teacher')
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      ) THEN
        RAISE EXCEPTION 'Not enrolled in this class';
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(SUM(marks), 0), count(*)
  INTO _max, _cnt
  FROM public.dpp_questions
  WHERE dpp_id = _dpp_id;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, school_id)
  VALUES (_dpp_id, auth.uid(), _sid, _max, _cnt, _school)
  ON CONFLICT (dpp_id, user_id) DO UPDATE
    SET max_score = EXCLUDED.max_score,
        total_count = EXCLUDED.total_count
  RETURNING id INTO _aid;

  RETURN _aid;
END;
$function$;

DROP POLICY IF EXISTS "dppa admin all" ON public.dpp_attempts;
CREATE POLICY "dppa admin all" ON public.dpp_attempts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

-- ── dpp_answers: fix insert path first, then RLS ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _att record; _q record; _ans record; _correct boolean; _award numeric;
  _score numeric := 0; _correct_n int := 0; _total int := 0; _neg numeric;
  _resp jsonb; _selected jsonb; _val numeric; _tol numeric; _has_answer boolean;
  _accuracy numeric := 0;
BEGIN
  SELECT * INTO _att FROM public.dpp_attempts WHERE id = _attempt_id;
  IF NOT FOUND OR _att.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN
    RETURN jsonb_build_object(
      'score', COALESCE(_att.score, 0),
      'correct_count', COALESCE(_att.correct_count, 0),
      'total_count', COALESCE(_att.total_count, 0),
      'accuracy', CASE
        WHEN COALESCE(_att.total_count, 0) > 0
          THEN round(100.0 * COALESCE(_att.correct_count, 0) / _att.total_count, 1)
        ELSE 0
      END,
      'already_submitted', true
    );
  END IF;

  -- Optional bulk answers payload (legacy clients)
  IF _answers IS NOT NULL AND jsonb_typeof(_answers) = 'object' THEN
    FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
      IF _answers ? _q.id::text THEN
        INSERT INTO public.dpp_answers (attempt_id, question_id, response, school_id)
        VALUES (_attempt_id, _q.id, _answers->_q.id::text, _att.school_id)
        ON CONFLICT (attempt_id, question_id) DO UPDATE SET response = EXCLUDED.response;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(negative_marking, 0) INTO _neg FROM public.dpps WHERE id = _att.dpp_id;
  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    _total := _total + 1;
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    _has_answer := FOUND; _correct := false; _award := 0;
    IF _has_answer THEN
      _resp := _ans.response;
      IF _q.kind IN ('mcq','multi') THEN
        _selected := COALESCE(_resp->'indexes','[]'::jsonb);
        IF jsonb_array_length(_selected) > 0 AND
           (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_selected) AS value)
           = (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(COALESCE(_q.correct->'indexes','[]'::jsonb)) AS value)
        THEN _correct := true; END IF;
      ELSIF _q.kind = 'numerical' THEN
        IF _resp ? 'value' AND (_resp->>'value') IS NOT NULL THEN
          BEGIN
            _val := (_resp->>'value')::numeric;
            _tol := COALESCE((_q.correct->>'tolerance')::numeric, 0);
            IF abs(_val - (_q.correct->>'value')::numeric) <= _tol THEN _correct := true; END IF;
          EXCEPTION WHEN others THEN
            _correct := false;
          END;
        END IF;
      ELSIF _q.kind = 'short' THEN
        IF lower(trim(COALESCE(_resp->>'text',''))) = lower(trim(COALESCE(_q.correct->>'text',''))) AND
           length(trim(COALESCE(_resp->>'text',''))) > 0 THEN _correct := true; END IF;
      END IF;
      IF _correct THEN _award := COALESCE(_q.marks, 1); _correct_n := _correct_n + 1;
      ELSIF _resp <> '{}'::jsonb THEN _award := -1 * COALESCE(_neg, 0); END IF;
      UPDATE public.dpp_answers SET is_correct = _correct, marks_awarded = _award WHERE id = _ans.id;
      _score := _score + _award;
    END IF;
  END LOOP;

  UPDATE public.dpp_attempts SET status = 'submitted', submitted_at = now(),
    score = _score, correct_count = _correct_n, total_count = _total,
    time_spent_sec = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::int, 0)
  WHERE id = _attempt_id;

  -- Progression Engine owns student_xp.xp / level / league — do not bump here.
  BEGIN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'first_dpp','bronze')
      ON CONFLICT (user_id, badge_code) DO NOTHING;
    IF _total > 0 AND _correct_n = _total THEN
      INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'dpp_perfect','gold')
        ON CONFLICT (user_id, badge_code) DO NOTHING;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  PERFORM public._capture_dpp_mistakes(_attempt_id);
  BEGIN
    PERFORM public._bump_academic_activity(auth.uid(), 1, 0, 0, GREATEST(COALESCE(_att.time_spent_sec,0) / 60, 1));
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF _total > 0 THEN
    _accuracy := round(100.0 * _correct_n / _total, 1);
  END IF;

  RETURN jsonb_build_object(
    'score', _score,
    'correct_count', _correct_n,
    'total_count', _total,
    'accuracy', _accuracy,
    'already_submitted', false
  );
END; $function$;

DROP POLICY IF EXISTS "dppans admin all" ON public.dpp_answers;
CREATE POLICY "dppans admin all" ON public.dpp_answers FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

-- ── homework: redundant legacy policy, already-scoped replacement exists ──
-- Confirmed "homework admin all" (has_role(admin) AND same_school) and
-- "homework principal read" (has_role(principal) AND same_school) already
-- grant the identical access, correctly scoped. "Admins can manage all
-- homework" duplicated this with zero school check, silently defeating the
-- correct policies (RLS policies OR together). Dropped, not rewritten.
DROP POLICY IF EXISTS "Admins can manage all homework" ON public.homework;

-- ── homework_submissions: three separate unscoped policies, fixed in place
--    (not consolidated -- "Admins can manage all submissions" grants
--    principal write/delete, not just read, unlike hw_sub principal read;
--    preserving that distinction rather than silently narrowing it as a
--    side effect of a tenant-isolation fix) ──────────────────────────────
DROP POLICY IF EXISTS "Admins can manage all submissions" ON public.homework_submissions;
CREATE POLICY "Admins can manage all submissions" ON public.homework_submissions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = ANY (ARRAY['admin'::app_role, 'principal'::app_role]))
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "hw_sub admin all" ON public.homework_submissions;
CREATE POLICY "hw_sub admin all" ON public.homework_submissions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

DROP POLICY IF EXISTS "hw_sub principal read" ON public.homework_submissions;
CREATE POLICY "hw_sub principal read" ON public.homework_submissions FOR SELECT
  USING (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id));

-- ── library_checkouts: redundant legacy policy, already-scoped replacement
--    exists ("checkouts admin all"); the legitimate student-self-read case
--    is independently covered by "checkouts student read" ─────────────────
DROP POLICY IF EXISTS "Students view own checkouts" ON public.library_checkouts;

-- ── question_records: read-only, write path already confirmed correct
--    (rpc_record_question_attempt derives school_id properly) ────────────
DROP POLICY IF EXISTS "qrec teacher" ON public.question_records;
CREATE POLICY "qrec teacher" ON public.question_records FOR SELECT
  USING (
    (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
    OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id))
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = question_records.user_id AND teacher_teaches_class(auth.uid(), s.class_id))
  );

-- ── attendance_locks: RLS gap only (separate from the still-pending
--    enforcement-logic gap on the actual attendance write path) ─────────
DROP POLICY IF EXISTS "locks admin delete" ON public.attendance_locks;
CREATE POLICY "locks admin delete" ON public.attendance_locks FOR DELETE
  USING (is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

DROP POLICY IF EXISTS "locks teacher insert" ON public.attendance_locks;
CREATE POLICY "locks teacher insert" ON public.attendance_locks FOR INSERT
  WITH CHECK (
    (teacher_teaches_class(auth.uid(), class_id) OR is_principal_or_admin(auth.uid()))
    AND public.same_school(school_id)
  );

CREATE TRIGGER trg_attendance_locks_set_school
  BEFORE INSERT ON public.attendance_locks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();
