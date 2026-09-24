/**
 * §4 classifier + §6 answer-key extraction.
 *
 * Refusal is the feature (§4.1). Below CONFIDENCE_THRESHOLD → unusable.
 * Fewer than MIN_USABLE_QUESTIONS and no notes → unusable (§4.4).
 * Never invent questions from timetables / receipts / blank / chat / prose.
 *
 * §13: threshold picked at 0.55 to match IMAGE_DOUBT_CONFIDENCE_THRESHOLD;
 * tune against the §4.5 battery and record the measurement in the spec.
 *
 * Pure gates live in ./refusalGates.ts (Deno-free). Re-exported here for
 * edge callers that already import classify.
 */
import {
  completeWithQwen,
  getConfiguredModelId,
  isOpenRouterConfigured,
} from "../_shared/modelRouter.ts";
import { applyRefusalGates } from "./refusalGates.ts";
import type {
  AnswerSource,
  ClassifierResult,
  ExtractedNote,
  ExtractedQuestion,
  MediaPayload,
  UploadVerdict,
} from "./types.ts";

export {
  applyRefusalGates,
  CONFIDENCE_THRESHOLD,
  MIN_USABLE_QUESTIONS,
} from "./refusalGates.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM = [
  "You classify a student's uploaded study file for Custom Practice.",
  "Return ONLY one JSON object. No markdown fences. No commentary.",
  "",
  "Verdicts (exactly one):",
  '- "questions" — the file holds exam/practice questions (MCQ or short answer)',
  '- "notes" — study material / notes, not questions',
  '- "mixed" — both questions and notes',
  '- "unusable" — neither, unreadable, or not study content',
  "",
  "REFUSAL RULES (critical — inventing questions is forbidden):",
  "Mark unusable with confidence and a one-line refusal_reason for:",
  "timetables/schedules, receipts/bills, blank/nearly blank pages,",
  "blurry or dark unreadable photos, chat/messaging screenshots,",
  "ordinary prose with no questions or study notes, logos/memes,",
  "or anything you are not confident is question/notes material.",
  "When in doubt, choose unusable. Do NOT invent questions.",
  "",
  "For questions that ARE present:",
  "- Copy question_text and options from the file; do not invent stems or options.",
  "- If the file shows the correct answer/key, set answer_source to \"file\" and fill",
  "  correct_index (0-based for MCQ) and/or correct_answer.",
  "- If the file has no key, SOLVE it and set answer_source to \"ai\", filling",
  "  correct_index/correct_answer and a short explanation (§6).",
  "- difficulty: easy | medium | hard when you can tell; else null.",
  "",
  "For notes: organise topic-wise titles with readable body text from the file only.",
  "confidence: 0..1 how sure you are of the verdict.",
].join("\n");

const RESULT_SHAPE = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["questions", "notes", "mixed", "unusable"] },
    confidence: { type: "number" },
    refusal_reason: { type: ["string", "null"] },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_text: { type: "string" },
          options: { type: ["array", "null"], items: { type: "string" } },
          correct_index: { type: ["integer", "null"] },
          correct_answer: { type: ["string", "null"] },
          answer_source: { type: "string", enum: ["file", "ai"] },
          explanation: { type: ["string", "null"] },
          difficulty: { type: ["string", "null"] },
        },
        required: ["question_text", "answer_source"],
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
  required: ["verdict", "confidence", "questions", "notes"],
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON object");
  return JSON.parse(raw.slice(start, end + 1));
}

function asVerdict(v: unknown): UploadVerdict | null {
  return v === "questions" || v === "notes" || v === "mixed" || v === "unusable" ? v : null;
}

function asAnswerSource(v: unknown): AnswerSource {
  return v === "file" ? "file" : "ai";
}

function normalizeQuestion(raw: unknown): ExtractedQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const question_text = typeof r.question_text === "string" ? r.question_text.trim() : "";
  if (question_text.length < 8) return null;

  const options = Array.isArray(r.options)
    ? r.options
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, 8)
    : null;
  const opts = options && options.length >= 2 ? options : null;

  let correct_index =
    typeof r.correct_index === "number" && Number.isFinite(r.correct_index)
      ? Math.trunc(r.correct_index)
      : null;
  if (correct_index != null && (correct_index < 0 || (opts && correct_index >= opts.length))) {
    correct_index = null;
  }

  let correct_answer =
    typeof r.correct_answer === "string" && r.correct_answer.trim()
      ? r.correct_answer.trim().slice(0, 500)
      : null;

  // Derive answer text from MCQ index when needed for the DB CHECK.
  if (!correct_answer && opts && correct_index != null && opts[correct_index]) {
    correct_answer = opts[correct_index];
  }

  // DB CHECK: (options + correct_index) OR non-empty correct_answer.
  if (opts && correct_index == null && !correct_answer) return null;
  if (!opts && !correct_answer) return null;

  let answer_source = asAnswerSource(r.answer_source);
  // If the model claimed "file" but we had to treat the answer as AI-filled
  // with no options/index from a key, keep the declared source; when the model
  // solves without a file key it must say "ai". If it said "file" without any
  // key fields originally, force "ai" when only a free-text answer exists and
  // options were invented-looking — prefer honesty: no options from file +
  // answer present → ai unless correct_index was set.
  if (answer_source === "file" && opts == null && correct_index == null) {
    // Short-answer key transcribed from file is still "file".
    answer_source = "file";
  }

  const difficulty =
    typeof r.difficulty === "string" && /^(easy|medium|hard)$/i.test(r.difficulty.trim())
      ? r.difficulty.trim().toLowerCase()
      : null;

  const explanation =
    typeof r.explanation === "string" && r.explanation.trim()
      ? r.explanation.trim().slice(0, 2000)
      : null;

  return {
    question_text: question_text.slice(0, 4000),
    options: opts,
    correct_index: opts ? correct_index : null,
    correct_answer,
    answer_source,
    explanation,
    difficulty,
  };
}

function normalizeNote(raw: unknown): ExtractedNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!title || body.length < 20) return null;
  return { title: title.slice(0, 200), body: body.slice(0, 12_000) };
}

function parseClassifierText(text: string): ClassifierResult {
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  const verdict = asVerdict(parsed.verdict) ?? "unusable";
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0;
  const refusal_reason =
    typeof parsed.refusal_reason === "string" && parsed.refusal_reason.trim()
      ? parsed.refusal_reason.trim().slice(0, 500)
      : null;

  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.map(normalizeQuestion).filter((q): q is ExtractedQuestion => q != null)
    : [];
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.map(normalizeNote).filter((n): n is ExtractedNote => n != null)
    : [];

  return applyRefusalGates({
    verdict,
    confidence,
    refusal_reason,
    questions,
    notes,
  });
}

function userPromptForMedia(media: MediaPayload): string {
  const schemaHint = `Respond with ONLY JSON matching: ${JSON.stringify(RESULT_SHAPE)}`;
  if (media.kind === "text") {
    return [
      "Classify the following extracted PDF text. Do not invent questions absent from it.",
      schemaHint,
      "",
      "--- BEGIN FILE TEXT ---",
      media.text,
      "--- END FILE TEXT ---",
    ].join("\n");
  }
  if (media.kind === "images") {
    return [
      "Classify the attached image(s) of a student's upload.",
      "Refuse timetables, receipts, blank/blurry pages, chat screenshots, and ordinary prose.",
      schemaHint,
    ].join("\n");
  }
  return [
    "Classify the attached PDF upload (may be a scan).",
    "Refuse timetables, receipts, blank/blurry pages, chat screenshots, and ordinary prose.",
    "Do not invent questions.",
    schemaHint,
  ].join("\n");
}

/**
 * OpenRouter call that can attach a PDF file (scanned papers with no extractable text).
 * Text + image paths reuse completeWithQwen.
 */
async function completeWithPdfFile(input: {
  system: string;
  user: string;
  pdfDataUri: string;
  filename?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return { ok: false, error: "OPENROUTER_API_KEY not configured — generative path degraded" };
  }

  const model = getConfiguredModelId();
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL") ?? "https://gurukul.app",
      "X-Title": Deno.env.get("OPENROUTER_APP_NAME") ?? "Gurukul",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: [
            { type: "text", text: input.user },
            {
              type: "file",
              file: {
                filename: input.filename ?? "upload.pdf",
                file_data: input.pdfDataUri,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `OpenRouter PDF classify failed (${res.status}): ${body.slice(0, 400)}`,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (!text.trim()) return { ok: false, error: "Model returned empty classification" };
  return { ok: true, text };
}

export type ClassifyOutcome =
  | { ok: true; result: ClassifierResult }
  | { ok: false; error: string; status: "failed" };

export async function classifyUploadMedia(media: MediaPayload): Promise<ClassifyOutcome> {
  if (!isOpenRouterConfigured()) {
    return {
      ok: false,
      error:
        "OPENROUTER_API_KEY is not configured. Your file is saved; classification cannot run until the key is set.",
      status: "failed",
    };
  }

  const user = userPromptForMedia(media);
  let modelText: string;

  if (media.kind === "pdf_bytes") {
    const pdfResult = await completeWithPdfFile({
      system: SYSTEM,
      user,
      pdfDataUri: media.dataUri,
    });
    if (!pdfResult.ok) {
      return { ok: false, error: pdfResult.error, status: "failed" };
    }
    modelText = pdfResult.text;
  } else {
    const images = media.kind === "images" ? media.images.slice(0, 3) : undefined;
    const result = await completeWithQwen({
      system: SYSTEM,
      user,
      images,
      temperature: 0.1,
      max_tokens: 4000,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, status: "failed" };
    }
    modelText = result.text;
  }

  try {
    return { ok: true, result: parseClassifierText(modelText) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse failure";
    return {
      ok: false,
      error: `Classifier response could not be parsed (${msg}). No questions were invented.`,
      status: "failed",
    };
  }
}
r: `Classifier response could not be parsed (${msg}). No questions were invented.`,
      status: "failed",
    };
  }
}
