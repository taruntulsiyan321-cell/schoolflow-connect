import io, os

SC = os.path.dirname(os.path.abspath(__file__))

PRE = """BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;
DO $probe$
DECLARE
  admin_a uuid := 'd1000001-0001-4000-8000-000000000001';
  princ_a uuid := 'd1000001-0002-4000-8000-000000000002';
  teach_a uuid := 'd1000002-0001-4000-8000-000000000001';
  stud_a  uuid := 'd1000003-0001-4000-8000-000000000001';
  par_a   uuid := 'd1000004-0001-4000-8000-000000000001';
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';
  vic_a uuid; vic_b uuid; aud_id uuid; cls_a uuid; r text;
BEGIN
"""

POST = """END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
"""

SEED = ("  SELECT id INTO vic_a FROM public.students WHERE school_id=sch_a AND deleted_at IS NULL LIMIT 1;\n"
        "  SELECT id INTO vic_b FROM public.students WHERE school_id=sch_b AND deleted_at IS NULL LIMIT 1;\n"
        "  UPDATE public.students SET deleted_at=now(), deleted_by=admin_a WHERE id IN (vic_a, vic_b);\n")

def rec(area, role, exp, cond):
    return ("  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES\n"
            "    ('%s','%s','%s',r, CASE WHEN %s THEN 'PASS' ELSE 'FAIL' END);\n" % (area, role, exp, cond))

def call(user, sql_literal):
    return "  r := pg_temp.as_user(%s, %s);\n" % (user, sql_literal)

RESTORE = "format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',{v})"

# ── probe 1: the cross-tenant hole, and the admin-only gate ────────────────
p1 = PRE + SEED
p1 += call("admin_a", RESTORE.format(v="vic_b"))
p1 += rec("160000 restore CROSS-TENANT", "admin of school A",
          "ERROR or false - must NOT restore school B",
          "r LIKE 'ERROR%' OR r='OK: false'")
p1 += call("admin_a", RESTORE.format(v="vic_a"))
p1 += rec("160000 restore own-tenant", "admin of school A",
          "OK: true - guard must not break the feature", "r='OK: true'")
p1 += "  UPDATE public.students SET deleted_at=now(), deleted_by=admin_a WHERE id=vic_a;\n"
for who, label in (("teach_a", "teacher"), ("par_a", "parent"), ("stud_a", "student")):
    p1 += call(who, RESTORE.format(v="vic_a"))
    p1 += rec("130000 restore role gate", label, "ERROR Admin only",
              "r LIKE 'ERROR%Admin only%'")
p1 += POST

# ── probe 2: trash view readability + fence + purge unreachable ────────────
p2 = PRE + SEED
p2 += call("admin_a", "'SELECT count(*)::text FROM public.trash'")
p2 += rec("150000 trash view readable", "admin of school A", "OK: >=1", "r ~ '^OK: [1-9]'")
p2 += call("admin_a", "format('SELECT count(*)::text FROM public.trash WHERE school_id=%L', sch_b)")
p2 += rec("150000 trash tenant fence", "admin of school A",
          "OK: 0 - must not see school B", "r='OK: 0'")
for who, label in (("teach_a", "teacher"), ("par_a", "parent"), ("stud_a", "student")):
    p2 += call(who, "'SELECT count(*)::text FROM public.trash'")
    p2 += rec("150000 trash view", label, "OK: 0 - G6 admin only", "r='OK: 0'")
p2 += call("admin_a", "'SELECT public.rpc_purge_expired()::text'")
p2 += rec("130000 purge unreachable", "admin of school A",
          "ERROR permission denied", "r LIKE 'ERROR%'")
p2 += POST

# ── probe 3: audit is admin-only ───────────────────────────────────────────
# ONE known row by primary key. EXISTS over the whole table makes a role that
# can see nothing scan all 8,878 rows evaluating same_school() per row, which
# times out - so the "false" case was untestable that way. An index lookup on a
# single school-A row asks the same question in one RLS evaluation.
AUD = "format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id)"
p3 = PRE
p3 += "  SELECT id INTO aud_id FROM public.academic_audit WHERE school_id=sch_a LIMIT 1;\n"
p3 += call("admin_a", AUD)
p3 += rec("100000 audit read (one school-A row)", "admin of school A", "OK: 1", "r='OK: 1'")
for who, label in (("princ_a", "PRINCIPAL"), ("teach_a", "teacher"),
                   ("par_a", "parent"), ("stud_a", "student")):
    p3 += call(who, AUD)
    p3 += rec("100000 audit read (one school-A row)", label, "OK: 0 - 10.18 admin only", "r='OK: 0'")
p3 += POST

# ── probe 4: digest gate, resources write, complaints ──────────────────────
# The INSERT probes previously used `SELECT ... FROM (INSERT ... RETURNING 1) z`,
# which is not valid SQL - every one failed with "syntax error at or near INTO"
# and three of them still scored PASS, because the check only looked for the
# word ERROR. A denial test that passes on a typo tests nothing. Data-modifying
# statements need a CTE, and a POSITIVE control is required so that a policy
# denying everybody cannot pass either.
DIG = "'SELECT (public.rpc_parent_weekly_digest() ? ''children'')::text'"

INS_RES = ("format('WITH ins AS (INSERT INTO public.learning_resources "
           "(school_id,class_id,title,resource_type,created_by) VALUES "
           "(%L,%L,''probe'',''pdf'',%L) RETURNING 1) SELECT count(*)::text FROM ins', "
           "sch_a, cls_a, {u})")
INS_CMP = ("format('WITH ins AS (INSERT INTO public.school_complaints "
           "(school_id,submitted_by,complainant_name,subject,body) VALUES "
           "(%L,%L,''probe'',''s'',''b'') RETURNING 1) SELECT count(*)::text FROM ins', "
           "sch_a, {u})")

p4 = PRE
# a class this teacher actually teaches - the positive control needs one
p4 += ("  SELECT tc.class_id INTO cls_a FROM public.teacher_classes tc\n"
       "    JOIN public.teachers t ON t.id = tc.teacher_id\n"
       "   WHERE t.user_id = teach_a AND tc.class_id IS NOT NULL LIMIT 1;\n")
p4 += call("par_a", DIG)
p4 += rec("120000 digest", "parent", "OK: true", "r='OK: true'")
for who, label in (("stud_a", "student"), ("teach_a", "teacher")):
    p4 += call(who, DIG)
    p4 += rec("120000 digest", label, "ERROR Parent only", "r LIKE 'ERROR%Parent only%'")

# POSITIVE control first: the teacher who teaches this class MUST succeed.
p4 += call("teach_a", INS_RES.format(u="teach_a"))
p4 += rec("140000 resources insert (positive control)", "teacher who teaches the class",
          "OK: 1 - 10.11 teachers upload", "r='OK: 1'")
for who, label in (("admin_a", "admin"), ("stud_a", "student"), ("par_a", "parent")):
    p4 += call(who, INS_RES.format(u=who))
    p4 += rec("140000 resources insert", label,
              "ERROR row-level security - 10.11 teachers only",
              "r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%'")

p4 += call("par_a", INS_CMP.format(u="par_a"))
p4 += rec("0903 complaint insert (positive control)", "parent",
          "OK: 1 - 10.15 parent may raise", "r='OK: 1'")
for who, label in (("teach_a", "teacher"), ("stud_a", "student")):
    p4 += call(who, INS_CMP.format(u=who))
    p4 += rec("0903 complaint insert", label,
              "ERROR row-level security - spec forbids",
              "r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%'")
p4 += POST

for i, body in enumerate([p1, p2, p3, p4], 1):
    io.open(os.path.join(SC, "probe%d.sql" % i), "w", encoding="utf-8", newline="").write(body)
print("wrote probe1..probe4")
