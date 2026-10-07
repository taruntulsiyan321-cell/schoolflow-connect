/**
 * Custom Practice upload caps — §13 ruled 2026-09-24.
 * Binding: docs/custom-practice-upload-spec.md §13
 *
 * ONE home each:
 *   - byte size → storage.buckets.file_size_limit (student-uploads) + client mirror
 *   - page count → edge custom-practice-upload after media load
 *   - uploads kept → BEFORE INSERT trigger on student_uploads
 *
 * Client may only reflect these; it must not be the sole gate.
 */
/** §13 — max bytes per object. Enforced by storage bucket; client mirrors. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** §13 — max pages per upload. Enforced in custom-practice-upload. */
export const UPLOAD_MAX_PAGES = 20;
