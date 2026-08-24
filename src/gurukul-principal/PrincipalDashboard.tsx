import { useDashboardDrillDown } from './DashboardDrillDown'
import { AttendanceHeroBlock } from './dashboard-blocks/AttendanceHeroBlock'
import { PendingDecisionsBlock } from './dashboard-blocks/PendingDecisionsBlock'
import { HomeworkCompletionBlock } from './dashboard-blocks/HomeworkCompletionBlock'
import { UpcomingBlock } from './dashboard-blocks/UpcomingBlock'
import { NeedsAttentionBlock } from './dashboard-blocks/NeedsAttentionBlock'
import { ChronicAbsenteesBlock } from './dashboard-blocks/ChronicAbsenteesBlock'
import { PrincipalClassRollups } from './PrincipalLiveAcademic'

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
    <div style={{ padding: '16px 12px', background: '#F8F9FA', minHeight: '100vh', maxWidth: '1400px', margin: '0 auto' }}>
      <BreadcrumbComponent />

      {/* School-level view - Six blocks in attention order */}
      {drillState.level === 'school' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* A. Today's Attendance - THE HERO */}
          <AttendanceHeroBlock onDrillToClasses={() => drillToClass('attendance')} />

          {/* Two-column grid for remaining blocks (mobile: stack, desktop: 2-col) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))',
            gap: '12px',
          }}>
            {/* B. Pending Decisions */}
            <PendingDecisionsBlock />

            {/* C. Homework Completion */}
            <HomeworkCompletionBlock onDrillToClasses={() => drillToClass('homework')} />
          </div>

          {/* D. Upcoming */}
          <UpcomingBlock />

          {/* E, F - Bottom row in two-column grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))',
            gap: '12px',
          }}>
            {/* E. Needs Attention */}
            <NeedsAttentionBlock />

            {/* F. Chronic Absentees */}
            <ChronicAbsenteesBlock />
          </div>
        </div>
      )}

      {/* Class-level drill-down */}
      {drillState.level === 'class' && drillState.metric && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1F2937', marginBottom: '6px' }}>
            {drillState.metric.charAt(0).toUpperCase()}{drillState.metric.slice(1)} by Class
          </h2>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '24px' }}>
            Click a class to see student-level details
          </p>
          <PrincipalClassRollups
            focusMetric={drillState.metric}
            onClassClick={drillToStudent}
          />
        </div>
      )}

      {/* Student-level drill-down */}
      {drillState.level === 'student' && drillState.classId && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1F2937', marginBottom: '6px' }}>
            {drillState.className} - {drillState.metric?.charAt(0).toUpperCase()}{drillState.metric?.slice(1)}
          </h2>
          <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '24px' }}>
            Individual student performance
          </p>
          <div style={{ padding: '20px', textAlign: 'center', color: '#9CA3AF' }}>
            Student list with {drillState.metric} details will load here
          </div>
        </div>
      )}
    </div>
  )
}
