/**
 * Students Panel - Part C.1
 *
 * List of all students with key metrics.
 * Search by name or parent phone. Sort columns.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE, formatValue, shouldFlag } from '@/gurukul-principal/shared/palette'
import { Search } from 'lucide-react'
import { THRESHOLDS } from '@/gurukul-principal/analysis/thresholds'

interface StudentRow {
  id: string
  rollNumber: string
  name: string
  className: string
  sectionName: string
  parentPhone: string
  attendancePct: number | null
  homeworkPct: number | null
  testAvg: number | null
  examAvg: number | null
}

export default function PrincipalStudents() {
  const navigate = useNavigate()
  const { school } = useAuth()
  const [students, setStudents] = useState<StudentRow[]>([])
  const [search, setSearch] = useState('')
  const [sortColumn, setSortColumn] = useState<keyof StudentRow>('rollNumber')
  const [sortAsc, setSortAsc] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id) return

    const loadStudents = async () => {
      setLoading(true)

      try {
        const { data: studentsData } = await supabase
          // `students`, not `users`: there is no public.users table in this
          // schema, and a students row already means role=student.
          .from('students')
          .select('id, full_name')
          .eq('school_id', school.id)
          .order('full_name')

        if (!studentsData) {
          setStudents([])
          setLoading(false)
          return
        }

        // TODO: Load actual data from sections, attendance, homework, marks
        const enriched: StudentRow[] = studentsData.map((s: any, i: number) => ({
          id: s.id,
          rollNumber: String(i + 1).padStart(2, '0'),
          name: s.full_name,
          className: 'Class 10',
          sectionName: 'A',
          parentPhone: '+91 98765 43210',
          attendancePct: 85,
          homeworkPct: 72,
          testAvg: 68,
          examAvg: 75,
        }))

        setStudents(enriched)
      } catch (error) {
        console.error('Failed to load students:', error)
      } finally {
        setLoading(false)
      }
    }

    loadStudents()
  }, [school?.id])

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.parentPhone.includes(search)
  )

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortColumn]
    const bVal = b[sortColumn]

    if (aVal === null) return 1
    if (bVal === null) return -1

    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  const handleSort = (col: keyof StudentRow) => {
    if (col === sortColumn) {
      setSortAsc(!sortAsc)
    } else {
      setSortColumn(col)
      setSortAsc(col === 'rollNumber' || col === 'name')
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
          Students
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          {students.length} {students.length === 1 ? 'student' : 'students'}
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ position: 'relative', maxWidth: '400px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: PALETTE.inkMuted }} />
          <input
            type="text"
            placeholder="Search by name or phone..."
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
                { key: 'rollNumber', label: 'ROLL' },
                { key: 'name', label: 'NAME' },
                { key: 'className', label: 'CLASS', sortable: false },
                { key: 'sectionName', label: 'SECTION', sortable: false },
                { key: 'parentPhone', label: 'PARENT PHONE', sortable: false },
                { key: 'attendancePct', label: 'ATTENDANCE %' },
                { key: 'homeworkPct', label: 'HOMEWORK %' },
                { key: 'testAvg', label: 'TEST AVG' },
                { key: 'examAvg', label: 'EXAM AVG' },
              ].map(({ key, label, sortable = true }) => (
                <th
                  key={key}
                  onClick={() => sortable && handleSort(key as keyof StudentRow)}
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
            {sorted.map((student, i) => (
              <tr
                key={student.id}
                onClick={() => navigate(`/principal/students/${student.id}`)}
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
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                  {student.rollNumber}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600 }}>
                  {student.name}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>{student.className}</td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>{student.sectionName}</td>
                <td style={{ ...TYPE.rowSecondary, padding: '12px 16px', fontSize: '13px' }}>
                  {student.parentPhone}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(student.attendancePct, THRESHOLDS.ATTENDANCE_LOW) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(student.attendancePct, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(student.homeworkPct, THRESHOLDS.HOMEWORK_LOW) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(student.homeworkPct, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(student.testAvg, THRESHOLDS.SUBJECT_MARKS_LOW) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(student.testAvg, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(student.examAvg, THRESHOLDS.SUBJECT_MARKS_LOW) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(student.examAvg, { isPercent: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
            No students found
          </div>
        )}
      </div>
    </div>
  )
}
