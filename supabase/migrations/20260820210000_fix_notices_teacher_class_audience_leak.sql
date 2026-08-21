-- BUG: "notices teacher class" is an ALL-command policy whose qual is
--   has_role(teacher) AND same_school AND (class_id IS NULL OR teacher_teaches_class(class_id))
-- The `class_id IS NULL` disjunct was meant to let a teacher manage their OWN
-- non-class-scoped notices, but it doesn't check who posted the notice or
-- what audience it's for -- it matches ANY notice with class_id IS NULL,
-- authored by anyone, for any audience. notices.audience (all/teachers/
-- students/parents/class/section) is the real scoping column and this
-- policy ignores it entirely.
--
-- Confirmed live: a teacher (priya.sharma@wisdomcampus.com) could SELECT a
-- 'parents'-audience-only notice ("Fee reminder") that a real parent account
-- can see but a real student account correctly cannot -- teachers should see
-- neither. Because this is an ALL policy (not just SELECT), the same
-- unconditional match also grants UPDATE/DELETE on any class_id-less notice
-- to any teacher, regardless of authorship or intended audience.
--
-- The `class_id IS NULL` disjunct is also redundant with its own stated
-- purpose: "notices publisher own" (posted_by = auth.uid(), ALL command,
-- already deployed) already grants a teacher full access to notices THEY
-- authored regardless of class_id or audience. So the only effect of the
-- disjunct being present is the leak -- removing it does not remove any
-- legitimate capability.
--
-- Fix: teachers get ALL access via this policy only for notices tied to a
-- class they actually teach. Own-authored non-class notices remain fully
-- covered by "notices publisher own". Audience-specific reads (teachers/
-- all) remain covered by "notices read teachers" / "notices read all".

DROP POLICY IF EXISTS "notices teacher class" ON public.notices;

CREATE POLICY "notices teacher class" ON public.notices
  FOR ALL
  USING (
    has_role(auth.uid(), 'teacher'::app_role)
    AND same_school(school_id)
    AND teacher_teaches_class(auth.uid(), class_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'teacher'::app_role)
    AND same_school(school_id)
    AND teacher_teaches_class(auth.uid(), class_id)
  );
