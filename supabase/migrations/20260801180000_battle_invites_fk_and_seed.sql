-- =========================================================
-- Battleground: battle_invites → battles FK + practice seed
--
-- PostgREST embed `battle_invites.select('…, battles(…)')` fails with
-- "could not find a relationship between battle_invites and battles"
-- because battle_id was created without a foreign key.
-- Client now uses a two-query load; this FK restores embeds + integrity.
-- =========================================================

-- 1) Foreign key (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'battle_invites_battle_id_fkey'
      AND conrelid = 'public.battle_invites'::regclass
  ) THEN
    -- Drop orphan invites that would block the FK
    DELETE FROM public.battle_invites bi
    WHERE NOT EXISTS (SELECT 1 FROM public.battles b WHERE b.id = bi.battle_id);

    ALTER TABLE public.battle_invites
      ADD CONSTRAINT battle_invites_battle_id_fkey
      FOREIGN KEY (battle_id) REFERENCES public.battles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_battle_invites_battle_id ON public.battle_invites(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_invites_invited_pending
  ON public.battle_invites(invited_user_id, status)
  WHERE status = 'pending';

-- Hint PostgREST to reload schema cache (no-op if unsupported)
NOTIFY pgrst, 'reload schema';

-- 2) Low-risk practice seed — only when bank has no seed_practice rows
DO $seed$
BEGIN
  IF (SELECT count(*) FROM public.question_bank WHERE source = 'seed_practice') >= 6 THEN
    RETURN;
  END IF;

  INSERT INTO public.question_bank (
    class_level, subject, chapter, difficulty, question, options, correct_index, explanation, source, is_approved
  ) VALUES
  (10, 'Mathematics', 'Real Numbers', 'easy',
   'What is the HCF of 12 and 18?',
   '["6","12","3","9"]'::jsonb, 0,
   '12 = 2²×3, 18 = 2×3²; HCF = 2×3 = 6.', 'seed_practice', true),
  (10, 'Mathematics', 'Polynomials', 'easy',
   'The degree of the polynomial 5x² − 3x + 1 is:',
   '["1","2","3","0"]'::jsonb, 1,
   'Highest power of x is 2.', 'seed_practice', true),
  (10, 'Mathematics', 'Trigonometry', 'medium',
   'The value of sin 30° is:',
   '["1/2","√3/2","1","0"]'::jsonb, 0,
   'sin 30° = 1/2.', 'seed_practice', true),
  (11, 'Mathematics', 'Sets', 'easy',
   'If A = {1,2,3} and B = {2,3,4}, then A ∩ B is:',
   '["{1,2,3,4}","{2,3}","{1}","{}"]'::jsonb, 1,
   'Intersection keeps elements common to both sets.', 'seed_practice', true),
  (12, 'Mathematics', 'Relations and Functions', 'easy',
   'The value of e⁰ is:',
   '["0","1","e","∞"]'::jsonb, 1,
   'Any non-zero number to the power 0 is 1.', 'seed_practice', true),
  (NULL, 'Mathematics', 'General', 'easy',
   'What is 15% of 200?',
   '["20","25","30","35"]'::jsonb, 2,
   '15% of 200 = 0.15 × 200 = 30.', 'seed_practice', true);
END $seed$;
