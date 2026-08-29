-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7C-C part 1: the bank-first half of the generation path
--
-- 7C-C as a whole is blocked. The doc names three decisions that "must be
-- answered first" and two of them are economic — cost per generated session
-- and the acceptable ceiling, expected cache hit rate and what happens below
-- it. Those are not schema questions and are not mine to invent.
--
-- But the generation path has a half that needs no AI, exactly as 7C-B did.
-- §4.2a: "Check the bank for existing variants before generating — generation
-- is the fallback, not the default." The lookup IS the default path. It can be
-- built and proved now, and what it cannot fill is precisely the input the
-- generation step will take once those three answers exist.
--
-- This lands verification item 3 in full and item 4's cache-hit half.
--
-- ── Why every function here is SECURITY INVOKER ────────────────────────────
--
-- 7A put the board filter in an RLS policy on question_bank
-- (qb_select_approved_board), and its own §8 warns that SECURITY DEFINER paths
-- bypass it — rpc_dpp_pick_from_bank had "no board filter, NO class filter at
-- all". A definer here would silently reopen that.
--
-- So these run as the caller. The board and is_approved filters then apply
-- because the policy applies, rather than because this file remembered to
-- restate them. Nothing below needs to read a table the student cannot.
--
-- ── The class filter, expressed structurally rather than as an integer ─────
--
-- The doc's rule is that a Class 5 student is never served Class 8 content,
-- "enforced in the query layer, not the UI". question_bank.class_level is a
-- legacy integer; matching on it would be a filter that a NULL defeats.
--
-- chapter_id is stronger. A chapter belongs to exactly one curriculum_subject,
-- which belongs to exactly one curriculum_class. So pinning the chapter pins
-- the subject and the class together, and entitlement becomes a question the
-- Chunk 2 schema already answers: does this student's own section teach that
-- curriculum subject? section_subjects is that answer.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. May this student work on this chapter at all? ───────────────────────
CREATE OR REPLACE FUNCTION public._recovery_chapter_is_mine(_chapter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- No SECURITY DEFINER: this must be answerable by the caller with their own
  -- rights, and it is. A chapter is "mine" when my own section teaches the
  -- curriculum subject that chapter belongs to.
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = auth.uid()
  )
$fn$;

COMMENT ON FUNCTION public._recovery_chapter_is_mine(uuid) IS
  'True when the calling student''s own section teaches the curriculum subject this chapter belongs to. This is the class/board filter the doc requires in the query layer, expressed through the curriculum tree rather than question_bank.class_level — an integer match is a filter a NULL defeats, and 15 bank rows have a NULL class_level.';


-- ── 2. The bank-first lookup ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recovery_variant_pool(
  _source_question_id uuid,
  _tier               smallint,
  _difficulty         text
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- Variants are ordinary bank questions (§4.2a), so this is a plain read of
  -- question_bank and the board / is_approved policy applies to it as the
  -- caller. Retired questions are excluded: a rewrite creates a NEW question
  -- and retires the old one (§10.21), and serving a retired variant would hand
  -- back content the student never actually got wrong.
  SELECT qb.id
    FROM public.question_bank qb
   WHERE qb.source_question_id = _source_question_id
     AND qb.variant_tier       = _tier
     AND qb.is_active
     AND qb.replaced_by_question_id IS NULL
     -- §4.2: "variants mirror the difficulty of what was failed. If they
     -- failed easy questions, hard variants teach nothing but discouragement."
     -- When the mistake recorded no difficulty there is nothing to mirror, so
     -- the constraint is dropped rather than guessed at.
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
   ORDER BY qb.created_at
$fn$;

COMMENT ON FUNCTION public._recovery_variant_pool(uuid, smallint, text) IS
  'Existing bank variants of one source question at one tier, difficulty-matched. This is the DEFAULT path of §4.2a — generation is the fallback. SECURITY INVOKER on purpose: question_bank''s board filter lives in an RLS policy, and a definer here would bypass it the way rpc_dpp_pick_from_bank did.';


-- ── 3. The session plan ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_recovery_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _t0       int;
  _t1       int;
  _t2       int;
  _t3       int;
  _sources  jsonb := '[]'::jsonb;
  _tiers    jsonb := '{}'::jsonb;
  _m        record;
  _src      record;
  _ids      uuid[];
  _got      uuid[];
  _need     int;
  _tier     smallint;
  _short    int;
  _total_short int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  -- Every count comes from the constants, never a literal (§10 / item 7).
  -- _recovery_const raises on a missing key, so a typo stops the session
  -- rather than silently building a ladder of zero questions.
  _t0 := public._recovery_const('RECOVERY_TIER0')::int;
  _t1 := public._recovery_const('RECOVERY_TIER1')::int;
  _t2 := public._recovery_const('RECOVERY_TIER2')::int;
  _t3 := public._recovery_const('RECOVERY_TIER3')::int;

  -- ── Tier 0: the student's own wrong questions ───────────────────────────
  -- No generation involved and none possible: these are the originals. Most
  -- repeatedly wrong first, because that is what §6.3 pins to the top.
  FOR _m IN
    SELECT sm.question_id, sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND sm.question_id IS NOT NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
     LIMIT _t0
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id,
      'difficulty',  _m.difficulty,
      'times_wrong', _m.times_wrong);
  END LOOP;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed',    _t0,
    'from_bank', (SELECT coalesce(jsonb_agg(s->'question_id'), '[]'::jsonb) FROM jsonb_array_elements(_sources) s),
    'filled',    jsonb_array_length(_sources),
    'shortfall', greatest(0, _t0 - jsonb_array_length(_sources)),
    'note',      'the student''s own wrong questions; nothing to generate'));
  _total_short := _total_short + greatest(0, _t0 - jsonb_array_length(_sources));

  -- ── Tiers 1 and 2: bank variants of those originals ─────────────────────
  -- §4.2a is explicit that the bank is checked BEFORE generating. What comes
  -- back short here is the exact input the generation step will take.
  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := CASE _tier WHEN 1 THEN _t1 ELSE _t2 END;
    _got  := ARRAY[]::uuid[];

    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
      EXIT WHEN coalesce(array_length(_got, 1), 0) >= _need;
      SELECT array_agg(t.qid) INTO _ids
        FROM (
          SELECT qid
            FROM public._recovery_variant_pool(
                   (_src.v->>'question_id')::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
           WHERE NOT (qid = ANY (_got))
           LIMIT _need - coalesce(array_length(_got, 1), 0)
        ) t;
      IF _ids IS NOT NULL THEN
        _got := _got || _ids;
      END IF;
    END LOOP;

    _short := greatest(0, _need - coalesce(array_length(_got, 1), 0));
    _total_short := _total_short + _short;

    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed',    _need,
      'from_bank', to_jsonb(coalesce(_got, ARRAY[]::uuid[])),
      'filled',    coalesce(array_length(_got, 1), 0),
      'shortfall', _short,
      'note',      'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  -- ── Tier 3: the bank, where coverage allows ─────────────────────────────
  -- §4.2: "Tier 3 comes from the bank where coverage allows, AI otherwise."
  -- Originals only — a tier-1 variant of their own wrong question is not a
  -- different application of the topic. And never a question they already got
  -- wrong, which would be tier 0 wearing a different label.
  SELECT array_agg(id) INTO _got
    FROM (
      SELECT qb.id
        FROM public.question_bank qb
       WHERE qb.chapter_id = _chapter_id
         AND qb.is_active
         AND qb.source_question_id IS NULL
         AND qb.replaced_by_question_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.student_mistakes sm
            WHERE sm.user_id = _uid AND sm.question_id = qb.id)
       ORDER BY qb.created_at
       LIMIT _t3
    ) t;

  _short := greatest(0, _t3 - coalesce(array_length(_got, 1), 0));
  _total_short := _total_short + _short;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed',    _t3,
    'from_bank', to_jsonb(coalesce(_got, ARRAY[]::uuid[])),
    'filled',    coalesce(array_length(_got, 1), 0),
    'shortfall', _short,
    'note',      'bank where coverage allows; AI otherwise'));

  RETURN jsonb_build_object(
    'chapter_id',  _chapter_id,
    'tiers',       _tiers,
    -- Derived from the four tiers, never stored and never read as a constant.
    -- RECOVERY_SESSION_SIZE is declared TS-only for exactly this reason: a row
    -- holding it would be a third home for a fact these four already fix, and
    -- check-recovery-constants.mjs re-derives it rather than trusting it.
    'session_size', (_t0 + _t1 + _t2 + _t3),
    'shortfall',   _total_short,
    -- Never padded. §4.2a: "A variant that cannot be generated is skipped, not
    -- faked. The session runs short and says so." This field is the saying-so.
    'complete',    (_total_short = 0),
    'generation_required', (_total_short > 0));
END
$fn$;

COMMIT;
