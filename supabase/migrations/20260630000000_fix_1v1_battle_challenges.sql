-- Fix 1v1 Battleground challenges.
-- Keeps one rpc_challenge_student signature, sends the battle invite, emits a notification,
-- and grants the RPC to authenticated users.

DROP FUNCTION IF EXISTS public.rpc_challenge_student(uuid, text, text, int, int, text);
DROP FUNCTION IF EXISTS public.rpc_challenge_student(uuid, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.rpc_challenge_student(uuid, text, text, int, int, text, text);
DROP FUNCTION IF EXISTS public.rpc_challenge_student(uuid, text, text, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bid uuid;
  _cid uuid;
  _n int;
  _name text;
  _grade int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF _opponent_user_id IS NULL OR _opponent_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Pick a valid classmate to challenge';
  END IF;

  _cid := public.student_class_id(auth.uid());
  IF _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to challenge classmates';
  END IF;

  IF public.student_class_id(_opponent_user_id) IS DISTINCT FROM _cid THEN
    RAISE EXCEPTION 'You can only challenge classmates from your class';
  END IF;

  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger')
    INTO _name
  FROM public.students
  WHERE user_id = auth.uid()
  LIMIT 1;

  INSERT INTO public.battles (
    title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec,
    is_public, mode, source, starts_at, class_level
  )
  VALUES (
    _name || ' challenges you · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count,
    false, 'duel', 'bank', now(), _grade
  )
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, status)
  VALUES (_bid, _opponent_user_id, auth.uid(), 'pending')
  ON CONFLICT (battle_id, invited_user_id) DO UPDATE SET
    status = 'pending',
    inviter_user_id = EXCLUDED.inviter_user_id,
    created_at = now();

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_notify') THEN
    PERFORM public._notify(
      _opponent_user_id,
      'invite',
      'Battle challenge!',
      _name || ' challenged you to a ' || _subject || ' battle.',
      'swords',
      '/student/battleground/battle/' || _bid::text
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event(
      'challenge',
      auth.uid(),
      _name,
      'threw down a ' || _subject || ' challenge',
      _subject,
      NULL,
      _bid,
      _cid,
      'swords'
    );
  END IF;

  RETURN _bid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_challenge_student(uuid, text, text, int, int, text, text) TO authenticated;
