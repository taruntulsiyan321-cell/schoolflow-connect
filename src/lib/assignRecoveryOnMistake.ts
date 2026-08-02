/** Queue recovery work when a student gets a concept wrong (idempotent per concept). */
export async function assignRecoveryOnMistake(opts: {
  subject: string;
  chapter?: string | null;
  concept?: string | null;
  sourceType: string;
  sourceId: string;
  accuracy?: number;
}): Promise<string | null> {
  try {
    const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
    const ctx = await resolveStudentServiceContext();
    return await PracticeService.assignRecovery(ctx, {
      subject: opts.subject,
      chapter: opts.chapter,
      concept: opts.concept,
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      accuracy: opts.accuracy,
    });
  } catch (e) {
    console.warn("recovery assign:", e instanceof Error ? e.message : e);
    return null;
  }
}
