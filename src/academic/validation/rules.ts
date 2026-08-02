import type { ValidationResult } from "../types";

/**
 * Centralized academic validation (pure functions).
 * Services call these before writes — do not scatter checks in UI.
 */

export function validateMarks(marksObtained: number, maxMarks: number | null | undefined): ValidationResult {
  if (!Number.isFinite(marksObtained)) {
    return { ok: false, issues: [{ field: "marksObtained", code: "invalid", message: "Marks must be a number" }] };
  }
  if (marksObtained < 0) {
    return {
      ok: false,
      issues: [{ field: "marksObtained", code: "negative", message: "Marks cannot be negative" }],
    };
  }
  if (maxMarks != null && Number.isFinite(maxMarks) && marksObtained > maxMarks) {
    return {
      ok: false,
      issues: [
        {
          field: "marksObtained",
          code: "exceeds_max",
          message: `Marks (${marksObtained}) cannot exceed maximum (${maxMarks})`,
        },
      ],
    };
  }
  return { ok: true };
}

export function validateAttendanceDate(dateIso: string): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return {
      ok: false,
      issues: [{ field: "date", code: "format", message: "Attendance date must be YYYY-MM-DD" }],
    };
  }
  return { ok: true };
}

export function validateAcademicYearRange(startsOn: string, endsOn: string): ValidationResult {
  const start = Date.parse(startsOn);
  const end = Date.parse(endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      ok: false,
      issues: [{ field: "dates", code: "invalid", message: "Academic year dates are invalid" }],
    };
  }
  if (end <= start) {
    return {
      ok: false,
      issues: [{ field: "endsOn", code: "range", message: "Academic year end must be after start" }],
    };
  }
  return { ok: true };
}

export function validateRemarkBody(body: string): ValidationResult {
  const trimmed = body.trim();
  if (trimmed.length < 3) {
    return {
      ok: false,
      issues: [{ field: "body", code: "too_short", message: "Remark must be at least 3 characters" }],
    };
  }
  if (trimmed.length > 4000) {
    return {
      ok: false,
      issues: [{ field: "body", code: "too_long", message: "Remark is too long" }],
    };
  }
  return { ok: true };
}

/** Teacher may only enter marks for subjects they are assigned (caller supplies assignment flag). */
export function validateTeacherSubjectAssignment(isAssigned: boolean): ValidationResult {
  if (!isAssigned) {
    return {
      ok: false,
      issues: [
        {
          field: "subject",
          code: "not_assigned",
          message: "Teacher is not assigned to this class/subject",
        },
      ],
    };
  }
  return { ok: true };
}


export function validateLeaveDateRange(fromDate: string, toDate: string): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return {
      ok: false,
      issues: [{ field: "dates", code: "format", message: "Leave dates must be YYYY-MM-DD" }],
    };
  }
  const start = Date.parse(fromDate);
  const end = Date.parse(toDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      ok: false,
      issues: [{ field: "dates", code: "invalid", message: "Leave dates are invalid" }],
    };
  }
  if (end < start) {
    return {
      ok: false,
      issues: [{ field: "toDate", code: "range", message: "Leave end date must be on or after start date" }],
    };
  }
  return { ok: true };
}

export function validateAnnouncementContent(title: string, body: string): ValidationResult {
  const tt = title.trim();
  const bb = body.trim();
  if (tt.length < 2) {
    return { ok: false, issues: [{ field: "title", code: "too_short", message: "Announcement title is required" }] };
  }
  if (tt.length > 200) {
    return { ok: false, issues: [{ field: "title", code: "too_long", message: "Announcement title is too long" }] };
  }
  if (bb.length < 2) {
    return { ok: false, issues: [{ field: "body", code: "too_short", message: "Announcement body is required" }] };
  }
  if (bb.length > 10000) {
    return { ok: false, issues: [{ field: "body", code: "too_long", message: "Announcement body is too long" }] };
  }
  return { ok: true };
}

export function validateBattleQuestionDrafts(
  questions: { question: string; options: string[]; correctIndex: number }[],
): ValidationResult {
  if (!questions.length) {
    return { ok: false, issues: [{ field: "questions", code: "required", message: "Add at least one question" }] };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question.trim()) {
      return { ok: false, issues: [{ field: `questions[${i}].question`, code: "required", message: `Question ${i + 1} text is required` }] };
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some((o) => !o.trim())) {
      return { ok: false, issues: [{ field: `questions[${i}].options`, code: "invalid", message: `Question ${i + 1} needs every option filled` }] };
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      return { ok: false, issues: [{ field: `questions[${i}].correctIndex`, code: "invalid", message: `Question ${i + 1} has an invalid correct answer` }] };
    }
  }
  return { ok: true };
}
