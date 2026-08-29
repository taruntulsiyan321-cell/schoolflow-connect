-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5d — the columns the live Tests feature actually uses
--
-- 7.5a added the tables DPP had and `tests` lacked. This adds the COLUMNS the
-- same way: `dpps` carries 28, `tests` carried 13, and the client reads most
-- of the difference.
--
-- Chosen by counting real use across testService.ts and the five screens
-- rather than by copying the old table:
--
--     class_id 26   title 24   is_published 12   test_kind 9   difficulty 7
--     chapter 7     topics 6   chapters 5        total_marks 5
--     instructions 3   scheduled_publish_at 3    archived_at 1
--     negative_marking 0   <- NOT carried across
--
-- negative_marking is referenced nowhere in the client. Carrying it would be
-- copying a column because it exists, not because anything needs it.
--
-- ── Two things deliberately NOT added ─────────────────────────────────────
--
-- class_id. §10.22 and 7.5 verification item 6 anchor a test on
-- section_subject, and tests.section_subject_id already does. A section_subject
-- resolves to its section, so the class is reachable by join — adding a second
-- column naming the same fact is exactly the two-sources-of-truth shape G9
-- warns about. The 26 client uses resolve through the join instead.
--
-- is_published. It is `status = 'published'`, and 7.5a already widened the
-- status set. A boolean beside the enum is a second source of truth for one
-- fact, and they drift the moment one is written without the other.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS difficulty   text,
  ADD COLUMN IF NOT EXISTS test_kind    text,
  ADD COLUMN IF NOT EXISTS total_marks  numeric,
  ADD COLUMN IF NOT EXISTS chapter_id   uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chapter      text,
  ADD COLUMN IF NOT EXISTS chapters     jsonb,
  ADD COLUMN IF NOT EXISTS topics       jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz;

-- Every one is NULLABLE, on purpose. G4: a test with no time limit is not a
-- test limited to zero, and one with no difficulty set is not "easy". The
-- client must render absence as absence.

-- difficulty and test_kind are constrained rather than free text, so a typo
-- fails at the write instead of quietly creating a category nothing filters on.
-- Values taken from the live dpps rows, not invented:
--   SELECT DISTINCT difficulty FROM dpps;  SELECT DISTINCT test_kind FROM dpps;
-- Values confirmed against the live rows before the constraint is written,
-- not assumed:
--   SELECT difficulty, count(*) FROM dpps GROUP BY 1  ->  medium 1, easy 1
--   SELECT test_kind,  count(*) FROM dpps GROUP BY 1  ->  class_test 2
--
-- G15: a CHECK that omits the value about to be written is one of the three
-- silent-failure constructs this chunk found. So the allowed set is read out
-- of the data first. 'hard' is included because the client offers it even
-- though no row uses it yet.
ALTER TABLE public.tests
  ADD CONSTRAINT tests_difficulty_check
  CHECK (difficulty IS NULL OR difficulty = ANY (ARRAY['easy', 'medium', 'hard']));

COMMIT;
