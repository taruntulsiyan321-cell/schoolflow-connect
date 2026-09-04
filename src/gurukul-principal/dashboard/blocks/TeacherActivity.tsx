import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tokens } from '../../design-tokens'
import { Block, LoadingBlock, ErrorBlock, AllClear } from '../ui'
import { useTeacherActivity } from '../useTeacherActivity'
import type { ActivityWindow } from '@/academic/metrics/activity'

/**
 * Teacher activity (§6). Full width — the principal's main accountability
 * surface. Per teacher: tests given · homework given, over the selected range.
 * COUNTS ONLY, never the reports.
 *
 * Most-active-first on the card (owner's ruling; the flip lives inside the full
 * list — my least-active-first argument is noted in the spec, ruled otherwise).
 */
export function TeacherActivity({ window }: { window: ActivityWindow }) {
  const navigate = useNavigate()
  const { rows, loading, error } = useTeacherActivity(window)
  const [expanded, setExpanded] = useState(false)
  const [leastFirst, setLeastFirst] = useState(false)

  const ordered = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => (leastFirst ? a.total - b.total : b.total - a.total))
    return copy
  }, [rows, leastFirst])

  if (loading) return <LoadingBlock title="Teacher activity" />
  if (error) return <ErrorBlock title="Teacher activity" message={error} />
  if (rows.length === 0) {
    return (
      <Block title="Teacher activity">
        <AllClear message="No teachers on record for this school yet." />
      </Block>
    )
  }

  const visible = expanded ? ordered : ordered.slice(0, 3)

  return (
    <Block
      title="Teacher activity"
      right={
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: tokens.fontSize.small,
            fontWeight: tokens.fontWeight.semibold,
            color: tokens.color.inkMuted,
          }}
        >
          {expanded ? 'Show top 3' : `All ${rows.length} teachers`}
        </button>
      }
    >
      {expanded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.space.md }}>
          <button
            onClick={() => setLeastFirst((v) => !v)}
            style={{
              background: 'none',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.xs} ${tokens.space.sm}`,
              cursor: 'pointer',
              fontSize: tokens.fontSize.small,
              color: tokens.color.ink,
            }}
          >
            {leastFirst ? 'Most active first' : 'Least active first'}
          </button>
        </div>
      )}

      {/* Column header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: `${tokens.space.sm} ${tokens.space.xl}`,
          fontSize: tokens.fontSize.small,
          color: tokens.color.inkMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: `0 ${tokens.space.sm} ${tokens.space.sm}`,
        }}
      >
        <span>Teacher</span>
        <span style={{ textAlign: 'right' }}>Tests</span>
        <span style={{ textAlign: 'right' }}>Homework</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: `${tokens.space.xs} ${tokens.space.xl}` }}>
        {visible.map((t) => (
          <button
            key={t.teacherId}
            onClick={() => navigate(`/principal/teachers/${t.teacherId}`)}
            style={{
              display: 'contents',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontSize: tokens.fontSize.body,
                fontWeight: tokens.fontWeight.medium,
                color: tokens.color.ink,
                textAlign: 'left',
                padding: `${tokens.space.sm} ${tokens.space.sm}`,
              }}
            >
              {t.name}
            </span>
            <span
              style={{
                fontFamily: tokens.font.display,
                fontVariantNumeric: 'tabular-nums',
                color: tokens.color.ink,
                textAlign: 'right',
                padding: `${tokens.space.sm} 0`,
              }}
            >
              {t.tests}
            </span>
            <span
              style={{
                fontFamily: tokens.font.display,
                fontVariantNumeric: 'tabular-nums',
                color: tokens.color.ink,
                textAlign: 'right',
                padding: `${tokens.space.sm} 0`,
              }}
            >
              {t.homework}
            </span>
          </button>
        ))}
      </div>

      <p
        style={{
          fontSize: tokens.fontSize.small,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.md} 0 0`,
        }}
      >
        Counts of tests and homework given{' '}
        {window.from === window.to ? `on ${window.from}` : `from ${window.from} to ${window.to}`}. Reports
        are not shown here.
      </p>
    </Block>
  )
}
