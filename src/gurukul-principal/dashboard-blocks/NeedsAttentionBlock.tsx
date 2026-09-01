import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { AttendanceService, AnalyticsService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { ATTENDANCE_LOW, HOMEWORK_LOW } from '@/academic/metrics/thresholds'
import { AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react'

interface AttentionItem {
  id: string
  type: 'low-attendance' | 'low-homework' | 'unmarked-attendance' | 'marks-overdue'
  className: string
  section: string
  reason: string
  value: string
  severity: number
  teacherName?: string
  teacherId?: string
}

// Chunk 10: both were declared here. ATTENDANCE_THRESHOLD was 75 while the
// thresholds module and every other screen flag below 80 — the same concept
// carrying two different numbers, which is exactly what a second home for a
// threshold does and why it is not visible until something compares them.
const ATTENDANCE_THRESHOLD = ATTENDANCE_LOW
const HOMEWORK_THRESHOLD = HOMEWORK_LOW

export function NeedsAttentionBlock() {
  const { school, profile } = useAuth()
  const { ctx, settled } = useAcademicContext()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<AttentionItem[]>([])

  const load = async () => {
    if (!school?.id || !settled || !ctx) return

    setLoading(true)
    const allItems: AttentionItem[] = []

    try {
      const classRollups = await AnalyticsService.classRollups(ctx)

      // Load class teachers for messaging
      const { data: classes } = await supabase
        .from('classes')
        // class_teacher_id points at `teachers`, not a public.users table
        // (which does not exist in this schema).
        .select('id, class_teacher_id, teachers(full_name)')
        .eq('school_id', ctx.schoolId)

      const teacherMap = new Map(
        classes?.map(c => [c.id, { id: c.class_teacher_id, name: c.teachers?.full_name || 'Unknown' }]) || []
      )

      classRollups.forEach((cls) => {
        const teacher = teacherMap.get(cls.classId)
        const attendancePct = cls.avgAttendancePct || 0
        const homeworkPct = cls.avgHomeworkCompletionPct || 0

        // Fix 1: Guard threshold checks - only flag if we have data (studentCount > 0)
        const hasStudents = cls.studentCount > 0

        if (hasStudents && attendancePct > 0 && attendancePct < ATTENDANCE_THRESHOLD) {
          allItems.push({
            id: `low-attendance-${cls.classId}`,
            type: 'low-attendance',
            className: cls.className,
            section: cls.section || '',
            reason: 'Attendance below threshold',
            value: `${attendancePct.toFixed(1)}%`,
            severity: ATTENDANCE_THRESHOLD - attendancePct,
            teacherName: teacher?.name,
            teacherId: teacher?.id,
          })
        }

        if (hasStudents && homeworkPct > 0 && homeworkPct < HOMEWORK_THRESHOLD) {
          allItems.push({
            id: `low-homework-${cls.classId}`,
            type: 'low-homework',
            className: cls.className,
            section: cls.section || '',
            reason: 'Homework completion low',
            value: `${homeworkPct.toFixed(1)}%`,
            severity: HOMEWORK_THRESHOLD - homeworkPct,
            teacherName: teacher?.name,
            teacherId: teacher?.id,
          })
        }
      })

      allItems.sort((a, b) => b.severity - a.severity)
      setItems(allItems.slice(0, 6))

    } catch (error) {
      console.error('Failed to load attention items:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [school?.id, settled, ctx])

  const dismissItem = (itemId: string) => {
    setItems(items.filter(i => i.id !== itemId))
  }

  if (loading) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          NEEDS ATTENTION
        </div>
        {/* Skeleton */}
        <div className="animate-pulse" style={{ height: '60px', background: '#F3F4F6', borderRadius: '6px' }} />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        border: '1px solid #d1fae5',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981' }}>
          ✓ All clear
        </div>
      </div>
    )
  }

  // Compact (Fix 2: not red, just informative)
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '16px 20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          border: '2px solid #F3F4F6',
          borderLeft: '4px solid #9CA3AF',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <div style={{
              background: '#1F2937',
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '12px',
              minWidth: '28px',
              textAlign: 'center',
            }}>
              {items.length}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Needs Attention
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                Classes below threshold
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <ChevronDown size={20} color="#9CA3AF" />
            <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 500 }}>Click to expand</div>
          </div>
        </div>
      </button>
    )
  }

  // Expanded (Fix 2: neutral header color)
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      border: '2px solid #F3F4F6',
      borderLeft: '4px solid #9CA3AF',
    }}>
      <button
        onClick={() => setExpanded(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          marginBottom: '12px',
          padding: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: '#1F2937',
            color: 'white',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '10px',
          }}>
            {items.length}
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', margin: 0 }}>
            Needs Attention
          </h3>
        </div>
        <ChevronUp size={18} color="#9CA3AF" />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((item) => {
          // Fix 2: Only red for real problems
          const isProblem = parseFloat(item.value) < (item.type === 'low-attendance' ? ATTENDANCE_THRESHOLD : HOMEWORK_THRESHOLD)
          const valueColor = isProblem ? '#ef4444' : '#1F2937'

          return (
            <div
              key={item.id}
              style={{
                background: '#F9FAFB',
                borderRadius: '8px',
                borderLeft: `3px solid ${isProblem ? '#ef4444' : '#9CA3AF'}`,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => console.log('View class:', item.className)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F3F4F6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: isProblem ? '#fee2e2' : '#F3F4F6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <AlertCircle size={16} color={isProblem ? '#ef4444' : '#6B7280'} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                      {item.className}{item.section && `-${item.section}`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>
                      {item.reason} • {item.teacherName || 'Class teacher'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: valueColor }}>
                      {item.value}
                    </div>
                    <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 500 }}>
                      Click to view →
                    </div>
                  </div>
                </div>
              </button>

              <div style={{
                padding: '0 12px 12px 12px',
                display: 'flex',
                gap: '8px',
              }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissItem(item.id)
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#6B7280',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f3f4f6'
                    e.currentTarget.style.borderColor = '#d1d5db'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white'
                    e.currentTarget.style.borderColor = '#e5e7eb'
                  }}
                >
                  <X size={14} />
                  Dismiss
                </button>

                {/* Fix 6: Specific action labels */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    console.log('Message teacher:', item.teacherId, item.teacherName)
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: '#1F2937',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#111827'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#1F2937'
                  }}
                >
                  Message teacher
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
