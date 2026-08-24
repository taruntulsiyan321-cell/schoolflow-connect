import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PALETTE } from './tokens';

interface CollapsibleBlockProps {
  title: string;
  summary: ReactNode;  // The summary shown when collapsed
  children: ReactNode;  // The detail shown when expanded
  defaultExpanded?: boolean;
}

export function CollapsibleBlock({
  title,
  summary,
  children,
  defaultExpanded = false
}: CollapsibleBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      border: `1px solid ${PALETTE.border}`,
      overflow: 'hidden',
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '16px 20px',
          background: expanded ? PALETTE.faint : 'white',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.2s',
          borderBottom: expanded ? `1px solid ${PALETTE.border}` : 'none',
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = PALETTE.hover;
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'white';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: PALETTE.inkMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '8px'
            }}>
              {title}
            </div>
            {!expanded && summary}
          </div>
          <div style={{
            marginLeft: '16px',
            color: PALETTE.inkMuted,
            flexShrink: 0,
          }}>
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </button>

      {/* Detail - shown when expanded */}
      {expanded && (
        <div style={{ padding: '20px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Summary component - shows metric with context
 * Context can be: trend, comparison, or flagged count
 */
export function MetricSummary({
  value,
  label,
  trend,
  comparison,
  flaggedCount,
}: {
  value: string | number;
  label?: string;
  trend?: { direction: 'up' | 'down'; from: number };
  comparison?: { section: string; value: number | string };
  flaggedCount?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color: PALETTE.ink }}>
        {value}{label}
      </div>

      {trend && (
        <div style={{
          fontSize: '13px',
          color: trend.direction === 'down' ? PALETTE.accent : PALETTE.positive,
          fontWeight: 500
        }}>
          {trend.direction === 'down' ? '↓' : '↑'} from {trend.from}{label}
        </div>
      )}

      {comparison && (
        <div style={{
          fontSize: '13px',
          color: PALETTE.inkMuted,
          fontWeight: 500,
          opacity: 0.7
        }}>
          {comparison.section}: {comparison.value}{label}
        </div>
      )}

      {flaggedCount !== undefined && flaggedCount > 0 && (
        <div style={{
          fontSize: '13px',
          color: PALETTE.accent,
          fontWeight: 600,
          background: `${PALETTE.accent}10`,
          padding: '2px 8px',
          borderRadius: '4px',
        }}>
          {flaggedCount} flagged
        </div>
      )}
    </div>
  );
}
