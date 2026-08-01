-- =========================================================
-- Battleground — shareable battle codes + featured battles
--   * battles.battle_code: short unique join code, auto-assigned
--   * rpc_join_battle_by_code: validate + join a battle by code
--   * rpc_ensure_featured_battle: create/return today's featured
--     battle for a given kind (daily/weekly/ncert/beat_topper/teacher)
--   * RLS: participants (incl. cross-class via code/featured) can
--     read the battle, its questions, and co-participants
-- =========================================================

-- ---------------------------------------------------------
-- Column + generator + backfill
-- ---------------------------------------------------------
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS battle_code text;

CREATE OR REPLACE FUNCTION public._generate_battle_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I to avoid confusion
  _code text;
  _tries int := 0;
BEGIN
  LOOP
    _code := '';
    FOR i IN 1..6 LOOP
      _code := _code || substr(_chars, 1 + floor(random() * length(_chars))::int, 1);
    END LOOP;
    _tries := _tries + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.battles WHERE battle_code = _code) OR _tries > 50;
  END LOOP;
  RETURN _code;
END; $$;

-- Backfill existing rows one at a time so every code is guaranteed unique
DO $$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT id FROM public.battles WHERE battle_code IS NULL LOOP
    UPDATE public.battles SET battle_code = public._generate_battle_code() WHERE id = _r.id;
  END LOOP;
END $$;

ALTER TABLE public.battles ALTER COLUMN battle_code SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.battles ADD CONSTRAINT battles_battle_code_key UNIQUE (battle_code);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_battles_code ON public.battles(battle_code);

-- ---------------------------------------------------------
-- Trigger: always assign a unique code on insert
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._battles_set_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.battle_code IS NULL OR length(trim(NEW.battle_code)) = 0 THEN
    NEW.battle_code := public._generate_battle_code();
  ELSE
    NEW.battle_code := upper(NEW.battle_code);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_battles_set_code ON public.battles;
CREATE TRIGGER trg_battles_set_code
BEFORE INSERT ON public.battles
FOR EACH ROW EXECUTE FUNCTION public._battles_set_code();

-- ---------------------------------------------------------
-- RLS: allow anyone who has actually joined a battle to read it,
-- its questions, and its co-participants — needed for join-by-code
-- and school-wide featured battles that cross class boundaries.
-- ---------------------------------------------------------
DROP POLICY IF EXISTS "battles read participant" ON public.battles;
CREATE POLICY "battles read participant" ON public.battles FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.battle_participants bp
  WHERE bp.battle_id = battles.id AND bp.user_id = auth.uid()
));

DROP POLICY IF EXISTS "bp read as participant" ON public.battle_participants;
CREATE POLICY "bp read as participant" ON public.battle_participants FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.battle_participants bp2
  WHERE bp2.battle_id = battle_participants.battle_id AND bp2.user_id = auth.uid()
));

DROP POLICY IF EXISTS "bq read participant" ON public.battle_questions;
CREATE POLICY "bq read participant" ON public.battle_questions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.battle_participants bp
  WHERE bp.battle_id = battle_questions.battle_id AND bp.user_id = auth.uid()
));

-- ---------------------------------------------------------
-- rpc_join_battle_by_code — validate a code, join, return battle id
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_join_battle_by_code(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
  VALUES (_b.id, _uid, _stu_id, COALESCE(_name, 'Challenger'));

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event('join', _uid, COALESCE(_name, 'A challenger'),
      'joined a ' || _b.subject || ' battle via code',
      _b.subject, NULL, _b.id, _b.class_id, 'users');
  END IF;

  RETURN _b.id;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_join_battle_by_code(text) TO authenticated;

-- ---------------------------------------------------------
-- rpc_ensure_featured_battle — create/return today's featured
-- battle of a given kind: daily | weekly | ncert | beat_topper | teacher
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int;
  _topper_uid uuid; _topper_name text; _existing uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind = 'daily' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;

    INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
    VALUES ('Daily Challenge', 'Mathematics', 'medium', 'mcq', 'live', _cid,
      _uid, 20, 10, 20 * 10, true, 'open', 'featured_daily', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet'; END IF;
    RETURN _bid;

  ELSIF _kind = 'weekly' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled')
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;

    INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
    VALUES ('Weekly Championship', 'Mathematics', 'hard', 'mcq', 'live', _cid,
      _uid, 25, 15, 25 * 15, true, 'open', 'featured_weekly', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public.rpc_generate_battle(_bid, 15) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for this week''s Championship yet'; END IF;
    RETURN _bid;

  ELSIF _kind = 'ncert' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
        AND (class_level IS NOT DISTINCT FROM _grade)
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;

    INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
    VALUES ('NCERT Challenge', 'Mathematics', 'easy', 'mcq', 'live', _cid,
      _uid, 20, 10, 20 * 10, true, 'open', 'featured_ncert', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for the NCERT Challenge yet'; END IF;
    RETURN _bid;

  ELSIF _kind = 'beat_topper' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to challenge your topper'; END IF;
    SELECT s.user_id, s.full_name INTO _topper_uid, _topper_name
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _cid AND s.user_id IS NOT NULL AND s.user_id <> _uid
      ORDER BY x.xp DESC LIMIT 1;
    IF _topper_uid IS NULL THEN
      RAISE EXCEPTION 'No class topper to challenge yet — be the first to score!';
    END IF;

    INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
    VALUES ('Beat the Topper · ' || _topper_name, 'Mathematics', 'hard', 'mcq', 'live', _cid,
      _uid, 20, 10, 20 * 10, false, 'duel', 'featured_beat_topper', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available to challenge the topper yet'; END IF;

    INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
    VALUES (_bid, _topper_uid, _uid)
    ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
      PERFORM public._battle_event('challenge', _uid, _name,
        'is trying to beat the topper, ' || _topper_name, 'Mathematics', _topper_name, _bid, _cid, 'crown');
    END IF;
    RETURN _bid;

  ELSIF _kind = 'teacher' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to see teacher challenges'; END IF;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'manual' AND class_id = _cid AND is_public = true
        AND status IN ('live','scheduled')
        AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = battles.creator_user_id AND ur.role = 'teacher')
      ORDER BY starts_at DESC LIMIT 1;
    IF _existing IS NULL THEN
      RAISE EXCEPTION 'No teacher-hosted challenge is live right now — check back soon.';
    END IF;
    RETURN _existing;

  ELSE
    RAISE EXCEPTION 'Unknown featured battle kind: %', _kind;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battle(text) TO authenticated;
