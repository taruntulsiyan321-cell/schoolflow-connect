// Generate DPP MCQs — OpenRouter (Qwen).
import { corsHeaders, generateStructuredWithFallback, jsonResponse } from "../_shared/structuredCompletion.ts";
import { requireAnyRole, getCallerSchoolId } from "../_shared/requireRole.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Block SSRF via user-supplied source_url (private / link-local / metadata hosts). */
function isSafePublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  // IPv4 literals
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return false;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }

  // IPv6 / IPv4-mapped basics
  if (host === "::1" || host === "[::1]" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return false;
  }

  return true;
}

/**
 * The caller's school, for a caller who may be a student.
 *
 * `getCallerSchoolId` reads `profiles.school_id` and nothing else, and that
 * column is NULL on 44 of 64 accounts — including **40 of the 52 student
 * accounts**, measured 2026-09-07. Widening the role gate without this would
 * have swapped one 403 for another: `insufficient_role` becomes
 * `No school context for caller` for three students in four, which is the same
 * feature still not working with a new message.
 *
 * The order is the one the app itself uses (`useAcademicContext`: "Prefer
 * portal-bound school (students.school_id) over profile fallback — never invent
 * a tenant"), inverted only in that `profiles` is tried first here to keep every
 * existing staff caller resolving byte-for-byte as before:
 *
 *   1. profiles.school_id      — what every staff caller has today
 *   2. students.school_id      — authoritative for a student; it is the row the
 *                                student portal is bound to
 *   3. memberships.school_id   — the active membership, for an account with
 *                                neither of the above
 *
 * NOTHING IS INVENTED. If all three are silent the caller is refused, exactly
 * as before. A guessed tenant here would bill the wrong school and hand a
 * student another school's board.
 *
 * Kept local rather than pushed into `_shared/requireRole.ts` deliberately:
 * that module is snapshotted into all 18 deployed functions, and changing it
 * would report drift against every one of them for a fix that only this
 * function needs.
 */
async function resolveSchoolId(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const fromProfile = await getCallerSchoolId(userId);
  if (fromProfile) return fromProfile;

  const { data: student } = await admin
    .from("students")
    .select("school_id")
    .eq("user_id", userId)
    .not("school_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (student?.school_id) return student.school_id as string;

  const { data: membership } = await admin
    .from("memberships")
    .select("school_id")
    .eq("account_id", userId)
    .eq("status", "active")
    .not("school_id", "is", null)
    .limit(1)
    .maybeSingle();
  return (membership?.school_id as string | undefined) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // `student` is in this list as of KNOWN_ISSUES 2, which ruled that students
  // should reach generation: `aiPracticeQuestions.ts` is called from
  // Class12AiSession and mistakeRecovery, both live student routes, and both
  // were being refused by a gate that named only staff.
  const __auth = await requireAnyRole(req, ["teacher", "admin", "principal", "student"]);
  if (!__auth.ok) return __auth.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const schoolId = await resolveSchoolId(admin, __auth.value.user.id);
  if (!schoolId) {
    return jsonResponse({ error: "No school context for caller" }, 403);
  }

  // A STUDENT'S GENERATION IS BILLED SEPARATELY, and this is the whole reason
  // the matched roles are read rather than ignored. Staff keep
  // `teacher.dpp.generate_questions` byte for byte, so existing per-feature
  // quotas and every `ai_budget_usage` row already written keep meaning what
  // they meant. A student-triggered run gets its own feature_id so a school can
  // cap the two independently and tell them apart afterwards -- without it, a
  // class of students exhausting the day's units would read as the teachers
  // having done it.
  const isStaff = __auth.value.roles.some((r) => r !== "student");
  const featureId = isStaff
    ? "teacher.dpp.generate_questions"
    : "student.dpp.generate_questions";

  // Named, and used at BOTH ends. The reservation and the release have to move
  // together or a refund silently returns the wrong amount; a literal at each
  // site is how that drift starts.
  const RESERVED_UNITS = 2;

  const { data: budgetRow, error: budgetErr } = await admin.rpc("ai_budget_check_and_reserve", {
    p_school_id: schoolId,
    p_feature_id: featureId,
    p_units: RESERVED_UNITS,
  });
  // A budget that could not be READ is not a budget that was EXCEEDED. These
  // were one branch returning one 429, which told a teacher to wait until
  // tomorrow when the reservation RPC itself had failed — a wrong reason is its
  // own kind of silent failure. `error_code` is carried so the client can tell
  // the two apart without parsing prose.
  if (budgetErr) {
    return jsonResponse(
      { error: "Could not check this school's AI budget", error_code: "budget_check_failed" },
      503,
    );
  }
  if (!budgetRow || (budgetRow as { ok?: boolean }).ok === false) {
    const b = (budgetRow ?? {}) as { units_used?: number; hard_limit?: number; error_code?: string };
    return jsonResponse(
      {
        error: "Daily AI generation budget for this school has been reached",
        error_code: b.error_code ?? "budget_exhausted",
        units_used: b.units_used ?? null,
        hard_limit: b.hard_limit ?? null,
      },
      429,
    );
  }

  // ── THE RESERVATION IS NOW HELD. Everything below must give it back ──────
  //
  // KNOWN_ISSUES 14: the units are taken BEFORE the provider is called, which
  // is what makes the admission check race-free, and nothing ever returned
  // them. A provider outage, a malformed body, a thrown exception -- each one
  // charged the school 2 units for nothing, and a morning of provider trouble
  // could burn a whole day's allowance without producing one question.
  //
  // `refund` is idempotent through `held` so no path can double-release, and it
  // swallows its own failure on purpose: a release that fails must not turn a
  // 400 into a 500 and hide the real reason from the caller. It is logged
  // instead, because a silently failing refund is the defect coming back.
  let held = true;
  const refund = async (why: string): Promise<void> => {
    if (!held) return;
    held = false;
    const { error } = await admin.rpc("ai_budget_release", {
      p_school_id: schoolId,
      p_feature_id: featureId,
      p_units: RESERVED_UNITS,
    });
    if (error) {
      console.error(
        `[dpp-generate-questions] budget release failed after ${why}: ${error.message}`,
      );
    }
  };

  try {
    const body = await req.json();
    const {
      topic = "",
      subject = "",
      chapter = "",
      difficulty = "medium",
      count = 5,
      source_text = "",
      source_url = "",
      // ADDITIVE ONLY. The flat {subject, chapter, topic, difficulty, count}
      // contract is unchanged and every existing caller keeps working: omitting
      // question_format yields the original MCQ behaviour byte-for-byte, and
      // omitting class_level means no class is asserted rather than a wrong one.
      question_format = "mcq",
      class_level = null,
    } = body ?? {};

    const n = Math.max(1, Math.min(20, Number(count) || 5));

    const format = String(question_format).toLowerCase();
    if (format !== "mcq" && format !== "short" && format !== "long") {
      await refund("an unusable question_format");
      return jsonResponse({ error: "question_format must be mcq, short or long" }, 400);
    }

    // THE BOARD IS THE SCHOOL'S, NOT A LITERAL. The prompt used to hardcode
    // "CBSE Class 12" for every request; the bank is RBSE across 8 class levels
    // (6-12), so the generator was being asked for the wrong board and the wrong
    // class on nearly every call. This is a correctness bug independent of the
    // non-MCQ work and is fixed here because the same prompt string carries both.
    const { data: schoolRow } = await admin
      .from("schools").select("board").eq("id", schoolId).maybeSingle();
    const boardCode = (schoolRow as { board?: string } | null)?.board ?? null;
    const boardLabel = boardCode === "rbse"
      ? "RBSE (Rajasthan Board)"
      : boardCode === "cbse"
      ? "CBSE"
      : null;

    // An unknown class or board is stated as unknown, never guessed. A wrong
    // "Class 12" is worse than no class: it silently produces off-syllabus
    // questions that look right.
    const lvl = Number(class_level);
    const classPhrase = Number.isFinite(lvl) && lvl >= 6 && lvl <= 12
      ? `Class ${lvl}`
      : "the class level indicated by the subject and source material";
    const boardPhrase = boardLabel ?? "the school's own board";

    let fetchedText = "";
    if (source_url && isSafePublicHttpUrl(String(source_url))) {
      try {
        const res = await fetch(String(source_url), {
          headers: { "User-Agent": "Mozilla/5.0 (SchoolFlow DPP Bot)" },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (res.ok) {
          const html = await res.text();
          fetchedText = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 8000);
        }
      } catch {
        /* ignore fetch errors */
      }
    } else if (source_url) {
      await refund("a rejected source_url");
      return jsonResponse({ error: "source_url is not allowed" }, 400);
    }

    const combined_source = [source_text, fetchedText].filter(Boolean).join("\n\n").slice(0, 9000);

    if (!topic && !combined_source) {
      await refund("no topic, URL or source text");
      return jsonResponse({ error: "Provide a topic, URL, or source text" }, 400);
    }

    const common =
      `You are an expert ${boardPhrase} ${classPhrase} question setter for Indian schools (NCERT-aligned). ` +
      "Never repeat the same question stem or pattern. Vary numbers, scenarios, and wording. " +
      "If reference material lists student mistakes, generate remedial questions that test the same underlying skills with new numbers and wording — never copy listed mistake questions verbatim. " +
      "If the student made recent mistakes, target those weak concepts first with remedial questions. ";

    const system = format === "mcq"
      ? common +
        "GENERATE fresh MCQs — each question must test a DIFFERENT sub-concept or skill. " +
        "Exactly 4 options per question, one unambiguously correct answer, clear step-by-step explanation."
      : format === "short"
      ? common +
        "GENERATE fresh SHORT-ANSWER questions — each must test a DIFFERENT sub-concept or skill. " +
        "Each answer is 2–3 sentences or a worked numerical result: the complete expected answer, not a hint. " +
        "Do NOT produce options; this is not a multiple-choice paper."
      : common +
        "GENERATE fresh LONG-ANSWER questions — each must test a DIFFERENT sub-concept or skill. " +
        "Each answer is a full model answer a teacher could mark against: the argument or derivation in steps, stated completely. " +
        "Do NOT produce options; this is not a multiple-choice paper.";

    const user = [
      `Subject: ${subject || "(infer from source)"}`,
      chapter ? `Chapter: ${chapter}` : "",
      `Topic: ${topic || "(derive from source)"}`,
      `Difficulty: ${difficulty}`,
      `Count: up to ${n} questions`,
      source_url ? `Source URL: ${source_url}` : "",
      combined_source
        ? `\nReference material:\n${combined_source}`
        : "",
    ].filter(Boolean).join("\n");

    // The MCQ branch is the original schema, unchanged. The non-MCQ branch
    // carries `answer` instead of options/correct_index — §4.2a's "the correct
    // answer must be generated with the question" applies to every format, not
    // just the one that could encode it as an index.
    const schema = format === "mcq"
      ? {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_index: { type: "integer" },
                  explanation: { type: "string" },
                },
                required: ["question", "options", "correct_index", "explanation"],
              },
            },
          },
          required: ["questions"],
        }
      : {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  answer: { type: "string" },
                  explanation: { type: "string" },
                },
                required: ["question", "answer", "explanation"],
              },
            },
          },
          required: ["questions"],
        };

    // ~180 tokens per MCQ (question + 4 options + explanation) is a safe
    // working estimate; the default 1200-token cap only covers ~5 questions
    // and silently truncated/broke JSON parsing for larger batches. A long
    // answer is the whole model answer, so it needs materially more room —
    // budgeting MCQ-sized tokens for it is what truncation looks like.
    const perQuestionTokens = format === "long" ? 700 : format === "short" ? 300 : 180;
    const result = await generateStructuredWithFallback<{ questions: Array<{
      question: string;
      options?: string[];
      correct_index?: number;
      answer?: string;
      explanation: string;
    }> }>(
      { system, user, schema, toolName: "emit_questions" },
      { max_tokens: Math.min(8000, Math.max(1200, n * perQuestionTokens)) },
    );

    // The provider path itself failed -- down, rate limited, or unparseable.
    // This is the case the entry named and the one that actually burns budget.
    if (!result.ok) {
      await refund("the provider returned no usable result");
      return jsonResponse({ error: result.error }, result.status);
    }

    // Each question is stamped with the format that produced it so a caller
    // never has to infer it from which keys happen to be present.
    // `topic` is deliberately absent: rule 31 — generated questions carry
    // chapter and leave topic NULL, never a guessed topic string.
    const questions = (result.data.questions ?? []).slice(0, n)
      .map((q) => ({ ...q, question_format: format }));
    return jsonResponse({
      questions,
      source: result.source,
      question_format: format,
      board: boardCode,
      class_level: Number.isFinite(lvl) && lvl >= 6 && lvl <= 12 ? lvl : null,
    });
  } catch (err) {
    await refund("an unhandled error");
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
