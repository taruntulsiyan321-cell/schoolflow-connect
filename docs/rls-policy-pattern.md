# RLS policy pattern — read this before writing any new policy

Chunk 7 adds a lot of tables. Every one of them will need a tenant fence and a
set of read policies, and the shape you reach for by default is the shape that
cost this project three chunks to remove.

This is the working pattern from Chunks 6.6 and 6.7, the two dead ends that were
tried and measured, and the checks that have to accompany it. It is written to be
read at the *start* of a chunk, not consulted after something is slow.

---

## Why the obvious shape is wrong

A policy predicate is evaluated **once per candidate row** — every row the
statement considers, not every row the caller may see. A parent who can see 5
marks in a school of 2,546 pays the predicate 2,546 times.

So a policy that calls a function per row multiplies that function's cost by the
whole table. Measured on this database:

| helper | per call |
|---|---|
| `same_school(school_id)` | 2.73 ms |
| `is_class_of_my_child()` | 126 ms (scans `students`) |
| `teacher_teaches_class()` | 18.5 ms |
| `active_membership_role()` | **0.06 ms** — no argument, resolves once |

`marks` as a parent, before and after: **50,105 ms → 26.5 ms.**
`academic_events` as a parent: **75,027 ms → 13.3 ms.**

Both were HTTP 500s at one ordinary school's volume, on a demo database that
showed half a second.

---

## The working shape

### 1. The fence

```sql
CREATE POLICY <table>_tenant_fence ON public.<table>
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));
```

Never `same_school(school_id)`. `my_accessible_school_ids()` is the set form of
exactly the same rule — the caller's own institution plus any a super admin
currently holds live access to.

**Why `IN (SELECT …)` and not `= ANY(array_fn())`:** an uncorrelated subquery
becomes a *hashed SubPlan* the planner runs once, then probes per row. An array
function inside `= ANY(...)` is re-evaluated per row like any other call. Only
the subquery form gives once-per-statement, and `EXPLAIN` will show it as
`(hashed SubPlan N)` with `loops=1`.

### 2. The read policy

```sql
CREATE POLICY <table>_read ON public.<table>
  FOR SELECT
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))     -- hoisted, once
      OR student_id IN (SELECT public.my_own_or_children_student_ids())
      OR <fk>_id    IN (SELECT public.my_<something>_ids())
    )
  );
```

Two rules in one block:

- **Any expression with no column reference goes inside `(SELECT …)`.** That
  makes it a one-time InitPlan instead of a per-row call. `auth.uid()`,
  `has_role(auth.uid(), …)`, `active_membership_role()` — all of them.
- **Any per-row lookup becomes set membership** against a set-returning helper.

### 3. The helper

```sql
CREATE OR REPLACE FUNCTION public.my_<thing>_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id
    FROM public.<table> t
   WHERE t.school_id IN (SELECT public.my_accessible_school_ids())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN t.class_id IN (SELECT public.my_teacher_class_ids())
           ELSE false
         END
$$;

GRANT EXECUTE ON FUNCTION public.my_<thing>_ids() TO anon, authenticated;
```

- **Zero arguments.** A helper taking a per-row argument cannot be resolved once,
  however cheap its body looks. That was the whole of `can_read_mark`.
- **Dispatch on role first.** An `OR` chain evaluates every arm until one is
  true, so a parent pays the teacher's check and the student's check before
  reaching their own. `CASE (SELECT active_membership_role())` costs 0.06 ms.
- **`SECURITY DEFINER`, and re-state every guarantee it bypasses** — active role,
  active local person, institution. The helper does not pay the inner table's
  RLS, so it must assert for itself what that RLS would have enforced. A helper
  missing its institution check is a privacy hole with better latency.
- **Hoist *inside* the helper too.** This is the step that gets missed. Making
  the helper set-returning stops the *policy* calling it per row, but if its body
  calls scalar resolvers per row of its own driving table, the cost has only
  moved inside. `my_readable_test_ids()` ran once and still cost 40 seconds.
- **Grant EXECUTE explicitly.** These are reached through the implicit PUBLIC
  grant otherwise, and a routine `REVOKE ... FROM PUBLIC` hardening step would
  break every fenced query on every table at once.

### 4. Write policies stay per-row

```sql
CREATE POLICY <table>_insert ON public.<table>
  FOR INSERT WITH CHECK (public.can_manage_<thing>(<fk>_id));
```

Leave them. Per-row is correct for a write, the row counts are tiny, and the
alternative is a dead end (below).

**But never leave a write policy as `FOR ALL`.** A permissive `FOR ALL` policy is
evaluated on `SELECT` too, so every reader pays the write check before reaching
their own arm. Split it into `INSERT` / `UPDATE` / `DELETE` — and when you do,
**fold the write predicate into the read policy**, or you silently remove read
access from anyone who only had it through that arm. `can_manage_test` includes
`created_by = auth.uid()`, so a teacher who created a test and stopped teaching
that section would have lost it.

---

## The two dead ends — measured, do not retry

### 1. Making `same_school()` inlinable

The idea: rewrite `same_school()` as a non-`SECURITY DEFINER`, no-`SET` function
so the planner inlines its body into the policy, fixing all 104 tenant-fenced
tables with one change.

**It does not work.** PostgreSQL will not inline a SQL function whose body
contains a subquery, and both `SECURITY DEFINER` and a `SET` clause block
inlining independently. The plan still showed `same_school(school_id)` in the
filter, and the per-call sublink made it **worse: 8.0 s → 16.2 s.**

Run inside a transaction that rolled itself back; production never saw it.

### 2. Rewriting a write check as `IN (SELECT …)`

The idea: apply the same set-membership rewrite to `WITH CHECK` on INSERT.

**Unsafe.** The subquery becomes a one-time InitPlan, and a row being inserted is
not guaranteed to be visible to it, where the per-row function does see it. The
read path was rewritten; the write path was deliberately left alone.

**One exception, and know why it is one:** `user_id = (SELECT auth.uid())` is
fine in a write check. The hazard is a subquery *against the table being
written*. `auth.uid()` reads no table and does not depend on the row, so there is
nothing for it to fail to see. In `notifications` that hoist also let the planner
switch from scanning 1,354 rows to an index scan of ~100.

---

## Measure, and measure the right thing

- **A total is meaningless without the row count it came from.** 14 ms/row is
  invisible at 26 rows and a 500 at 2,000. Report per-row cost and what it
  becomes at 10,000.
- **Read the split off `EXPLAIN (ANALYZE)`, not off a stopwatch.** A policy whose
  setup costs 900 ms once and a policy costing 25 ms per row look identical at 36
  rows and could not be less alike at 10,000. `scripts/explain-as-role.mjs`
  prints both.
- **Two ways of splitting them are wrong**, both tried here: `total / rows`
  invented a 25 ms/row figure on a table whose cost was all setup; subtracting a
  `ctid`-restricted scan reported 1.4 ms of setup for a policy whose setup really
  cost 27 ms, because SubPlans evaluate lazily and the one-row probe skipped
  them.
- **Measure again after the fix.** In Chunk 6 the first two fixes moved the cost
  by ~0 ms and only measurement revealed it. In 6.6 the fourth measurement found
  the cost had moved *inside* an InitPlan.
- **"Once per statement" is not "constant."** A helper that scans a table to
  build its set still grows with that table. The multiplication stops; the cost
  does not vanish.

---

## What must accompany the change

This is a change to the isolation boundary. A performance fix that opens a hole
is worse than the latency it removed.

- **Set equality per role, not counts.** Counts pass if two children's records
  are swapped.
- **Ground truth is the OLD predicate**, reconstructed from raw tables as owner.
  Comparing the new policy to its own logic proves only self-consistency.
- **A negative control per batch.** Open the policy, confirm the check catches
  it, let the rollback close it. A gate never seen to fail is a gate never seen
  to work.
- **Each item captures its own baseline.** Never compare against a variable an
  earlier item wrote.
- **Both halves of a refusal.** "0 rows changed" is indistinguishable from
  "cannot read the table at all".
- **The super-admin arm is separate.** An account acting in a granted institution
  has no membership row, so `active_membership_role()` is NULL and every role arm
  is false. If they had access before, they need their own explicit arm; if they
  did not, assert that it is still none — a sudden non-zero means the rewrite
  invented access.
- **Then the standing gates**, plus `scripts/query-timing.mjs` and the leak
  survey.

---

## Checklist for a new table

1. `school_id`, `academic_year_id`, RLS enabled.
2. Tenant fence in the set form above.
3. One read policy; role dispatch first; every no-column call hoisted.
4. Write policies per-row, split by command, never `FOR ALL`.
5. Any new helper: zero arguments, `SECURITY DEFINER`, guarantees re-stated,
   hoisted internally, `GRANT EXECUTE`.
6. Rollback script, same timestamp, stating what reverting costs.
7. Verification: set equality vs the old predicate, negative control, own
   baselines.
8. `scripts/query-timing.mjs` on the new table, every role, with the projection.
