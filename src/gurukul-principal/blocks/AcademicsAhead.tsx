import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { tokens } from '../design-tokens'
import { Loader2 } from 'lucide-react'

interface AcademicEvent {
  id: string
  title: string
  event_date: string
  event_type: string
  class_id?: string | null
  class_name?: string
  section?: string
  subject?: string
}

export function AcademicsAhead() {
  const navigate = useNavigate()
  const { school } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AcademicEvent[]>([])

  useEffect(() => {
    if (!school?.id) {
      setLoading(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        const today = new Date().toISOString().split('T')[0]

        // Real table is `school_calendar_events`; there is no `school_events`.
        // Its date column is `starts_at` (timestamptz), not `event_date`.
        const { data, error: eventsErr } = await supabase
          .from('school_calendar_events')
          .select('id, title, starts_at, event_type, class_id')
          .eq('school_id', school.id)
          .gte('starts_at', today)
          .order('starts_at', { ascending: true })
          .limit(5)

        if (eventsErr) throw eventsErr
        if (cancelled) return

        setEvents(
          (data ?? []).map((e) => ({
            id: e.id,
            title: e.title,
            event_date: e.starts_at,
            event_type: String(e.event_type),
            class_id: e.class_id,
          })),
        )
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load calendar')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [school?.id])

  if (loading) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.lg}`,
        }}>
          Academics Ahead
        </h2>
        <Loader2 className="animate-spin" size={20} color={tokens.color.inkMuted} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.accent}20`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Academics Ahead
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  const isEmpty = events.length === 0

  if (isEmpty) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}>
        <h2 style={{
          fontSize: tokens.fontSize.blockTitle,
          fontWeight: tokens.fontWeight.semibold,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: tokens.color.inkMuted,
          margin: `0 0 ${tokens.space.md}`,
        }}>
          Academics Ahead
        </h2>
        <p style={{
          fontSize: tokens.fontSize.body,
          color: tokens.color.inkMuted,
          margin: 0,
        }}>
          No upcoming exams or events
        </p>
      </div>
    )
  }

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }

  return (
    <div style={{
      background: 'white',
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space.xl,
    }}>
      <h2 style={{
        fontSize: tokens.fontSize.blockTitle,
        fontWeight: tokens.fontWeight.semibold,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: tokens.color.inkMuted,
        margin: `0 0 ${tokens.space.lg}`,
      }}>
        Academics Ahead
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        {events.map((event) => (
          <button
            key={event.id}
            onClick={() => navigate('/principal/exams')}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.sm} ${tokens.space.md}`,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = tokens.color.borderSubtle
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.md }}>
              <div style={{
                fontSize: tokens.fontSize.label,
                fontWeight: tokens.fontWeight.bold,
                color: tokens.color.ink,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatDate(event.event_date)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: tokens.fontSize.body,
                  fontWeight: tokens.fontWeight.medium,
                  color: tokens.color.ink,
                }}>
                  {event.title}
                </div>
                {event.class_name && (
                  <div style={{
                    fontSize: tokens.fontSize.small,
                    color: tokens.color.inkMuted,
                    marginTop: tokens.space.xs,
                  }}>
                    {event.class_name}{event.section && `-${event.section}`}
                    {event.subject && ` • ${event.subject}`}
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
