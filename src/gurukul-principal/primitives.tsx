import React from "react";

/**
 * The principal portal's design language, in one place.
 *
 * These six were local functions inside
 * `autonomous-design/PrincipalPortalDesign.tsx`. The real (database-backed)
 * test screens need the same label, heading, pill, back control, empty state
 * and loading row, and a second copy of each would drift from the first the
 * moment either was touched (G9). Both files import these now, so the fixture
 * portal and the live screens cannot diverge visually.
 *
 * The bodies are the originals verbatim — this is a move, not a redesign.
 */

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="font-display text-2xl font-medium text-foreground mb-1">{children}</h1>;
}

export function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[10px] font-medium tracking-widest uppercase text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

export function Mono({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`font-mono ${className}`}>{children}</span>;
}

export function Pill({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "muted" | "outline";
}) {
  const cls = {
    default: "bg-secondary text-secondary-foreground",
    muted: "bg-muted text-muted-foreground",
    outline: "border border-border text-foreground",
  }[variant];
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded-[2px] ${cls}`}>
      {children}
    </span>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mb-4"
    >
      ← Back
    </button>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="py-16 text-center">
      <div className="text-sm text-muted-foreground">{title}</div>
      {detail && <div className="text-xs text-muted-foreground mt-1">{detail}</div>}
    </div>
  );
}

export function LoadingRow() {
  return (
    <div className="h-10 flex items-center px-4">
      <div className="h-2 w-32 bg-muted rounded-[2px] animate-pulse" />
    </div>
  );
}
