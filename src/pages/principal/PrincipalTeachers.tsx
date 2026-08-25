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

interface TeacherRow {
  id: string
  name: string
  subjects: string[]
  sectionsCount: number
  classTeacherOf: string | null
  homeworkCount: number
  testsCount: number
  marksPending: number
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
        const { data: teachersData } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('school_id', school.id)
          .eq('role', 'teacher')
          .order('full_name')

        if (!teachersData) {
          setTeachers([])
          setLoading(false)
          return
        }

        // For now, using mock data structure
        // TODO: Wire up actual homework, tests, marks data
        const enriched: TeacherRow[] = teachersData.map((t: any) => ({
          id: t.id,
          name: t.full_name,
          subjects: ['Mathematics', 'Physics'], // TODO: Load from assignments
          sectionsCount: 4, // TODO: Count from section assignments
          classTeacherOf: null, // TODO: Load from classes table
          homeworkCount: 18, // TODO: Count from homework table
          testsCount: 6, // TODO: Count from tests table
          marksPending: 0, // TODO: Count pending marks
          lastActivityDays: 2, // TODO: Compute from last homework/test date
        }))

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
