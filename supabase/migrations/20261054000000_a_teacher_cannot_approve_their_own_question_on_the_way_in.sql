-- A TEACHER CANNOT APPROVE THEIR OWN QUESTION ON THE WAY IN.
--
-- §10.20: only a super admin may approve a question for the central bank.
-- `trg_question_bank_approval_is_super_admin_only` enforced that — on UPDATE
-- only. It is declared `BEFORE UPDATE OF is_approved`, so the INSERT that
-- creates the row was never seen by it, and `is_approved` is an ordinary
-- column on that path. Nothing else guarded it: `qb_staff_insert`'s WITH CHECK
-- is `created_by = auth.uid() AND can_author_bank_question()`, which says who
-- may write a row, not what it may claim about itself.
--
-- MEASURED 2026-09-23 on production, as the real teacher priya.sharma over
-- PostgREST (the row was written inactive so no student could be served it,
-- and deleted in the same breath):
--
--   POST /rest/v1/question_bank  {... is_approved: true, is_active: false}
--     -> 201  [{"is_approved": true, "is_active": false}]
--
-- The bank is global (G2): an approved question is served to every school on
-- that board and class. So one teacher could publish into every school's
-- practice, mistake book and paper fill, bypassing the review queue that is
-- the only thing standing between a contribution and 21,876 other questions.
--
-- THE FIX IS THE RULE, NOT A SECOND GUARD. The one function that owns "who
-- may approve" now owns it on both paths, and its trigger fires on both.
--
-- WHY THE INSERT ARM ASKS auth.uid() IS NOT NULL AND THE UPDATE ARM DOES NOT.
-- Every one of the bank's 21,876 rows arrived approved, from seed migrations
-- running as the database owner, where auth.uid() is NULL and
-- is_super_admin() is therefore false. Refusing those would refuse every
-- future seed and every service-role import. So the insert arm refuses an
-- END USER who is not a super admin; a caller with no JWT subject is not an
-- end user. The update arm is left exactly as it was: it has refused everyone
-- but a super admin since 20260914030000 and nothing in the app updates
-- is_approved except the super admin's own review RPC.

CREATE OR REPLACE FUNCTION public.tg_question_bank_approval_is_super_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A contribution arrives unapproved and waits for the review queue.
    IF NEW.is_approved
       AND (SELECT auth.uid()) IS NOT NULL
       AND NOT (SELECT public.is_super_admin()) THEN
      RAISE EXCEPTION
        'only a super admin may approve a question (§10.20: manage the central question bank)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved
     AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION
      'only a super admin may approve or unapprove a question (§10.20: manage the central question bank)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_question_bank_approval_is_super_admin_only ON public.question_bank;
CREATE TRIGGER trg_question_bank_approval_is_super_admin_only
  BEFORE INSERT OR UPDATE OF is_approved ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.tg_question_bank_approval_is_super_admin_only();

-- ── THE PROOF, AS THE CALLER IT IS ABOUT ─────────────────────────────────
--
-- A DO block runs as the database owner, where this rule deliberately does
-- not apply, so proving it there would prove nothing (that is how the insert
-- arm came to be missing). The block below becomes a real teacher — the role
-- `authenticated` and that teacher's JWT subject — for the length of the
-- test, so RLS and auth.uid() are the ones an app request gets.
--
-- Three assertions, and the middle one is the control: without it, a refusal
-- could mean "teachers cannot insert at all" and would look identical.
--   1. teacher, is_approved true   -> refused, 42501        (the defect)
--   2. teacher, is_approved false  -> accepted              (CONTROL)
--   3. owner,   is_approved true   -> accepted              (seeds still run)
-- Every row written here is inactive, so it can never be served, and each is
-- deleted before the next assertion.
DO $guard$
DECLARE
  _teacher uuid;
  _chapter uuid;
  _subject text;
  _level   integer;
  _id      uuid;
  _refused boolean := false;
BEGIN
  SELECT ur.user_id INTO _teacher
    FROM public.user_roles ur
   WHERE ur.role = 'teacher'::public.app_role
     AND NOT EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.account_id = ur.user_id AND sa.revoked_at IS NULL)
   LIMIT 1;
  IF _teacher IS NULL THEN
    RAISE EXCEPTION 'no teacher to prove this with — the guard cannot run';
  END IF;

  SELECT ch.id, cs.name, cc.level INTO _chapter, _subject, _level
    FROM public.chapters ch
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
    JOIN public.curriculum_classes  cc ON cc.id = cs.curriculum_class_id
   LIMIT 1;
  IF _chapter IS NULL THEN
    RAISE EXCEPTION 'no curriculum chapter to key the proof rows to';
  END IF;

  -- 1. The defect: the teacher approves their own question on the way in.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
    INSERT INTO public.question_bank
      (subject, class_level, chapter_id, question, options, correct_index, created_by, is_approved, is_active)
    VALUES
      (_subject, _level, _chapter, 'migration 20261054000000 proof — approved on insert',
       '["1","2","3","4"]'::jsonb, 0, _teacher, true, false)
    RETURNING id INTO _id;
  EXCEPTION WHEN insufficient_privilege THEN
    _refused := true;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF NOT _refused THEN
    DELETE FROM public.question_bank WHERE id = _id;
    RAISE EXCEPTION 'a teacher still inserted an APPROVED question — the trigger does not cover INSERT';
  END IF;

  -- 2. CONTROL: the same insert, unapproved, must go through.
  _id := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
    INSERT INTO public.question_bank
      (subject, class_level, chapter_id, question, options, correct_index, created_by, is_approved, is_active)
    VALUES
      (_subject, _level, _chapter, 'migration 20261054000000 control — a contribution awaiting review',
       '["1","2","3","4"]'::jsonb, 0, _teacher, false, false)
    RETURNING id INTO _id;
    DELETE FROM public.question_bank WHERE id = _id;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF _id IS NULL THEN
    RAISE EXCEPTION 'the control failed: a teacher could not contribute an unapproved question either, so the refusal above proves nothing about approval';
  END IF;

  -- 3. The seed path: no JWT subject, so the rule does not apply.
  INSERT INTO public.question_bank
    (subject, class_level, chapter_id, question, options, correct_index, is_approved, is_active)
  VALUES
    (_subject, _level, _chapter, 'migration 20261054000000 seed path — approved by the owner',
     '["1","2","3","4"]'::jsonb, 0, true, false)
  RETURNING id INTO _id;
  DELETE FROM public.question_bank WHERE id = _id;

  -- Nothing this block wrote may survive it.
  IF EXISTS (SELECT 1 FROM public.question_bank WHERE question LIKE 'migration 20261054000000%') THEN
    RAISE EXCEPTION 'the proof left rows in the bank';
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261054000000_a_teacher_cannot_approve_their_own_question_on_the_way_in')
ON CONFLICT (version) DO NOTHING;
