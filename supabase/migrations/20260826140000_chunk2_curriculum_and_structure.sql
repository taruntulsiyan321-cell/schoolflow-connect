-- =====================================================================
-- CHUNK 2 — CURRICULUM AND ACADEMIC STRUCTURE
--
-- Follows the two decisions the build doc settled after the preflight report:
--
--   1. NO `topics` table. Chapter is the stable unit. The free-text topic
--      string stays on the question as an unmapped label, never used for
--      tracking (locked decision 10.10).
--   2. The existing `classes` table stays section-grain and all 18 foreign
--      keys to it are left untouched. `class_groups` is added ABOVE it.
--
-- PRE-SEED CHECK (verification 6), run before writing this: 523 distinct
-- chapter names contain 4 near-duplicate groups / 8 names, of which 4 would
-- merge. All four are typographic — three curly-vs-straight apostrophes and
-- one hyphen-spacing difference. 0.8% fragmentation, against 11,917 strings at
-- topic level. Chapter is safe as the stable unit. The four are merged here to
-- their canonical form.
--
-- COLUMNS ADDED BEYOND THE DOC'S LIST, each a mechanical necessity for joining
-- to data that already exists, not a product decision:
--   * boards.code            — 'rbse'; question_bank.board is a slug, and the
--                              seed has to join on something stable.
--   * curriculum_classes.level — integer 5..12; question_bank.class_level is an
--                              int and classes.name is '9'/'10'/'12'. `label`
--                              stays human-readable per the doc.
--   * question_bank.chapter_id — the bridge that makes "downstream keys on
--                              chapter_id" true rather than aspirational.
--                              Nullable; Chunk 7 owns the question bank proper.
--
-- chapters.sequence is left NULL, deliberately. Syllabus order is not recorded
-- anywhere in the source data, and G4 says a value that is "not recorded yet"
-- is NULL, never an invented number. The super admin sets it.
--
-- board: question_bank holds 'rbse' (21,640 rows) and 'both' (56). Both seed
-- under the single RBSE board — this is a one-board deployment (10.10, "one
-- board per school"). If a second board is ever added, the 'both' rows need
-- revisiting.
--
-- Reverse: supabase/migrations/rollback/20260826140000_chunk2_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — global curriculum (G2: no institution scope)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.boards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boards_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS public.curriculum_classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  label      text NOT NULL,
  level      int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_classes_board_level_key UNIQUE (board_id, level),
  CONSTRAINT curriculum_classes_level_range CHECK (level BETWEEN 1 AND 12)
);

CREATE TABLE IF NOT EXISTS public.curriculum_subjects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_class_id uuid NOT NULL REFERENCES public.curriculum_classes(id) ON DELETE CASCADE,
  name                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_subjects_class_name_key UNIQUE (curriculum_class_id, name),
  CONSTRAINT curriculum_subjects_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS public.chapters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_subject_id uuid NOT NULL REFERENCES public.curriculum_subjects(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  sequence              int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapters_subject_name_key UNIQUE (curriculum_subject_id, name),
  CONSTRAINT chapters_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT chapters_sequence_positive CHECK (sequence IS NULL OR sequence > 0)
);

COMMENT ON COLUMN public.chapters.sequence IS
  'Syllabus order. NULL until a super admin sets it — G4: not-recorded is NULL, never an invented number.';

CREATE INDEX IF NOT EXISTS curriculum_classes_board_idx    ON public.curriculum_classes (board_id);
CREATE INDEX IF NOT EXISTS curriculum_subjects_class_idx   ON public.curriculum_subjects (curriculum_class_id);
CREATE INDEX IF NOT EXISTS chapters_subject_idx            ON public.chapters (curriculum_subject_id);


-- ---------------------------------------------------------------------
-- SECTION 2 — seed the tree from the question bank
-- ---------------------------------------------------------------------

INSERT INTO public.boards (name, code)
VALUES ('RBSE', 'rbse')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.curriculum_classes (board_id, label, level)
SELECT b.id, 'Class ' || q.class_level, q.class_level
  FROM (SELECT DISTINCT class_level FROM public.question_bank WHERE class_level IS NOT NULL) q
 CROSS JOIN (SELECT id FROM public.boards WHERE code = 'rbse') b
ON CONFLICT (board_id, level) DO NOTHING;

INSERT INTO public.curriculum_subjects (curriculum_class_id, name)
SELECT cc.id, s.subject
  FROM (SELECT DISTINCT class_level, btrim(subject) AS subject
          FROM public.question_bank
         WHERE class_level IS NOT NULL AND btrim(coalesce(subject, '')) <> '') s
  JOIN public.curriculum_classes cc ON cc.level = s.class_level
ON CONFLICT (curriculum_class_id, name) DO NOTHING;

-- Chapters, with the four typographic near-duplicates collapsed. The canonical
-- name is the lexicographically first variant of each normalised group, chosen
-- deterministically so a re-run picks the same one.
INSERT INTO public.chapters (curriculum_subject_id, name)
SELECT cs.id, c.canonical_name
  FROM (
    SELECT class_level,
           subject,
           min(chapter) AS canonical_name
      FROM (
        SELECT DISTINCT
               class_level,
               btrim(subject) AS subject,
               btrim(chapter) AS chapter,
               regexp_replace(
                 lower(translate(btrim(chapter), '’‘“”–—', '''''""--')),
                 '[^[:alnum:]]+', '', 'g') AS key_norm
          FROM public.question_bank
         WHERE class_level IS NOT NULL
           AND btrim(coalesce(subject, '')) <> ''
           AND btrim(coalesce(chapter, '')) <> ''
      ) d
     WHERE key_norm <> ''
     GROUP BY class_level, subject, key_norm
  ) c
  JOIN public.curriculum_classes cc ON cc.level = c.class_level
  JOIN public.curriculum_subjects cs
    ON cs.curriculum_class_id = cc.id AND cs.name = c.subject
ON CONFLICT (curriculum_subject_id, name) DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 3 — the bridge: questions key on chapter_id
--
-- Nullable, and the free-text chapter/topic columns are left in place. The
-- topic string stays an unmapped label by design (10.10).
-- ---------------------------------------------------------------------

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS question_bank_chapter_id_idx ON public.question_bank (chapter_id);

UPDATE public.question_bank qb
   SET chapter_id = ch.id
  FROM public.curriculum_classes cc
  JOIN public.curriculum_subjects cs ON cs.curriculum_class_id = cc.id
  JOIN public.chapters ch ON ch.curriculum_subject_id = cs.id
 WHERE qb.chapter_id IS NULL
   AND cc.level = qb.class_level
   AND cs.name  = btrim(qb.subject)
   AND regexp_replace(lower(translate(btrim(ch.name), '’‘“”–—', '''''""--')), '[^[:alnum:]]+', '', 'g')
     = regexp_replace(lower(translate(btrim(qb.chapter), '’‘“”–—', '''''""--')), '[^[:alnum:]]+', '', 'g');

COMMENT ON COLUMN public.question_bank.topic IS
  'Unmapped free-text label (locked decision 10.10). Never used for tracking, grouping or trends — chapter_id is the stable unit.';


-- ---------------------------------------------------------------------
-- SECTION 4 — class_groups: the class level, ABOVE the existing sections
--
-- public.classes is section-grain and 18 tables foreign-key to it. Not one of
-- those is re-pointed. classes simply gains a parent.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.class_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id    uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  curriculum_class_id uuid REFERENCES public.curriculum_classes(id) ON DELETE SET NULL,
  label               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_groups_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT class_groups_school_year_label_key UNIQUE (school_id, academic_year_id, label)
);

CREATE INDEX IF NOT EXISTS class_groups_school_idx ON public.class_groups (school_id);

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS class_group_id uuid REFERENCES public.class_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_class_group_idx ON public.classes (class_group_id);

COMMENT ON TABLE public.classes IS
  'SECTION-grain despite the name: one row per class-section (name=''12'', section=''A''). Renaming to sections is accepted naming debt, to be done as its own migration with a compatibility view. Its parent is class_groups.';

-- One class_group per distinct class label per institution, then link the
-- sections that belong to it.
INSERT INTO public.class_groups (school_id, academic_year_id, curriculum_class_id, label)
SELECT DISTINCT
       c.school_id,
       (SELECT ay.id FROM public.academic_years ay
         WHERE ay.school_id = c.school_id AND ay.is_current LIMIT 1),
       cc.id,
       btrim(c.name)
  FROM public.classes c
  LEFT JOIN public.curriculum_classes cc
    ON cc.level = NULLIF(regexp_replace(btrim(c.name), '\D', '', 'g'), '')::int
 WHERE btrim(coalesce(c.name, '')) <> ''
ON CONFLICT (school_id, academic_year_id, label) DO NOTHING;

UPDATE public.classes c
   SET class_group_id = g.id
  FROM public.class_groups g
 WHERE c.class_group_id IS NULL
   AND g.school_id = c.school_id
   AND g.label = btrim(c.name);


-- ---------------------------------------------------------------------
-- SECTION 5 — section_subjects: the canonical identity for all teaching
--
-- section_id points at public.classes, which IS the section (see the note
-- above). Subjects attach here, not to the class group: two sections of one
-- class may study different subjects.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.section_subjects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  section_id            uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  curriculum_subject_id uuid NOT NULL REFERENCES public.curriculum_subjects(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT section_subjects_section_subject_key UNIQUE (section_id, curriculum_subject_id),
  -- Lets child tables carry a composite FK and inherit the institution, so a
  -- homework row can never name a section_subject from another institution.
  CONSTRAINT section_subjects_id_school_key UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS section_subjects_section_idx ON public.section_subjects (section_id);
CREATE INDEX IF NOT EXISTS section_subjects_school_idx  ON public.section_subjects (school_id);

-- A section_subject must live in the same institution as its section.
CREATE OR REPLACE FUNCTION public.tg_section_subjects_same_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _section_school uuid;
BEGIN
  SELECT c.school_id INTO _section_school FROM public.classes c WHERE c.id = NEW.section_id;
  IF _section_school IS NULL THEN
    RAISE EXCEPTION 'section % does not exist', NEW.section_id;
  END IF;
  IF _section_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'section % belongs to institution %, not %',
      NEW.section_id, _section_school, NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_section_subjects_same_institution ON public.section_subjects;
CREATE TRIGGER trg_section_subjects_same_institution
  BEFORE INSERT OR UPDATE OF section_id, school_id ON public.section_subjects
  FOR EACH ROW EXECUTE FUNCTION public.tg_section_subjects_same_institution();

-- Seed from teacher_classes, the only record of who teaches what today.
INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
SELECT DISTINCT c.school_id, c.id, cs.id
  FROM public.teacher_classes tc
  JOIN public.classes c ON c.id = tc.class_id
  JOIN public.class_groups g ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs
    ON cs.curriculum_class_id = g.curriculum_class_id
   AND cs.name = btrim(tc.subject)
 WHERE btrim(coalesce(tc.subject, '')) <> ''
ON CONFLICT (section_id, curriculum_subject_id) DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 6 — teacher_assignments
--
-- Multiple teachers per section-subject are allowed. Assignment can change
-- mid-year, so it carries start_date/end_date rather than one current column.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  section_subject_id uuid NOT NULL,
  teacher_id         uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  is_primary         boolean NOT NULL DEFAULT false,
  start_date         date NOT NULL DEFAULT current_date,
  end_date           date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignments_window CHECK (end_date IS NULL OR end_date >= start_date),
  -- The composite reference is what makes cross-institution attachment
  -- structurally impossible rather than merely checked.
  CONSTRAINT teacher_assignments_section_subject_fk
    FOREIGN KEY (section_subject_id, school_id)
    REFERENCES public.section_subjects (id, school_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS teacher_assignments_ss_idx      ON public.teacher_assignments (section_subject_id);
CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_idx ON public.teacher_assignments (teacher_id);

-- One open (unended) assignment per teacher per section-subject. History is
-- kept: ending one and starting another is two rows, not an overwrite.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_assignments_one_open
  ON public.teacher_assignments (section_subject_id, teacher_id)
  WHERE end_date IS NULL;

INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, is_primary, start_date)
SELECT DISTINCT
       ss.school_id, ss.id, tc.teacher_id, true,
       COALESCE((SELECT ay.starts_on FROM public.academic_years ay
                  WHERE ay.school_id = ss.school_id AND ay.is_current LIMIT 1),
                current_date)
  FROM public.teacher_classes tc
  JOIN public.classes c ON c.id = tc.class_id
  JOIN public.class_groups g ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs
    ON cs.curriculum_class_id = g.curriculum_class_id AND cs.name = btrim(tc.subject)
  JOIN public.section_subjects ss
    ON ss.section_id = c.id AND ss.curriculum_subject_id = cs.id
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 7 — a student's section must match any record attached to them
--
-- "Reject at write time — do not discover later." Verified before adding:
-- zero existing rows violate this across all three tables, so the trigger
-- rejects only new mistakes.
--
-- A student with no section yet is not a violation — that is a not-recorded
-- NULL, not a mismatch (G4).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_student_section_must_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _student_section uuid;
  _record_section  uuid;
BEGIN
  SELECT s.class_id INTO _student_section
    FROM public.students s WHERE s.id = NEW.student_id;

  IF _student_section IS NULL THEN
    RETURN NEW;   -- student not placed in a section yet
  END IF;

  IF TG_TABLE_NAME = 'attendance' THEN
    _record_section := NEW.class_id;
  ELSIF TG_TABLE_NAME = 'homework_submissions' THEN
    SELECT h.class_id INTO _record_section
      FROM public.homework h WHERE h.id = NEW.homework_id;
  ELSIF TG_TABLE_NAME = 'marks' THEN
    SELECT e.class_id INTO _record_section
      FROM public.exams e WHERE e.id = NEW.exam_id;
  END IF;

  IF _record_section IS NULL THEN
    RETURN NEW;   -- the record itself names no section
  END IF;

  IF _record_section IS DISTINCT FROM _student_section THEN
    RAISE EXCEPTION
      'student % is in section %, but this % row is attached to section %',
      NEW.student_id, _student_section, TG_TABLE_NAME, _record_section;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_student_section ON public.attendance;
CREATE TRIGGER trg_attendance_student_section
  BEFORE INSERT OR UPDATE OF student_id, class_id ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_section_must_match();

DROP TRIGGER IF EXISTS trg_hw_submission_student_section ON public.homework_submissions;
CREATE TRIGGER trg_hw_submission_student_section
  BEFORE INSERT OR UPDATE OF student_id, homework_id ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_section_must_match();

DROP TRIGGER IF EXISTS trg_marks_student_section ON public.marks;
CREATE TRIGGER trg_marks_student_section
  BEFORE INSERT OR UPDATE OF student_id, exam_id ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_section_must_match();

REVOKE EXECUTE ON FUNCTION public.tg_student_section_must_match()       FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_section_subjects_same_institution() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 8 — RLS
--
-- Global curriculum (G2): readable by every authenticated user, maintained by
-- the super admin only. Institution tables: the Chunk 1 restrictive tenant
-- fence, plus staff read and admin/principal write.
-- ---------------------------------------------------------------------

ALTER TABLE public.boards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_classes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.section_subjects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

-- Curriculum: read for all signed-in users. Not `USING (true)` — an
-- authenticated identity is still required, so this is not
-- permissive-by-default in the sense Chunk 1's verification 3 forbids.
DROP POLICY IF EXISTS boards_read ON public.boards;
CREATE POLICY boards_read ON public.boards
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS curriculum_classes_read ON public.curriculum_classes;
CREATE POLICY curriculum_classes_read ON public.curriculum_classes
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS curriculum_subjects_read ON public.curriculum_subjects;
CREATE POLICY curriculum_subjects_read ON public.curriculum_subjects
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS chapters_read ON public.chapters;
CREATE POLICY chapters_read ON public.chapters
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- "Maintained by super admin."
DROP POLICY IF EXISTS boards_write_super ON public.boards;
CREATE POLICY boards_write_super ON public.boards
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS curriculum_classes_write_super ON public.curriculum_classes;
CREATE POLICY curriculum_classes_write_super ON public.curriculum_classes
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS curriculum_subjects_write_super ON public.curriculum_subjects;
CREATE POLICY curriculum_subjects_write_super ON public.curriculum_subjects
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS chapters_write_super ON public.chapters;
CREATE POLICY chapters_write_super ON public.chapters
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Institution tables: the same restrictive fence every other school-scoped
-- table carries since Chunk 1, so no permissive policy here can ever reach
-- across institutions.
DROP POLICY IF EXISTS class_groups_tenant_fence ON public.class_groups;
CREATE POLICY class_groups_tenant_fence ON public.class_groups
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS section_subjects_tenant_fence ON public.section_subjects;
CREATE POLICY section_subjects_tenant_fence ON public.section_subjects
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS teacher_assignments_tenant_fence ON public.teacher_assignments;
CREATE POLICY teacher_assignments_tenant_fence ON public.teacher_assignments
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- Read: anyone in the institution. Structure is not sensitive, and every panel
-- needs it to resolve what a section studies and who teaches it.
DROP POLICY IF EXISTS class_groups_read ON public.class_groups;
CREATE POLICY class_groups_read ON public.class_groups
  FOR SELECT TO authenticated USING (public.same_school(school_id));

DROP POLICY IF EXISTS section_subjects_read ON public.section_subjects;
CREATE POLICY section_subjects_read ON public.section_subjects
  FOR SELECT TO authenticated USING (public.same_school(school_id));

DROP POLICY IF EXISTS teacher_assignments_read ON public.teacher_assignments;
CREATE POLICY teacher_assignments_read ON public.teacher_assignments
  FOR SELECT TO authenticated USING (public.same_school(school_id));

-- Write: admin creates structure; principal may adjust teaching assignments
-- (10.18 gives "assign teachers to sections" to admin; the principal is
-- included on assignments only, not on creating the structure itself).
DROP POLICY IF EXISTS class_groups_write_admin ON public.class_groups;
CREATE POLICY class_groups_write_admin ON public.class_groups
  FOR ALL TO authenticated
  USING (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS section_subjects_write_admin ON public.section_subjects;
CREATE POLICY section_subjects_write_admin ON public.section_subjects
  FOR ALL TO authenticated
  USING (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS teacher_assignments_write_staff ON public.teacher_assignments;
CREATE POLICY teacher_assignments_write_staff ON public.teacher_assignments
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role))
  );


-- ---------------------------------------------------------------------
-- SECTION 9 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _m int; _d text;
BEGIN
  -- The tree seeded.
  SELECT count(*) INTO _n FROM public.boards;
  IF _n <> 1 THEN RAISE EXCEPTION 'Chunk 2: expected 1 board, found %', _n; END IF;

  SELECT count(*) INTO _n FROM public.curriculum_classes;
  IF _n <> 8 THEN RAISE EXCEPTION 'Chunk 2: expected 8 curriculum classes (5..12), found %', _n; END IF;

  SELECT count(*) INTO _n FROM public.chapters;
  IF _n < 500 THEN RAISE EXCEPTION 'Chunk 2: only % chapters seeded; expected ~519', _n; END IF;

  -- The four typographic near-duplicates must have collapsed.
  SELECT count(*) INTO _n
    FROM (SELECT cs.curriculum_class_id, cs.name AS subj,
                 regexp_replace(lower(translate(btrim(ch.name), '’‘“”–—', '''''""--')),
                                '[^[:alnum:]]+', '', 'g') AS k
            FROM public.chapters ch
            JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
           GROUP BY 1, 2, 3 HAVING count(*) > 1) t;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 2: % near-duplicate chapter group(s) survived the merge', _n;
  END IF;

  -- No chapter may carry an invented sequence.
  SELECT count(*) INTO _n FROM public.chapters WHERE sequence IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 2: % chapter(s) have a sequence, but syllabus order was never recorded', _n;
  END IF;

  -- Every existing section got a parent class group.
  SELECT count(*) INTO _n FROM public.classes WHERE class_group_id IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 2: % section(s) have no class_group', _n;
  END IF;

  -- Verification 7: all 18 foreign keys to public.classes still exist.
  SELECT count(*) INTO _n
    FROM pg_constraint k
   WHERE k.contype = 'f' AND k.confrelid = 'public.classes'::regclass;
  IF _n < 18 THEN
    RAISE EXCEPTION 'Chunk 2: only % FKs to public.classes remain; 18 expected — none may be re-pointed', _n;
  END IF;

  -- Teaching identity seeded from teacher_classes without loss.
  SELECT count(DISTINCT (tc.class_id, btrim(tc.subject))) INTO _m
    FROM public.teacher_classes tc WHERE btrim(coalesce(tc.subject, '')) <> '';
  SELECT count(*) INTO _n FROM public.section_subjects;
  IF _n < _m THEN
    RAISE EXCEPTION 'Chunk 2: % section_subjects seeded from % distinct (class, subject) pairs', _n, _m;
  END IF;

  SELECT count(*) INTO _n FROM public.teacher_assignments;
  IF _n = 0 THEN RAISE EXCEPTION 'Chunk 2: no teacher assignments seeded'; END IF;

  -- Every new school-scoped table carries the restrictive fence.
  SELECT count(*), string_agg(t.tbl, ', ') INTO _n, _d
    FROM (VALUES ('class_groups'), ('section_subjects'), ('teacher_assignments')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tbl
        AND p.permissive = 'RESTRICTIVE' AND p.policyname = t.tbl || '_tenant_fence');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 2: tenant fence missing on %', _d;
  END IF;

  -- RLS on every new table.
  SELECT count(*), string_agg(c.relname, ', ') INTO _n, _d
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('boards','curriculum_classes','curriculum_subjects','chapters',
                       'class_groups','section_subjects','teacher_assignments')
     AND NOT c.relrowsecurity;
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 2: RLS not enabled on %', _d; END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 10 — homework hangs off a section_subject
--
-- "Every homework, test, and exam-subject hangs off exactly one
-- section_subject_id. They do not each store their own class and section —
-- that is how mixing happens."
--
-- Added nullable here with the composite foreign key that makes cross-
-- institution attachment structurally impossible. It is NOT made NOT NULL in
-- this chunk: homework is Chunk 5's subject, and 19 live rows predate the
-- column. Chunk 5 enforces it. The existing class_id/subject columns are left
-- alone so nothing in flight breaks.
-- ---------------------------------------------------------------------

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS section_subject_id uuid;

ALTER TABLE public.homework
  DROP CONSTRAINT IF EXISTS homework_section_subject_fk;

-- (section_subject_id, school_id) -> section_subjects(id, school_id).
-- MATCH SIMPLE, so a NULL section_subject_id is simply unenforced, but a
-- non-NULL one can only name a section_subject of this same institution.
ALTER TABLE public.homework
  ADD CONSTRAINT homework_section_subject_fk
  FOREIGN KEY (section_subject_id, school_id)
  REFERENCES public.section_subjects (id, school_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS homework_section_subject_idx
  ON public.homework (section_subject_id);

-- Backfill from the class + subject text the rows already carry.
UPDATE public.homework h
   SET section_subject_id = ss.id
  FROM public.classes c
  JOIN public.class_groups g ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs ON cs.curriculum_class_id = g.curriculum_class_id
  JOIN public.section_subjects ss ON ss.section_id = c.id AND ss.curriculum_subject_id = cs.id
 WHERE h.section_subject_id IS NULL
   AND c.id = h.class_id
   AND cs.name = btrim(h.subject);

DO $$
DECLARE _n int; _t int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.homework'::regclass
       AND conname = 'homework_section_subject_fk'
  ) THEN
    RAISE EXCEPTION 'Chunk 2: homework composite FK to section_subjects missing';
  END IF;

  SELECT count(*) FILTER (WHERE section_subject_id IS NOT NULL), count(*)
    INTO _n, _t FROM public.homework;
  RAISE NOTICE 'homework rows anchored on a section_subject: % of %', _n, _t;
END $$;
