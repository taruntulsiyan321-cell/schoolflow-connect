-- =========================================================
-- Wisdom Campus — Phase 3: Notification system
--   * Per-user notifications inbox
--   * _notify() helper (used by SECURITY DEFINER RPCs)
--   * Badge unlocks + challenge invites emit notifications
--   * Users may also create their own (results, reminders)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  type       text NOT NULL DEFAULT 'general',  -- badge|invite|result|leaderboard|fee|homework|general
  title      text NOT NULL,
  body       text,
  icon       text,                             -- lucide icon hint
  link       text,                             -- in-app route
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON public.notifications(user_id) WHERE NOT read;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif self read"   ON public.notifications;
DROP POLICY IF EXISTS "notif self insert" ON public.notifications;
DROP POLICY IF EXISTS "notif self update" ON public.notifications;
DROP POLICY IF EXISTS "notif self delete" ON public.notifications;
CREATE POLICY "notif self read"   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif self insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self delete" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Cross-user emitter (definer bypasses RLS so we can notify other students).
CREATE OR REPLACE FUNCTION public._notify(
  _uid uuid, _type text, _title text, _body text DEFAULT NULL,
  _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications(user_id, type, title, body, icon, link)
  VALUES (_uid, _type, _title, _body, _icon, _link);
$$;

-- Badge award helper now emits a notification on first unlock.
CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF FOUND THEN
    PERFORM public._notify(
      _uid, 'badge', 'Badge unlocked!',
      'You earned a new ' || _tier || ' badge.', 'award',
      '/student/battleground/achievements'
    );
  END IF;
END $$;

-- Challenge a classmate now notifies the opponent.
CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (_name || ' challenges you · ' || _subject, _subject, _chapter, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now())
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  PERFORM public._notify(
    _opponent_user_id, 'invite', 'Battle challenge!',
    _name || ' challenged you to a ' || _subject || ' battle.', 'swords',
    '/student/battleground/battle/' || _bid::text
  );

  RETURN _bid;
END $$;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
