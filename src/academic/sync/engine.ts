import { supabase } from "@/integrations/supabase/client";
import { syncTargetsFor, type SyncTarget } from "../events";
import { requireSchoolId } from "../tenant";

/**
 * Academic Sync Engine (Phase 4)
 *
 * DB triggers emit academic_events; SQL processors refresh profiles,
 * notifications, and activity feed. This module is the TypeScript facade
 * panels/jobs use to drain or refresh explicitly.
 */

export interface SyncRunResult {
  processed: number;
  schoolId: string;
}

export async function processPendingEvents(
  schoolId: string,
  limit = 50,
): Promise<SyncRunResult> {
  requireSchoolId(schoolId);
  const { data, error } = await supabase.rpc("process_pending_academic_events", {
    _limit: limit,
  });
  if (error) throw new Error(error.message);
  return { processed: Number(data ?? 0), schoolId };
}

export async function processEvent(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("process_academic_event", {
    _event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function refreshStudentProfile(studentId: string): Promise<string> {
  const { data, error } = await supabase.rpc("refresh_student_academic_profile", {
    _student_id: studentId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Documented fan-out for an event type (mirrors SQL processor intent). */
export function plannedTargets(eventType: string): readonly SyncTarget[] {
  return syncTargetsFor(eventType);
}

export const SyncEngine = {
  processPendingEvents,
  processEvent,
  refreshStudentProfile,
  plannedTargets,
};
