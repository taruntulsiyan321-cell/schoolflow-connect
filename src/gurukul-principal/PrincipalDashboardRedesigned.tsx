import { tokens } from './design-tokens'
import { AttendanceHero } from './blocks/AttendanceHero'
import { NeedsDecision } from './blocks/NeedsDecision'
import { ClassWatchlist } from './blocks/ClassWatchlist'
import { HomeworkBlock } from './blocks/HomeworkBlock'
import { AcademicsAhead } from './blocks/AcademicsAhead'
import { RecentUploads } from './blocks/RecentUploads'

/**
 * Principal Dashboard — Redesigned
 *
 * Six blocks in attention order:
 * 1. Attendance Hero (signature element)
 * 2. Needs Decision (collapses when empty)
 * 3. Class Watchlist (data-driven flags)
 * 4. Homework Completion (shows spread, not just average)
 * 5. Academics Ahead (upcoming exams/events)
 * 6. Recent Uploads (assessment flow proof)
 *
 * Design: Quiet authority. Institutional clarity. Data-first.
 * Every number is a door — all metrics drill down to detail views.
 */

export default function PrincipalDashboardRedesigned() {
  return (
    <div
      style={{
        background: tokens.color.ground,
        minHeight: '100vh',
        padding: `${tokens.space.xl} ${tokens.space.lg}`,
        fontFamily: tokens.font.body,
      }}
    >
      {/* Mobile: Single Column */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.xl,
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        {/* Hero — Always Full Width */}
        <AttendanceHero />

        {/* Desktop: 2-column grid for middle blocks */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: tokens.space.xl,
          }}
          className="dashboard-grid"
        >
          <NeedsDecision />
          <ClassWatchlist />
          <HomeworkBlock />
          <AcademicsAhead />
        </div>

        {/* Uploads — Full Width */}
        <RecentUploads />
      </div>

      {/* Responsive Grid: Activate 2-column on desktop */}
      <style>{`
        @media (min-width: ${tokens.breakpoint.tablet}) {
          .dashboard-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        /* Focus states */
        button:focus-visible {
          outline: 2px solid ${tokens.color.ink};
          outline-offset: 2px;
        }

        /* Tap targets */
        button, a {
          min-height: 44px;
          min-width: 44px;
        }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  )
}
