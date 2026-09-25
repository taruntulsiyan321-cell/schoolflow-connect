/**
 * Copy for Practice when the student's curriculum scope cannot be resolved.
 *
 * Individuals (exam-scoped, no class) must never see school-admin language —
 * they have no school and no admin to ask. School students without a class
 * still get the assign-to-class message.
 */

export const CLASS_UNRESOLVED_MSG =
  "We couldn't determine your class. Ask your school admin to assign you to a class (e.g. 10-A, 11-B, or 12-C) so practice can show subjects for your class level only.";

export const EXAM_UNRESOLVED_MSG =
  "We couldn't determine which exam you're preparing for. Sign out and sign in again, or contact support if this keeps happening.";

export const CLASS_LEVEL_UNRESOLVED_MSG =
  "Your class is assigned, but its name or category does not identify a class level. Ask your school admin to use a label such as Class 10, Std 9, XI, or 12-A.";

export type PracticeUnresolvedInput = {
  /** True when shell is ready and curriculumScope.examId is set (individual / exam tenant). */
  examScoped: boolean;
  examUnresolved: boolean;
  classIdMissing: boolean;
  classLevelUnresolved: boolean;
  /**
   * schools.kind from identity. Class-admin copy is only for confirmed
   * organisation schools — never for individual, and never while kind is still null.
   */
  schoolKind?: "school" | "individual" | null;
};

/**
 * Returns whether Practice should block on unresolved scope, and which message.
 * When `examScoped` is true, class-missing / class-level gaps are ignored —
 * individuals never have a class_id, so CLASS_*_MSG is unreachable.
 * While `schoolKind` is null/individual, CLASS_*_MSG is also unreachable
 * (unknown kind must not look like a school with a missing class).
 */
export function resolvePracticeUnresolved(input: PracticeUnresolvedInput): {
  classUnresolved: boolean;
  classUnresolvedMessage: string | undefined;
} {
  const {
    examScoped,
    examUnresolved,
    classIdMissing,
    classLevelUnresolved,
    schoolKind = null,
  } = input;

  if (examScoped) {
    return { classUnresolved: false, classUnresolvedMessage: undefined };
  }

  if (examUnresolved) {
    return { classUnresolved: true, classUnresolvedMessage: EXAM_UNRESOLVED_MSG };
  }

  // Class-admin language only after we know this is an organisation school.
  if (schoolKind !== "school") {
    return { classUnresolved: false, classUnresolvedMessage: undefined };
  }

  const classUnresolved = classIdMissing || classLevelUnresolved;
  if (!classUnresolved) {
    return { classUnresolved: false, classUnresolvedMessage: undefined };
  }

  const classUnresolvedMessage = classIdMissing
    ? CLASS_UNRESOLVED_MSG
    : CLASS_LEVEL_UNRESOLVED_MSG;

  return { classUnresolved: true, classUnresolvedMessage };
}
