-- A QUESTION RENDERS THE SYMBOL, NOT ITS ESCAPE CODE.
--
-- ── WHAT WAS FOUND ──────────────────────────────────────────────────────────
--
-- Driving a revision check on 2026-09-17 turned up a question rendering as
--
--     The value of e⁰ is:
--
-- to the student. Six live, approved, active bank questions carry JSON unicode
-- escapes as LITERAL TEXT, because they were inserted from a payload that was
-- stringified once too often:
--
--   Logarithms         The value of log₁₀(1) is:        log₁₀(1)
--   Exponentials       The value of e⁰ is:                   e⁰
--   Calculus           The derivative of x² with respect...  x²
--   Trigonometry       The value of sin 30° is:              sin 30°
--   Quadratic Eq.      The discriminant of ax² + bx + c = 0  ax²
--   Integration        The value of ∫ 1 dx is:               ∫ 1 dx
--
-- Every one is a question whose MEANING is in the symbol. "The value of
-- e⁰" is not a harder version of "the value of e⁰"; it is not a question.
--
-- ── AND EACH ONE HAS A TWIN ─────────────────────────────────────────────────
--
-- Every escaped row carries source = 'seed'. Two of them have an identical
-- twin from source = 'seed_practice' — same options, same correct_index,
-- correctly encoded — so decoding blindly trips
-- question_bank_unique_active (question, class_level, subject) WHERE is_active.
-- The first attempt at this migration did exactly that and was refused, which
-- is how the twins were found at all:
--
--   e⁰        123c6f57 Exponentials (escaped)  vs 7dc94b9d Relations and
--                                                 Functions (clean)
--   sin 30°   91c6e169 Trigonometry (escaped)  vs 1a338b84 Trigonometry
--                                                 (clean)
--
-- They are NOT resolved the same way, because the chapters differ:
--
--   sin 30°  both copies sit in Trigonometry, so the clean one is simply the
--            one to keep. The escaped copy is withdrawn.
--   e⁰       the ESCAPED copy is in Exponentials and the clean one is in
--            Relations and Functions — which is not where "the value of e⁰"
--            belongs, and is why it was served inside a Relations and
--            Functions revision check on 2026-09-17. Here the clean copy is
--            the mis-filed one: it is withdrawn, and the Exponentials copy is
--            decoded.
--
-- Withdrawn means is_active = false — not DELETE, because question_attempts
-- references bank_question_id and the attempt record is evidence.
--
-- is_active ONLY, not is_approved: tg_question_bank_approval_is_super_admin_only
-- refuses any change to is_approved from anyone but a super admin (§10.20,
-- "manage the central question bank"), and it is right to. Approval is an
-- editorial judgement a person owns; is_active is whether the row is servable,
-- which is what withdrawal means and what every serving path filters on.
--
-- Deactivating also frees question_bank_unique_active, the partial unique index
-- that only covers is_active rows — which is what lets the decode below
-- succeed.
--
-- ── WHY THE NEEDLES ARE BUILT FROM chr(92) ──────────────────────────────────
--
-- Writing \uXXXX inside a migration that travels as JSON is unsafe: a valid
-- \uXXXX is a JSON escape, so the transport decodes it and Postgres receives
-- the SYMBOL where the file says the ESCAPE. Measured: a targeted WHERE clause
-- written that way selected 600 rows instead of 6, because it had quietly
-- become a search for "²". chr(92) is a backslash no transport can
-- reinterpret, and U&'\2070' carries no \u for one to find.
--
-- Deliberately NOT a general decoder across 21,721 rows: a question that
-- legitimately discusses an escape sequence would be corrupted by one.

BEGIN;

-- 1 ── the two duplicates, each resolved toward the copy in the right chapter
UPDATE public.question_bank
   SET is_active = false
 WHERE id IN (
   -- the clean e⁰, mis-filed under Relations and Functions
   '7dc94b9d-6769-4cbb-b914-2a848dea73d2',
   -- the escaped sin 30°, whose clean twin is already in Trigonometry
   '91c6e169-2208-4880-84c3-d6d7ad32662c'
 );

-- 2 ── decode what is left
DO $$
DECLARE
  _bs   text := chr(92);
  _rows int;
  _left int;
BEGIN
  UPDATE public.question_bank
     SET question = replace(replace(replace(replace(replace(replace(question,
           _bs || 'u2081', U&'\2081'),   -- ₁
           _bs || 'u2080', U&'\2080'),   -- ₀
           _bs || 'u2070', U&'\2070'),   -- ⁰
           _bs || 'u00b2', U&'\00B2'),   -- ²
           _bs || 'u00b0', U&'\00B0'),   -- °
           _bs || 'u222b', U&'\222B')    -- ∫
   WHERE position(_bs || 'u' IN question) > 0
     AND is_active;

  GET DIAGNOSTICS _rows = ROW_COUNT;

  -- FAIL CLOSED on anything left behind, including a sequence this migration
  -- does not know about: finding four of five and reporting success is how the
  -- fifth survives to the next session. This is also the check that caught the
  -- transport problem described above, when the UPDATE silently did nothing.
  SELECT count(*) INTO _left
  FROM public.question_bank
  WHERE position(_bs || 'u' IN question) > 0 AND is_active;

  IF _left > 0 THEN
    RAISE EXCEPTION 'would have failed open: % servable question(s) still carry a literal unicode escape (% rewritten)', _left, _rows;
  END IF;
  IF _rows <> 5 THEN
    RAISE EXCEPTION 'would have failed open: expected to rewrite 5 question(s), rewrote %', _rows;
  END IF;

  RAISE NOTICE '% question(s) now carry their symbols; 2 duplicates withdrawn', _rows;
END $$;

COMMIT;
