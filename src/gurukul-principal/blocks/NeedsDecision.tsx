import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { tokens, daysWaiting } from '../design-tokens'
import { Loader2 } from 'lucide-react'

interface DecisionItem {
  type: 'leave' | 'complaint' | 'inquiry'
  count: number
  oldestDays: number
}

export function NeedsDecision() {
  const navigate = useNavigate()
  const { school } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<DecisionItem[]>([])

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
        // Fetch pending leave requests
        // CHUNK 8 BATCH 1b. This was `.eq('status', 'pending')` against the
        // stored column. Pending is now the ABSENCE of a decision row, so the
        // query embeds the decisions and filters on emptiness. It reads the
        // authority rather than the copy, and survives batch 1c dropping the
        // column.
        const { data: leaveRows, error: leavesErr } = await supabase
          .from('leave_requests')
          .select('created_at, leave_decisions(id)')
          .eq('school_id', school.id)
          .order('created_at', { ascending: true })
        if (leavesErr) throw leavesErr

        const leaves = (leaveRows ?? []).filter(
          (r) => ((r as { leave_decisions?: unknown[] }).leave_decisions ?? []).length === 0,
        )

        // Fetch open/in-progress complaints
        const { data: complaints, error: complaintsErr } = await supabase
          .from('school_complaints')
          .select('created_at')
          .eq('school_id', school.id)
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: true })

        if (complaintsErr) throw complaintsErr

        // Fetch open inquiries
        const { data: inquiries, error: inquiriesErr } = await supabase
          .from('school_inquiries')
          .select('created_at')
          .eq('school_id', school.id)
          .eq('status', 'open')
          .order('created_at', { ascending: true })

        if (inquiriesErr) throw inquiriesErr

        if (cancelled) return

        const result: DecisionItem[] = []

        if (leaves && leaves.length > 0) {
          result.push({
            type: 'leave',
            count: leaves.length,
            oldestDays: daysWaiting(leaves[0].created_at),
          })
        }

        if (complaints && complaints.length > 0) {
          result.push({
            type: 'complaint',
            count: complaints.length,
            oldestDays: daysWaiting(complaints[0].created_at),
          })
        }

        if (inquiries && inquiries.length > 0) {
          result.push({
            type: 'inquiry',
            count: inquiries.length,
            oldestDays: daysWaiting(inquiries[0].created_at),
          })
        }

        setItems(result.sort((a, b) => b.oldestDays - a.oldestDays)) // Oldest first
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load decision items')
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
          Needs a Decision
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
          Needs a Decision
        </h2>
        <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent }}>{error}</p>
      </div>
    )
  }

  const isEmpty = items.length === 0

  if (isEmpty) {
    return (
      <div style={{
        background: 'white',
        border: `1px solid ${tokens.color.positive}20`,
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
          Needs a Decision
        </h2>
        <p style={{
          fontSize: tokens.fontSize.body,
          fontWeight: tokens.fontWeight.medium,
          color: tokens.color.positive,
          margin: 0,
        }}>
          ✓ Nothing pending
        </p>
      </div>
    )
  }

  const getLabel = (type: string): string => {
    if (type === 'leave') return 'Leave Requests'
    if (type === 'complaint') return 'Complaints'
    return 'Inquiries'
  }

  const getPath = (type: string): string => {
    if (type === 'leave') return '/principal/leaves'
    if (type === 'complaint') return '/principal/cases'
    return '/principal/cases'
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
        Needs a Decision
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        {items.map((item) => (
          <button
            key={item.type}
            onClick={() => navigate(getPath(item.type))}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderLeft: `3px solid ${tokens.color.accent}`,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.md} ${tokens.space.lg}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${tokens.color.accent}03`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{
                fontSize: tokens.fontSize.body,
                fontWeight: tokens.fontWeight.medium,
                color: tokens.color.ink,
              }}>
                {getLabel(item.type)}
              </div>
              <div style={{
                fontSize: tokens.fontSize.small,
                color: tokens.color.inkMuted,
                marginTop: tokens.space.xs,
              }}>
                Oldest: {item.oldestDays} day{item.oldestDays !== 1 ? 's' : ''} ago
              </div>
            </div>
            <div style={{
              fontFamily: tokens.font.display,
              fontSize: tokens.fontSize.metric,
              fontWeight: tokens.fontWeight.bold,
              color: tokens.color.accent,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {item.count}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
