-- ═══════════════════════════════════════════════════════════════════════════
-- Class 5 exists — §10.9 says so, and 2,189 questions were archived for
-- disagreeing with a hardcoded 6..12
--
-- ── RULED BY THE SPEC, NOT BY THIS MIGRATION (KNOWN_ISSUES 27) ───────────
--
-- The entry recorded a contradiction and asked for a ruling. The ruling was
-- already written down. §10.9, `docs/locked-decisions.md:391`:
--
--   "Filtering by tag is what keeps content appropriate — **a Class 5 student
--    is only ever served Class 5 content for their own board.**"
--
-- The spec names Class 5 by hand, as the worked example of the whole tagging
-- rule. `curriculum_classes` agrees: Class 5, 4 subjects, 55 chapters, seeded.
-- This is the same shape as KNOWN_ISSUES 17 — a "ruling request" the spec had
-- already answered.
--
-- ── WHERE THE 6..12 CAME FROM ────────────────────────────────────────────
--
-- `20260821120000` measured 2,189 rows at `class_level = 5` and archived every
-- one of them, on these stated grounds:
--
--   "outside the app's ClassLevel domain (6..12, ... resolveCurriculumScope
--    only ever queries 6-12), so these 2204 rows are silently unreachable by
--    any student/teacher query. Archive (is_active=false), don't delete —
--    these may be legitimate content for a future class-5 rollout."
--
-- The reasoning was sound and the conclusion was backwards: the CLIENT'S domain
-- was the defect, not the data. `question_bank_class_level_check` then codified
-- the client's mistake into the schema. This is that rollout.
--
-- ── WHAT REPLACES THE RANGE ──────────────────────────────────────────────
--
-- Nothing, and that is deliberate. A range is a literal that drifts; the
-- curriculum tree already knows which classes exist. Every keyed question
-- resolves a class through `chapter_id -> chapters -> curriculum_subjects ->
-- curriculum_classes.level`, so `class_level` is DERIVABLE and was only ever a
-- duplicate — the two-homes shape (G9) waiting to disagree.
--
-- Measured before writing this, across all 21,696 rows:
--   chapter_id NULL ......................... 15   (chunk 7A retired them)
--   chapter that does not resolve to a class . 0
--   class_level DISAGREEING with its chapter . 0
--   class_level = 5 whose chapter is Class 5 . 2,189 of 2,189
--
-- So the invariant already holds everywhere; the trigger below makes it
-- structural, and fills `class_level` from the chapter when a caller omits it.
-- A CHECK constraint cannot do this — it may not run a subquery — which is why
-- this is a trigger and not a constraint.
--
-- After this, the class-level domain is "whatever `curriculum_classes` holds".
-- Seeding Class 4 becomes a data job, not a code change, and no literal in
-- either the database or the client has to be found and edited.
--
-- ── THE REACTIVATION ─────────────────────────────────────────────────────
--
-- Only the rows `20260821120000` archived for this reason: keyed, Class 5, and
-- currently inactive. The 15 rows with no `chapter_id` STAY archived — chunk 7A
-- retired those deliberately because a question with no chapter can never be
-- selected, tracked or analysed (§10.10), and that ruling is untouched.
--
-- The UPDATE is idempotent (`WHERE NOT is_active`) and this file asserts an
-- INVARIANT rather than a row count, so a replay cannot fail on its own success.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. the range goes ─────────────────────────────────────────────────────
ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_class_level_check;

-- ── 2. the class follows the chapter ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_question_bank_class_follows_chapter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _chapter_level integer;
BEGIN
  -- An unkeyed row is the retired-question case; `question_bank_active_must_be_keyed`
  -- already forbids it while active, and nothing here should second-guess that.
  IF NEW.chapter_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cc.level INTO _chapter_level
    FROM public.chapters ch
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
    JOIN public.curriculum_classes  cc ON cc.id = cs.curriculum_class_id
   WHERE ch.id = NEW.chapter_id;

  IF _chapter_level IS NULL THEN
    RAISE EXCEPTION
      'question_bank.chapter_id % does not resolve to a curriculum class', NEW.chapter_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.class_level IS NULL THEN
    -- Derived, not demanded. A caller that names the chapter has already said
    -- which class it is; making them repeat it is how the two come to disagree.
    NEW.class_level := _chapter_level;
  ELSIF NEW.class_level <> _chapter_level THEN
    RAISE EXCEPTION
      'question_bank.class_level % disagrees with chapter %, which is Class % (§10.9: a Class % student is only ever served Class % content)',
      NEW.class_level, NEW.chapter_id, _chapter_level, _chapter_level, _chapter_level
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_question_bank_class_follows_chapter ON public.question_bank;
CREATE TRIGGER trg_question_bank_class_follows_chapter
  BEFORE INSERT OR UPDATE OF class_level, chapter_id ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.tg_question_bank_class_follows_chapter();

COMMENT ON FUNCTION public.tg_question_bank_class_follows_chapter() IS
  'Keeps question_bank.class_level equal to the class of its chapter, and fills '
  'it in when omitted. Replaces question_bank_class_level_check, whose hardcoded '
  '6..12 archived 2,189 legitimate Class 5 questions -- a class §10.9 names by '
  'hand. A CHECK cannot do this because it may not run a subquery.';

-- ── 3. the rollout ────────────────────────────────────────────────────────
UPDATE public.question_bank
   SET is_active = true, updated_at = now()
 WHERE NOT is_active
   AND class_level = 5
   AND chapter_id IS NOT NULL;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — invariants, not row counts, so a replay cannot fail on its own
-- success. Runs as the migration role and proves nothing about who may READ
-- these rows (rule 6); probe29 asserts that as the caller (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _n int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.question_bank'::regclass
                AND conname = 'question_bank_class_level_check') THEN
    RAISE EXCEPTION 'ABORT: the 6..12 range constraint is still present';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.question_bank'::regclass
                    AND tgname = 'trg_question_bank_class_follows_chapter'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the class-follows-chapter trigger is missing';
  END IF;

  -- The keying constraint is NOT what this migration touched; if it went, an
  -- unkeyed active question becomes possible again and §10.10 is broken.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.question_bank'::regclass
                    AND conname = 'question_bank_active_must_be_keyed') THEN
    RAISE EXCEPTION 'ABORT: question_bank_active_must_be_keyed was lost';
  END IF;

  -- INVARIANT 1: no row disagrees with its chapter.
  SELECT count(*) INTO _n
    FROM public.question_bank qb
    JOIN public.chapters ch ON ch.id = qb.chapter_id
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
    JOIN public.curriculum_classes  cc ON cc.id = cs.curriculum_class_id
   WHERE qb.class_level IS DISTINCT FROM cc.level;
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % question(s) disagree with their chapter''s class', _n;
  END IF;

  -- INVARIANT 2: no keyed Class 5 question is left archived.
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE NOT is_active AND class_level = 5 AND chapter_id IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % keyed Class 5 question(s) are still archived', _n;
  END IF;

  -- INVARIANT 3: the 15 unkeyed rows chunk 7A retired stay retired.
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE chapter_id IS NULL AND is_active;
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % unkeyed question(s) are active -- §10.10 broken', _n;
  END IF;

  RAISE NOTICE 'class_level follows the curriculum; Class 5 is live. probe29 asserts the reads.';
END $verify$;
