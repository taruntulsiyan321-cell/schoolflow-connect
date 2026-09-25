-- §6.4: "IMPROVING when the latest 3 sessions average > the previous 3 by
-- >= 10 points." The 3 had no home; the client split the whole history in
-- half instead, so a chapter's trend compared its first sessions ever against
-- its latest ones. The window is a constant like its neighbours.
INSERT INTO public.recovery_constants (key, value, spec_ref, rationale)
VALUES ('TREND_WINDOW_SESSIONS', 3, '§6.4',
        'Trend compares the average of the latest this-many sessions against the this-many before them.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, spec_ref = EXCLUDED.spec_ref,
  rationale = EXCLUDED.rationale, updated_at = now();

-- §6.3 pins a chapter whose COUNT of repeated mistakes (times_wrong > 1)
-- reaches this — "repeated_mistakes >= 3" — not a single mistake's times_wrong.
UPDATE public.recovery_constants
   SET rationale = 'Repeated mistakes (open, times_wrong > 1) in a chapter that pin it to the top of the analysis list.',
       updated_at = now()
 WHERE key = 'REPEATED_MISTAKE_PIN';
