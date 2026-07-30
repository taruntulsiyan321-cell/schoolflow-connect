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
