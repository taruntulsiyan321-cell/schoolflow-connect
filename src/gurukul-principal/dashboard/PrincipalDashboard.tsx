import { useMemo, useState } from 'react'
import { tokens } from '../design-tokens'
import { AttendanceHero } from '../blocks/AttendanceHero'
import { LoadingBlock, ErrorBlock } from './ui'
import { TeacherActivity } from './blocks/TeacherActivity'
import { NeedsAttention } from './blocks/NeedsAttention'
import { ExamReports } from './blocks/ExamReports'
import { FeesPanel } from './blocks/FeesPanel'
import { useExamSlot } from './useExamSlot'
import { useSchoolFees } from './useSchoolFees'
import { localDateKey } from '@/lib/localDate'
import type { ActivityWindow } from '@/academic/metrics/activity'

const RANGES: { label: string; days: number }[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

function daysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Principal Dashboard (Sept 2026 spec). Four full-width blocks, top to bottom:
 *   1. Attendance today      (§3, the only "today" block)
 *   2. The switching slot     (§4 — exam reports while an exam runs, else fees)
 *   3. Teacher activity        (§6, the accountability surface)
 *   4. Needs attention         (§7, muted)
 * When an exam occupies the slot, fees drops back to a card (§4/§8).
 */
export default function PrincipalDashboard() {
  const [rangeDays, setRangeDays] = useState(30)

  const window: ActivityWindow = useMemo(
    () => ({ from: daysAgoKey(rangeDays), to: localDateKey() }),
    [rangeDays],
  )

  const { slot, loading: slotLoading, error: slotError } = useExamSlot()
  const { data: fees, loading: feesLoading, error: feesError } = useSchoolFees()

  const examRunning = slot.running
  const unmarkedSubjectsCount = slot.marking.reduce(
    (sum, r) => sum + Math.max(0, r.subjectsTotal - r.subjectsMarked),
    0,
  )
  const unpaidPastDueCount = fees?.unpaidPastDue.length ?? 0

  return (
    <div style={{ background: tokens.color.ground, minHeight: '100vh', padding: `${tokens.space.xl} ${tokens.space.lg}`, fontFamily: tokens.font.body }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xl, maxWidth: '1000px', margin: '0 auto' }}>
        {/* Page range control. Attendance is always "today"; this governs the
            range-dependent blocks (teacher activity). Whether it should govern
            the whole page is an open question in the spec (§9). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: tokens.space.sm }}>
          <span style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted }}>Range</span>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              style={{
                background: rangeDays === r.days ? tokens.color.ink : 'white',
                color: rangeDays === r.days ? 'white' : tokens.color.ink,
                border: `1px solid ${rangeDays === r.days ? tokens.color.ink : tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                padding: `${tokens.space.xs} ${tokens.space.sm}`,
                fontSize: tokens.fontSize.small,
                fontWeight: tokens.fontWeight.medium,
                cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 1. Attendance today — always first. */}
        <AttendanceHero />

        {/* 2. Switching slot. */}
        {slotLoading || feesLoading ? (
          <LoadingBlock title={examRunning ? 'Exam reports' : 'Fees'} />
        ) : slotError ? (
          <ErrorBlock title="Exam reports" message={slotError} />
        ) : examRunning ? (
          <ExamReports ready={slot.ready} marking={slot.marking} />
        ) : (
          <FeesPanel variant="expanded" data={fees} loading={feesLoading} error={feesError} />
        )}

        {/* 3. Teacher activity. */}
        <TeacherActivity window={window} />

        {/* Fees drops to a card here when an exam holds the slot (§4/§8). */}
        {examRunning && <FeesPanel variant="card" data={fees} loading={feesLoading} error={feesError} />}

        {/* 4. Needs attention — muted, last. */}
        <NeedsAttention unpaidPastDueCount={unpaidPastDueCount} unmarkedSubjectsCount={unmarkedSubjectsCount} />
      </div>
    </div>
  )
}
