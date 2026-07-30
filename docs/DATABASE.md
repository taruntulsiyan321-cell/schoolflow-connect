# Gurukul Database

Multi-tenant PostgreSQL schema (Supabase). Every school is a row in `schools`; tenant rows carry `school_id`.

## Apply migrations

```bash
supabase db push
```

Order matters:

1. `20260730000000_auth_multitenant_foundation.sql` — schools, profiles.school_id, auth RPCs  
2. `20260730010000_complete_panel_database.sql` — full panel schema + school isolation  

After push, regenerate types:

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

## Panel → tables

| Panel | Primary tables |
|-------|----------------|
| **Auth** | `schools`, `profiles`, `user_roles` |
| **Admin** | `students`, `teachers`, `parents`, `parent_students`, `classes`, `subjects`, `notices`, `exams`, `marks`, `fees`, `leave_requests`, `approval_requests`, `app_settings`, `audit_logs`, `school_activity_feed` |
| **Principal** | Same ops tables + `approval_requests`, `school_activity_feed`, `academic_terms`, attendance/marks analytics |
| **Teacher** | `teacher_classes`, `timetable_slots`, `attendance`, `homework*`, `exams`/`marks`, `community_doubts*`, `messages`, `leave_requests`, `notices` |
| **Student** | `practice_*`, `question_*`, `dpps*`, `battles*`, `student_xp`, `student_badges`, `learning_resources`, `school_calendar_events`, `homework*`, `attendance`, `fees` |
| **Parent** | `parents`, `parent_students`, `parent_academic_alerts`, `attendance`, `marks`, `fees`, `notices`, `messages`, `notifications` |

## New tables (migration 20260730010000)

- `parents` / `parent_students`
- `school_calendar_events`
- `learning_resources`
- `subjects`
- `academic_terms`
- `approval_requests`
- `timetable_slots`
- `school_activity_feed`

## Multi-tenant rules

- Filter queries with `school_id` from `useAuth().schoolId`
- Prefer SQL helper: `school_id = public.get_my_school_id()`
- Unique admission numbers / class sections are **per school**

## Auth RPCs

| RPC | Purpose |
|-----|---------|
| `get_auth_context()` | Profile + role + school bootstrap |
| `claim_signup_role(student\|parent)` | Self-signup role (SECURITY DEFINER) |
| `get_my_school_id()` | Current tenant id |
| `ensure_default_role()` | Fallback student role |
| `link_portal_on_auth()` | Link reserved portal emails/phones |
