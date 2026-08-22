-- Gap closure, 2026-08-22, continuing the admin/principal same_school sweep
-- into the remaining untriaged functions: rpc_ensure_battle_report,
-- rpc_get_battle_report, and rpc_teacher_battle_reports all used
-- has_role(admin)/has_role(principal) as an unconditional bypass with no
-- same_school() check -- any admin/principal, from any school, could
-- generate or read another school's full battle performance report
-- (individual student scores, accuracy, rank).
--
-- Also closed a lower-severity but still real gap: rpc_vote_community_answer
-- and rpc_vote_community_doubt let ANY authenticated user vote on/unvote
-- ANY doubt or answer in the system regardless of school, silently
-- manipulating another school's community reputation and vote counts.
-- Fixed by requiring the target doubt/answer's doubt to be in the caller's
-- own school before allowing the vote to register.
CREATE OR REPLACE FUNCTION public.rpc_get_battle_report(_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r record; _allowed boolean;
BEGIN
  SELECT br.*, b.creator_user_id, b.class_id
    INTO _r
    FROM public.battle_reports br
    JOIN public.battles b ON b.id = br.battle_id
    WHERE br.participant_id = _participant_id;

  IF _r IS NULL THEN RETURN NULL; END IF;
  IF _r.expires_at < now() THEN
    RETURN jsonb_build_object('expired', true, 'expires_at', _r.expires_at);
  END IF;

  _allowed := _r.user_id = auth.uid()
    OR _r.creator_user_id = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.same_school(_r.school_id))
    OR (public.has_role(auth.uid(), 'principal'::app_role) AND public.same_school(_r.school_id))
    OR (_r.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), _r.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN jsonb_build_object(
    'id', _r.id, 'participant_id', _r.participant_id, 'battle_id', _r.battle_id,
    'user_id', _r.user_id, 'display_name', _r.display_name,
    'report', _r.report, 'ai_insights', _r.ai_insights,
    'expires_at', _r.expires_at, 'created_at', _r.created_at, 'expired', false
  );
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_battle_report(_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p record; _school uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _p FROM public.battle_participants WHERE id = _participant_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Participant not found'; END IF;
  SELECT school_id INTO _school FROM public.battles WHERE id = _p.battle_id;
  IF _p.user_id <> auth.uid()
     AND NOT (public.has_role(auth.uid(), 'admin') AND public.same_school(_school))
     AND NOT (public.has_role(auth.uid(), 'principal') AND public.same_school(_school))
     AND NOT EXISTS (
       SELECT 1 FROM public.battles b
       WHERE b.id = _p.battle_id
         AND (b.creator_user_id = auth.uid()
           OR public.teacher_teaches_class(auth.uid(), b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _p.finished_at IS NULL THEN
    RAISE EXCEPTION 'Finish the battle first to view the report';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.battle_reports WHERE participant_id = _participant_id) THEN
    PERFORM public._snapshot_battle_report(_participant_id);
  END IF;

  RETURN public.rpc_get_battle_report(_participant_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_battle_reports(_battle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b record; _allowed boolean;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;

  _allowed := _b.creator_user_id = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.same_school(_b.school_id))
    OR (public.has_role(auth.uid(), 'principal'::app_role) AND public.same_school(_b.school_id))
    OR (_b.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), _b.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'participant_id', br.participant_id,
      'user_id', br.user_id,
      'display_name', br.display_name,
      'expires_at', br.expires_at,
      'expired', (br.expires_at < now()),
      'summary', br.report->'summary',
      'has_ai', (br.ai_insights IS NOT NULL)
    ) ORDER BY (br.report->'summary'->>'rank')::int NULLS LAST, br.display_name)
    FROM public.battle_reports br
    WHERE br.battle_id = _battle_id
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_vote_community_answer(_answer_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count int;
  _author uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_doubt_answers a
    JOIN public.community_doubts d ON d.id = a.doubt_id
    WHERE a.id = _answer_id AND public.same_school(d.school_id)
  ) THEN
    RAISE EXCEPTION 'Answer not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.community_doubt_votes WHERE user_id = _uid AND answer_id = _answer_id) THEN
    DELETE FROM public.community_doubt_votes WHERE user_id = _uid AND answer_id = _answer_id;
  ELSE
    INSERT INTO public.community_doubt_votes(user_id, answer_id) VALUES (_uid, _answer_id);
  END IF;

  SELECT COUNT(*) INTO _count FROM public.community_doubt_votes WHERE answer_id = _answer_id;
  UPDATE public.community_doubt_answers SET upvote_count = _count WHERE id = _answer_id RETURNING user_id INTO _author;
  IF _author IS NOT NULL THEN PERFORM public._community_refresh_reputation(_author); END IF;
  RETURN _count;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_vote_community_doubt(_doubt_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_doubts d WHERE d.id = _doubt_id AND public.same_school(d.school_id)
  ) THEN
    RAISE EXCEPTION 'Doubt not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.community_doubt_votes WHERE user_id = _uid AND doubt_id = _doubt_id) THEN
    DELETE FROM public.community_doubt_votes WHERE user_id = _uid AND doubt_id = _doubt_id;
  ELSE
    INSERT INTO public.community_doubt_votes(user_id, doubt_id) VALUES (_uid, _doubt_id);
  END IF;

  SELECT COUNT(*) INTO _count FROM public.community_doubt_votes WHERE doubt_id = _doubt_id;
  UPDATE public.community_doubts SET upvote_count = _count WHERE id = _doubt_id;
  RETURN _count;
END $function$;
