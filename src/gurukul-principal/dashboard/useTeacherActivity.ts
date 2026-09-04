import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useAcademicLive } from '@/academic'
import {
  homeworkAssigned,
  testsConducted,
  type HomeworkSet,
  type TestConducted,
  type ActivityWindow,
} from '@/academic/metrics/activity'
import { valueOr } from '@/academic/metrics/types'
import { toErrorMessage } from '@/lib/presentation'

export interface TeacherActivityRow {
  teacherId: string
  userId: string | null
  name: string
  /** Tests given in the window (counts only — never the reports, per §1/§6). */
  tests: number
  /** Homework given in the window. */
  homework: number
  /** tests + homework — the single figure "most active" orders by. */
  total: number
}

/**
 * Per-teacher counts of tests and homework GIVEN over a window (§6).
 *
 * Counts only — the principal never reaches the reports themselves. Zero is a
 * real, measured answer here (a teacher who set nothing set nothing); the
 * window is explicit so a count is always interpretable.
 */
export function useTeacherActivity(window: ActivityWindow) {
  const { school } = useAuth()
  const schoolId = school?.id ?? null
  const liveVersion = useAcademicLive(['homework'])

  const [rows, setRows] = useState<TeacherActivityRow[]>([])
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
        const [teachersRes, hwRes, testsRes] = await Promise.all([
          supabase
            .from('teachers')
            .select('id, user_id, full_name')
            .eq('school_id', schoolId)
            .eq('status', 'active'),
          supabase
            .from('homework')
            .select('id, created_by, created_at')
            .eq('school_id', schoolId)
            .is('deleted_at', null)
            .is('archived_at', null)
            .gte('created_at', `${window.from}T00:00:00`)
            .lte('created_at', `${window.to}T23:59:59`),
          supabase
            .from('tests')
            .select('id, created_by, date')
            .eq('school_id', schoolId)
            .is('deleted_at', null)
            .is('archived_at', null),
        ])

        if (cancelled) return
        if (teachersRes.error) throw teachersRes.error
        if (hwRes.error) throw hwRes.error
        if (testsRes.error) throw testsRes.error

        const teachers = teachersRes.data ?? []

        // Group homework/tests by the user_id that created them (teachers.user_id).
        const hwByUser = new Map<string, HomeworkSet[]>()
        for (const h of hwRes.data ?? []) {
          const uid = h.created_by
          if (!uid) continue
          const list = hwByUser.get(uid) ?? []
          list.push({
            homeworkId: h.id,
            teacherId: uid,
            sectionId: null,
            createdOn: (h.created_at ?? '').slice(0, 10),
          })
          hwByUser.set(uid, list)
        }
        const testsByUser = new Map<string, TestConducted[]>()
        for (const t of testsRes.data ?? []) {
          const uid = t.created_by
          if (!uid) continue
          const list = testsByUser.get(uid) ?? []
          list.push({ testId: t.id, teacherId: uid, sectionId: null, conductedOn: t.date })
          testsByUser.set(uid, list)
        }

        const mapped: TeacherActivityRow[] = teachers.map((t) => {
          const uid = t.user_id ?? ''
          const hw = valueOr(homeworkAssigned(hwByUser.get(uid) ?? [], window), 0)
          const ts = valueOr(testsConducted(testsByUser.get(uid) ?? [], window), 0)
          return {
            teacherId: t.id,
            userId: t.user_id,
            name: t.full_name ?? 'Unnamed teacher',
            homework: hw,
            tests: ts,
            total: hw + ts,
          }
        })

        setRows(mapped)
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err, 'Failed to load teacher activity'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [schoolId, window.from, window.to, liveVersion])

  return { rows, loading, error }
}
