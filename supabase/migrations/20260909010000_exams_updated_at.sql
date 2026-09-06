-- ═══════════════════════════════════════════════════════════════════════════
-- Finalising and publishing an exam wrote a column that does not exist
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `examRepository` updates `public.exams` in two places, and both write
-- `updated_at`:
--
--   setExamLocked            .update({ marks_locked, updated_at })   line 424
--   setExamResultsPublished  .update({ results_published_at, updated_at })
--                                                                   line 440
--
-- `public.exams` has no `updated_at` column. PostgREST answers PGRST204
-- ("column not found in schema cache"), which `src/lib/presentation/errors.ts`
-- maps to "This feature isn't available right now." -- the banner a teacher
-- actually sees.
--
-- Those two functions ARE the back half of the exam workflow:
-- `MarksService.finalizeMarks` and `MarksService.publishResults`. So marks
-- could be entered and saved, and then the sitting could never be finalised
-- and results could never be published. Measured in the browser as Priya
-- Sharma: "Marks saved" succeeds, then "Finalize all subjects" shows
-- "This feature isn't available right now."
--
-- Together with 20260909000000 (which made creating the sitting possible at
-- all) this is the whole reason `marks.results_published` and
-- `examination.scheduled` have ZERO rows in `academic_events` while six exams
-- carry `results_published_at`. Those six were written by the seed, directly.
-- `publishResults` had never run, so its emitter had never been reached.
--
-- ── WHICH SIDE IS WRONG ──────────────────────────────────────────────────
--
-- The schema. Same argument 20260908000000 made for `tests`, and the same
-- evidence shape:
--
--   · `homework` -- the sibling table, same domain, written by the same
--     service layer -- HAS `updated_at` and the `tg_set_updated_at` trigger.
--   · Both live call sites already write it. This is a design expectation the
--     schema never met, not a typo.
--   · No ruling removed it: `exams` simply never had the column.
--   · It is an audit timestamp, not a second copy of a fact, so it does not
--     repeat the G9 two-homes shape that got `is_published` dropped in 7.5.
--
-- So `exams` gains `updated_at` and the trigger `homework` has, exactly as
-- `tests` did one migration earlier.
--
-- ── THE BACKFILL, AND WHY IT IS NOT `now()` ──────────────────────────────
--
-- `DEFAULT now()` stamps every existing exam as though it had been modified at
-- migration time, which is a false audit fact about rows nobody touched. The
-- existing rows are backfilled from `created_at` instead, so "never updated
-- since creation" reads as exactly that. New rows still default to now().
--
-- §10.5 Teacher panel > Marks entry and Exams (docs/locked-decisions.md:203-213)
-- -- marks are "saved as draft, reviewed, then submitted once", and the class
-- teacher owns the exam for their own section. Finalise IS that single
-- submission and publish is what makes the result reach students and parents;
-- a schema that refuses both leaves the rule with no path to run on.
--
-- NOT §10.13, which is "Report card" (line 475). An earlier draft of this
-- header cited it; the citation was wrong and is corrected here.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── exams.updated_at, matching homework and tests exactly ────────────────
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Rows that predate the column were not updated at migration time; say so.
UPDATE public.exams SET updated_at = created_at WHERE updated_at <> created_at;

DROP TRIGGER IF EXISTS exams_set_updated ON public.exams;
CREATE TRIGGER exams_set_updated
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON COLUMN public.exams.updated_at IS
  'Maintained by the exams_set_updated trigger, the same way homework.updated_at '
  'and tests.updated_at are. Added 20260909010000: setExamLocked and '
  'setExamResultsPublished already wrote it against a column that did not '
  'exist, which is what made finalise and publish-results unreachable.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres` and therefore proves nothing about who may finalise or
-- publish (rule 6). It checks the shape. The behavioural claims -- that the
-- class teacher can now lock and publish a sitting, that a teacher who does
-- not teach the class still cannot, and that the trigger actually moves the
-- timestamp -- are asserted as the caller in probe20.sql (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _cols int;
  _trg  int;
  _null text;
BEGIN
  SELECT count(*) INTO _cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='exams' AND column_name='updated_at';
  IF _cols <> 1 THEN
    RAISE EXCEPTION 'ABORT: exams.updated_at was not created';
  END IF;

  SELECT is_nullable INTO _null FROM information_schema.columns
   WHERE table_schema='public' AND table_name='exams' AND column_name='updated_at';
  IF _null <> 'NO' THEN
    RAISE EXCEPTION 'ABORT: exams.updated_at is nullable; homework and tests are not';
  END IF;

  SELECT count(*) INTO _trg
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='exams'
     AND t.tgname='exams_set_updated' AND NOT t.tgisinternal;
  IF _trg <> 1 THEN
    RAISE EXCEPTION 'ABORT: exams_set_updated trigger is missing';
  END IF;

  -- A column with no trigger behind it would satisfy the writes and then lie
  -- about when the row changed, which is worse than not having it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE c.relname='exams' AND t.tgname='exams_set_updated'
       AND p.proname='tg_set_updated_at'
  ) THEN
    RAISE EXCEPTION 'ABORT: exams_set_updated does not run tg_set_updated_at';
  END IF;

  RAISE NOTICE 'exams.updated_at present; behaviour is asserted as the caller in probe20.';
END $verify$;

COMMIT;
