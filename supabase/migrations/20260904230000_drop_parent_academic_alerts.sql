-- ═══════════════════════════════════════════════════════════════════════════
-- DROP public.parent_academic_alerts — the storage for a cancelled feature
--
-- ── WHY, RECORDED SO THIS CANNOT LATER READ AS AN ACCIDENT ───────────────
--
-- This is a deliberate drop, ruled after the table was measured. It is the
-- same reasoning that removed the permanently-empty `alerts` key from the
-- digest payload in 20260904190000, applied one level up: an empty key is an
-- invitation to start filling it, and an empty TABLE is a bigger one, because
-- the next session finds a schema that looks designed and writes an emitter
-- for it.
--
-- Measured immediately before writing this migration:
--
--   rows                                          0
--   triggers                                      0
--   inbound foreign keys (anything pointing here) 0
--   database functions referencing it             0
--   dependent views                               0
--   client code referencing it                    the generated types file only
--   policies on it                                2  ← the only references left
--
-- A table whose only remaining references are its own RLS policies is not a
-- feature. The feature it belonged to — AI-generated parent academic alerts —
-- was explicitly ruled not to exist, because every generation rule it had was
-- derived from practice data and practice must stay private (§10.15: "School
-- data only. No practice data.").
--
-- ── ONE THING THE MEASUREMENT TURNED UP THAT MAKES THIS MORE THAN TIDYING ─
--
-- The table is not merely dormant, it is WRITABLE by any signed-in user:
--
--   has_table_privilege('authenticated', …, 'INSERT')  →  true
--
-- The grant is held through PUBLIC rather than granted to the role by name,
-- which is why it does not appear in information_schema.role_table_grants and
-- why it survived the Chunk 9.5 sweep. RLS is the only thing in the way, and
-- the permissive policy on it — `parent alerts own`, FOR ALL, WITH CHECK
-- (parent_user_id = auth.uid()) — constrains only WHO the row is addressed to.
-- It does not constrain `student_id` at all, and `school_id` is nullable so the
-- RESTRICTIVE tenant fence (school_id IS NULL OR same_school(school_id)) admits
-- a NULL. A parent could therefore insert an alert about any student in the
-- database, with arbitrary title and body.
--
-- Nothing reads the table, so nobody could see such a row today — the impact
-- is storage, not disclosure, and this is not being reported as a live breach.
-- But it is a writable, unread, policy-gapped surface belonging to a cancelled
-- feature, which is a worse thing to leave lying around than an empty table.
--
-- ── IF A SCHOOL-DATA EMITTER IS BUILT LATER ──────────────────────────────
--
-- It gets a table shaped for its own requirements. It must not inherit this
-- one: the `kind` CHECK enumerates weakness / consistency / improvement /
-- participation, which are the four PRACTICE-derived alert kinds. A school-data
-- emitter reusing that enum would be inheriting the cancelled feature's
-- vocabulary and, with it, the shape of its data model.
--
-- ── ROLLBACK ORDERING — READ THIS BEFORE ROLLING BACK ANYTHING ELSE ──────
--
-- `supabase/migrations/rollback/20260904190000_parent_digest_delivery.rollback.sql`
-- SELECTs FROM public.parent_academic_alerts (line 135). With this table
-- dropped, that rollback FAILS with "relation does not exist".
--
--   To roll back 190000, run THIS migration's rollback first.
--
-- The dependency is one-way and stated here rather than discovered at 2am.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to drop a table that has become live since this was authored. Data
-- loss must not ride along inside a migration whose stated premise is "0 rows".
DO $$
DECLARE _rows bigint; _fks int; _trg int;
BEGIN
  IF to_regclass('public.parent_academic_alerts') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.parent_academic_alerts does not exist; nothing to drop';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.parent_academic_alerts' INTO _rows;
  IF _rows <> 0 THEN
    RAISE EXCEPTION
      'ABORT: parent_academic_alerts holds % row(s). This migration was ruled on the basis that it is empty and unwritten. Something now writes it — find that writer and re-rule before dropping.', _rows;
  END IF;

  SELECT count(*) INTO _fks FROM pg_constraint
   WHERE confrelid = 'public.parent_academic_alerts'::regclass;
  IF _fks <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % foreign key(s) now point AT parent_academic_alerts. Dropping it would cascade into whatever they belong to.', _fks;
  END IF;

  SELECT count(*) INTO _trg FROM pg_trigger
   WHERE tgrelid = 'public.parent_academic_alerts'::regclass AND NOT tgisinternal;
  IF _trg <> 0 THEN
    RAISE EXCEPTION 'ABORT: % trigger(s) now exist on parent_academic_alerts.', _trg;
  END IF;
END $$;

-- RESTRICT, not CASCADE: if anything at all depends on this table, the drop
-- must fail and be re-examined rather than quietly taking dependants with it.
-- The guard above proves there are none, so RESTRICT is the assertion, not a
-- limitation.
DROP TABLE public.parent_academic_alerts RESTRICT;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.parent_academic_alerts') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: the table is still present after DROP';
  END IF;

  -- The policies were the only references left; they go with the table. If one
  -- somehow survived it would be pointing at nothing.
  IF EXISTS (SELECT 1 FROM pg_policy p
              JOIN pg_class c ON c.oid = p.polrelid
             WHERE c.relname = 'parent_academic_alerts') THEN
    RAISE EXCEPTION 'ABORT: a policy named against parent_academic_alerts survived the drop';
  END IF;

  -- And the digest must still not mention it — the pure-read property proved
  -- in 190000 has to hold after the table is gone, not merely before.
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = '_parent_weekly_digest' AND pronamespace = 'public'::regnamespace)
     ~* 'parent_academic_alerts' THEN
    RAISE EXCEPTION 'ABORT: the digest computation still references the dropped table';
  END IF;
END $$;

COMMIT;
