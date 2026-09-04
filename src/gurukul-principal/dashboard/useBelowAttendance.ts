import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useAcademicLive } from '@/academic'
import { belowAttendanceThreshold } from '@/academic/metrics/attendance'
import { isOk } from '@/academic/metrics/types'
import { toClassLabel, toErrorMessage } from '@/lib/presentation'

export interface BelowAttendanceStudent {
  studentId: string
  name: string
  classLabel: string
  pct: number
}

/**
 * Students below the attendance threshold (§7), worst-first. "Never marked"
 * students are returned separately — nobody has said anything about them, so
 * they are never folded into a below-threshold count (unmarked is never
 * inferred, §10).
 */
export function useBelowAttendance() {
  const { school } = useAuth()
  const schoolId = school?.id ?? null
  const liveVersion = useAcademicLive(['attendance'])

  const [students, setStudents] = useState<BelowAttendanceStudent[]>([])
  const [neverMarked, setNeverMarked] = useState(0)
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
        const { data, error: err } = await supabase
          .from('student_academic_profiles')
          .select(
            'student_id, attendance_present, attendance_total, students!inner(full_name, class_id, classes(name, section))',
          )
          .eq('school_id', schoolId)
          .limit(2000)
        if (err) throw err
        if (cancelled) return

        const list = (data ?? []) as Record<string, unknown>[]
        const metric = belowAttendanceThreshold(
          list.map((r) => ({
            studentId: String(r.student_id),
            present: Number(r.attendance_present ?? 0),
            total: Number(r.attendance_total ?? 0),
          })),
        )
        if (!isOk(metric)) {
          setStudents([])
          setNeverMarked(0)
          return
        }
        const byId = new Map(
          list.map((r) => {
            const s = r.students as
              | { full_name?: string; classes?: { name?: string | null; section?: string | null } | null }
              | null
            return [
              String(r.student_id),
              {
                name: s?.full_name ?? 'Unnamed',
                classLabel: toClassLabel(s?.classes?.name ?? null, s?.classes?.section ?? null),
              },
            ] as const
          }),
        )
        setStudents(
          metric.value.below.map((b) => ({
            studentId: b.studentId,
            name: byId.get(b.studentId)?.name ?? 'Unnamed',
            classLabel: byId.get(b.studentId)?.classLabel ?? '—',
            pct: b.pct,
          })),
        )
        setNeverMarked(metric.value.neverMarked.length)
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, 'Failed to load attendance'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [schoolId, liveVersion])

  return { students, neverMarked, loading, error }
}
