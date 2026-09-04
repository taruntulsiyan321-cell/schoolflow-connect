import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { tokens } from '../design-tokens'

/**
 * Shared block primitives for the spec'd Principal Dashboard (Sept 2026).
 *
 * These reuse the principal panel's own design system (`tokens` — "quiet
 * authority", tabular-mono numbers) rather than the student panel's GlassCard
 * aesthetic, which is a deliberately different visual language. The student
 * panel analysis informed the interaction grammar here (card → list → detail,
 * honest empty states, worst-first ordering), not the paint.
 */

export function Block({
  title,
  children,
  muted,
  accentColor,
  right,
}: {
  title: string
  children: ReactNode
  /** Needs-attention is deliberately quiet (grey), never competing with attendance. */
  muted?: boolean
  /** Optional left accent (e.g. attendance status colour). */
  accentColor?: string
  /** Optional header-right slot (e.g. a range control or "all N" link). */
  right?: ReactNode
}) {
  return (
    <section
      style={{
        background: muted ? tokens.color.ground : 'white',
        border: `1px solid ${tokens.color.border}`,
        borderLeft: accentColor ? `6px solid ${accentColor}` : `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.xl,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space.md,
          marginBottom: tokens.space.lg,
        }}
      >
        <h2
          style={{
            fontSize: tokens.fontSize.blockTitle,
            fontWeight: tokens.fontWeight.semibold,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: tokens.color.inkMuted,
            margin: 0,
          }}
        >
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function LoadingBlock({ title }: { title: string }) {
  return (
    <Block title={title}>
      <Loader2 className="animate-spin" size={20} color={tokens.color.inkMuted} />
    </Block>
  )
}

export function ErrorBlock({ title, message }: { title: string; message: string }) {
  return (
    <Block title={title}>
      <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.accent, margin: 0 }}>{message}</p>
    </Block>
  )
}

/** Honest empty / all-clear state. Green when it means "nothing to act on". */
export function AllClear({ message }: { message: string }) {
  return (
    <p
      style={{
        fontSize: tokens.fontSize.body,
        fontWeight: tokens.fontWeight.medium,
        color: tokens.color.positive,
        margin: 0,
      }}
    >
      ✓ {message}
    </p>
  )
}

/** Neutral "we do not know" / not-set copy — never an alarming zero. */
export function NotSet({ message }: { message: string }) {
  return (
    <p style={{ fontSize: tokens.fontSize.body, color: tokens.color.inkMuted, margin: 0 }}>{message}</p>
  )
}

/** A clickable row that is a door to a deeper list/detail. */
export function DoorRow({
  label,
  value,
  valueColor,
  sub,
  onClick,
}: {
  label: ReactNode
  value?: ReactNode
  valueColor?: string
  sub?: ReactNode
  onClick?: () => void
}) {
  const interactive = !!onClick
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.space.md,
        background: 'white',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.sm,
        padding: `${tokens.space.md} ${tokens.space.md}`,
        textAlign: 'left',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: tokens.fontSize.body,
            fontWeight: tokens.fontWeight.medium,
            color: tokens.color.ink,
          }}
        >
          {label}
        </div>
        {sub != null && (
          <div style={{ fontSize: tokens.fontSize.small, color: tokens.color.inkMuted, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      {value != null && (
        <span
          style={{
            fontFamily: tokens.font.display,
            fontWeight: tokens.fontWeight.bold,
            fontVariantNumeric: 'tabular-nums',
            color: valueColor ?? tokens.color.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      )}
    </button>
  )
}
