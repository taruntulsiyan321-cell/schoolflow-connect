import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { localDateKey } from '@/lib/localDate'
import { feeCollectionBand, type FeeCollectionBand } from '@/finance/metrics'
import { toClassLabel, toErrorMessage } from '@/lib/presentation'

export interface FeesClassRow {
  classId: string
  classLabel: string
  /** null = no fee structure set for this class → "not set", excluded from % (§10). */
  collectedPct: number | null
  pending: number
  unpaidStudents: number
  band: FeeCollectionBand
}

export interface UnpaidStudentRow {
  studentId: string
  name: string
  classId: string | null
  classLabel: string
  outstanding: number
  dueDate: string | null
}

export interface SchoolFees {
  enabled: boolean
  /** null when nothing is billed yet — an unknown rate, not 0% (§10). */
  collectedPct: number | null
  band: FeeCollectionBand
  pending: number
  studentsUnpaid: number
  classes: FeesClassRow[]
  /** Unpaid past their due date — feeds Needs Attention (§7) and the drill-down. */
  unpaidPastDue: UnpaidStudentRow[]
}

interface FeeRow {
  student_id: string
  amount: number
  paid_amount: number
  due_date: string | null
  status: string
}

function summarize(rows: FeeRow[]): { pct: number | null; pending: number; unpaid: Set<string> } {
  let due = 0
  let paid = 0
  let pending = 0
  const unpaid = new Set<string>()
  for (const r of rows) {
    if (r.amount > 0) {
      due += r.amount
      pending += Math.max(0, r.amount - r.paid_amount)
    }
    paid += r.paid_amount
    if (r.status !== 'paid') unpaid.add(r.student_id)
  }
  // Nothing billed → unknown, NOT 0% collected.
  const pct = due > 0 ? Math.round((paid / due) * 100) : null
  return { pct, pending, unpaid }
}

/** School fees: KPIs, class-wise breakdown, and the unpaid-past-due list. */
export function useSchoolFees() {
  const { school } = useAuth()
  const schoolId = school?.id ?? null

  const [data, setData] = useState<SchoolFees | null>(null)
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
        const [settingsRes, feesRes, studentsRes, classesRes] = await Promise.all([
          supabase.from('app_settings').select('enable_fees').eq('school_id', schoolId).maybeSingle(),
          supabase
            .from('fees')
            .select('student_id, amount, paid_amount, due_date, status')
            .eq('school_id', schoolId),
          supabase.from('students').select('id, full_name, class_id').eq('school_id', schoolId),
          supabase.from('classes').select('id, name, section').eq('school_id', schoolId),
        ])
        if (cancelled) return
        if (feesRes.error) throw feesRes.error
        if (studentsRes.error) throw studentsRes.error
        if (classesRes.error) throw classesRes.error

        const enabled = settingsRes.data?.enable_fees !== false
        const feeRows = (feesRes.data ?? []) as FeeRow[]
        const students = studentsRes.data ?? []
        const classes = classesRes.data ?? []

        const classById = new Map(classes.map((c) => [c.id, c]))
        const studentClass = new Map(students.map((s) => [s.id, s.class_id]))
        const studentName = new Map(students.map((s) => [s.id, s.full_name ?? 'Unnamed']))

        // School-wide.
        const school_ = summarize(feeRows)

        // Class-wise. Every class is represented; classes with no fee rows are
        // "not set" (collectedPct = null) and excluded from percentages.
        const rowsByClass = new Map<string, FeeRow[]>()
        for (const r of feeRows) {
          const classId = studentClass.get(r.student_id)
          if (!classId) continue
          const list = rowsByClass.get(classId) ?? []
          list.push(r)
          rowsByClass.set(classId, list)
        }
        const classRows: FeesClassRow[] = classes.map((c) => {
          const rows = rowsByClass.get(c.id) ?? []
          const s = summarize(rows)
          return {
            classId: c.id,
            classLabel: toClassLabel(c.name, c.section),
            collectedPct: rows.length === 0 ? null : s.pct,
            pending: s.pending,
            unpaidStudents: s.unpaid.size,
            band: feeCollectionBand(rows.length === 0 ? null : s.pct),
          }
        })
        // Worst-first: lowest collection at the top; "not set" (null) sinks last.
        classRows.sort((a, b) => {
          if (a.collectedPct === null && b.collectedPct === null) return 0
          if (a.collectedPct === null) return 1
          if (b.collectedPct === null) return -1
          return a.collectedPct - b.collectedPct
        })

        // Unpaid past due, worst (largest outstanding) first.
        const unpaidPastDue: UnpaidStudentRow[] = feeRows
          .filter((r) => r.status !== 'paid' && r.due_date !== null && r.due_date < today)
          .map((r) => {
            const classId = studentClass.get(r.student_id) ?? null
            const cls = classId ? classById.get(classId) : null
            return {
              studentId: r.student_id,
              name: studentName.get(r.student_id) ?? 'Unnamed',
              classId,
              classLabel: cls ? toClassLabel(cls.name, cls.section) : '—',
              outstanding: Math.max(0, r.amount - r.paid_amount),
              dueDate: r.due_date,
            }
          })
          .sort((a, b) => b.outstanding - a.outstanding)

        setData({
          enabled,
          collectedPct: school_.pct,
          band: feeCollectionBand(school_.pct),
          pending: school_.pending,
          studentsUnpaid: school_.unpaid.size,
          classes: classRows,
          unpaidPastDue,
        })
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err, 'Failed to load fees'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [schoolId])

  return { data, loading, error }
}
