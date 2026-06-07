-- AI report fixes: ensure snapshot exists, secure AI insights save, on-demand snapshot

CREATE OR REPLACE FUNCTION public.rpc_ensure_battle_report(_participant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _p FROM public.battle_participants WHERE id = _participant_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Participant not found'; END IF;
  IF _p.user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'principal')
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
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_battle_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_save_battle_ai_insights(
  _participant_id uuid,
  _insights jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id INTO _owner FROM public.battle_reports WHERE participant_id = _participant_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF _owner <> _uid
     AND NOT public.has_role(_uid, 'admin')
     AND NOT public.has_role(_uid, 'principal')
     AND NOT EXISTS (
       SELECT 1 FROM public.battle_reports br
       JOIN public.battles b ON b.id = br.battle_id
       WHERE br.participant_id = _participant_id
         AND (b.creator_user_id = _uid OR public.teacher_teaches_class(_uid, b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.battle_reports
    SET ai_insights = _insights
    WHERE participant_id = _participant_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_save_battle_ai_insights(uuid, jsonb) TO authenticated;
