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
        // TODO: Load actual sections for this class
        // Mock data for now
        setSections([
          {
            sectionId: '1',
            sectionName: 'A',
            studentsCount: 35,
            classTeacher: 'Mrs. Sharma',
            attendancePct: 92,
            homeworkPct: 78,
            testAvg: 72,
            examAvg: 75,
          },
          {
            sectionId: '2',
            sectionName: 'B',
            studentsCount: 32,
            classTeacher: 'Mr. Gupta',
            attendancePct: 88,
            homeworkPct: 71,
            testAvg: 68,
            examAvg: 70,
          },
          {
            sectionId: '3',
            sectionName: 'C',
            studentsCount: 38,
            classTeacher: 'Ms. Patel',
            attendancePct: 85,
            homeworkPct: 82,
            testAvg: 76,
            examAvg: 78,
          },
        ])
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
