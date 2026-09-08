-- ═══════════════════════════════════════════════════════════════════════════
-- Somebody can approve a contributed question now (KNOWN_ISSUES 15 and 12)
--
-- ── RULED BY THE SPEC, AGAIN ─────────────────────────────────────────────
--
-- Entry 15 asked three questions and said the spec answered none of them:
-- "a reviewer role (principal? a subject lead? the spec does not say) ... and a
-- decision about whether approval is per-school or central."
--
-- It does say. §10.20 Super admin, "Can do": **"Manage the central question
-- bank."** And §10.9: "Centralised and shared across all schools and all
-- users." Central bank, central approval, and a named role that already exists.
-- Third time a "ruling request" turned out to be written down already (17, 27).
--
-- ── THE HOLE THIS CLOSES, WHICH THE ENTRY DID NOT KNOW ABOUT ─────────────
--
-- `20260907000000` made `is_approved` default FALSE so a contribution is not
-- student-visible the instant it saves. But `qb_staff_update` is
--
--   USING / WITH CHECK (created_by = auth.uid() AND (admin OR principal OR teacher))
--
-- and it does not exclude `is_approved`. **A teacher could approve their own
-- question** with one UPDATE and broadcast it to every school in the country.
-- The default was the whole protection, and the author could undo it. Measured
-- in probe30 before this migration: the UPDATE succeeded.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
--  1. Provenance. `approved_by`, `approved_at`, `review_note`. Without them
--     "approved" is a bare boolean with no answer to "by whom, and when" —
--     and §10.20's entire model for the super admin is that what they do is
--     recorded.
--
--     The 21,696 seeded rows keep `is_approved = true` with `approved_by` NULL.
--     They were seeded, not reviewed, and inventing a reviewer for them would
--     be a lie in a provenance column. NULL there means exactly "reference
--     content, never reviewed by a person", and the queue below excludes them
--     because they are already approved.
--
--  2. A super admin can READ the bank. Measured before this migration: they
--     could see **56 of 21,696 rows**, and no unapproved question at all.
--     `qb_staff_read` is `is_principal_or_admin OR teacher` and neither
--     includes a super admin, so the only policy admitting them is
--     `qb_select_approved_board` — which requires `is_approved` AND a board
--     match against `get_my_school_id()`, deliberately NULL for a super admin
--     (§10.20). That leaves exactly the `board = 'both'` rows: 56. The other
--     21,640 are `board = 'rbse'` and were invisible. The person the spec puts
--     in charge of the central bank could see 0.3% of it and none of the queue.
--
--  3. `is_approved` becomes super-admin-only, by ANY route. A trigger, not a
--     policy: a WITH CHECK cannot see the OLD row, so it cannot tell "this
--     UPDATE changes is_approved" from "this UPDATE leaves it alone". A teacher
--     may still edit their own question's text — that is `qb_staff_update` and
--     it is untouched — but the approval bit is not theirs.
--
--  4. `rpc_review_question` and `rpc_question_bank_review_queue`. The queue
--     returns the author's NAME, which a super admin cannot read from
--     `profiles` themselves (RLS), so the definer resolves it — the same
--     lesson as `storage_object_owner_school_id` two migrations ago.
--
-- ── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────
--
-- No auto-approval, no bulk approve, and no narrowing of `qb_staff_read`.
-- Every teacher can already read every unapproved question; that is consistent
-- with §10.9's "shared across all schools and all users" and narrowing it is a
-- separate decision, not a side effect of adding a queue.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. provenance ─────────────────────────────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS approved_by  uuid,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS review_note  text;

COMMENT ON COLUMN public.question_bank.approved_by IS
  'The super admin who approved or rejected this question (§10.20 "Manage the '
  'central question bank"). NULL on the 21,696 seeded reference rows, which were '
  'never reviewed by a person -- inventing a reviewer for them would be a lie in '
  'a provenance column.';

-- Finding the queue must not scan the whole bank once it grows.
CREATE INDEX IF NOT EXISTS question_bank_pending_review_idx
  ON public.question_bank (created_at DESC)
  WHERE NOT is_approved;

-- ── 2. the super admin can see the bank they are in charge of ────────────
DROP POLICY IF EXISTS qb_super_admin_read ON public.question_bank;
CREATE POLICY qb_super_admin_read ON public.question_bank
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

-- ── 3. approval is not self-service ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_question_bank_approval_is_super_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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
  BEFORE UPDATE OF is_approved ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.tg_question_bank_approval_is_super_admin_only();

COMMENT ON FUNCTION public.tg_question_bank_approval_is_super_admin_only() IS
  'Stops an author approving their own contribution. A trigger and not a policy '
  'because WITH CHECK cannot see the OLD row, so it cannot distinguish an UPDATE '
  'that CHANGES is_approved from one that leaves it alone. qb_staff_update is '
  'untouched: a teacher still edits their own question''s text.';

-- ── 4. the queue and the decision ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_question_bank_review_queue(
  _limit  integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  question     text,
  options      jsonb,
  correct_index integer,
  explanation  text,
  subject      text,
  chapter      text,
  class_level  integer,
  difficulty   text,
  source       text,
  created_by   uuid,
  author_name  text,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'only a super admin may review the central question bank (§10.20)'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
         qb.subject, qb.chapter, qb.class_level, qb.difficulty, qb.source,
         qb.created_by,
         -- Resolved here because a super admin holds no school and therefore
         -- cannot read `profiles` under its own RLS.
         coalesce(p.full_name, p.email, 'Unknown') AS author_name,
         qb.created_at
    FROM public.question_bank qb
    LEFT JOIN public.profiles p ON p.id = qb.created_by
   WHERE NOT qb.is_approved
   ORDER BY qb.created_at DESC
   LIMIT  greatest(1, least(coalesce(_limit, 50), 200))
  OFFSET greatest(0, coalesce(_offset, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_review_question(
  _question_id uuid,
  _approved    boolean,
  _note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _reviewer uuid := auth.uid();
  _row      public.question_bank;
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'only a super admin may approve or reject a question (§10.20)'
      USING ERRCODE = '42501';
  END IF;
  IF _question_id IS NULL OR _approved IS NULL THEN
    RAISE EXCEPTION 'rpc_review_question needs a question and a decision'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.question_bank
     SET is_approved = _approved,
         approved_by = _reviewer,
         approved_at = now(),
         -- An empty note is no note. Storing '' would make "was a reason given?"
         -- unanswerable without also asking "is it blank?".
         review_note = nullif(btrim(coalesce(_note, '')), ''),
         updated_at  = now()
   WHERE id = _question_id
  RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'question % not found', _question_id USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', _row.id,
    'is_approved', _row.is_approved,
    'approved_by', _row.approved_by,
    'approved_at', _row.approved_at,
    'review_note', _row.review_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_question_bank_review_queue(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_review_question(uuid, boolean, text)         FROM PUBLIC;
-- Granted to `authenticated`, not to a role: the FUNCTION decides, and it asks
-- `is_super_admin()` on its first line. A grant cannot express "super admin"
-- because that is a row in `super_admins`, not a database role.
GRANT EXECUTE ON FUNCTION public.rpc_question_bank_review_queue(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_review_question(uuid, boolean, text)         TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_review_question(uuid, boolean, text) IS
  'Approve or reject a contributed question, and record who did it. Super admin '
  'only (§10.20). Rejection is is_approved=false with a note, not a delete: a '
  'rejected question may already sit in a student''s mistake book.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only. Runs as the migration role, which is a superuser
-- and satisfies nothing this file is about (rule 6). probe30 asserts the
-- behaviour as a teacher and as a super admin (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='question_bank'
     AND column_name IN ('approved_by','approved_at','review_note');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'ABORT: expected 3 provenance columns, found %', _n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid='public.question_bank'::regclass
                    AND tgname='trg_question_bank_approval_is_super_admin_only'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the self-approval trigger is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                  WHERE c.relname='question_bank' AND p.polname='qb_super_admin_read') THEN
    RAISE EXCEPTION 'ABORT: the super admin still cannot read the bank';
  END IF;

  -- The author-fenced write path must SURVIVE: this migration narrows one
  -- column, it does not take a teacher's question away from them.
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                  WHERE c.relname='question_bank' AND p.polname='qb_staff_update') THEN
    RAISE EXCEPTION 'ABORT: qb_staff_update was lost';
  END IF;

  IF has_function_privilege('anon', 'public.rpc_review_question(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon can execute rpc_review_question';
  END IF;

  RAISE NOTICE 'approval path exists; who may use it is asserted in probe30.';
END $verify$;
