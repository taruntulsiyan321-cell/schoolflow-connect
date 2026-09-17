-- ROLLBACK for 20261036000000_a_question_renders_the_symbol_not_its_escape.
--
-- READ THIS FIRST. This puts six questions back into a state where the student
-- is shown "The value of e⁰ is:" instead of "The value of e⁰ is:" — a
-- question whose meaning lives in a symbol, with the symbol replaced by its
-- escape code.
--
-- Re-encoding is narrower than decoding was: it rewrites ONLY the six rows the
-- forward migration touched, identified by id, so it cannot reach a question
-- that legitimately contains one of these characters.
--
-- chr(92) rather than a written backslash, for the transport reason the
-- forward migration's header explains.

BEGIN;

DO $$
DECLARE _bs text := chr(92);
BEGIN
  UPDATE public.question_bank
     SET question = replace(replace(replace(replace(replace(replace(question,
           U&'\2081', _bs || 'u2081'),
           U&'\2080', _bs || 'u2080'),
           U&'\2070', _bs || 'u2070'),
           U&'\00B2', _bs || 'u00b2'),
           U&'\00B0', _bs || 'u00b0'),
           U&'\222B', _bs || 'u222b')
   WHERE id IN (
     'ecea3eda-274e-4cff-b285-edbb51784bc0',
     '123c6f57-5e9a-40d5-8368-481f684f008d',
     '717fb043-8f6a-4177-9775-667491356cdf',
     '91c6e169-2208-4880-84c3-d6d7ad32662c',
     'fc29cee5-7598-4594-8ec5-66eaeffa0945',
     '5af826e7-7a08-44bf-ab39-58a4a78418a4'
   );

  RAISE NOTICE 'six questions again show escape codes where their symbols belong';
END $$;

COMMIT;
