-- ROOT CAUSE FIX (not a symptom patch): the entire Battleground creation
-- subsystem has never set school_id on any of its writes, since these
-- functions were first written -- confirmed live: 31/34 battles, 229/231
-- battle_questions, 2/4 battle_participants have school_id = NULL today.
-- Every "INSERT INTO public.battles (...)" / battle_questions /
-- battle_participants statement in every RPC lists its columns explicitly
-- and school_id was simply never among them (not a recent regression --
-- this has been true since these functions were first written).
--
-- This was found via a systematic sweep (join information_schema.columns
-- against pg_policies for every school_id-bearing table, filtered to
-- role-based policies with no school check) rather than one table at a
-- time -- it also surfaced that "battles admin all" and related read
-- policies on battle_questions/battle_participants/battle_events/
-- battle_reports have the same missing-tenant-scoping gap as
-- leave_requests/staff_attendance/audit_logs (already fixed this session).
--
-- Fix order matters and is enforced by this migration's statement order:
--   1. Backfill existing NULL school_id (261 rows) FIRST.
--   2. Fix every insert path so this can't reoccur.
--   3. Only then add same_school() to RLS -- adding it before the backfill
--      would have made every NULL-school_id battle instantly invisible to
--      everyone (same_school(NULL) is never true), breaking Battleground
--      for the vast majority of existing students immediately.

-- ── 1. Backfill ────────────────────────────────────────────────────────────
UPDATE public.battles b
SET school_id = COALESCE(
  (SELECT c.school_id FROM public.classes c WHERE c.id = b.class_id),
  (SELECT s.school_id FROM public.students s WHERE s.user_id = b.creator_user_id AND s.school_id IS NOT NULL LIMIT 1),
  (SELECT t.school_id FROM public.teachers t WHERE t.user_id = b.creator_user_id AND t.school_id IS NOT NULL LIMIT 1),
  (SELECT p.school_id FROM public.profiles p WHERE p.id = b.creator_user_id),
  public.default_school_id()
)
WHERE b.school_id IS NULL;

UPDATE public.battle_questions bq
SET school_id = b.school_id
FROM public.battles b
WHERE bq.battle_id = b.id AND bq.school_id IS NULL;

UPDATE public.battle_participants bp
SET school_id = b.school_id
FROM public.battles b
WHERE bp.battle_id = b.id AND bp.school_id IS NULL;

-- ── 2. Fix every write path ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_create_class_battle(_subject text, _difficulty text DEFAULT 'medium'::text, _count integer DEFAULT 5, _per_q integer DEFAULT 20, _chapter text DEFAULT NULL::text, _topic text DEFAULT NULL::text, _class_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _bid uuid; _cid uuid; _n int; _grade int; _sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to host a class battle'; END IF;
  _grade := public._class_grade(_cid);
  _sid := COALESCE((SELECT school_id FROM public.classes WHERE id = _cid), public.get_my_school_id());

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
  VALUES (
    'Class Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'lobby', 'bank', now(), _grade, _sid
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_create_open_battle(_subject text, _difficulty text DEFAULT 'medium'::text, _count integer DEFAULT 5, _per_q integer DEFAULT 20, _chapter text DEFAULT NULL::text, _topic text DEFAULT NULL::text, _class_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _bid uuid; _cid uuid; _n int; _grade int; _sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);
  _sid := COALESCE((SELECT school_id FROM public.classes WHERE id = _cid), public.get_my_school_id());

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
  VALUES (
    'Open Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'open', 'bank', now(), _grade, _sid
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(_subject text, _difficulty text DEFAULT 'medium'::text, _count integer DEFAULT 5, _per_q integer DEFAULT 20, _chapter text DEFAULT NULL::text, _class_id uuid DEFAULT NULL::uuid, _topic text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _bid uuid; _cid uuid; _n int; _grade int; _sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);
  _sid := COALESCE((SELECT school_id FROM public.classes WHERE id = _cid), public.get_my_school_id());

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
  VALUES (
    'Solo Practice · ' || _subject || COALESCE(' · ' || _chapter, ''),
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'solo', 'bank', now(), _grade, _sid
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher')
     AND NOT (
       coalesce(_b.source, '') LIKE 'featured_%'
       AND _b.class_id IS NOT NULL
       AND public.student_class_id(_uid) IS NOT DISTINCT FROM _b.class_id
     ) THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0) AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index FROM pool
    ORDER BY seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC, random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET
      source = CASE
        WHEN nullif(trim(source), '') IS NULL THEN 'bank'
        ELSE source
      END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $function$;

CREATE OR REPLACE FUNCTION public._fill_featured_battle_questions(_battle_id uuid, _count integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b record;
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _battle_id LIMIT 1) THEN
    SELECT count(*) INTO _inserted FROM public.battle_questions WHERE battle_id = _battle_id;
    RETURN _inserted;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id, school_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id, _b.school_id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
  SET
    source = CASE
      WHEN nullif(trim(source), '') IS NULL THEN 'bank'
      ELSE source
    END,
    question_count = GREATEST(_inserted, 1),
    duration_sec = per_question_sec * GREATEST(_inserted, 1)
  WHERE id = _battle_id;

  RETURN _inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_join_battle_by_code(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b record;
  _uid uuid := auth.uid();
  _name text;
  _stu_id uuid;
  _existing uuid;
  _count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RAISE EXCEPTION 'Enter a battle code to join.';
  END IF;

  SELECT * INTO _b FROM public.battles WHERE battle_code = upper(trim(_code));
  IF _b IS NULL THEN
    RAISE EXCEPTION 'That battle code doesn''t exist — double-check and try again.';
  END IF;

  IF _b.status = 'finished' THEN
    RAISE EXCEPTION 'This battle has already finished.';
  END IF;
  IF _b.status = 'cancelled' THEN
    RAISE EXCEPTION 'This battle was cancelled.';
  END IF;
  IF _b.starts_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'This battle code has expired.';
  END IF;

  SELECT id INTO _existing FROM public.battle_participants WHERE battle_id = _b.id AND user_id = _uid;
  IF _existing IS NOT NULL THEN
    RETURN _b.id;
  END IF;

  IF _b.mode = 'duel' THEN
    SELECT count(*) INTO _count FROM public.battle_participants WHERE battle_id = _b.id;
    IF _count >= 2 THEN
      RAISE EXCEPTION 'This duel is already full.';
    END IF;
  END IF;

  SELECT full_name INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  IF _name IS NULL THEN
    SELECT full_name INTO _name FROM public.profiles WHERE id = _uid LIMIT 1;
  END IF;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name, school_id)
  VALUES (_b.id, _uid, _stu_id, COALESCE(_name, 'Challenger'), _b.school_id);

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event('join', _uid, COALESCE(_name, 'A challenger'),
      'joined a ' || _b.subject || ' battle via code',
      _b.subject, NULL, _b.id, _b.class_id, 'users');
  END IF;

  RETURN _b.id;
END; $function$;

CREATE OR REPLACE FUNCTION public._seed_featured_battle_for_class(_class_id uuid, _kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _grade int;
  _subj text;
  _creator uuid;
  _bid uuid;
  _n int;
  _source text;
  _title text;
  _diff text;
  _qcount int;
  _pqsec int;
  _lock_a int;
  _lock_b int;
  _sid uuid;
BEGIN
  IF _class_id IS NULL THEN RETURN NULL; END IF;
  IF _kind NOT IN ('daily', 'weekly', 'ncert') THEN
    RAISE EXCEPTION 'Unsupported featured seed kind: %', _kind;
  END IF;

  _grade := public._class_grade(_class_id);
  _subj := public._pick_featured_subject(_class_id, _grade);
  _creator := public._featured_system_creator(_class_id);
  IF _creator IS NULL THEN RETURN NULL; END IF;
  -- Always derive from _class_id here, never get_my_school_id(): this
  -- function also runs from a system loop (rpc_refresh_featured_battles)
  -- with no single "acting user" whose school would make sense.
  _sid := COALESCE((SELECT school_id FROM public.classes WHERE id = _class_id), public.default_school_id());

  IF _kind = 'daily' THEN
    _source := 'featured_daily';
    _title := 'Daily Challenge';
    _diff := 'medium';
    _qcount := 10;
    _pqsec := 20;
  ELSIF _kind = 'weekly' THEN
    _source := 'featured_weekly';
    _title := 'Weekly Championship';
    _diff := 'hard';
    _qcount := 15;
    _pqsec := 25;
  ELSE
    _source := 'featured_ncert';
    _title := 'NCERT Challenge';
    _diff := 'easy';
    _qcount := 10;
    _pqsec := 20;
  END IF;

  _lock_a := hashtext('featured-seed:' || _kind || ':' || _class_id::text);
  IF _kind = 'weekly' THEN
    _lock_b := hashtext(date_trunc('week', now())::text);
  ELSE
    _lock_b := hashtext(current_date::text);
  END IF;
  PERFORM pg_advisory_xact_lock(_lock_a, _lock_b);

  IF _kind = 'weekly' THEN
    SELECT id INTO _bid FROM public.battles
    WHERE source = _source
      AND class_id = _class_id
      AND date_trunc('week', starts_at) = date_trunc('week', now())
      AND status IN ('live', 'scheduled')
    ORDER BY created_at
    LIMIT 1;
  ELSE
    SELECT id INTO _bid FROM public.battles
    WHERE source = _source
      AND class_id = _class_id
      AND starts_at::date = current_date
      AND status IN ('live', 'scheduled')
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF _bid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      SELECT public._fill_featured_battle_questions(_bid, _qcount) INTO _n;
      IF _n = 0 THEN
        UPDATE public.battles SET status = 'cancelled' WHERE id = _bid;
        RETURN NULL;
      END IF;
    END IF;
    RETURN _bid;
  END IF;

  BEGIN
    INSERT INTO public.battles (
      title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec,
      is_public, mode, source, starts_at, class_level, school_id
    ) VALUES (
      _title, _subj, _diff, 'mcq', 'live', _class_id,
      _creator, _pqsec, _qcount, _pqsec * _qcount,
      true, 'open', _source, now(), _grade, _sid
    )
    RETURNING id INTO _bid;
  EXCEPTION WHEN unique_violation THEN
    IF _kind = 'weekly' THEN
      SELECT id INTO _bid FROM public.battles
      WHERE source = _source AND class_id = _class_id
        AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live', 'scheduled')
      ORDER BY created_at LIMIT 1;
    ELSE
      SELECT id INTO _bid FROM public.battles
      WHERE source = _source AND class_id = _class_id
        AND starts_at::date = current_date
        AND status IN ('live', 'scheduled')
      ORDER BY created_at LIMIT 1;
    END IF;
  END;

  IF _bid IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
    SELECT public._fill_featured_battle_questions(_bid, _qcount) INTO _n;
    IF _n = 0 THEN
      UPDATE public.battles SET status = 'cancelled' WHERE id = _bid;
      RETURN NULL;
    END IF;
  END IF;

  RETURN _bid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int; _qneed int;
  _topper_uid uuid; _topper_name text; _existing uuid;
  _stu_id uuid;
  _lock_a int;
  _lock_b int;
  _subj text;
  _sid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _kind IN ('daily', 'weekly', 'ncert') THEN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  END IF;

  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;
  _sid := COALESCE((SELECT school_id FROM public.classes WHERE id = _cid), public.get_my_school_id());

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
  END IF;

  IF _kind IN ('daily', 'weekly', 'ncert', 'beat_topper') THEN
    _subj := public._pick_featured_subject(_cid, _grade);
  END IF;

  _lock_a := hashtext('featured:' || coalesce(_kind, '') || ':' || coalesce(_cid::text, ''));
  IF _kind = 'weekly' THEN
    _lock_b := hashtext(date_trunc('week', now())::text);
  ELSIF _kind IN ('daily', 'ncert') THEN
    _lock_b := hashtext(current_date::text);
  ELSE
    _lock_b := hashtext(_uid::text);
  END IF;
  PERFORM pg_advisory_xact_lock(_lock_a, _lock_b);

  IF _kind = 'daily' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
        VALUES ('Daily Challenge', _subj, 'medium', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_daily', now(), _grade, _sid)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_daily' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Daily Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'weekly' THEN
    _qneed := 15;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
        VALUES ('Weekly Championship', _subj, 'hard', 'mcq', 'live', _cid,
          _uid, 25, 15, 25 * 15, true, 'open', 'featured_weekly', now(), _grade, _sid)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Weekly Championship'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for this week''s Championship yet';
      END IF;
    END IF;

  ELSIF _kind = 'ncert' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
        AND (class_level IS NOT DISTINCT FROM _grade)
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
        VALUES ('NCERT Challenge', _subj, 'easy', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_ncert', now(), _grade, _sid)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_ncert' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create NCERT Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for the NCERT Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'beat_topper' THEN
    IF _cid IS NULL THEN
      RAISE EXCEPTION 'Join a class to challenge your topper';
    END IF;

    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_beat_topper'
        AND creator_user_id = _uid
        AND class_id = _cid
        AND status IN ('live', 'scheduled')
      ORDER BY created_at DESC
      LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      SELECT s.user_id, s.full_name INTO _topper_uid, _topper_name
        FROM public.students s
        JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _cid AND s.user_id IS NOT NULL AND s.user_id <> _uid
        ORDER BY x.xp DESC LIMIT 1;
      IF _topper_uid IS NULL THEN
        RAISE EXCEPTION 'Beat the Topper unlocks when a classmate has XP — check back soon.';
      END IF;

      INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
        creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level, school_id)
      VALUES ('Beat the Topper · ' || _topper_name, _subj, 'hard', 'mcq', 'live', _cid,
        _uid, 20, 10, 20 * 10, false, 'duel', 'featured_beat_topper', now(), _grade, _sid)
      RETURNING id INTO _bid;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, 10) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available to challenge the topper yet';
      END IF;

      INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, school_id)
      VALUES (_bid, _topper_uid, _uid, _sid)
      ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
        PERFORM public._battle_event('challenge', _uid, _name,
          'is trying to beat the topper, ' || _topper_name, _subj, _topper_name, _bid, _cid, 'crown');
      END IF;
    END IF;

  ELSIF _kind = 'teacher' THEN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_peek_teacher_featured_battle') THEN
      _existing := public._peek_teacher_featured_battle(_cid);
    END IF;
    IF _existing IS NULL THEN
      RAISE EXCEPTION 'No teacher-hosted challenge is live right now — check back soon.';
    END IF;
    _bid := _existing;

  ELSE
    RAISE EXCEPTION 'Unknown featured battle kind: %', _kind;
  END IF;

  IF _bid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.battle_participants WHERE battle_id = _bid AND user_id = _uid
  ) THEN
    INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name, school_id)
    VALUES (_bid, _uid, _stu_id, COALESCE(_name, 'Challenger'), (SELECT school_id FROM public.battles WHERE id = _bid));
  END IF;

  RETURN _bid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_submit_battle_answer(_participant_id uuid, _question_id uuid, _selected_index integer, _time_ms integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _part record;
  _battle record;
  _q record;
  _correct boolean;
  _pts int := 0;
  _new_score int;
  _new_correct int;
  _new_answered int;
  _new_time int;
BEGIN
  SELECT * INTO _part FROM public.battle_participants WHERE id = _participant_id;
  IF NOT FOUND OR _part.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not your participation';
  END IF;
  IF _part.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'Battle already finished';
  END IF;

  SELECT * INTO _battle FROM public.battles WHERE id = _part.battle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Battle not found'; END IF;

  SELECT * INTO _q FROM public.battle_questions WHERE id = _question_id AND battle_id = _part.battle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not in this battle'; END IF;

  -- Idempotent: existing answer wins
  IF EXISTS (
    SELECT 1 FROM public.battle_answers
    WHERE participant_id = _participant_id AND question_id = _question_id
  ) THEN
    SELECT is_correct INTO _correct
    FROM public.battle_answers
    WHERE participant_id = _participant_id AND question_id = _question_id;
    RETURN jsonb_build_object(
      'is_correct', COALESCE(_correct, false),
      'points', 0,
      'correct_index', _q.correct_index,
      'score', COALESCE(_part.score, 0),
      'correct_count', COALESCE(_part.correct_count, 0),
      'answered_count', COALESCE(_part.answered_count, 0),
      'total_time_ms', COALESCE(_part.total_time_ms, 0),
      'already', true
    );
  END IF;

  _correct := (_selected_index >= 0 AND _selected_index = _q.correct_index);
  IF _correct THEN
    _pts := COALESCE(_q.points, 10)
      + GREATEST(0, FLOOR((COALESCE(_battle.per_question_sec, 30) * 1000 - GREATEST(_time_ms, 0)) / 200.0)::int);
  END IF;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms, school_id)
  VALUES (_participant_id, _question_id, _selected_index, _correct, GREATEST(COALESCE(_time_ms, 0), 0), _battle.school_id);

  _new_score := COALESCE(_part.score, 0) + _pts;
  _new_correct := COALESCE(_part.correct_count, 0) + CASE WHEN _correct THEN 1 ELSE 0 END;
  _new_answered := COALESCE(_part.answered_count, 0) + 1;
  _new_time := COALESCE(_part.total_time_ms, 0) + GREATEST(COALESCE(_time_ms, 0), 0);

  UPDATE public.battle_participants SET
    score = _new_score,
    correct_count = _new_correct,
    answered_count = _new_answered,
    total_time_ms = _new_time
  WHERE id = _participant_id;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_mirror_battle_answer') THEN
      PERFORM public.rpc_mirror_battle_answer(_participant_id, _question_id);
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'is_correct', _correct,
    'points', _pts,
    'correct_index', _q.correct_index,
    'score', _new_score,
    'correct_count', _new_correct,
    'answered_count', _new_answered,
    'total_time_ms', _new_time,
    'already', false
  );
END; $function$;

-- battle_answers currently has an ownership-only "ba self all" RLS policy
-- (safe by construction, no school_id needed for security), and
-- battle_questions/battle_participants already got school_id set explicitly
-- above (via rpc_generate_battle/_fill_featured_battle_questions/
-- rpc_join_battle_by_code/rpc_ensure_featured_battle/app code). Backfill
-- battle_answers here for the same completeness reason as everything else
-- (currently 0 NULL rows live, but nothing enforced that -- fixing the root
-- cause, not just the symptom that happens not to have fired yet).

-- ── 3. Insert-safety triggers (defense in depth alongside the app/RPC fixes
--      above, and future-proofing against any insert path this migration
--      didn't touch). Deliberately NOT added to battles/battle_questions/
--      battle_participants: tg_set_school_id_from_session() derives school_id
--      from get_my_school_id() (i.e. auth.uid()), which is correct for
--      events/reports/answers/invites (always tied to the current acting
--      user) but would be WRONG as a silent fallback for battles/questions/
--      participants -- those are deliberately derived from the class or the
--      parent battle above (correct even in the system-loop context of
--      _seed_featured_battle_for_class, where auth.uid() may not belong to
--      the class being seeded at all). A silently-wrong fallback there would
--      be worse than the explicit values already set by every insert site
--      above. ───────────────────────────────────────────────────────────
CREATE TRIGGER trg_battle_events_set_school
  BEFORE INSERT ON public.battle_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_battle_reports_set_school
  BEFORE INSERT ON public.battle_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_battle_answers_set_school
  BEFORE INSERT ON public.battle_answers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_battle_invites_set_school
  BEFORE INSERT ON public.battle_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

-- ── 4. RLS scoping -- now safe, since every row is backfilled and every
--      write path sets school_id going forward. Only touching the
--      role-based branches that had zero tenant check; ownership/class/
--      creator-based branches in the same OR-chains are left exactly as
--      they were (already safe by construction, and rewriting a whole
--      policy risks introducing an unrelated regression the audit didn't
--      ask for). ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "battles admin all" ON public.battles;
CREATE POLICY "battles admin all" ON public.battles FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

DROP POLICY IF EXISTS "battles read class" ON public.battles;
CREATE POLICY "battles read class" ON public.battles FOR SELECT
  USING (
    (is_public = true) AND (
      (student_class_id(auth.uid()) = class_id)
      OR (creator_user_id = auth.uid())
      OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
      OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id))
      OR teacher_teaches_class(auth.uid(), class_id)
    )
  );

DROP POLICY IF EXISTS "bq read" ON public.battle_questions;
CREATE POLICY "bq read" ON public.battle_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_questions.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (student_class_id(auth.uid()) = b.class_id)
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
        )
    )
  );

DROP POLICY IF EXISTS "bp read class" ON public.battle_participants;
CREATE POLICY "bp read class" ON public.battle_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_participants.battle_id
        AND b.is_public = true
        AND (
          (student_class_id(auth.uid()) = b.class_id)
          OR (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(b.school_id))
          OR teacher_teaches_class(auth.uid(), b.class_id)
        )
    )
  );

DROP POLICY IF EXISTS "be read" ON public.battle_events;
CREATE POLICY "be read" ON public.battle_events FOR SELECT
  USING (
    (actor_user_id = auth.uid())
    OR ((class_id IS NOT NULL) AND (student_class_id(auth.uid()) = class_id))
    OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
    OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(school_id))
    OR ((class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), class_id))
  );

DROP POLICY IF EXISTS "br teacher read" ON public.battle_reports;
CREATE POLICY "br teacher read" ON public.battle_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR (has_role(auth.uid(), 'principal'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  );

DROP POLICY IF EXISTS "br ai update self" ON public.battle_reports;
CREATE POLICY "br ai update self" ON public.battle_reports FOR UPDATE
  USING (
    (user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM battles b
      WHERE b.id = battle_reports.battle_id
        AND (
          (b.creator_user_id = auth.uid())
          OR (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(b.school_id))
          OR ((b.class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  );
