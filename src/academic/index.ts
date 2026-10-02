/**
 * Gurukul Academic Engine — what the individual student panel uses.
 *
 * The live app is the individual student panel only (2026-10-01). This barrel
 * exported the whole engine — the school side's homework, attendance, marks,
 * tests, timetable, notices, remarks, leave, battles, doubts, question papers
 * and parent access with it — and because the student shell loads it with a
 * dynamic `import("@/academic")`, every one of those services was shipped in
 * the live bundle though no screen called it. It now exports only what the
 * app imports; the school side is kept whole on the `organisation` branch
 * (tag organisation-archive-2026-10-01).
 */

export { PracticeService } from "./services/practiceService";
export { RecoveryEngineService } from "./services/recoveryEngineService";
export { BadgeService } from "./services/badgeService";
export { ProgressionService } from "./services/progressionService";
export { resolveStudentServiceContext } from "./services/resolveStudentContext";
export type { ServiceContext } from "./services/context";
export type { EarnedBadgeRow } from "./services/badgeService";
export type { ProgressionSnapshot } from "./services/progressionService";
export type { CurriculumScope, PracticeSessionRow } from "./services/practiceService";
export { StudentUploadService } from "./services/studentUploadService";
export type {
  ChapterStateRow,
  RecoveryQueueRow,
  RecoverySessionOutcome,
  ClearChapterOutcome,
  RevisionSessionOutcome,
  RevisionHistoryRow,
} from "./services/recoveryEngineService";
export { useAcademicLive } from "./live";
export { useAcademicContext } from "./hooks/useAcademicContext";
export { WEAK_CONCEPT_THRESHOLD } from "./eie/masteryBands";
