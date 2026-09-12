SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'academic_years','account_identifiers','accounts','boards','chapters',
    'class_groups','curriculum_classes','curriculum_subjects','invitations',
    'memberships','section_subjects','sessions','super_admin_access_log',
    'super_admins','teacher_assignments','schools'
  )
ORDER BY table_name, ordinal_position;
