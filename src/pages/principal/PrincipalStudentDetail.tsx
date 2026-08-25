/**
 * Student Detail Page - Part C.2
 *
 * Three tabs: OVERVIEW, ACADEMICS, ACTIVITY
 * Only selected tab renders (not CSS hidden)
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE, formatValue, shouldFlag } from '@/gurukul-principal/shared/palette'
import { THRESHOLDS } from '@/gurukul-principal/analysis/thresholds'
import { ChevronLeft } from 'lucide-react'

type Tab = 'OVERVIEW' | 'ACADEMICS' | 'ACTIVITY'

interface StudentProfile {
  id: string
  rollNumber: string
  name: string
  className: string
  sectionName: string
  parentName: string
  parentPhone: string
  attendancePct: number | null
  homeworkPct: number | null
}

interface SubjectRow {
  subjectName: string
  teacher: string
  testAvg: number | null
  examAvg: number | null
  overallAvg: number | null
}

interface ActivityItem {
  date: string
  type: string
  description: string
}

export default function PrincipalStudentDetail() {
  const { studentId } = useParams<{ studentId: string }>()
  const navigate = useNavigate()
  const { school } = useAuth()
  const [selectedTab, setSelectedTab] = useState<Tab>('OVERVIEW')
  const [student, setStudent] = useState<StudentProfile | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id || !studentId) return

    const loadStudent = async () => {
      setLoading(true)

      try {
        const { data: studentData } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('id', studentId)
          .single()

        if (!studentData) {
          setLoading(false)
          return
        }

        // TODO: Load actual data
        setStudent({
          id: studentData.id,
          rollNumber: '15',
          name: studentData.full_name,
          className: 'Class 10',
          sectionName: 'A',
          parentName: 'Rajesh Kumar',
          parentPhone: '+91 98765 43210',
          attendancePct: 78,
          homeworkPct: 65,
        })

        // Mock subjects
        setSubjects([
          { subjectName: 'Mathematics', teacher: 'Mrs. Sharma', testAvg: 68, examAvg: 72, overallAvg: 70 },
          { subjectName: 'Physics', teacher: 'Mr. Gupta', testAvg: 62, examAvg: 58, overallAvg: 60 },
          { subjectName: 'Chemistry', teacher: 'Ms. Patel', testAvg: 75, examAvg: 78, overallAvg: 76 },
          { subjectName: 'English', teacher: 'Mrs. Singh', testAvg: 82, examAvg: 85, overallAvg: 83 },
        ])

        // Mock activity
        setActivity([
          { date: '2026-08-24', type: 'Absence', description: 'Absent from school' },
          { date: '2026-08-22', type: 'Homework', description: 'Failed to submit Mathematics homework' },
          { date: '2026-08-20', type: 'Test', description: 'Scored 42% in Physics test' },
        ])
      } catch (error) {
        console.error('Failed to load student:', error)
      } finally {
        setLoading(false)
      }
    }

    loadStudent()
  }, [school?.id, studentId])

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

  if (!student) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ ...TYPE.rowSecondary }}>Student not found</div>
      </div>
    )
  }

  return (
    <div style={{ background: PALETTE.ground, minHeight: '100vh', padding: '16px' }}>
      {/* Header with back button */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/principal/students')}
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
          Back to Students
        </button>

        <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0, marginBottom: '4px' }}>
          {student.name}
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          Roll {student.rollNumber} · {student.className}-{student.sectionName}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '24px',
        borderBottom: `1px solid ${PALETTE.border}`,
        marginBottom: '24px',
      }}>
        {(['OVERVIEW', 'ACADEMICS', 'ACTIVITY'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            style={{
              padding: '12px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: selectedTab === tab ? `2px solid ${PALETTE.ink}` : '2px solid transparent',
              ...TYPE.rowPrimary,
              fontWeight: selectedTab === tab ? 600 : 500,
              color: selectedTab === tab ? PALETTE.ink : PALETTE.inkMuted,
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content - only selected renders */}
      {selectedTab === 'OVERVIEW' && (
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {/* Contact Info */}
          <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, padding: '16px' }}>
            <div style={{ ...TYPE.sectionLabel, marginBottom: '12px' }}>CONTACT</div>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ ...TYPE.rowSecondary, marginBottom: '2px' }}>Parent</div>
              <div style={{ ...TYPE.rowPrimary }}>{student.parentName}</div>
            </div>
            <div>
              <div style={{ ...TYPE.rowSecondary, marginBottom: '2px' }}>Phone</div>
              <div style={{ ...TYPE.rowPrimary }}>{student.parentPhone}</div>
            </div>
          </div>

          {/* Attendance */}
          <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, padding: '16px' }}>
            <div style={{ ...TYPE.sectionLabel, marginBottom: '12px' }}>ATTENDANCE</div>
            <div style={{
              fontSize: '32px',
              fontWeight: 600,
              color: shouldFlag(student.attendancePct, THRESHOLDS.ATTENDANCE_LOW) ? PALETTE.alert : PALETTE.ink
            }}>
              {formatValue(student.attendancePct, { isPercent: true })}
            </div>
            <div style={{ ...TYPE.rowSecondary, marginTop: '4px' }}>This term</div>
          </div>

          {/* Homework */}
          <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, padding: '16px' }}>
            <div style={{ ...TYPE.sectionLabel, marginBottom: '12px' }}>HOMEWORK</div>
            <div style={{
              fontSize: '32px',
              fontWeight: 600,
              color: shouldFlag(student.homeworkPct, THRESHOLDS.HOMEWORK_LOW) ? PALETTE.alert : PALETTE.ink
            }}>
              {formatValue(student.homeworkPct, { isPercent: true })}
            </div>
            <div style={{ ...TYPE.rowSecondary, marginTop: '4px' }}>Completion rate</div>
          </div>
        </div>
      )}

      {selectedTab === 'ACADEMICS' && (
        <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
                {['SUBJECT', 'TEACHER', 'TEST AVG', 'EXAM AVG', 'OVERALL'].map((label) => (
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
              {subjects.map((subject, i) => (
                <tr
                  key={subject.subjectName}
                  style={{
                    background: i % 2 === 0 ? 'transparent' : PALETTE.ground,
                  }}
                >
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600 }}>
                    {subject.subjectName}
                  </td>
                  <td style={{ ...TYPE.rowSecondary, padding: '12px 16px' }}>{subject.teacher}</td>
                  <td style={{
                    ...TYPE.rowPrimary,
                    padding: '12px 16px',
                    fontFeatureSettings: '"tnum" 1',
                    color: shouldFlag(subject.testAvg, THRESHOLDS.SUBJECT_MARKS_LOW) ? PALETTE.alert : PALETTE.ink
                  }}>
                    {formatValue(subject.testAvg, { isPercent: true })}
                  </td>
                  <td style={{
                    ...TYPE.rowPrimary,
                    padding: '12px 16px',
                    fontFeatureSettings: '"tnum" 1',
                    color: shouldFlag(subject.examAvg, THRESHOLDS.SUBJECT_MARKS_LOW) ? PALETTE.alert : PALETTE.ink
                  }}>
                    {formatValue(subject.examAvg, { isPercent: true })}
                  </td>
                  <td style={{
                    ...TYPE.rowPrimary,
                    padding: '12px 16px',
                    fontFeatureSettings: '"tnum" 1',
                    fontWeight: 600,
                    color: shouldFlag(subject.overallAvg, THRESHOLDS.SUBJECT_MARKS_LOW) ? PALETTE.alert : PALETTE.ink
                  }}>
                    {formatValue(subject.overallAvg, { isPercent: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedTab === 'ACTIVITY' && (
        <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}` }}>
          {activity.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
              No recent activity
            </div>
          ) : (
            <div>
              {activity.map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: '16px',
                    borderBottom: i < activity.length - 1 ? `1px solid ${PALETTE.border}` : 'none',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start'
                  }}>
                    <div style={{ flex: '0 0 auto', minWidth: '80px' }}>
                      <div style={{ ...TYPE.rowSecondary, fontSize: '12px' }}>{item.date}</div>
                    </div>
                    <div style={{ flex: '0 0 auto', minWidth: '80px' }}>
                      <div style={{
                        ...TYPE.rowSecondary,
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        letterSpacing: '0.05em'
                      }}>
                        {item.type}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ ...TYPE.rowPrimary }}>{item.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
