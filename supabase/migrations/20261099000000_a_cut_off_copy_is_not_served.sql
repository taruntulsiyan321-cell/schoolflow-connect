-- ===========================================================================
-- A CUT-OFF COPY IS NOT SERVED
--
-- The PW ebook import stored some questions more than once, and in some
-- copies the extraction cut the stem off before its last line — the line
-- that asks the question:
--
--   served   "…Fayol's principle of 'Equity' emphasizes that there should be
--             no discrimination on account of sex, religion, language, caste,
--             or belief."
--   complete "…or belief. However, Equity does NOT mean:"
--
-- 20261084000000 grouped copies on the whole cleaned stem, so a cut-off copy
-- was a group of its own and stayed active beside (or instead of) its
-- complete copy. Measured 2026-09-25: 34 active CUET questions are a cut-off
-- copy — same options, and their stem (letters and digits only, so the
-- extraction's "reli - gion" does not hide the match) is the start of a
-- longer copy's. In every one the longer copy adds the ask ("Identify the
-- function:", "This is called:", "This represents:").
--
-- The same rule as 20261084000000, applied to the copies it missed:
--
--   * 30 have an active complete copy: retired, replaced_by_question_id
--     pointing at it, and everything that pointed at them follows it —
--     mistakes, bookmarks, seen-history, variants, pending variant jobs.
--   * 4 have none: every complete copy was retired (keys that disagree —
--     Fayol's Equity — or text that cannot be answered), so the cut-off copy
--     shares that outcome and is retired with no replacement.
--
-- Every row touched is recorded in public.cuet_cutoff_repair_20261099 and
-- public.cuet_ref_repoint_20261099, which is what the rollback reads.
--
-- ROLLBACK: rollback/20261099000000_a_cut_off_copy_is_not_served.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.cuet_cutoff_repair_20261099 (
  question_id     uuid PRIMARY KEY,
  complete_id     uuid,             -- the active complete copy, when there is one
  old_is_active   boolean NOT NULL,
  old_replaced_by uuid
);
CREATE TABLE public.cuet_ref_repoint_20261099 (
  seq             bigserial PRIMARY KEY,
  ref_table       text NOT NULL,
  ref_key         text NOT NULL,
  old_question_id uuid NOT NULL,
  new_question_id uuid NOT NULL,
  inserted        boolean NOT NULL DEFAULT false
);
ALTER TABLE public.cuet_cutoff_repair_20261099 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuet_ref_repoint_20261099 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuet_cutoff_repair_20261099, public.cuet_ref_repoint_20261099 FROM PUBLIC, anon, authenticated;

-- Stem and options reduced to letters and digits: tags, quote marks, spacing
-- and the extraction's split words do not make a different question.
CREATE TEMP TABLE _stem ON COMMIT DROP AS
SELECT q.id, q.is_active, q.replaced_by_question_id AS rb,
       lower(regexp_replace(regexp_replace(q.question, '\s*(\[[^\]]+\]\s*)+$', ''), '[^a-zA-Z0-9]+', '', 'g')) AS k,
       lower(regexp_replace(q.options::text, '[^a-zA-Z0-9]+', '', 'g')) AS ok
  FROM public.question_bank q JOIN public.competitive_exams ce ON ce.id = q.exam_id
 WHERE ce.code = 'cuet' AND q.source_question_id IS NULL;

-- A cut-off copy: active, and a longer copy with the same options begins with
-- its whole stem. Its complete copy is that copy when active, or the copy
-- that one was retired in favour of.
CREATE TEMP TABLE _cut ON COMMIT DROP AS
SELECT t.id,
       (SELECT CASE WHEN c.is_active THEN c.id ELSE c.rb END
          FROM _stem c
         WHERE c.id <> t.id AND c.ok = t.ok AND length(c.k) > length(t.k) + 3 AND left(c.k, length(t.k)) = t.k
           AND (c.is_active OR c.rb IS NOT NULL)
         ORDER BY c.is_active DESC LIMIT 1) AS complete_id
  FROM _stem t
 WHERE t.is_active
   AND EXISTS (SELECT 1 FROM _stem c
                WHERE c.id <> t.id AND c.ok = t.ok AND length(c.k) > length(t.k) + 3 AND left(c.k, length(t.k)) = t.k);

INSERT INTO public.cuet_cutoff_repair_20261099 (question_id, complete_id, old_is_active, old_replaced_by)
SELECT c.id, c.complete_id, q.is_active, q.replaced_by_question_id
  FROM _cut c JOIN public.question_bank q ON q.id = c.id;

UPDATE public.question_bank q
   SET is_active = false,
       replaced_by_question_id = COALESCE(c.complete_id, q.replaced_by_question_id),
       updated_at = now()
  FROM _cut c WHERE q.id = c.id;

-- ── References follow a cut-off copy to its complete copy ───────────────────
CREATE TEMP TABLE _dup ON COMMIT DROP AS
SELECT id AS old_id, complete_id AS new_id FROM _cut WHERE complete_id IS NOT NULL;

INSERT INTO public.cuet_ref_repoint_20261099 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'student_mistakes', sm.id::text, d.old_id, d.new_id
  FROM public.student_mistakes sm JOIN _dup d ON d.old_id = sm.question_id
 WHERE sm.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM public.student_mistakes x
                    WHERE x.user_id = sm.user_id AND x.source = sm.source AND x.question_id = d.new_id);
UPDATE public.student_mistakes sm
   SET question_id = r.new_question_id, question_text = q.question, options = q.options
  FROM public.cuet_ref_repoint_20261099 r JOIN public.question_bank q ON q.id = r.new_question_id
 WHERE r.ref_table = 'student_mistakes' AND sm.id = r.ref_key::uuid;

INSERT INTO public.cuet_ref_repoint_20261099 (ref_table, ref_key, old_question_id, new_question_id)
SELECT DISTINCT ON (pb.user_id, d.new_id) 'practice_bookmarks', pb.id::text, d.old_id, d.new_id
  FROM public.practice_bookmarks pb JOIN _dup d ON d.old_id = pb.question_id
 WHERE NOT EXISTS (SELECT 1 FROM public.practice_bookmarks x WHERE x.user_id = pb.user_id AND x.question_id = d.new_id)
 ORDER BY pb.user_id, d.new_id, pb.created_at;
UPDATE public.practice_bookmarks pb SET question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'practice_bookmarks' AND pb.id = r.ref_key::uuid;

INSERT INTO public.cuet_ref_repoint_20261099 (ref_table, ref_key, old_question_id, new_question_id, inserted)
SELECT DISTINCT ON (h.user_id, d.new_id) 'student_question_history', h.user_id::text || ':' || d.new_id::text, d.old_id, d.new_id, true
  FROM public.student_question_history h JOIN _dup d ON d.old_id = h.question_id
 WHERE NOT EXISTS (SELECT 1 FROM public.student_question_history x WHERE x.user_id = h.user_id AND x.question_id = d.new_id)
 ORDER BY h.user_id, d.new_id, h.last_seen_at DESC;
INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at, school_id)
SELECT h.user_id, r.new_question_id, h.times_seen, h.last_seen_at, h.school_id
  FROM public.cuet_ref_repoint_20261099 r
  JOIN public.student_question_history h
    ON h.user_id = split_part(r.ref_key, ':', 1)::uuid AND h.question_id = r.old_question_id
 WHERE r.ref_table = 'student_question_history';

INSERT INTO public.cuet_ref_repoint_20261099 (ref_table, ref_key, old_question_id, new_question_id)
SELECT 'question_bank.source_question_id', v.id::text, d.old_id, d.new_id
  FROM public.question_bank v JOIN _dup d ON d.old_id = v.source_question_id;
UPDATE public.question_bank v SET source_question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'question_bank.source_question_id' AND v.id = r.ref_key::uuid;

INSERT INTO public.cuet_ref_repoint_20261099 (ref_table, ref_key, old_question_id, new_question_id)
SELECT DISTINCT ON (d.new_id, j.tier) 'variant_generation_queue', j.id::text, d.old_id, d.new_id
  FROM public.variant_generation_queue j JOIN _dup d ON d.old_id = j.source_question_id
 WHERE j.status = 'pending'
   AND NOT EXISTS (SELECT 1 FROM public.variant_generation_queue x
                    WHERE x.status = 'pending' AND x.source_question_id = d.new_id AND x.tier = j.tier)
 ORDER BY d.new_id, j.tier, j.created_at;
UPDATE public.variant_generation_queue j SET source_question_id = r.new_question_id
  FROM public.cuet_ref_repoint_20261099 r
 WHERE r.ref_table = 'variant_generation_queue' AND j.id = r.ref_key::uuid;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.cuet_cutoff_repair_20261099;
  IF _n < 30 THEN RAISE EXCEPTION 'expected the 34 cut-off copies measured, found %', _n; END IF;

  -- No active question is still a cut-off copy of another.
  SELECT count(*) INTO _n
    FROM _stem t JOIN public.question_bank q ON q.id = t.id AND q.is_active
   WHERE EXISTS (SELECT 1 FROM _stem c
                  WHERE c.id <> t.id AND c.ok = t.ok AND length(c.k) > length(t.k) + 3 AND left(c.k, length(t.k)) = t.k);
  IF _n <> 0 THEN RAISE EXCEPTION '% cut-off copies are still served', _n; END IF;

  -- The Equity question is no longer served without its ask.
  IF EXISTS (SELECT 1 FROM public.question_bank WHERE id = 'b236bdc9-b38b-49c3-9b41-8928d61be064' AND is_active) THEN
    RAISE EXCEPTION 'the cut-off Equity copy is still served';
  END IF;

  -- Every complete copy a cut-off one points at is served.
  SELECT count(*) INTO _n FROM public.cuet_cutoff_repair_20261099 r
    JOIN public.question_bank q ON q.id = r.complete_id WHERE NOT q.is_active;
  IF _n <> 0 THEN RAISE EXCEPTION '% cut-off copies point at a complete copy that is not served', _n; END IF;

  -- Nothing still points at a cut-off copy that has a complete one.
  SELECT count(*) INTO _n FROM public.student_mistakes sm JOIN _dup d ON d.old_id = sm.question_id WHERE sm.status = 'open';
  IF _n <> 0 THEN RAISE EXCEPTION '% open mistakes still point at a retired cut-off copy', _n; END IF;
END
$proof$;

COMMIT;
