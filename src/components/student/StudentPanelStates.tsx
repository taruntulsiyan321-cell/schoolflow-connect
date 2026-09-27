import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RefreshCw } from "lucide-react";


/** List-style pages (revision, mistakes, Test cards). */
export function StudentListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-rise" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
      ))}
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
