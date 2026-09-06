import { useNavigate } from 'react-router-dom'
import { tokens } from '../../design-tokens'
import { Block, LoadingBlock, ErrorBlock, NotSet } from '../ui'
import { type SchoolFees, type FeesClassRow } from '../useSchoolFees'
import { FEE_COLLECTION_HEALTHY, FEE_COLLECTION_LOW, type FeeCollectionBand } from '@/finance/metrics'

function bandColor(band: FeeCollectionBand): string {
  if (band === 'healthy') return tokens.color.positive
  if (band === 'partial') return tokens.color.warning
  if (band === 'low') return tokens.color.accent
  return tokens.color.inkMuted // unknown
}

function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function Kpis({ data }: { data: SchoolFees }) {
  const pctColor = bandColor(data.band)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: tokens.space.lg }}>
      <div>
        <div style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Collected
        </div>
        <div style={{ fontFamily: tokens.font.display, fontSize: tokens.fontSize.metric, fontWeight: tokens.fontWeight.bold, color: pctColor, fontVariantNumeric: 'tabular-nums' }}>
          {data.collectedPct === null ? 'not set' : `${data.collectedPct}%`}
        </div>
      </div>
      <div>
        <div style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Pending
        </div>
        <div style={{ fontFamily: tokens.font.display, fontSize: tokens.fontSize.metric, fontWeight: tokens.fontWeight.bold, color: tokens.color.ink, fontVariantNumeric: 'tabular-nums' }}>
          {inr(data.pending)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Students unpaid
        </div>
        <div style={{ fontFamily: tokens.font.display, fontSize: tokens.fontSize.metric, fontWeight: tokens.fontWeight.bold, color: tokens.color.ink, fontVariantNumeric: 'tabular-nums' }}>
          {data.studentsUnpaid}
        </div>
      </div>
    </div>
  )
}

function ClassRow({ row, onOpen }: { row: FeesClassRow; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: tokens.space.lg,
        alignItems: 'center',
        background: 'white',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.sm,
        padding: `${tokens.space.sm} ${tokens.space.md}`,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: tokens.fontSize.body, fontWeight: tokens.fontWeight.medium, color: tokens.color.ink }}>
        {row.classLabel}
      </span>
      <span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, fontVariantNumeric: 'tabular-nums' }}>
        {row.collectedPct === null ? '' : `${row.unpaidStudents} unpaid`}
      </span>
      <span
        style={{
          fontFamily: tokens.font.display,
          fontWeight: tokens.fontWeight.bold,
          color: bandColor(row.band),
          fontVariantNumeric: 'tabular-nums',
          minWidth: 64,
          textAlign: 'right',
        }}
      >
        {row.collectedPct === null ? 'not set' : `${row.collectedPct}%`}
      </span>
    </button>
  )
}

/**
 * Fees (§4 fills the switching slot when no exam runs; §8 card otherwise).
 * "Not set" classes show "not set" and are excluded from percentages (§10).
 */
export function FeesPanel({
  variant,
  data,
  loading,
  error,
}: {
  variant: 'expanded' | 'card'
  data: SchoolFees | null
  loading: boolean
  error: string | null
}) {
  const navigate = useNavigate()

  if (loading) return <LoadingBlock title="Fees" />
  if (error) return <ErrorBlock title="Fees" message={error} />
  if (!data) return <Block title="Fees"><NotSet message="No fees data." /></Block>
  if (!data.enabled) {
    return (
      <Block title="Fees">
        <NotSet message="Fees are turned off for this school." />
      </Block>
    )
  }

  // §8 card: KPIs only; opens into the class list.
  if (variant === 'card') {
    return (
      <Block title="Fees" right={<span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted }}>tap to open</span>}>
        <div onClick={() => navigate('/principal/classes')} style={{ cursor: 'pointer' }}>
          <Kpis data={data} />
        </div>
      </Block>
    )
  }

  // §4 expanded: class-wise breakdown visible, worst-first.
  return (
    <Block title="Fees">
      <Kpis data={data} />
      <div
        style={{
          fontSize: tokens.fontSize.small,
          color: tokens.color.inkMuted,
          margin: `${tokens.space.lg} 0 ${tokens.space.sm}`,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        By class — lowest collection first (healthy ≥ {FEE_COLLECTION_HEALTHY}%, below {FEE_COLLECTION_LOW}% is a problem)
      </div>
      {data.classes.length === 0 ? (
        <NotSet message="No classes to show." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          {data.classes.map((c) => (
            <ClassRow key={c.classId} row={c} onOpen={() => navigate('/principal/classes')} />
          ))}
        </div>
      )}
    </Block>
  )
}
