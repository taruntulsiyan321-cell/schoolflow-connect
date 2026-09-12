SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN (
    'institutions','academic_years','accounts','account_identifiers','memberships',
    'sessions','invitations','super_admins','super_admin_access_log',
    'boards','curriculum_classes','curriculum_subjects','chapters','topics',
    'class_groups','section_subjects','teacher_assignments',
    'chapter_tally','chapter_state','recovery_sessions','revision_sessions',
    'practice_mistakes','practice_skipped','practice_bookmarks','practice_xp','practice_sessions',
    'question_reports','student_enrolments','student_guardians','guardians'
  )
ORDER BY table_name;
