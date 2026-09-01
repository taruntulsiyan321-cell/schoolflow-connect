/**
 * Teachers Panel - Part B.1
 *
 * List of all teachers with activity metrics.
 * Every row clickable. Search present.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE, formatValue } from '@/gurukul-principal/shared/palette'
import { Search } from 'lucide-react'
import { localDateKey } from '@/lib/localDate'
import { daysSinceLastActivity } from '@/academic/metrics/activity'
import { valueOr } from '@/academic/metrics/types'

interface TeacherRow {
  id: string
  name: string
  subjects: string[]
  sectionsCount: number
  classTeacherOf: string | null
  homeworkCount: number
  testsCount: number
  /**
   * null = NOT MEASURED, and never 0.
   *
   * `strictNullChecks` is off in this project, so the compiler will not stop
   * anyone assigning null here or comparing it with `>`. The distinction is
   * therefore held by this comment and by the render, which shows "—" for null:
   * `0 pending` reads as "nothing to chase", and inventing that for a teacher
   * who owes marks is the whole reason this file was rewritten.
   */
  marksPending: number | null
  lastActivityDays: number | null
}

export default function PrincipalTeachers() {
  const navigate = useNavigate()
  const { school } = useAuth()
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [search, setSearch] = useState('')
  const [sortColumn, setSortColumn] = useState<keyof TeacherRow>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id) return

    const loadTeachers = async () => {
      setLoading(true)

      try {
        // Load all teachers
        // `teachers`, not `users`: there is no public.users table in this
        // schema, and teacher identity/role is carried by the teachers row
        // itself, so no separate role filter is needed.
        const { data: teachersData } = await supabase
          .from('teachers')
          .select('id, full_name, user_id')
          .eq('school_id', school.id)
          .order('full_name')

        if (!teachersData) {
          setTeachers([])
          setLoading(false)
          return
        }

        // CHUNK 10. This block used to decorate every REAL teacher name with the
        // same invented figures — Mathematics and Physics, 4 sections, 18
        // homework, 6 tests, 0 marks pending, last active 2 days ago. Real names
        // carrying fabricated activity is worse than a wholly fake page: a
        // principal has no way to tell which half is true, and "0 marks pending"
        // for a teacher who owes marks is an instruction not to chase them.
        //
        // Every column is now measured, and a column that cannot be measured
        // says so instead of guessing. `null` renders as "—".
        const teacherIds = teachersData.map((t: { id: string }) => t.id)
        const userIds = teachersData
          .map((t: { user_id: string | null }) => t.user_id)
          .filter((v): v is string => !!v)

        const [assignments, classTeacherOf, homework, tests] = await Promise.all([
          supabase
            .from('teacher_classes')
            .select('teacher_id, class_id, subject')
            .eq('school_id', school.id)
            .in('teacher_id', teacherIds.length ? teacherIds : ['00000000-0000-0000-0000-000000000000']),
          supabase
            .from('classes')
            .select('id, name, section, class_teacher_id')
            .eq('school_id', school.id)
            .not('class_teacher_id', 'is', null),
          userIds.length
            ? supabase
                .from('homework')
                .select('id, created_by, created_at')
                .eq('school_id', school.id)
                .is('deleted_at', null)
                .in('created_by', userIds)
            : Promise.resolve({ data: [] as { id: string; created_by: string; created_at: string }[] }),
          userIds.length
            ? supabase
                .from('tests')
                .select('id, created_by, date')
                .eq('school_id', school.id)
                .is('deleted_at', null)
                .in('created_by', userIds)
            : Promise.resolve({ data: [] as { id: string; created_by: string; date: string | null }[] }),
        ])

        const today = localDateKey(new Date())
        const byTeacher = <T,>(rows: T[] | null, key: (r: T) => string | null) => {
          const m = new Map<string, T[]>()
          for (const r of rows ?? []) {
            const k = key(r)
            if (!k) continue
            m.set(k, [...(m.get(k) ?? []), r])
          }
          return m
        }

        const assignedBy = byTeacher(assignments.data, (r) => r.teacher_id)
        const homeworkBy = byTeacher(homework.data, (r) => r.created_by)
        const testsBy = byTeacher(tests.data, (r) => r.created_by)

        const enriched: TeacherRow[] = teachersData.map(
          (t: { id: string; full_name: string; user_id: string | null }) => {
            const mine = assignedBy.get(t.id) ?? []
            const hw = (t.user_id ? homeworkBy.get(t.user_id) : undefined) ?? []
            const ts = (t.user_id ? testsBy.get(t.user_id) : undefined) ?? []

            const cls = (classTeacherOf.data ?? []).find((c) => c.class_teacher_id === t.user_id)
            const last = daysSinceLastActivity(
              hw.map((h) => ({ homeworkId: h.id, teacherId: t.id, sectionId: null, createdOn: (h.created_at ?? '').slice(0, 10) })),
              ts.map((x) => ({ testId: x.id, teacherId: t.id, sectionId: null, conductedOn: x.date })),
              today,
            )

            return {
              id: t.id,
              name: t.full_name,
              subjects: [...new Set(mine.map((a) => a.subject).filter(Boolean))] as string[],
              sectionsCount: new Set(mine.map((a) => a.class_id).filter(Boolean)).size,
              classTeacherOf: cls ? `${cls.name}${cls.section ? `-${cls.section}` : ''}` : null,
              homeworkCount: hw.length,
              testsCount: ts.length,
              // Not yet measured. Counting outstanding marks needs exams joined
              // to their expected roll, which is the marks family's `marksPending`
              // — wired in the next batch. NULL, not 0: "0 pending" is an
              // instruction not to chase, and it is the one value this column
              // must never invent.
              marksPending: null,
              lastActivityDays: valueOr(last, null),
            }
          },
        )

        setTeachers(enriched)
      } catch (error) {
        console.error('Failed to load teachers:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTeachers()
  }, [school?.id])

  const filtered = teachers.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subjects.some(s => s.toLowerCase().includes(search.toLowerCase()))
  )

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortColumn]
    const bVal = b[sortColumn]

    if (aVal === null) return 1
    if (bVal === null) return -1

    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  const handleSort = (col: keyof TeacherRow) => {
    if (col === sortColumn) {
      setSortAsc(!sortAsc)
    } else {
      setSortColumn(col)
      setSortAsc(col === 'name')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${PALETTE.border}`,
          borderTopColor: PALETTE.ink,
          borderRadius: '50%',
          margin: '0 auto',
          animation: 'spin 0.8s linear infinite'
        }} />
      </div>
    )
  }

  return (
    <div style={{ background: PALETTE.ground, minHeight: '100vh', padding: '16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0, marginBottom: '8px' }}>
          Teachers
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          {teachers.length} {teachers.length === 1 ? 'teacher' : 'teachers'}
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ position: 'relative', maxWidth: '400px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: PALETTE.inkMuted }} />
          <input
            type="text"
            placeholder="Search by name or subject..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px 10px 40px',
              fontSize: '14px',
              color: PALETTE.ink,
              background: PALETTE.surface,
              border: `1px solid ${PALETTE.border}`,
              borderRadius: '6px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
              {[
                { key: 'name', label: 'NAME' },
                { key: 'subjects', label: 'SUBJECTS', sortable: false },
                { key: 'sectionsCount', label: 'SECTIONS' },
                { key: 'classTeacherOf', label: 'CLASS TEACHER' },
                { key: 'homeworkCount', label: 'HOMEWORK' },
                { key: 'testsCount', label: 'TESTS' },
                { key: 'marksPending', label: 'MARKS PENDING' },
                { key: 'lastActivityDays', label: 'LAST ACTIVITY' },
              ].map(({ key, label, sortable = true }) => (
                <th
                  key={key}
                  onClick={() => sortable && handleSort(key as keyof TeacherRow)}
                  style={{
                    ...TYPE.sectionLabel,
                    padding: '12px 16px',
                    textAlign: 'left',
                    cursor: sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                >
                  {label} {sortable && sortColumn === key && (sortAsc ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((teacher, i) => (
              <tr
                key={teacher.id}
                onClick={() => navigate(`/principal/teachers/${teacher.id}`)}
                style={{
                  background: i % 2 === 0 ? 'transparent' : PALETTE.ground,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F3F4F6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : PALETTE.ground
                }}
              >
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600 }}>
                  {teacher.name}
                </td>
                <td style={{ ...TYPE.rowSecondary, padding: '12px 16px' }}>
                  {teacher.subjects.join(', ')}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                  {teacher.sectionsCount}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>
                  {teacher.classTeacherOf || '—'}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                  {teacher.homeworkCount}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                  {teacher.testsCount}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: teacher.marksPending > 0 ? PALETTE.alert : PALETTE.ink
                }}>
                  {teacher.marksPending > 0 ? teacher.marksPending : '—'}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  color: teacher.lastActivityDays && teacher.lastActivityDays > 14 ? PALETTE.alert : PALETTE.ink
                }}>
                  {teacher.lastActivityDays !== null ? `${teacher.lastActivityDays} days ago` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
            No teachers found
          </div>
        )}
      </div>
    </div>
  )
}
