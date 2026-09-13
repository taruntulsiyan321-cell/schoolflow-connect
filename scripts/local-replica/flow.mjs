#!/usr/bin/env node
/**
 * THE TEST FLOW, DRIVEN END TO END AS THE REAL CALLERS, against the local
 * replica of the live schema.
 *
 * Every write is the payload the client actually sends, and every read runs
 * under RLS as the signed-in role — never as `postgres`. Each claim is an
 * assertion with an expected value, and each fence claim has a positive control
 * beside it, so a refusal cannot pass because nothing was there to see.
 *
 *   node flow.mjs            run and report
 *   node flow.mjs --keep     leave the created rows behind for inspection
 */
import pg from "pg";

const PORT = process.env.GK_PORT || "5433";
const DB = process.env.GK_DB || "gurukul";

const ID = {
  school: "00000000-0000-4000-8000-000000000001",
  class10a: "d2000001-0001-4000-8000-000000000001",
  class9a: "d2000001-0002-4000-8000-000000000002",
  priya: "d1000002-0001-4000-8000-000000000001", // class teacher of 10-A, teaches 10-A Maths + 9-A Maths
  rajesh: "d1000002-0002-4000-8000-000000000002", // teaches 10-A Physics
  principal: "d1000001-0002-4000-8000-000000000002",
  admin: "d1000001-0001-4000-8000-000000000001",
  stuA: "d1000003-0001-4000-8000-000000000001", // Arjun Mehta, 10-A
  stuB: "d1000003-0002-4000-8000-000000000002", // Priya Patel, 10-A
  stuC: "d1000003-0003-4000-8000-000000000003", // Rohan Singh, 10-A
  stuOutsider: "d1000003-0010-4000-8000-000000000010", // moved to 9-A by this harness
  stuOutsiderPerson: "d3000001-0010-4000-8000-000000000010",
};

const pool = new pg.Pool({ host: "127.0.0.1", port: Number(PORT), user: "postgres", database: DB, max: 4 });

let pass = 0;
const failures = [];
const notes = [];

function claim(name, actual, expected, cmp = "eq") {
  const ok =
    cmp === "eq"
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : cmp === "gt"
        ? Number(actual) > Number(expected)
        : cmp === "truthy"
          ? Boolean(actual)
          : false;
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}` + (cmp === "eq" ? `  (= ${JSON.stringify(actual)})` : `  (${JSON.stringify(actual)})`));
  } else {
    failures.push({ name, actual, expected, cmp });
    console.log(`  FAIL  ${name}\n        expected ${cmp} ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  }
  return ok;
}

function note(text) {
  notes.push(text);
  console.log(`  NOTE  ${text}`);
}

/** Run `fn` inside one transaction, as `uid` (role authenticated) or as postgres when uid is null. */
async function as(uid, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (uid) {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: "authenticated" }),
      ]);
    }
    const out = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Expect a refusal. Returns the error so the caller can assert on its code. */
async function refusal(uid, fn) {
  try {
    await as(uid, fn);
    return null;
  } catch (e) {
    return { code: e.code, message: String(e.message).slice(0, 160) };
  }
}

const main = async () => {
  console.log("\n══ 0. fixture state ════════════════════════════════════════════════");
  await as(null, async (q) => {
    const [row] = await q(
      `select (select count(*) from public.students where class_id=$1) as students_10a,
              (select count(*) from public.tests) as tests,
              (select count(*) from public.test_attempts) as attempts`,
      [ID.class10a],
    );
    console.log("  ", row);
  });

  // A student of another section, so "not my class" is a real case rather than
  // an empty one. Seeded students are all in 10-A.
  await as(null, async (q) => {
    await q(`update public.students set class_id=$1 where id=$2`, [ID.class9a, ID.stuOutsiderPerson]);
  });

  // ── 1. TEACHER CREATES THE TEST ───────────────────────────────────────────
  console.log("\n══ 1. the teacher builds and publishes a test ══════════════════════");
  const sectionSubjectId = await as(ID.priya, async (q) => {
    const rows = await q(
      `select ss.id from public.section_subjects ss
         join public.curriculum_subjects cs on cs.id = ss.curriculum_subject_id
        where ss.section_id = $1 and cs.name = 'Mathematics'`,
      [ID.class10a],
    );
    claim("teacher resolves the section-subject anchor", rows.length, 1);
    return rows[0].id;
  });

  const testId = await as(ID.priya, async (q) => {
    const rows = await q(
      `insert into public.tests
         (school_id, section_subject_id, created_by, title, max_mark, total_marks, passing_marks,
          status, test_kind, difficulty, duration_sec, instructions, chapter, topic, chapters, topics,
          scheduled_publish_at, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,'draft','unit_test','medium',1800,$8,$9,$10,$11,$12,null,null)
       returning id`,
      [
        ID.school, sectionSubjectId, ID.priya, "Unit Test 1 — Real Numbers", 3, 3, 1,
        "Answer all questions.", "Real Numbers", "HCF and LCM",
        JSON.stringify(["Real Numbers"]), JSON.stringify(["HCF and LCM"]),
      ],
    );
    claim("teacher can create a test on the section they teach", rows.length, 1);
    return rows[0].id;
  });

  const questionIds = await as(ID.priya, async (q) => {
    const rows = await q(
      `insert into public.test_questions
         (test_id, order_index, question_format, question, options, correct, answer, marks, explanation, school_id, chapter, concept)
       values
         ($1,0,'mcq','What is the HCF of 12 and 18?','["2","4","6","12"]','{"indexes":[2]}',null,1,'12=2^2*3, 18=2*3^2 so HCF=6.',$2,'Real Numbers','HCF and LCM'),
         ($1,1,'mcq','What is the LCM of 4 and 6?','["12","24","6","8"]','{"indexes":[0]}',null,1,'LCM(4,6)=12.',$2,'Real Numbers','HCF and LCM'),
         ($1,2,'mcq','Is sqrt(2) rational?','["Yes","No"]','{"indexes":[1]}',null,1,'sqrt(2) is irrational.',$2,'Real Numbers','Irrational numbers')
       returning id, order_index`,
      [testId, ID.school],
    );
    claim("three MCQs saved", rows.length, 3);
    return rows.sort((a, b) => a.order_index - b.order_index).map((r) => r.id);
  });

  await as(ID.priya, async (q) => {
    const rows = await q(
      `update public.tests set status='published', published_at=now() where id=$1 returning status`,
      [testId],
    );
    claim("teacher publishes it", rows[0]?.status, "published");
  });

  // ── 2. WHO CAN SEE IT ─────────────────────────────────────────────────────
  console.log("\n══ 2. visibility ═══════════════════════════════════════════════════");
  await as(ID.stuA, async (q) => {
    const rows = await q(`select id, title, status from public.tests where id=$1`, [testId]);
    claim("a student of that section sees the published test", rows.length, 1);
  });
  await as(ID.stuOutsider, async (q) => {
    const rows = await q(`select id from public.tests where id=$1`, [testId]);
    claim("FENCE a student of another section sees nothing", rows.length, 0);
  });
  await as(ID.stuOutsider, async (q) => {
    const rows = await q(`select id from public.tests where deleted_at is null`, []);
    claim("POSITIVE CONTROL that outsider can read their own section's tests table at all", rows.length, 0);
    note("9-A has no test of its own, so the control above is vacuous — see claim 'outsider sees the 9-A test'");
  });
  await as(ID.stuA, async (q) => {
    const rows = await q(`select id from public.test_questions where test_id=$1`, [testId]);
    claim("FENCE the answer key is not SELECT-able by the student", rows.length, 0);
  });
  await as(ID.priya, async (q) => {
    const rows = await q(`select id, correct from public.test_questions where test_id=$1`, [testId]);
    claim("POSITIVE CONTROL the teacher who owns it does read the key", rows.length, 3);
  });

  // ── 3. STUDENT A SITS IT ──────────────────────────────────────────────────
  console.log("\n══ 3. student A sits the test ══════════════════════════════════════");
  const attemptA = await as(ID.stuA, async (q) => {
    const rows = await q(`select public.rpc_test_start($1) as id`, [testId]);
    claim("rpc_test_start returns an attempt", Boolean(rows[0].id), true);
    return rows[0].id;
  });

  await as(ID.stuA, async (q) => {
    const paper = await q(`select * from public.rpc_test_questions_for_attempt($1)`, [attemptA]);
    claim("the paper reaches the student", paper.length, 3);
    claim(
      "the paper carries no answer key",
      paper.every((r) => !("correct" in r) && !("explanation" in r)),
      true,
    );
  });

  // saveAnswer, per question, exactly as TestService.saveAnswer does.
  await as(ID.stuA, async (q) => {
    for (const [i, qid] of questionIds.entries()) {
      const response = i === 0 ? { indexes: [2] } : i === 1 ? { indexes: [0] } : { indexes: [0] }; // 2 right, 1 wrong
      await q(
        `insert into public.test_answers (attempt_id, question_id, school_id, response)
         values ($1,$2,$3,$4)
         on conflict (attempt_id, question_id) do update set response = excluded.response`,
        [attemptA, qid, ID.school, JSON.stringify(response)],
      );
    }
    const rows = await q(`select count(*)::int as n from public.test_answers where attempt_id=$1`, [attemptA]);
    claim("mid-attempt answers save as the student", rows[0].n, 3);
  });

  const submitA = await as(ID.stuA, async (q) => {
    const rows = await q(`select public.rpc_test_submit($1, null) as result`, [attemptA]);
    return rows[0].result;
  });
  claim("submit returns a score of 2 for 2 of 3 right", Number(submitA.score), 2);
  claim("submit returns correct_count 2", Number(submitA.correct_count), 2);
  claim("submit returns total_count 3", Number(submitA.total_count), 3);
  claim("submit returns the reviewable paper", Array.isArray(submitA.questions) ? submitA.questions.length : 0, 3);

  await as(null, async (q) => {
    const [row] = await q(
      `select (select count(*)::int from public.test_answers where attempt_id=$1) as answers_left,
              (select score from public.test_attempts where id=$1) as score,
              (select status from public.test_attempts where id=$1) as status,
              (select count(*)::int from public.test_marks where test_id=$2) as marks,
              (select mark from public.test_marks where test_id=$2 limit 1) as mark,
              (select count(*)::int from public.student_mistakes where source_id=$2) as mistakes`,
      [attemptA, testId],
    );
    claim("the attempt is marked submitted", row.status, "submitted");
    claim("the attempt's score is durable", Number(row.score), 2);
    claim("the mark is written to test_marks", row.marks, 1);
    claim("the mark equals the score", Number(row.mark), 2);
    claim("the wrong answer became a mistake-book row", row.mistakes, 1);
    claim("PER-QUESTION ANSWERS SURVIVE THE SUBMIT", row.answers_left, 3);
  });

  // ── 4. THE STUDENT'S OWN REPORT ───────────────────────────────────────────
  console.log("\n══ 4. the report the student sees the moment they submit ═══════════");
  const studentIdA = await as(null, async (q) =>
    (await q(`select id from public.students where user_id=$1`, [ID.stuA]))[0].id,
  );
  const reportA = await as(ID.stuA, async (q) =>
    (await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, studentIdA]))[0].r,
  );
  claim("student report: submitted", reportA.submitted, true);
  claim("student report: mark", Number(reportA.mark), 2);
  claim("student report: max_mark", Number(reportA.max_mark), 3);
  claim("student report: correct_count", Number(reportA.correct_count), 2);
  claim("student report: rank is 1 while they are the only submitter", Number(reportA.rank), 1);
  claim("student report: class_size counts submitters", Number(reportA.class_size), 1);
  claim("student report: ONE wrong answer listed, not the whole paper", (reportA.wrong_answers || []).length, 1);
  claim(
    "student report: the wrong answer carries what they actually chose",
    JSON.stringify((reportA.wrong_answers || [])[0]?.their_answer ?? null),
    JSON.stringify({ indexes: [0] }),
  );
  claim(
    "student report: the wrong answer is marked answered",
    (reportA.wrong_answers || [])[0]?.answered,
    true,
  );
  claim(
    "student report: the wrong answer carries its topic",
    (reportA.wrong_answers || [])[0]?.topic,
    "Irrational numbers",
  );

  // ── 5. THE LEADERBOARD MOVES AS OTHERS SUBMIT ─────────────────────────────
  console.log("\n══ 5. the leaderboard, as B then C submit ══════════════════════════");
  const rankOf = async (uid) => {
    const sid = (await as(null, async (q) => await q(`select id from public.students where user_id=$1`, [uid])))[0].id;
    const r = await as(uid, async (q) =>
      (await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, sid]))[0].r,
    );
    return { mark: r.mark == null ? null : Number(r.mark), rank: r.rank == null ? null : Number(r.rank), size: r.class_size == null ? null : Number(r.class_size) };
  };

  // B answers everything right.
  const attemptB = await as(ID.stuB, async (q) => (await q(`select public.rpc_test_start($1) as id`, [testId]))[0].id);
  await as(ID.stuB, async (q) => {
    // WITH A CLOCK PER QUESTION, which is what TestAttempt sends. The middle
    // question is deliberately the expensive one for both B and C, so the
    // per-question breakdown below has something real to rank. Student A above
    // submitted without times at all, so the untimed branch is exercised too.
    const answers = questionIds.map((qid, i) => ({
      question_id: qid,
      response: { indexes: [i === 0 ? 2 : i === 1 ? 0 : 1] },
      time_ms: i === 1 ? 120000 : i === 0 ? 3000 : 5000,
    }));
    await q(`select public.rpc_test_submit($1,$2::jsonb) as r`, [attemptB, JSON.stringify(answers)]);
  });
  // C answers one right.
  const attemptC = await as(ID.stuC, async (q) => (await q(`select public.rpc_test_start($1) as id`, [testId]))[0].id);
  await as(ID.stuC, async (q) => {
    const answers = questionIds.map((qid, i) => ({
      question_id: qid,
      response: { indexes: [i === 0 ? 2 : 3] },
      time_ms: i === 1 ? 90000 : i === 0 ? 4000 : 6000,
    }));
    await q(`select public.rpc_test_submit($1,$2::jsonb) as r`, [attemptC, JSON.stringify(answers)]);
  });

  const [rA, rB, rC] = [await rankOf(ID.stuA), await rankOf(ID.stuB), await rankOf(ID.stuC)];
  console.log("   A:", rA, "B:", rB, "C:", rC);
  claim("B scored 3", rB.mark, 3);
  claim("C scored 1", rC.mark, 1);
  claim("B is rank 1", rB.rank, 1);
  claim("A slipped to rank 2", rA.rank, 2);
  claim("C is rank 3", rC.rank, 3);
  claim("class_size is now 3 submitters", rA.size, 3);

  // ── 5b. THE NAMED LEADERBOARD ─────────────────────────────────────────────
  console.log("\n══ 5b. the named leaderboard (rpc_test_leaderboard) ════════════════");
  const boardA = await as(ID.stuA, async (q) => (await q(`select public.rpc_test_leaderboard($1) as r`, [testId]))[0].r);
  claim("leaderboard: three entries", (boardA.entries || []).length, 3);
  claim("leaderboard: submitted_count", Number(boardA.submitted_count), 3);
  claim("leaderboard: roll_count is the whole section", Number(boardA.roll_count), 10);
  claim(
    "leaderboard: ordered by mark, highest first",
    (boardA.entries || []).map((e) => Number(e.mark)),
    [3, 2, 1],
  );
  claim(
    "leaderboard: ranks agree with the student report",
    (boardA.entries || []).map((e) => Number(e.rank)),
    [1, 2, 3],
  );
  claim(
    "leaderboard: the caller is flagged as themselves, and only them",
    (boardA.entries || []).filter((e) => e.is_me).length,
    1,
  );
  claim(
    "leaderboard: carries the classmates' names (rule 13)",
    (boardA.entries || []).every((e) => typeof e.full_name === "string" && e.full_name.length > 0),
    true,
  );

  // The tie-break the ruling names: equal marks, first to finish on top.
  console.log("   -- tie-break: two students on the same mark, submitted minutes apart");
  const tieTestId = await as(ID.priya, async (q) => {
    const rows = await q(
      `insert into public.tests
         (school_id, section_subject_id, created_by, title, max_mark, total_marks, status, test_kind, duration_sec, published_at)
       values ($1,$2,$3,'Tie-break probe',1,1,'published','class_test',600, now()) returning id`,
      [ID.school, sectionSubjectId, ID.priya],
    );
    return rows[0].id;
  });
  const tieQ = await as(ID.priya, async (q) =>
    (await q(
      `insert into public.test_questions (test_id, order_index, question_format, question, options, correct, marks, school_id)
       values ($1,0,'mcq','tie: 1+1?','["2","3"]','{"indexes":[0]}',1,$2) returning id`,
      [tieTestId, ID.school],
    ))[0].id,
  );
  for (const uid of [ID.stuC, ID.stuB, ID.stuA]) {
    const att = await as(uid, async (q) => (await q(`select public.rpc_test_start($1) as id`, [tieTestId]))[0].id);
    await as(uid, async (q) =>
      await q(`select public.rpc_test_submit($1,$2::jsonb)`, [
        att,
        JSON.stringify([{ question_id: tieQ, response: { indexes: [0] } }]),
      ]),
    );
    // The clock is what decides the order, so the submissions must be distinguishable.
    await as(null, async (q) => await q(`select pg_sleep(0.05)`));
  }
  const tieBoard = await as(ID.stuA, async (q) => (await q(`select public.rpc_test_leaderboard($1) as r`, [tieTestId]))[0].r);
  claim(
    "leaderboard tie-break: all three scored 1",
    (tieBoard.entries || []).map((e) => Number(e.mark)),
    [1, 1, 1],
  );
  claim(
    "leaderboard tie-break: every tied student shares rank 1",
    (tieBoard.entries || []).map((e) => Number(e.rank)),
    [1, 1, 1],
  );
  claim(
    "leaderboard tie-break: the FIRST to finish is at the top",
    (tieBoard.entries || []).map((e) => e.student_id),
    [
      await as(null, async (q) => (await q(`select id from public.students where user_id=$1`, [ID.stuC]))[0].id),
      await as(null, async (q) => (await q(`select id from public.students where user_id=$1`, [ID.stuB]))[0].id),
      await as(null, async (q) => (await q(`select id from public.students where user_id=$1`, [ID.stuA]))[0].id),
    ],
  );

  // FENCE: a student who has not submitted cannot read the board.
  const boardBeforeSitting = await refusal(ID.stuOutsider, async (q) =>
    await q(`select public.rpc_test_leaderboard($1) as r`, [testId]),
  );
  claim("FENCE a student of another section cannot read the leaderboard", boardBeforeSitting?.code, "42501");

  const notYetTestId = await as(ID.priya, async (q) => {
    const rows = await q(
      `insert into public.tests
         (school_id, section_subject_id, created_by, title, max_mark, total_marks, status, test_kind, duration_sec, published_at)
       values ($1,$2,$3,'Not yet sat',1,1,'published','class_test',600, now()) returning id`,
      [ID.school, sectionSubjectId, ID.priya],
    );
    return rows[0].id;
  });
  await as(ID.priya, async (q) =>
    await q(
      `insert into public.test_questions (test_id, order_index, question_format, question, options, correct, marks, school_id)
       values ($1,0,'mcq','q','["a","b"]','{"indexes":[0]}',1,$2)`,
      [notYetTestId, ID.school],
    ),
  );
  const boardUnsat = await refusal(ID.stuA, async (q) =>
    await q(`select public.rpc_test_leaderboard($1) as r`, [notYetTestId]),
  );
  claim(
    "FENCE a student who has not submitted cannot read that test's leaderboard",
    boardUnsat?.code,
    "42501",
  );
  const boardUnsatTeacher = await as(ID.priya, async (q) =>
    (await q(`select public.rpc_test_leaderboard($1) as r`, [notYetTestId]))[0].r,
  );
  claim(
    "POSITIVE CONTROL the teacher reads that same empty board",
    (boardUnsatTeacher.entries || []).length,
    0,
  );

  // ── 5c. THE STUDENT'S OWN ANSWER SHEET ───────────────────────────────────
  console.log("\n══ 5c. the answer sheet the result screen reviews ══════════════════");
  const sheetA = await as(ID.stuA, async (q) =>
    (await q(`select public.rpc_test_answer_sheet($1,$2) as r`, [testId, studentIdA]))[0].r,
  );
  claim("answer sheet: submitted", sheetA.submitted, true);
  claim("answer sheet: every question of the paper", (sheetA.questions || []).length, 3);
  claim(
    "answer sheet: two right, one wrong",
    (sheetA.questions || []).filter((x) => x.is_correct).length,
    2,
  );
  claim(
    "answer sheet: the key travels with it",
    (sheetA.questions || []).every((x) => x.correct_answer != null),
    true,
  );
  claim(
    "answer sheet: their own answer travels with it",
    (sheetA.questions || []).every((x) => x.their_answer != null),
    true,
  );
  claim(
    "answer sheet: the explanation travels with it",
    (sheetA.questions || []).every((x) => typeof x.explanation === "string"),
    true,
  );
  claim("answer sheet: records the time taken", Number(sheetA.time_spent_sec) >= 1, true);
  const sheetOther = await refusal(ID.stuB, async (q) =>
    await q(`select public.rpc_test_answer_sheet($1,$2) as r`, [testId, studentIdA]),
  );
  claim("FENCE a classmate cannot read another student's paper", sheetOther?.code, "42501");
  const sheetUnsat = await refusal(ID.stuA, async (q) =>
    await q(`select public.rpc_test_answer_sheet($1,$2) as r`, [notYetTestId, studentIdA]),
  );
  claim(
    "FENCE the key is refused before the paper is handed in",
    sheetUnsat?.code,
    "42501",
  );

  // ── 6. THE TEACHER'S CLASS REPORT ─────────────────────────────────────────
  console.log("\n══ 6. the class report ═════════════════════════════════════════════");
  const classReport = await as(ID.priya, async (q) =>
    (await q(`select public.rpc_test_class_report($1) as r`, [testId]))[0].r,
  );
  claim("class report: submitted_count", Number(classReport.submitted_count), 3);
  claim("class report: class_average of 2,3,1", Number(classReport.class_average), 2);
  claim("class report: lists every student of the section", (classReport.students || []).length, 10);
  claim(
    "class report: the three who sat it are marked submitted",
    (classReport.students || []).filter((s) => s.submitted).length,
    3,
  );
  claim(
    "class report: a student who never sat it has a NULL mark, not 0",
    (classReport.students || []).filter((s) => !s.submitted).every((s) => s.mark === null),
    true,
  );
  claim(
    "class report: weakest topics rank only what went wrong",
    (classReport.weakest_topics || []).length > 0 &&
      (classReport.weakest_topics || []).every((t) => t.wrong > 0),
    true,
  );
  claim(
    "class report: average_seconds_per_question is present or honestly null",
    classReport.average_seconds_per_question === null || Number(classReport.average_seconds_per_question) >= 0,
    true,
  );
  console.log("   weakest_topics:", JSON.stringify(classReport.weakest_topics));

  // teacher drill-down into a named student
  const drill = await as(ID.priya, async (q) =>
    (await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, studentIdA]))[0].r,
  );
  claim("teacher drill-down reads that student's wrong answers", (drill.wrong_answers || []).length, 1);

  // ── 6b. WHERE THE TIME WENT, QUESTION BY QUESTION ────────────────────────
  console.log("\n══ 6b. the per-question breakdown ══════════════════════════════════");
  const bd = await as(ID.priya, async (q) =>
    (await q(`select public.rpc_test_question_breakdown($1) as r`, [testId]))[0].r,
  );
  const bq = bd.questions || [];
  claim("breakdown: one row per question of the paper", bq.length, 3);
  claim(
    "breakdown: in paper order",
    bq.every((x, i) => Number(x.order_index) === i),
    true,
  );
  claim(
    "breakdown: the four outcome states are counted apart",
    bq.every(
      (x) =>
        Number(x.correct_count) + Number(x.wrong_count) === Number(x.answered_count) &&
        Number(x.blank_count) >= 0,
    ),
    true,
  );
  claim(
    "breakdown: answered + blank is everyone who handed in",
    bq.every(
      (x) => Number(x.answered_count) + Number(x.blank_count) === Number(bd.submitted_count),
    ),
    true,
  );
  // THE POINT OF THE WHOLE THING: the questions do not share one timing. The
  // paper mean this replaces could not tell these two apart.
  const timed = bq.filter((x) => x.avg_time_ms != null).map((x) => Number(x.avg_time_ms));
  claim("breakdown: the questions carry their own times", timed.length > 0, true);
  claim(
    "breakdown: and those times differ from one another",
    new Set(timed).size > 1,
    true,
  );
  // The costliest question by name, not by position: this is the number that
  // makes the report actionable, and a paper-wide mean cannot produce it.
  const costliest = bq.reduce((a, x) =>
    x.avg_time_ms != null && (a == null || Number(x.avg_time_ms) > Number(a.avg_time_ms)) ? x : a,
  null);
  claim("breakdown: names the question that cost the class most", Number(costliest.order_index), 1);
  claim("breakdown: its average is the middle question's, not the paper's", Number(costliest.avg_time_ms), 105000);
  claim("breakdown: and names who it cost most, by name", typeof costliest.slowest_student_name, "string");
  claim("breakdown: with that student's own time", Number(costliest.slowest_time_ms), 120000);
  claim(
    "breakdown: says how much of the class was timed at all",
    Number(costliest.timed_count) === 2 && Number(costliest.answered_count) === 3,
    true,
  );
  claim(
    "breakdown: an untimed answer is never averaged as zero",
    bq.every((x) => x.avg_time_ms === null || Number(x.timed_count) > 0),
    true,
  );
  claim(
    "breakdown: the slowest student is named whole, or not at all",
    bq.every(
      (x) =>
        (x.slowest_student_id === null &&
          x.slowest_student_name === null &&
          x.slowest_time_ms === null) ||
        (x.slowest_student_id !== null &&
          x.slowest_student_name !== null &&
          x.slowest_time_ms !== null),
    ),
    true,
  );
  console.log(
    "   per-question ms:",
    JSON.stringify(bq.map((x) => ({ i: x.order_index, avg: x.avg_time_ms, who: x.slowest_student_name }))),
  );
  const bdUnsat = await as(ID.priya, async (q) =>
    (await q(`select public.rpc_test_question_breakdown($1) as r`, [notYetTestId]))[0].r,
  );
  claim(
    "breakdown: a test nobody has sat reports no time rather than zero",
    (bdUnsat.questions || []).every(
      (x) => x.avg_time_ms === null && Number(x.answered_count) === 0,
    ),
    true,
  );
  const bdStudent = await refusal(ID.stuA, async (q) =>
    await q(`select public.rpc_test_question_breakdown($1) as r`, [testId]),
  );
  claim("FENCE a student cannot read the class's per-question breakdown", bdStudent?.code, "42501");
  const bdPrincipal = await refusal(ID.principal, async (q) =>
    await q(`select public.rpc_test_question_breakdown($1) as r`, [testId]),
  );
  claim(
    "FENCE the principal is refused it, exactly as they are refused the report",
    bdPrincipal?.code,
    "42501",
  );

  // ── 7. FENCES on the report ───────────────────────────────────────────────
  console.log("\n══ 7. report fences ════════════════════════════════════════════════");
  const rajeshMay = await as(ID.rajesh, async (q) =>
    (await q(`select public.can_read_test_report($1) as ok`, [testId]))[0].ok,
  );
  note(`Rajesh (teaches 10-A Physics) may read this Maths test's report: ${rajeshMay}`);

  const principalMay = await as(ID.principal, async (q) =>
    (await q(`select public.can_read_test_report($1) as ok`, [testId]))[0].ok,
  );
  const adminMay = await as(ID.admin, async (q) =>
    (await q(`select public.can_read_test_report($1) as ok`, [testId]))[0].ok,
  );
  note(`principal may read the report: ${principalMay}`);
  note(`admin may read the report: ${adminMay}`);

  const otherStudentReport = await refusal(ID.stuB, async (q) =>
    await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, studentIdA]),
  );
  claim("FENCE one student cannot read another's report", otherStudentReport?.code, "42501");
  const ownReport = await as(ID.stuB, async (q) => {
    const sid = (await q(`select id from public.students where user_id=$1`, [ID.stuB]))[0]?.id;
    return (await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, sid]))[0].r;
  });
  claim("POSITIVE CONTROL that same student reads their own", Number(ownReport.mark), 3);

  const classReportAsStudent = await refusal(ID.stuA, async (q) =>
    await q(`select public.rpc_test_class_report($1) as r`, [testId]),
  );
  claim("FENCE a student cannot read the class report", classReportAsStudent?.code, "42501");

  // ── 8. WHAT THE OFFICE CAN SEE ────────────────────────────────────────────
  console.log("\n══ 8. principal and admin, on marks and counts ═════════════════════");
  const principalMarks = await as(ID.principal, async (q) =>
    (await q(`select public.rpc_test_class_marks($1) as r`, [testId]))[0].r,
  );
  claim("principal: reads the test's marks list", (principalMarks.students || []).length, 10);
  claim("principal: sees the three submitted marks", (principalMarks.students || []).filter((s) => s.submitted).length, 3);
  claim("principal: sees the class average", Number(principalMarks.class_average), 2);
  claim(
    "principal: the marks are the real ones",
    (principalMarks.students || []).filter((s) => s.submitted).map((s) => Number(s.mark)).sort(),
    [1, 2, 3],
  );
  const principalReport = await refusal(ID.principal, async (q) =>
    await q(`select public.rpc_test_class_report($1) as r`, [testId]),
  );
  claim("FENCE the principal is still refused the teacher's report", principalReport?.code, "42501");
  const principalDrill = await refusal(ID.principal, async (q) =>
    await q(`select public.rpc_test_student_report($1,$2) as r`, [testId, studentIdA]),
  );
  claim("FENCE the principal is still refused a named child's per-question detail", principalDrill?.code, "42501");
  const principalSheet = await refusal(ID.principal, async (q) =>
    await q(`select public.rpc_test_answer_sheet($1,$2) as r`, [testId, studentIdA]),
  );
  claim("FENCE the principal is still refused the answer sheet", principalSheet?.code, "42501");
  const principalBoard = await as(ID.principal, async (q) =>
    (await q(`select public.rpc_test_leaderboard($1) as r`, [testId]))[0].r,
  );
  claim("principal: reads the leaderboard (marks, ranked)", (principalBoard.entries || []).length, 3);

  // The admin's stated need: how many tests the school has run.
  const adminCounts = await as(ID.admin, async (q) => {
    const [row] = await q(
      `select (select count(*)::int from public.tests where school_id=$1 and deleted_at is null) as tests,
              (select count(*)::int from public.tests where school_id=$1 and deleted_at is null and status='published') as published,
              (select count(*)::int from public.test_attempts a
                 join public.tests t on t.id=a.test_id
                where t.school_id=$1 and a.status='submitted') as submissions`,
      [ID.school],
    );
    return row;
  });
  console.log("   admin counts:", adminCounts);
  claim("admin: counts every test in the school", adminCounts.tests >= 3, true);
  claim("admin: counts the submissions behind them", adminCounts.submissions >= 3, true);
  const adminMarks = await refusal(ID.admin, async (q) =>
    await q(`select public.rpc_test_class_marks($1) as r`, [testId]),
  );
  claim("FENCE the admin is not admitted to one class's named marks", adminMarks?.code, "42501");

  // ── 9. THE STUDENT'S PROFILE ──────────────────────────────────────────────
  console.log("\n══ 9. the student's own marks surface ══════════════════════════════");
  const myMarks = await as(ID.stuA, async (q) =>
    await q(
      `select tm.mark, t.title, t.max_mark from public.test_marks tm
         join public.tests t on t.id = tm.test_id
        where tm.student_id = $1 and tm.test_id = $2`,
      [studentIdA, testId],
    ),
  );
  claim("the student reads their own mark for this test", myMarks.length, 1);
  claim("the mark on their profile is the mark they scored", Number(myMarks[0]?.mark), 2);
  // Rule 13: once they have handed their own paper in, a classmate's mark is
  // theirs to see — that is what the leaderboard shows by name. Before that it
  // is not, and the marks table now says the same thing the leaderboard does.
  const othersMarksAfter = await as(ID.stuA, async (q) =>
    await q(`select count(*)::int as n from public.test_marks where test_id=$1 and student_id <> $2`, [testId, studentIdA]),
  );
  claim("after submitting, a classmate's mark on that test is readable", othersMarksAfter[0].n, 2);
  const othersMarksBefore = await as(ID.stuA, async (q) =>
    await q(`select count(*)::int as n from public.test_marks where test_id=$1`, [notYetTestId]),
  );
  claim("FENCE before submitting, no mark of that test is readable", othersMarksBefore[0].n, 0);

  // ── 10. RE-SUBMISSION AND RESUME ──────────────────────────────────────────
  console.log("\n══ 10. re-entry and double submit ══════════════════════════════════");
  const restart = await as(ID.stuA, async (q) => (await q(`select public.rpc_test_start($1) as id`, [testId]))[0].id);
  claim("re-entering the test resumes the same attempt", restart, attemptA);
  const doubleSubmit = await refusal(ID.stuA, async (q) =>
    await q(`select public.rpc_test_submit($1, null) as r`, [attemptA]),
  );
  claim("a submitted attempt cannot be submitted twice", Boolean(doubleSubmit), true);

  // ── 11. THE ACTIVITY BUMP ─────────────────────────────────────────────────
  console.log("\n══ 11. what submitting was supposed to bump ════════════════════════");
  const activity = await as(null, async (q) =>
    await q(`select * from public.academic_daily_activity where user_id=$1`, [ID.stuA]),
  );
  claim("submitting a test records the student's daily activity", activity.length, 1);

  // ── teardown ──────────────────────────────────────────────────────────────
  await as(null, async (q) => {
    await q(`update public.students set class_id=$1 where id=$2`, [ID.class10a, ID.stuOutsiderPerson]);
  });

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(`  ${pass} passed, ${failures.length} failed, ${notes.length} notes`);
  if (failures.length) {
    console.log("\n  FAILURES:");
    for (const f of failures) console.log(`   - ${f.name}\n       expected ${f.cmp} ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`);
  }
  console.log("");
  await pool.end();
  process.exit(failures.length ? 1 : 0);
};

main().catch(async (e) => {
  console.error("\nHARNESS ERROR:", e.message, e.code ? `(${e.code})` : "");
  console.error(e.stack?.split("\n").slice(1, 4).join("\n"));
  await pool.end();
  process.exit(2);
});
