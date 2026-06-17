import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RefreshCw } from "lucide-react";

/** Consistent loading skeleton for the student dashboard. */
export function StudentDashboardSkeleton() {
  return (
    <div className="space-y-6 animate-rise" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-xl" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    </div>
  );
}

/** List-style pages (revision, mistakes, DPP cards). */
export function StudentListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-rise" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Analysis page — 6-section card layout. */
export function StudentAnalyticsSkeleton() {
  return (
    <div className="space-y-8 animate-rise" aria-busy="true" aria-label="Loading analytics">
      <Skeleton className="h-48 w-full rounded-3xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-44 rounded-3xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

/** In-session practice / recovery loading. */
export function StudentSessionSkeleton({ label = "Preparing session…" }: { label?: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-4 animate-rise" aria-busy="true">
      <Skeleton className="h-2 w-full max-w-md rounded-full" />
      <Skeleton className="h-48 w-full max-w-2xl rounded-xl" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function StudentErrorState({
  title = "Something went wrong",
  message,
  hint = "Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  message?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-8 text-center max-w-md mx-auto shadow-card animate-rise">
      <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="text-sm text-muted-foreground mt-2">{hint}</p>}
      {message && <p className="text-xs text-destructive mt-2 break-words">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-1" /> Try again
        </Button>
      )}
    </Card>
  );
}
