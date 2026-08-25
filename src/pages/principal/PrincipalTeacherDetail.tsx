/**
 * Teacher Detail Page - Part B.2
 *
 * Three tabs: ACTIVITY, CLASSES, ASSESSMENTS
 * Only selected tab renders (not CSS hidden)
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { PALETTE, TYPE, formatValue, shouldFlag } from '@/gurukul-principal/shared/palette'
import { ChevronLeft } from 'lucide-react'

type Tab = 'ACTIVITY' | 'CLASSES' | 'ASSESSMENTS'

interface TeacherProfile {
  id: string
  name: string
  subjects: string[]
  classTeacherOf: string | null
}

interface ClassRow {
  sectionId: string
  className: string
  sectionName: string
  subjectName: string
  studentsCount: number
  homeworkCount: number
  testsCount: number
  marksPending: number
}

interface AssessmentRow {
  id: string
  type: 'Homework' | 'Test'
  title: string
  sectionName: string
  subjectName: string
  dueDate: string
  submitted: number
  total: number
  marksEntered: number
}

interface ActivityItem {
  date: string
  action: string
  target: string
}

export default function PrincipalTeacherDetail() {
  const { teacherId } = useParams<{ teacherId: string }>()
  const navigate = useNavigate()
  const { school } = useAuth()
  const [selectedTab, setSelectedTab] = useState<Tab>('ACTIVITY')
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null)
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [assessments, setAssessments] = useState<AssessmentRow[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!school?.id || !teacherId) return

    const loadTeacher = async () => {
      setLoading(true)

      try {
        const { data: teacherData } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('id', teacherId)
          .single()

        if (!teacherData) {
          setLoading(false)
          return
        }

        // TODO: Load actual data
        setTeacher({
          id: teacherData.id,
          name: teacherData.full_name,
          subjects: ['Mathematics', 'Physics'],
          classTeacherOf: null,
        })

        // Mock classes
        setClasses([
          {
            sectionId: '1',
            className: 'Class 10',
            sectionName: 'A',
            subjectName: 'Mathematics',
            studentsCount: 35,
            homeworkCount: 12,
            testsCount: 4,
            marksPending: 0,
          },
          {
            sectionId: '2',
            className: 'Class 10',
            sectionName: 'B',
            subjectName: 'Mathematics',
            studentsCount: 32,
            homeworkCount: 12,
            testsCount: 4,
            marksPending: 35,
          },
        ])

        // Mock assessments
        setAssessments([
          {
            id: '1',
            type: 'Homework',
            title: 'Chapter 5 Exercise',
            sectionName: '10-A',
            subjectName: 'Mathematics',
            dueDate: '2026-08-20',
            submitted: 32,
            total: 35,
            marksEntered: 32,
          },
          {
            id: '2',
            type: 'Test',
            title: 'Unit Test 2',
            sectionName: '10-B',
            subjectName: 'Mathematics',
            dueDate: '2026-08-18',
            submitted: 32,
            total: 32,
            marksEntered: 0,
          },
        ])

        // Mock activity
        setActivity([
          { date: '2026-08-24', action: 'Entered marks', target: 'Unit Test 2 - 10-A Mathematics' },
          { date: '2026-08-23', action: 'Created homework', target: 'Chapter 5 Exercise - 10-A Mathematics' },
          { date: '2026-08-22', action: 'Entered marks', target: 'Quiz 3 - 10-B Mathematics' },
        ])
      } catch (error) {
        console.error('Failed to load teacher:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTeacher()
  }, [school?.id, teacherId])

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

  if (!teacher) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ ...TYPE.rowSecondary }}>Teacher not found</div>
      </div>
    )
  }

  return (
    <div style={{ background: PALETTE.ground, minHeight: '100vh', padding: '16px' }}>
      {/* Header with back button */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/principal/teachers')}
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
          Back to Teachers
        </button>

        <h1 style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink, margin: 0, marginBottom: '4px' }}>
          {teacher.name}
        </h1>
        <div style={{ ...TYPE.rowSecondary }}>
          {teacher.subjects.join(', ')}
          {teacher.classTeacherOf && ` · Class Teacher of ${teacher.classTeacherOf}`}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '24px',
        borderBottom: `1px solid ${PALETTE.border}`,
        marginBottom: '24px',
      }}>
        {(['ACTIVITY', 'CLASSES', 'ASSESSMENTS'] as Tab[]).map((tab) => (
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
                  <div style={{ ...TYPE.rowSecondary, marginBottom: '4px', fontSize: '12px' }}>
                    {item.date}
                  </div>
                  <div style={{ ...TYPE.rowPrimary }}>
                    {item.action} · {item.target}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedTab === 'CLASSES' && (
        <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
                {['CLASS', 'SECTION', 'SUBJECT', 'STUDENTS', 'HOMEWORK', 'TESTS', 'MARKS PENDING'].map((label) => (
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
              {classes.map((cls, i) => (
                <tr
                  key={cls.sectionId}
                  onClick={() => navigate(`/principal/classes/${cls.sectionId}`)}
                  style={{
                    background: i % 2 === 0 ? 'transparent' : PALETTE.ground,
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>{cls.className}</td>
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600 }}>{cls.sectionName}</td>
                  <td style={{ ...TYPE.rowSecondary, padding: '12px 16px' }}>{cls.subjectName}</td>
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>{cls.studentsCount}</td>
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>{cls.homeworkCount}</td>
                  <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>{cls.testsCount}</td>
                  <td style={{
                    ...TYPE.rowPrimary,
                    padding: '12px 16px',
                    fontFeatureSettings: '"tnum" 1',
                    color: cls.marksPending > 0 ? PALETTE.alert : PALETTE.ink
                  }}>
                    {cls.marksPending > 0 ? cls.marksPending : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {classes.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
              No classes assigned
            </div>
          )}
        </div>
      )}

      {selectedTab === 'ASSESSMENTS' && (
        <div style={{ background: PALETTE.surface, borderRadius: '8px', border: `1px solid ${PALETTE.border}`, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
                {['TYPE', 'TITLE', 'SECTION', 'SUBJECT', 'DUE DATE', 'SUBMITTED', 'MARKS ENTERED'].map((label) => (
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
              {assessments.map((assessment, i) => {
                const submittedPct = Math.round((assessment.submitted / assessment.total) * 100)
                const markedPct = Math.round((assessment.marksEntered / assessment.submitted) * 100)

                return (
                  <tr
                    key={assessment.id}
                    style={{
                      background: i % 2 === 0 ? 'transparent' : PALETTE.ground,
                    }}
                  >
                    <td style={{ ...TYPE.rowSecondary, padding: '12px 16px', fontSize: '12px' }}>
                      {assessment.type.toUpperCase()}
                    </td>
                    <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontWeight: 600 }}>{assessment.title}</td>
                    <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>{assessment.sectionName}</td>
                    <td style={{ ...TYPE.rowSecondary, padding: '12px 16px' }}>{assessment.subjectName}</td>
                    <td style={{ ...TYPE.rowPrimary, padding: '12px 16px' }}>{assessment.dueDate}</td>
                    <td style={{ ...TYPE.rowPrimary, padding: '12px 16px', fontFeatureSettings: '"tnum" 1' }}>
                      {assessment.submitted}/{assessment.total} ({submittedPct}%)
                    </td>
                    <td style={{
                      ...TYPE.rowPrimary,
                      padding: '12px 16px',
                      fontFeatureSettings: '"tnum" 1',
                      color: assessment.marksEntered < assessment.submitted ? PALETTE.alert : PALETTE.ink
                    }}>
                      {assessment.marksEntered}/{assessment.submitted} ({isNaN(markedPct) ? 0 : markedPct}%)
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {assessments.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', ...TYPE.rowSecondary }}>
              No assessments found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
