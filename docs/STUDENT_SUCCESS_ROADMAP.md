# Wisdom Campus — Student Success Platform Roadmap



**Vision:** Every feature answers: *How does this help students improve, participate, build consistency, or help schools support growth?*



## Phase 1 — Shipped (`20260606000000_student_success_platform.sql`)



| Area | Delivered |

|------|-----------|

| Student | Growth dashboard, exam readiness, weak/strong topics, heatmap, revision queue, mistake book, analytics |

| DPP | Auto-capture wrong answers → mistake bank + activity bump |

| Parent | Insights page (existing) + `rpc_parent_child_snapshot` for linked children |

| Teacher | Class insights: at-risk, improving, top performers, class weak topics |

| Principal | School engagement score, attendance/DPP rates, class overview |

| Data | `student_mistakes`, `revision_queue`, `academic_daily_activity` + RPCs |



## Phase 2 — Shipped (`20260607000000_student_success_phase2.sql`)



| Area | Delivered |

|------|-----------|

| Parent | Weekly digest RPC + in-app alerts (`parent_academic_alerts`) |

| Battles | Wrong answers → mistake bank via `_capture_battle_mistakes` |

| Student | Performance charts RPC; expanded engagement badges |

| Frontend | `useParentWeeklyDigest`, `AcademicReport`, analytics heatmap |



## Phase 3 — Shipped (`20260608000000_student_success_phase3.sql`)



| Area | Delivered |

|------|-----------|

| Student | Rule + AI improvement plans per weak topic (`student_improvement_plans`, `rpc_student_improvement_plans`, `ai-improvement-plan`) |

| Student | Personalized revision queue scoring + `rpc_student_revision_queue` |

| Teacher | Suggested interventions on class insights |

| Principal | Class trend arrows (7d vs prior 7d: activity, DPP, attendance) |

| Frontend | `ImprovementPlans`, updated `RevisionQueue`, `ClassInsights`, `SchoolEngagement` |



## Phase 4 — Polish



- Hide ERP-only nav items from student role (fees/library de-emphasized)

- Parent push notifications for consistency drops

- School engagement benchmarks vs last term



## Apply database changes



Paste into Lovable SQL (in order):



1. `supabase/migrations/20260606000000_student_success_platform.sql`

2. `supabase/migrations/20260607000000_student_success_phase2.sql`

3. `supabase/migrations/20260608000000_student_success_phase3.sql`



Or append the Student Success block at the end of `supabase/LOVABLE_PASTE_ALL_PENDING.sql` (regenerated bundle).



Deploy edge function: `supabase/functions/ai-improvement-plan` (requires `LOVABLE_API_KEY`).

