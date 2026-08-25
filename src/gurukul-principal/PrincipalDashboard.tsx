import { useDashboardDrillDown } from './DashboardDrillDown'
import { AttendanceHeroBlock } from './dashboard-blocks/AttendanceHeroBlock'
import { PendingDecisionsBlock } from './dashboard-blocks/PendingDecisionsBlock'
import { HomeworkCompletionBlock } from './dashboard-blocks/HomeworkCompletionBlock'
import { UpcomingBlock } from './dashboard-blocks/UpcomingBlock'
import { NeedsAttentionBlock } from './dashboard-blocks/NeedsAttentionBlock'
import { ChronicAbsenteesBlock } from './dashboard-blocks/ChronicAbsenteesBlock'
import { AttendanceDrillDown } from './dashboard-drilldowns/AttendanceDrillDown'
import { HomeworkDrillDown } from './dashboard-drilldowns/HomeworkDrillDown'

/**
 * Principal Dashboard - Following Design Prompt Exactly
 *
 * Six blocks in attention order (§5):
 * A. Today's Attendance (hero with formula, coverage, unmarked list)
 * B. Pending Decisions (leaves with inline approve/reject)
 * C. Homework Completion (7-day window, show spread)
 * D. Upcoming (exams/events, marks not uploaded)
 * E. Needs Attention (auto-computed flags, dismiss)
 * F. Chronic Absentees (term-long view)
 *
 * Drill-down: School → Class → Student (in place, no navigation)
 */

export default function PrincipalDashboard() {
  const { drillState, drillToClass, drillToStudent, BreadcrumbComponent } = useDashboardDrillDown()

  return (
    <div style={{ padding: '20px 16px', background: '#F8F9FA', minHeight: '100vh', maxWidth: '1400px', margin: '0 auto' }}>
      <BreadcrumbComponent />

      {/* School-level view - Six blocks in attention order */}
      {drillState.level === 'school' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* A. Today's Attendance - THE HERO (Always visible) */}
          <AttendanceHeroBlock onDrillToClasses={() => drillToClass('attendance')} />

          {/* Two-column grid with stable layout */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px',
            '@media (max-width: 768px)': {
              gridTemplateColumns: '1fr',
            }
          }}>
            {/* B. Pending Decisions */}
            <div style={{ minHeight: '120px' }}>
              <PendingDecisionsBlock />
            </div>

            {/* C. Homework Completion */}
            <div style={{ minHeight: '120px' }}>
              <HomeworkCompletionBlock onDrillToClasses={() => drillToClass('homework')} />
            </div>
          </div>

          {/* D. Upcoming - Full width */}
          <div style={{ minHeight: '120px' }}>
            <UpcomingBlock />
          </div>

          {/* E, F - Bottom row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px',
            '@media (max-width: 768px)': {
              gridTemplateColumns: '1fr',
            }
          }}>
            {/* E. Needs Attention */}
            <div style={{ minHeight: '120px' }}>
              <NeedsAttentionBlock />
            </div>

            {/* F. Chronic Absentees */}
            <div style={{ minHeight: '120px' }}>
              <ChronicAbsenteesBlock />
            </div>
          </div>
        </div>
      )}

      {/* Drill-down views (Fix 4: Different for attendance vs homework) */}
      {(drillState.level === 'class' || drillState.level === 'student') && drillState.metric && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}>
          {drillState.metric === 'attendance' && (
            <AttendanceDrillDown
              selectedClassId={drillState.classId || undefined}
              selectedClassName={drillState.className || undefined}
              onClassClick={drillToStudent}
            />
          )}

          {drillState.metric === 'homework' && (
            <HomeworkDrillDown
              selectedClassId={drillState.classId || undefined}
              selectedClassName={drillState.className || undefined}
              onClassClick={drillToStudent}
            />
          )}

          {/* Fallback for other metrics */}
          {drillState.metric !== 'attendance' && drillState.metric !== 'homework' && (
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1F2937', marginBottom: '6px' }}>
                {drillState.metric.charAt(0).toUpperCase()}{drillState.metric.slice(1)} by Class
              </h2>
              <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '24px' }}>
                Drill-down view for {drillState.metric}
              </p>
              <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                {drillState.level === 'class' ? 'Class breakdown coming soon' : 'Student details coming soon'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
