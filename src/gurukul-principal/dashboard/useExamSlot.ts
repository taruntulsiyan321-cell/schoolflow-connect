import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useAcademicLive } from '@/academic'
import { localDateKey } from '@/lib/localDate'
import { toClassLabel, toErrorMessage } from '@/lib/presentation'

// These two are query WINDOWS (how far back to look, how long a ready report
// lingers in the slot), not metric thresholds — nothing is measured against
// them, so they live here rather than in thresholds.ts. Named without metric
// vocabulary for the same reason REPORT_LINGER_DAYS is not a "threshold".
/** How many days a section's report lingers in the slot after it is ready (§4). */
const REPORT_LINGER_DAYS = 7
/** How far back an occurred sitting is still considered part of the live cycle. */
const SITTING_LOOKBACK_DAYS = 45

export interface ExamSectionRow {
  examId: string
  classId: string
  sectionLabel: string
  examName: string
  subjectsMarked: number
  subjectsTotal: number
  ready: boolean
  /** ISO date the report became ready, when known. */
  readyAt: string | null
}

export interface ExamSlot {
  /** True when the switching slot should show Exam reports rather than Fees. */
  running: boolean
  /** Sections with a ready report (shown on top). */
  ready: ExamSectionRow[]
  /** Sections still marking (shown muted below — the actionable half). */
  marking: ExamSectionRow[]
}

function daysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Exam roll-up per section (§5) and the switching-slot decision (§4).
 *
 * There is no school-wide exam object: each section's class teacher owns a
 * sitting, subject teachers mark their own subject, and the report becomes
 * visible the moment the last subject is marked (auto-publish). "Running" means
 * at least one section is still marking, or a report went ready within the last
 * week — otherwise the slot yields to Fees.
 */
export function useExamSlot() {
  const { school } = useAuth()
  const schoolId = school?.id ?? null
  const liveVersion = useAcademicLive(['marks'])

  const [slot, setSlot] = useState<ExamSlot>({ running: false, ready: [], marking: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!schoolId) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const today = localDateKey()
        const since = daysAgoKey(SITTING_LOOKBACK_DAYS)

        // Sittings that have already occurred within the live cycle window.
        const examsRes = await supabase
          .from('exams')
          .select('id, class_id, name, exam_date, results_published_at, classes(name, section)')
          .eq('school_id', schoolId)
          .not('exam_date', 'is', null)
          .gte('exam_date', since)
          .lte('exam_date', today)
        if (cancelled) return
        if (examsRes.error) throw examsRes.error

        const exams = examsRes.data ?? []
        if (exams.length === 0) {
          setSlot({ running: false, ready: [], marking: [] })
          return
        }

        const examIds = exams.map((e) => e.id)
        const subjRes = await supabase
          .from('exam_subjects')
          .select('exam_id, uploaded_at')
          .in('exam_id', examIds)
        if (cancelled) return
        if (subjRes.error) throw subjRes.error

        const totalByExam = new Map<string, number>()
        const markedByExam = new Map<string, number>()
        const lastUploadByExam = new Map<string, string>()
        for (const s of subjRes.data ?? []) {
          totalByExam.set(s.exam_id, (totalByExam.get(s.exam_id) ?? 0) + 1)
          if (s.uploaded_at) {
            markedByExam.set(s.exam_id, (markedByExam.get(s.exam_id) ?? 0) + 1)
            const at = s.uploaded_at.slice(0, 10)
            const prev = lastUploadByExam.get(s.exam_id)
            if (!prev || at > prev) lastUploadByExam.set(s.exam_id, at)
          }
        }

        const ready: ExamSectionRow[] = []
        const marking: ExamSectionRow[] = []

        for (const e of exams) {
          const total = totalByExam.get(e.id) ?? 0
          // No subject grain recorded → cannot assert progress; skip rather than
          // invent "0 of 0 marked".
          if (total === 0) continue
          const marked = markedByExam.get(e.id) ?? 0
          const cls = (e as { classes?: { name: string | null; section: string | null } | null }).classes
          const row: ExamSectionRow = {
            examId: e.id,
            classId: e.class_id,
            sectionLabel: cls ? toClassLabel(cls.name, cls.section) : '—',
            examName: e.name,
            subjectsMarked: marked,
            subjectsTotal: total,
            ready: marked >= total,
            readyAt: marked >= total ? (e.results_published_at?.slice(0, 10) ?? lastUploadByExam.get(e.id) ?? e.exam_date) : null,
          }
          if (row.ready) ready.push(row)
          else marking.push(row)
        }

        // A ready report lingers for a week after it is ready; older ones have
        // already left the dashboard slot (they stay in the exams tab all year).
        const lingerCutoff = daysAgoKey(REPORT_LINGER_DAYS)
        const readyRecent = ready.filter((r) => (r.readyAt ?? '') >= lingerCutoff)

        // Still-marking first in data terms (actionable), but presented below in UI.
        marking.sort((a, b) => b.subjectsMarked / b.subjectsTotal - a.subjectsMarked / a.subjectsTotal)
        readyRecent.sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''))

        const running = marking.length > 0 || readyRecent.length > 0
        setSlot({ running, ready: readyRecent, marking })
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err, 'Failed to load exam reports'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [schoolId, liveVersion])

  return { slot, loading, error }
}
