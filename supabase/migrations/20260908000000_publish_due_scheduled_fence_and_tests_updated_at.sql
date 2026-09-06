-- ═══════════════════════════════════════════════════════════════════════════
-- publish_due_scheduled_homework: a school fence, one overload, and the
-- updated_at column its whole service layer already assumed
--
-- THREE DEFECTS ON ONE FUNCTION. Two were reported; the third was found while
-- fixing them and is the reason this migration exists at all.
--
-- ── 1. A CROSS-TENANT WRITE (not reported, found here) ────────────────────
-- The function is SECURITY DEFINER, `authenticated` holds EXECUTE, and it took
-- `_school_id` WITHOUT EVER CHECKING THE CALLER BELONGS TO THAT SCHOOL. So any
-- authenticated user -- a student -- could call
--
--     publish_due_scheduled_homework('<some other school>')
--
-- and force-publish another school's scheduled homework and tests ahead of
-- their scheduled time. And because the predicate was
-- `_school_id IS NULL OR school_id = _school_id`, passing NULL published EVERY
-- SCHOOL'S due work at once. The zero-argument overload did precisely that.
--
-- A tenant-boundary hole is never out of scope, so it is closed here rather
-- than recorded. The school is now resolved from the CALLER and an argument
-- naming any other school is refused. service_role keeps the wider path for a
-- future sweep: `current_setting('role')` is the one caller marker that
-- survives inside SECURITY DEFINER (KNOWN_ISSUES 1 measured this --
-- current_user and session_user are the definer for every caller, so testing
-- them would admit anon).
--
-- ── 2. 42703: `column "updated_at" of relation "tests" does not exist` ─────
-- WHICH SIDE WAS WRONG. The schema was. Establishing it, rather than adding a
-- column to satisfy a query:
--
--   · `homework` -- the sibling table, in the same domain, updated by the same
--     function -- HAS `updated_at` AND the `tg_set_updated_at` trigger.
--   · SEVEN call sites already write `tests.updated_at`: five in
--     `TestService` (setQuestions x2, update, and two more), this function, and
--     `HomeworkService.publishDueScheduled`'s fallback. That is a consistent
--     design expectation, not one typo.
--   · No ruling ever removed it. `tests` simply never had it -- absent from
--     CREATE TABLE in chunk6 and from chunk75d's column additions.
--   · It is an audit timestamp, not a second copy of a fact, so it does not
--     repeat the G9 shape that got `is_published` deliberately dropped in 7.5.
--
-- So `tests` gains `updated_at` and the same trigger `homework` has, and seven
-- call sites become correct at once.
--
-- ── 3. PGRST203: ambiguous overload ───────────────────────────────────────
-- `publish_due_scheduled_homework()` and `(uuid DEFAULT NULL)` both matched a
-- zero-argument call. The zero-arg form is dropped: nothing calls it (no cron
-- job, no `src/` reference -- checked), it existed only to pass NULL, and NULL
-- is exactly the global-publish path defect 1 closes. Same shape as
-- `admin_connect_student_account/2`, where dropping the orphan made the call
-- resolve to the fenced form.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── tests.updated_at, matching homework exactly ───────────────────────────
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS tests_set_updated ON public.tests;
CREATE TRIGGER tests_set_updated
  BEFORE UPDATE ON public.tests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON COLUMN public.tests.updated_at IS
  'Maintained by the tests_set_updated trigger, the same way homework.updated_at '
  'is. Added 20260908000000: seven call sites already wrote it against a column '
  'that did not exist, which is what produced 42703 on publish_due_scheduled_homework.';

-- ── the ambiguous, global-publish overload goes ───────────────────────────
DROP FUNCTION IF EXISTS public.publish_due_scheduled_homework();

-- ── the surviving overload, fenced to the caller's own school ─────────────
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework(_school_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n_hw     int := 0;
  _n_test   int := 0;
  _is_svc   boolean := coalesce(current_setting('role', true) = 'service_role', false);
  _target   uuid := _school_id;
BEGIN
  -- Resolve from the caller when unspecified. NULL no longer means "every
  -- school"; for a real user it means "mine", and with no school context at all
  -- it is refused rather than widened.
  IF NOT _is_svc THEN
    IF _target IS NULL THEN
      _target := public.get_my_school_id();
    END IF;
    IF _target IS NULL THEN
      RAISE EXCEPTION 'publish_due_scheduled_homework: no school context for this caller';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.my_accessible_school_ids() AS s(id) WHERE s.id = _target
    ) THEN
      RAISE EXCEPTION 'publish_due_scheduled_homework: % is outside your school', _target;
    END IF;
  END IF;

  UPDATE public.homework
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_target IS NULL OR school_id = _target);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.tests
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_target IS NULL OR school_id = _target);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$function$;

COMMENT ON FUNCTION public.publish_due_scheduled_homework(uuid) IS
  'Publishes homework and tests whose scheduled_publish_at has passed, for ONE '
  'school. Fenced 20260908000000: the school is resolved from the caller and an '
  'argument naming another school is refused -- it previously accepted any '
  'school id from any authenticated user, and NULL meant every school at once. '
  'service_role keeps the unfenced path for a future sweep; no cron uses it yet.';

COMMIT;
