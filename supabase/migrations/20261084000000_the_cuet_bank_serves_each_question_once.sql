-- ===========================================================================
-- THE CUET BANK SERVES EACH QUESTION ONCE, AS ITS CLEANEST, ANSWERABLE COPY
--
-- Measured 2026-09-24/25, driving Practice as a CUET account and then reading
-- the rows (4,292 active CUET rows, 4,252 of them the PW CUET ebook import and
-- 40 AI recovery variants):
--
--   * Most ebook questions are stored 2–4 times: same stem, same chapter, same
--     options, same key. question_bank_unique_active is unique on
--     (question, class_level, subject), so each extra copy had "[<chapter>]"
--     appended to its stem to get past it — once, twice, three times. 2,868
--     stems carry that tag, and a student reads it: "Identify the correct
--     statement. [Retirement and Death of a Partner] [Retirement and Death of
--     a Partner]". Other copies differ only in their quote marks
--     ('Quick-Fix' / ‘Quick-Fix’ / Quick-Fix'). The copies defeat every
--     "fresh question" rule: a revision check or recovery ladder that excludes
--     what the student has seen by id serves the same question under another.
--   * Page furniture from the book: 13 stems and 52 option sets carry a page
--     marker ("=====PAGE 97=====", "---PAGE 60---", "PRACTICE CORNER") and the
--     running header after it ("Retirement and Death of a Partner 93",
--     "224 CUET UG Business Studies"), or the next section's heading bled into
--     the last option ("Assertion – Reason – Based Questions Given below…",
--     "Case – Based Questions Directions (1-5) Read the following passage…").
--   * Some questions cannot be answered as stored: a case-study question whose
--     case was never imported ("Which external source of recruitment is being
--     used by Lenovo India in the above case?"), a match-the-following cut off
--     mid-list (options ", (2) –", "(1) - (A), (2) - (B), (3) - (C), (4) -"), or
--     the answer choices bled into an option ("Partner's loan accounts (a) (A),
--     (B), (D), (C) (b) …").
--   * Some stems are stored with DIFFERENT correct answers across copies.
--     There is no way to tell from the data which is right.
--
-- What this does, per question (grouped on the stem with tags, furniture,
-- quote marks and spacing removed — the 40 AI variants are not grouped):
--
--   1. Copies that disagree on the key: every copy retired. None is served
--      until someone decides the key. A question whose answer choices bled
--      into an option: every copy retired (see choices_bled).
--   2. Otherwise one copy is kept — answerable first, then the fewest words
--      split by the extraction, then the longest options (a cut-short fraction
--      is the shorter), then a stem that needed no cleaning, then the oldest —
--      and every other copy is retired with
--      replaced_by_question_id pointing at it (the 20260828160000 lineage).
--   3. The kept copy loses page furniture from stem and options and its
--      "[<chapter>]" tags — unless the cleaned stem is already an active
--      question elsewhere, where the tag is what keeps the two apart.
--   4. A kept copy that still cannot be answered is retired.
--   5. Everything that pointed at a retired duplicate follows it to the kept
--      copy: open mistakes (recovery serves active questions only), bookmarks,
--      seen-history (so the kept copy is not "fresh" to someone who answered a
--      duplicate), AI variants' source, and pending variant jobs.
--
-- Every row touched is recorded, with what it was, in
-- public.cuet_bank_repair_20261084 and public.cuet_ref_repoint_20261084 —
-- which is also what the rollback reads. Changed rows are re-queued for
-- embedding (pending_embed).
--
-- ROLLBACK: rollback/20261084000000_the_cuet_bank_serves_each_question_once.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.cuet_bank_repair_20261084 (
  question_id       uuid PRIMARY KEY,
  action            text NOT NULL,
  kept_id           uuid,
  old_question      text NOT NULL,
  old_options       jsonb NOT NULL,
  old_is_active     boolean NOT NULL,
  old_replaced_by   uuid,
  old_embed_status  text
);
ALTER TABLE public.cuet_bank_repair_20261084 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuet_bank_repair_20261084 FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.cuet_bank_repair_20261084 IS
  'Rows 20261084000000 changed in the CUET bank, with their prior values. Read by its rollback; no client access.';

-- One row per reference moved from a retired duplicate to its kept copy.
-- ref_table + ref_key identify the referencing row; 'inserted' marks a
-- seen-history row this migration created (the rollback deletes it).
CREATE TABLE public.cuet_ref_repoint_20261084 (
  ref_table        text NOT NULL,
  ref_key          text NOT NULL,
  old_question_id  uuid NOT NULL,
  new_question_id  uuid NOT NULL,
  inserted         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (ref_table, ref_key)
);
ALTER TABLE public.cuet_ref_repoint_20261084 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuet_ref_repoint_20261084 FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.cuet_ref_repoint_20261084 IS
  'References 20261084000000 moved from retired CUET duplicates to the kept copy. Read by its rollback; no client access.';

-- ── The working set: every active CUET ebook row, cleaned ──────────────────
-- Page marker, optionally followed by the book's running header: the row's
-- own chapter with a page number, or "CUET UG <subject>" with one. Nothing is
-- removed unless a marker is present.
CREATE TEMP TABLE _b ON COMMIT DROP AS
WITH src AS (
  SELECT q.id, q.question, q.options, q.correct_index, q.subject, q.class_level, q.chapter,
         q.created_at, q.is_active, q.replaced_by_question_id, q.embed_status,
         regexp_replace(q.chapter, '([\[\]\(\)\.\*\+\?\^\$\{\}\|\\])', '\\\1', 'g') AS chap_re
    FROM public.question_bank q
    JOIN public.competitive_exams ce ON ce.id = q.exam_id
   WHERE ce.code = 'cuet' AND q.is_active AND q.source_question_id IS NULL
)
SELECT s.*,
       btrim(regexp_replace(
         regexp_replace(
           regexp_replace(
             s.question,
             '\s*(?:PRACTICE CORNER(?:\s*(?:=====|---)PAGE \d+(?:=====|---))?|(?:=====|---)PAGE \d+(?:=====|---))\s*'
             || '(?:\d+ CUET UG (?:Accountancy|Business Studies|Economics|English|Mathematics)'
             || '|CUET UG (?:Accountancy|Business Studies|Economics|English|Mathematics) \d+'
             || '|' || s.chap_re || ' \d+)?\s*',
             ' ', 'g'),
           '(\s*\[' || s.chap_re || '\])+\s*$', ''),
         '\s{2,}', ' ', 'g')) AS clean,
       (SELECT jsonb_agg(btrim(regexp_replace(
                 regexp_replace(o,
                   '\s*(?:PRACTICE CORNER|(?:=====|---)PAGE \d+(?:=====|---)|Case\s*[–-]\s*Based Questions'
                   || '|Assertion\s*[–-]\s*Reason\s*[–-]\s*Based Questions|Given below are two statements'
                   || '|Comprehension\s+[A-Z]|Directions\s*\(\s*\d+\s*[-–]\s*\d+\s*\)|Read the following (?:text|passage)).*$',
                   '', 'i'),
                 '\s{2,}', ' ', 'g')) ORDER BY ord)
          FROM jsonb_array_elements_text(s.options) WITH ORDINALITY AS t(o, ord)) AS fixed
  FROM src s;

ALTER TABLE _b ADD COLUMN gkey text, ADD COLUMN choices_bled boolean, ADD COLUMN unusable boolean,
               ADD COLUMN artefacts int, ADD COLUMN opt_len int;
UPDATE _b SET
  -- Tags, furniture, quote marks and spacing do not make a different question.
  gkey = lower(regexp_replace(regexp_replace(clean, '[‘’''“”"`]', '', 'g'), '\s+', ' ', 'g')),
  -- The question's real choices ("(a) (A), (B) and (C) only") bled into an
  -- option, so the stored options are its ITEMS and the stored key points at
  -- one of them. Every copy of such a question is malformed, including one
  -- that looks tidy because the bleed was cut off it.
  choices_bled =
       (question || ' ' || options::text) ~* 'Choose the correct answer from the options'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(fixed) o
                WHERE o ~ '\(\s*[a-d]\s*\)\s*\(\s*[A-E1-4]\s*\)\s*[,–-]'      -- (a) (A), (B) …
                   OR o ~ '\(\s*[a-d]\s*\)\s*[A-E]\s*(?:,|and\M)'             -- (a) A, C, D …
                   OR o ~ '\d\s*\(\s*[a-d]\s*\)\s*,\s*\d\s*\(\s*[a-d]\s*\)'), -- 1(a), 2(c) …
  unusable =
       jsonb_array_length(fixed) < 2
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(fixed) o
                WHERE btrim(o) = ''
                   OR length(o) > 250                                       -- the next question bled in
                   OR o ~ '^\s*(?:[,;]|(?:and|or)\s*\()'                   -- a fragment of a split option or list
                   OR o ~ '\(\d\)\s*[–-]\s*$')                            -- a match-the-following cut off
    OR (SELECT count(DISTINCT lower(o)) FROM jsonb_array_elements_text(fixed) o) < jsonb_array_length(fixed)
    -- A case-study question whose case was never imported: it says "the above
    -- case" and is too short to be carrying one.
    OR (clean ~* '(based on the case|(in|from) the above case|the case above|the above passage|the passage above)'
        AND length(clean) < 200),
  -- Words the extraction split at a line end ("activ- ities", "su - perior").
  artefacts = (SELECT count(*) FROM jsonb_array_elements_text(fixed) o WHERE o ~ '[a-z]\s?-\s[a-z]'),
  opt_len = (SELECT sum(length(o)) FROM jsonb_array_elements_text(fixed) o);

-- 1. Stems whose copies disagree on the answer, and stems whose choices bled.
CREATE TEMP TABLE _conflict ON COMMIT DROP AS
SELECT gkey, subject, class_level FROM _b GROUP BY 1, 2, 3 HAVING count(DISTINCT correct_index) > 1;
CREATE TEMP TABLE _bled ON COMMIT DROP AS
SELECT DISTINCT gkey, subject, class_level FROM _b WHERE choices_bled;

-- 2. One keeper per remaining stem.
CREATE TEMP TABLE _keep ON COMMIT DROP AS
SELECT DISTINCT ON (b.gkey, b.subject, b.class_level) b.gkey, b.subject, b.class_level, b.id AS kept_id
  FROM _b b
 WHERE NOT EXISTS (SELECT 1 FROM _conflict c
                    WHERE c.gkey = b.gkey AND c.subject = b.subject AND c.class_level = b.class_level)
   AND NOT EXISTS (SELECT 1 FROM _bled c
                    WHERE c.gkey = b.gkey AND c.subject = b.subject AND c.class_level = b.class_level)
 -- Answerable, then fewest split words, then the longest options (a fraction
 -- cut short is the shorter copy), then a stem that needed no cleaning.
 ORDER BY b.gkey, b.subject, b.class_level, b.unusable, b.artefacts, b.opt_len DESC, (b.question = b.clean) DESC, b.created_at, b.id;

CREATE TEMP TABLE _plan ON COMMIT DROP AS
SELECT b.*, k.kept_id,
       CASE
         WHEN EXISTS (SELECT 1 FROM _bled c
                       WHERE c.gkey = b.gkey AND c.subject = b.subject AND c.class_level = b.class_level)
           THEN 'retired_unanswerable'
         WHEN k.kept_id IS NULL THEN 'retired_conflicting_key'
         WHEN b.id <> k.kept_id THEN 'retired_duplicate'
         WHEN b.unusable THEN 'retired_unanswerable'
         ELSE 'kept'
       END AS action
  FROM _b b
  LEFT JOIN _keep k ON k.gkey = b.gkey AND k.subject = b.subject AND k.class_level = b.class_level;

-- 3. A kept stem keeps its tag if the cleaned stem is already active outside
--    the rows being changed here.
ALTER TABLE _plan ADD COLUMN strip boolean;
UPDATE _plan p SET strip = p.action = 'kept' AND p.question <> p.clean
  AND NOT EXISTS (SELECT 1 FROM public.question_bank o
                   WHERE o.is_active AND o.question = p.clean AND o.class_level = p.class_level
                     AND o.subject = p.subject AND o.id NOT IN (SELECT id FROM _b));

INSERT INTO public.cuet_bank_repair_20261084
  (question_id, action, kept_id, old_question, old_options, old_is_active, old_replaced_by, old_embed_status)
SELECT id,
       CASE WHEN action <> 'kept' THEN action
            WHEN strip AND fixed <> options THEN 'kept_stem_and_options_cleaned'
            WHEN strip THEN 'kept_stem_cleaned'
            ELSE 'kept_options_cleaned' END,
       CASE WHEN action = 'retired_duplicate' THEN kept_id END,
       question, options, is_active, replaced_by_question_id, embed_status
  FROM _plan
 WHERE action <> 'kept' OR strip OR fixed <> options;

-- Retire first, so a cleaned stem never collides with a copy still active.
UPDATE public.question_bank q
   SET is_active = false,
       replaced_by_question_id = CASE WHEN p.action = 'retired_duplicate' THEN p.kept_id ELSE q.replaced_by_question_id END,
       updated_at = now()
  FROM _plan p
 WHERE q.id = p.id AND p.action <> 'kept';

UPDATE public.question_bank q
   SET question = CASE WHEN p.strip THEN p.clean ELSE q.question END,
       options = p.fixed,
       embed_status = 'pending_embed',
       updated_at = now()
  FROM _plan p
 WHERE q.id = p.id AND p.action = 'kept' AND (p.strip OR p.fixed <> p.options);

-- ── 5. References follow a retired duplicate to its kept copy ───────────────
CREATE TEMP TABLE _dup ON COMMIT DROP AS
SELECT id AS old_id, kept_id AS new_id FROM _plan WHERE action = 'retired_duplicate';

-- Open mistakes (one per user+source+question: skip where one is already kept).
INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'student_mistakes', sm.id::text, d.old_id, d.new_id
  FROM public.student_mistakes sm JOIN _dup d ON d.old_id = sm.question_id
 WHERE sm.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM public.student_mistakes x
                    WHERE x.user_id = sm.user_id AND x.source = sm.source AND x.question_id = d.new_id);
UPDATE public.student_mistakes sm SET question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid;

-- Bookmarks (unique per user+question).
INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT DISTINCT ON (pb.user_id, d.new_id) 'practice_bookmarks', pb.id::text, d.old_id, d.new_id
  FROM public.practice_bookmarks pb JOIN _dup d ON d.old_id = pb.question_id
 WHERE NOT EXISTS (SELECT 1 FROM public.practice_bookmarks x WHERE x.user_id = pb.user_id AND x.question_id = d.new_id)
 ORDER BY pb.user_id, d.new_id, pb.created_at;
UPDATE public.practice_bookmarks pb SET question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'practice_bookmarks' AND pb.id = r.ref_key::uuid;

-- Seen-history: the kept copy is seen by whoever saw a duplicate. A new row,
-- never an edit of an existing one, so the rollback only deletes what it made.
INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id, inserted)
SELECT DISTINCT ON (h.user_id, d.new_id) 'student_question_history', h.user_id::text || ':' || d.new_id::text, d.old_id, d.new_id, true
  FROM public.student_question_history h JOIN _dup d ON d.old_id = h.question_id
 WHERE NOT EXISTS (SELECT 1 FROM public.student_question_history x WHERE x.user_id = h.user_id AND x.question_id = d.new_id)
 ORDER BY h.user_id, d.new_id, h.last_seen_at DESC;
INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at, school_id)
SELECT h.user_id, r.new_question_id, h.times_seen, h.last_seen_at, h.school_id
  FROM public.cuet_ref_repoint_20261084 r
  JOIN public.student_question_history h
    ON h.user_id = split_part(r.ref_key, ':', 1)::uuid AND h.question_id = r.old_question_id
 WHERE r.ref_table = 'student_question_history';

-- AI variants generated from a duplicate belong to the kept copy's ladder.
INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'question_bank.source_question_id', v.id::text, d.old_id, d.new_id
  FROM public.question_bank v JOIN _dup d ON d.old_id = v.source_question_id;
UPDATE public.question_bank v SET source_question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid;

-- Pending variant jobs (one pending job per source+tier).
INSERT INTO public.cuet_ref_repoint_20261084 (ref_table, ref_key, old_question_id, new_question_id)
SELECT DISTINCT ON (d.new_id, j.tier) 'variant_generation_queue', j.id::text, d.old_id, d.new_id
  FROM public.variant_generation_queue j JOIN _dup d ON d.old_id = j.source_question_id
 WHERE j.status = 'pending'
   AND NOT EXISTS (SELECT 1 FROM public.variant_generation_queue x
                    WHERE x.status = 'pending' AND x.source_question_id = d.new_id AND x.tier = j.tier)
 ORDER BY d.new_id, j.tier, j.created_at;
UPDATE public.variant_generation_queue j SET source_question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261084 r
 WHERE r.ref_table = 'variant_generation_queue' AND j.id = r.ref_key::uuid;

-- ── Verify (each check can fail) ───────────────────────────────────────────
DO $proof$
DECLARE
  _active int; _n int;
BEGIN
  SELECT count(*) INTO _active
    FROM public.question_bank q JOIN public.competitive_exams ce ON ce.id = q.exam_id
   WHERE ce.code = 'cuet' AND q.is_active AND q.source_question_id IS NULL;

  SELECT count(*) INTO _n FROM (
    SELECT p.gkey FROM _plan p JOIN public.question_bank q ON q.id = p.id AND q.is_active
     GROUP BY p.gkey, p.subject, p.class_level HAVING count(*) > 1) x;
  IF _n <> 0 THEN RAISE EXCEPTION '% CUET stems are still served more than once', _n; END IF;

  SELECT count(*) INTO _n FROM _plan p JOIN public.question_bank q ON q.id = p.id
   WHERE q.is_active AND q.question <> p.clean;
  IF _n > 1 THEN RAISE EXCEPTION '% active CUET stems still carry a tag or furniture (at most 1 expected)', _n; END IF;

  SELECT count(*) INTO _n FROM public.question_bank q JOIN public.competitive_exams ce ON ce.id = q.exam_id
   WHERE ce.code = 'cuet' AND q.is_active AND q.source_question_id IS NULL
     AND (q.question || ' ' || q.options::text) ~* '=====PAGE|---PAGE|PRACTICE CORNER|Assertion\s*[–-]\s*Reason\s*[–-]\s*Based|Case\s*[–-]\s*Based Questions';
  IF _n <> 0 THEN RAISE EXCEPTION '% active CUET rows still carry page furniture', _n; END IF;

  SELECT count(*) INTO _n FROM _plan p JOIN public.question_bank q ON q.id = p.id
   WHERE q.is_active AND (p.action = 'retired_conflicting_key' OR p.unusable OR p.choices_bled);
  IF _n <> 0 THEN RAISE EXCEPTION '% conflicting or unanswerable CUET rows still served', _n; END IF;

  SELECT count(*) INTO _n FROM public.student_mistakes sm
    JOIN public.cuet_bank_repair_20261084 r ON r.question_id = sm.question_id AND r.action = 'retired_duplicate'
   WHERE sm.status = 'open'
     AND NOT EXISTS (SELECT 1 FROM public.student_mistakes x
                      WHERE x.user_id = sm.user_id AND x.source = sm.source AND x.question_id = r.kept_id);
  IF _n <> 0 THEN RAISE EXCEPTION '% open mistakes still point at a retired duplicate', _n; END IF;

  SELECT count(*) INTO _n FROM public.question_bank v
    JOIN public.cuet_bank_repair_20261084 r ON r.question_id = v.source_question_id AND r.action = 'retired_duplicate';
  IF _n <> 0 THEN RAISE EXCEPTION '% variants still hang off a retired duplicate', _n; END IF;

  RAISE NOTICE 'OK: % CUET ebook questions served, one row each', _active;
END
$proof$;

COMMIT;
