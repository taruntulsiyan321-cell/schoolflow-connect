
-- ============ QUESTION BANK ============
CREATE TABLE public.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_level int,
  subject text NOT NULL,
  chapter text,
  topic text,
  difficulty text NOT NULL DEFAULT 'medium',
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_index int NOT NULL,
  explanation text,
  source text,
  created_by uuid,
  is_approved boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qb_filter ON public.question_bank (subject, class_level, difficulty) WHERE is_approved;
CREATE INDEX idx_qb_chapter ON public.question_bank (subject, chapter);

ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qb read auth" ON public.question_bank FOR SELECT TO authenticated USING (true);
CREATE POLICY "qb teacher insert" ON public.question_bank FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'teacher') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'principal'));
CREATE POLICY "qb admin manage" ON public.question_bank FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'principal'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'principal'));

-- ============ BATTLES additions ============
ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'class',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS difficulty text DEFAULT 'medium';

-- ============ BATTLE INVITES ============
CREATE TABLE public.battle_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL,
  invited_user_id uuid NOT NULL,
  inviter_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, invited_user_id)
);
ALTER TABLE public.battle_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites creator insert" ON public.battle_invites FOR INSERT TO authenticated
  WITH CHECK (inviter_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.battles b WHERE b.id = battle_id AND b.creator_user_id = auth.uid()));
CREATE POLICY "invites read mine" ON public.battle_invites FOR SELECT TO authenticated
  USING (invited_user_id = auth.uid() OR inviter_user_id = auth.uid());
CREATE POLICY "invites update mine" ON public.battle_invites FOR UPDATE TO authenticated
  USING (invited_user_id = auth.uid()) WITH CHECK (invited_user_id = auth.uid());

-- ============ STUDENT XP equipped badge ============
ALTER TABLE public.student_xp ADD COLUMN IF NOT EXISTS equipped_badge text;

-- ============ RPC: generate from bank ============
CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record;
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b.creator_user_id <> auth.uid() AND NOT has_role(auth.uid(),'admin') AND NOT has_role(auth.uid(),'teacher') THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH picked AS (
    SELECT id, question, options, correct_index
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR chapter ILIKE _b.chapter)
      AND (_b.difficulty IS NULL OR difficulty = _b.difficulty)
      AND (_b.class_level IS NULL OR class_level IS NULL OR class_level = _b.class_level)
    ORDER BY random()
    LIMIT GREATEST(_count,1)
  ), ins AS (
    INSERT INTO public.battle_questions (battle_id, order_index, question, options, correct_index, points)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10 FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles SET source = 'bank', question_count = _inserted, duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

-- ============ RPC: quick battle in one shot ============
CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _class_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  INSERT INTO public.battles (title, subject, chapter, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (
    'Quick Battle · ' || _subject || ' · ' || _difficulty,
    _subject, _chapter, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now()
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END $$;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_invites;
