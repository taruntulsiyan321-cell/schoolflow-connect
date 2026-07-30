# Gurukul Database

Multi-tenant PostgreSQL schema (Supabase). Every school is a row in `schools`; tenant rows carry `school_id`.

## Apply migrations

```bash
supabase db push
```

Order matters:

1. `20260730000000_auth_multitenant_foundation.sql` — schools, profiles.school_id, auth RPCs  
2. `20260730010000_complete_panel_database.sql` — full panel schema + school isolation  
3. `20260730020000_academic_engine_foundation.sql` — academic engine backbone (years, profiles, events, audit, remarks)

After push, regenerate types:

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

## Academic Engine (Phase 1)

Canonical TypeScript contracts live in `src/academic/`.

| Concern | Location |
|---------|----------|
| Entity → table registry | `src/academic/entities.ts` |
| Ownership (who writes / who reads) | `src/academic/ownership.ts` |
| Event catalog + sync targets | `src/academic/events.ts` |
| Tenant helpers | `src/academic/tenant.ts` |
| Validation rules | `src/academic/validation/rules.ts` |

### New tables (migration 20260730020000)

| Table | Purpose |
|-------|---------|
| `academic_years` | Formal school year; `classes` / `academic_terms` link via `academic_year_id` |
| `student_academic_profiles` | Auto-maintained one profile per student (dashboards / AI) |
| `academic_events` | Event outbox for automatic synchronization |
| `academic_audit` | Immutable audit (who/when/before/after) |
| `teacher_remarks` | First-class remarks owned by Teacher |

### Product aliases (do not create duplicate tables)

| Product name | Physical table |
|--------------|----------------|
| Assignment | `homework` |
| Assignment submission | `homework_submissions` |
| Test | `dpps` |
| Examination marks | `marks` |
| Section | `classes.section` |

### Engine RPCs

| RPC | Purpose |
|-----|---------|
| `emit_academic_event(...)` | Publish to outbox |
| `write_academic_audit(...)` | Append audit row |
| `ensure_student_academic_profile(student_id)` | Upsert profile shell |

## Academic Engine (Phase 2) — repositories

School-scoped data access lives in `src/academic/repository/`.

| Repository | Responsibility |
|------------|----------------|
| `attendanceRepository` | Class/student attendance reads + upsert (tenant + uniqueness checks) |
| `homeworkRepository` | Homework + submissions (assignment alias) |
| `marksRepository` | Exams + marks publish with max-marks + assignment gates |
| `remarksRepository` | Teacher remarks |
| `academicProfileRepository` | Read-only profiles + ensure RPC |
| `eventsRepository` | Emit events / audit via RPCs; list pending outbox |
| `teacherAssignmentRepository` | Central teacher–class–subject ownership check |

Rules:

- Every write takes `RepoContext { schoolId, userId? }`
- Cross-school student access throws `TenantViolationError`
- Validation runs in the repository before DB writes
- Panels must not query academic tables directly once services (Phase 3) land

## Academic Engine (Phase 3) — domain services

Reusable write/read APIs with ownership enforcement: `src/academic/services/`.

| Service | Owns writes | Consumers |
|---------|-------------|-----------|
| `AttendanceService` | Teacher | Student, Parent, Principal, Admin |
| `HomeworkService` / `AssignmentService` | Teacher (assign), Student (submit) | All academic roles |
| `MarksService` | Teacher (assigned subject) / Admin / Principal | Student, Parent, Staff |
| `RemarksService` | Teacher | Student, Parent, Staff |
| `AcademicProfileService` | Sync engine only (ensure = operators) | Dashboards / AI |

Usage:

```ts
import { AttendanceService, type ServiceContext } from "@/academic";

const ctx: ServiceContext = { schoolId, userId, role: "teacher" };
await AttendanceService.mark(ctx, { studentId, classId, date, status: "present" });
```

Panels must call services — never repositories or raw tables for academic mutations.

## Academic Engine (Phase 4) — synchronization

Outbox + automatic fan-out:

| Piece | Location |
|-------|----------|
| SQL refresh rollup | `refresh_student_academic_profile(student_id)` |
| SQL event processor | `process_academic_event` / `process_pending_academic_events` |
| Auto-process trigger | `trg_academic_events_autoprocess` on `academic_events` insert |
| TS facade | `src/academic/sync/` |

Flow:

```
Service write → DB trigger → academic_events row
  → process_academic_event
    → refresh student_academic_profiles
    → notifications (student + parents)
    → school_activity_feed
```

No panel should manually update dashboards after attendance/marks/homework.

## Academic Engine (Phase 5) — analytics, AI data, audit

| Layer | Module | Rule |
|-------|--------|------|
| Analytics | `src/academic/analytics` + `AnalyticsService` | Compute from profiles/facts — never duplicate stores |
| AI data | `src/academic/ai` + `AiSummaryService` | AI receives structured summaries only |
| Audit read | `src/academic/audit` + `AuditReadService` | Admin/principal history (who/when/before/after) |
| Notifications | Phase 4 SQL `_notify_student_circle` | Auto on academic events |

```ts
import { AnalyticsService, AiSummaryService, AuditReadService } from "@/academic";

await AnalyticsService.forStudent(ctx, studentId);
await AiSummaryService.student(ctx, studentId);
await AuditReadService.recent(ctx);
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
