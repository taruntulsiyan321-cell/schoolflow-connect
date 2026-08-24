import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { AttendanceService, AnalyticsService } from '@/academic'
import { useAcademicContext } from '@/academic/hooks/useAcademicContext'
import { localDateKey } from '@/lib/localDate'
import { AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react'

interface AttentionItem {
  id: string
  type: 'low-attendance' | 'low-homework' | 'unmarked-attendance' | 'marks-overdue'
  className: string
  section: string
  reason: string
  value: string
  severity: number
}

const ATTENDANCE_THRESHOLD = 75
const HOMEWORK_THRESHOLD = 60

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

      classRollups.forEach((cls) => {
        const attendancePct = cls.avgAttendancePct || 0
        const homeworkPct = cls.avgHomeworkCompletionPct || 0

        if (attendancePct < ATTENDANCE_THRESHOLD) {
          allItems.push({
            id: `low-attendance-${cls.classId}`,
            type: 'low-attendance',
            className: cls.className,
            section: cls.section || '',
            reason: 'Attendance below threshold',
            value: `${attendancePct.toFixed(1)}%`,
            severity: ATTENDANCE_THRESHOLD - attendancePct,
          })
        }

        if (homeworkPct < HOMEWORK_THRESHOLD) {
          allItems.push({
            id: `low-homework-${cls.classId}`,
            type: 'low-homework',
            className: cls.className,
            section: cls.section || '',
            reason: 'Homework completion low',
            value: `${homeworkPct.toFixed(1)}%`,
            severity: HOMEWORK_THRESHOLD - homeworkPct,
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
        padding: '12px 16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}>
        <div className="animate-pulse" style={{ fontSize: '13px', color: '#9CA3AF' }}>Loading...</div>
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

  // Compact
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '16px 20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          border: '2px solid #fef2f2',
          borderLeft: '4px solid #ef4444',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.15)'
          e.currentTarget.style.borderColor = '#fee2e2'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)'
          e.currentTarget.style.borderColor = '#fef2f2'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <div style={{
              background: '#ef4444',
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '12px',
              minWidth: '28px',
              textAlign: 'center',
              boxShadow: '0 2px 4px rgba(239,68,68,0.3)',
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

  // Expanded
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      border: '2px solid #fef2f2',
      borderLeft: '4px solid #ef4444',
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
            background: '#ef4444',
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
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              background: '#F9FAFB',
              borderRadius: '8px',
              borderLeft: '3px solid #ef4444',
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
                e.currentTarget.style.background = '#fee2e2'
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
                  background: '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <AlertCircle size={16} color="#ef4444" />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                    {item.className}{item.section && `-${item.section}`}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {item.reason}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444' }}>
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

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  console.log('Take action for:', item.className)
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#dc2626'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#ef4444'
                }}
              >
                Take Action
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
