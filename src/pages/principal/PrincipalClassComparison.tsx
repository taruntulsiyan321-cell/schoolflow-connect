/**
 * Class Comparison Page - Part D.2
 *
 * Shows all sections of a class side-by-side for comparison.
 * Each row is one section.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE, formatValue, shouldFlag } from '@/gurukul-principal/shared/palette'
import { THRESHOLDS } from '@/gurukul-principal/analysis/thresholds'
import { ChevronLeft } from 'lucide-react'
import { rollupFromProfiles, profileCountsFromRow, type ProfileCounts } from '@/academic/metrics/rollup'
import { valueOr } from '@/academic/metrics/types'

interface SectionRow {
  sectionId: string
  sectionName: string
  studentsCount: number
  classTeacher: string | null
  attendancePct: number | null
  homeworkPct: number | null
  testAvg: number | null
  examAvg: number | null
}

export default function PrincipalClassComparison() {
  const { className } = useParams<{ className: string }>()
  const navigate = useNavigate()
  const { school } = useAuth()
  const [sections, setSections] = useState<SectionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id || !className) return

    const loadSections = async () => {
      setLoading(true)

      try {
        // CHUNK 10. This block invented three sections with invented class
        // teachers — "Mrs. Sharma", "Mr. Gupta", "Ms. Patel" — and invented
        // figures for every column. The page a principal uses to compare their
        // own sections was showing a fixture.
        //
        // Sections and their rollups are real now. A section with no measured
        // figure carries null and renders "—"; it is NOT given a 0 and NOT
        // ranked against the sections that were measured, which is what
        // compare() in the metric layer exists to prevent.
        const { data: classRows } = await supabase
          .from('classes')
          .select('id, name, section, class_teacher_id')
          .eq('school_id', school.id)
          .eq('name', className)
          .eq('is_active', true)
          .order('section')

        const sectionIds = (classRows ?? []).map((c) => c.id)
        if (sectionIds.length === 0) {
          setSections([])
          setLoading(false)
          return
        }

        const [profiles, teacherRows] = await Promise.all([
          supabase
            .from('student_academic_profiles')
            .select('student_id, attendance_present, attendance_total, homework_assigned, homework_submitted, tests_attempted, tests_avg_pct, exams_recorded, exams_avg_pct, students!inner(class_id)')
            .eq('school_id', school.id),
          supabase
            .from('teachers')
            .select('user_id, full_name')
            .eq('school_id', school.id),
        ])

        const teacherName = new Map(
          (teacherRows.data ?? []).map((t) => [t.user_id, t.full_name] as const),
        )

        const byClass = new Map<string, ProfileCounts[]>()
        for (const row of (profiles.data ?? []) as Record<string, unknown>[]) {
          const cls = (row.students as { class_id?: string } | null)?.class_id
          if (!cls) continue
          byClass.set(cls, [...(byClass.get(cls) ?? []), profileCountsFromRow(row)])
        }

        setSections(
          (classRows ?? []).map((c) => {
            const rollup = rollupFromProfiles(byClass.get(c.id) ?? [])
            return {
              sectionId: c.id,
              sectionName: c.section ?? '',
              studentsCount: rollup.studentCount,
              classTeacher: c.class_teacher_id ? teacherName.get(c.class_teacher_id) ?? null : null,
              attendancePct: valueOr(rollup.attendance, null),
              homeworkPct: valueOr(rollup.homework, null),
              testAvg: valueOr(rollup.tests, null),
              examAvg: valueOr(rollup.exams, null),
            }
          }),
        )
      } catch (error) {
        console.error('Failed to load sections:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSections()
  }, [school?.id, className])

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
      {/* Header with back button */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/principal/classes')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 0',
            marginBottom: '12px',
            background: 'transparent',
            border: 'none',
            ...TYPE.rowSecondary,
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={16} />
          Back to Classes
        </button>

        <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0, marginBottom: '4px' }}>
          {className}
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          {sections.length} {sections.length === 1 ? 'section' : 'sections'}
        </div>
      </div>

      {/* Section comparison table */}
      <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
              {[
                'SECTION',
                'STUDENTS',
                'CLASS TEACHER',
                'ATTENDANCE %',
                'HOMEWORK %',
                'TEST AVG',
                'EXAM AVG',
              ].map((label) => (
                <th
                  key={label}
                  style={{
                    ...TYPE.sectionLabel,
                    padding: '12px 16px',
                    textAlign: 'left',
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section, i) => (
              <tr
                key={section.sectionId}
                onClick={() => navigate(`/principal/classes/${className}/${section.sectionName}`)}
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
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600, fontSize: '16px' }}>
                  {section.sectionName}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                  {section.studentsCount}
                </td>
                <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>
                  {section.classTeacher || '—'}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(section.attendancePct, THRESHOLDS.ATTENDANCE_LOW, section.studentsCount) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(section.attendancePct, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(section.homeworkPct, THRESHOLDS.HOMEWORK_LOW, section.studentsCount) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(section.homeworkPct, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(section.testAvg, THRESHOLDS.SUBJECT_MARKS_LOW, section.studentsCount) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(section.testAvg, { isPercent: true })}
                </td>
                <td style={{
                  ...TYPE.rowPrimary,
                  padding: '12px 16px',
                  fontFeatureSettings: '"tnum" 1',
                  color: shouldFlag(section.examAvg, THRESHOLDS.SUBJECT_MARKS_LOW, section.studentsCount) ? PALETTE.alert : PALETTE.ink
                }}>
                  {formatValue(section.examAvg, { isPercent: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sections.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
            No sections found
          </div>
        )}
      </div>
    </div>
  )
}
