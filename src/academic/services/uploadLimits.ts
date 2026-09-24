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
/** §4.2 confidence — measured against §4.5 battery; see spec §13. */
export const UPLOAD_CONFIDENCE_THRESHOLD = 0.55;

/** §13 — max bytes per object. Enforced by storage bucket; client mirrors. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** §13 — max pages per upload. Enforced in custom-practice-upload. */
export const UPLOAD_MAX_PAGES = 20;

/** §13 — max student_uploads rows an owner may keep. Enforced by DB trigger. */
export const UPLOAD_MAX_PER_ACCOUNT = 40;

/** Model that reads uploads (custom-practice-upload via modelRouter). */
export const UPLOAD_CLASSIFIER_MODEL = "qwen/qwen3.7-flash";
