import { useState } from 'react'
import { ChevronRight, Home } from 'lucide-react'

/**
 * Dashboard Drill-Down System
 *
 * Hierarchy:
 * Level 0: School Overview (all blocks visible)
 * Level 1: Class-wise breakdown (clicked metric)
 * Level 2: Student-level detail (clicked class)
 *
 * Navigation: School → Class → Student
 * All on the same page, no route changes.
 */

type DrillLevel = 'school' | 'class' | 'student'
type MetricType = 'attendance' | 'homework' | 'tests' | 'exams'

interface DrillState {
  level: DrillLevel
  metric: MetricType | null
  classId: string | null
  className: string | null
}

interface BreadcrumbProps {
  state: DrillState
  onNavigate: (level: DrillLevel) => void
}

function Breadcrumb({ state, onNavigate }: BreadcrumbProps) {
  if (state.level === 'school') return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 0',
      fontSize: 13,
      color: 'var(--text-muted)',
      marginBottom: 16,
    }}>
      <button
        onClick={() => onNavigate('school')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--indigo)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Home size={14} /> School Overview
      </button>

      {state.level === 'class' && (
        <>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {state.metric?.charAt(0).toUpperCase()}{state.metric?.slice(1)} by Class
          </span>
        </>
      )}

      {state.level === 'student' && state.className && (
        <>
          <ChevronRight size={14} />
          <button
            onClick={() => onNavigate('class')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--indigo)',
              fontWeight: 600,
            }}
          >
            {state.metric?.charAt(0).toUpperCase()}{state.metric?.slice(1)} by Class
          </button>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {state.className}
          </span>
        </>
      )}
    </div>
  )
}

export function useDashboardDrillDown() {
  const [drillState, setDrillState] = useState<DrillState>({
    level: 'school',
    metric: null,
    classId: null,
    className: null,
  })

  const drillToClass = (metric: MetricType) => {
    setDrillState({
      level: 'class',
      metric,
      classId: null,
      className: null,
    })
  }

  const drillToStudent = (classId: string, className: string) => {
    setDrillState({
      ...drillState,
      level: 'student',
      classId,
      className,
    })
  }

  const navigateToLevel = (level: DrillLevel) => {
    if (level === 'school') {
      setDrillState({
        level: 'school',
        metric: null,
        classId: null,
        className: null,
      })
    } else if (level === 'class') {
      setDrillState({
        ...drillState,
        level: 'class',
        classId: null,
        className: null,
      })
    }
  }

  return {
    drillState,
    drillToClass,
    drillToStudent,
    navigateToLevel,
    BreadcrumbComponent: () => <Breadcrumb state={drillState} onNavigate={navigateToLevel} />,
  }
}
