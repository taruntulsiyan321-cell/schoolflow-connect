import { Component, type ReactNode } from "react";

declare global {
  interface Window {
    /** index.html's boot guard: reloads at most once in 30 s; false when it will not. */
    __gurukulReloadOnce?: () => boolean;
  }
}

/** A file the app asked for could not be fetched — the network, or a deploy. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed/i.test(
    message,
  );
}

/**
 * THE APP DOES NOT GO BLANK.
 *
 * Nothing caught a render error, so one — a page whose file failed to load, or
 * a bug — unmounted the whole app and left a white page. This is the one
 * boundary, around everything. A file that failed to load gets one automatic
 * reload from index.html's boot guard (the one home of that rule); anything
 * else, or a second failure, is said plainly with a Reload button.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[app] render failed", error);
    if (isChunkLoadError(error)) window.__gurukulReloadOnce?.();
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkLoadError(this.state.error);
    return (
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-bold text-foreground">
          {chunk ? "Part of Gurukul couldn’t load" : "Something went wrong"}
        </p>
        <p className="text-sm text-muted-foreground">
          {chunk ? "Check your connection, then reload." : "Reloading usually fixes it."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
        >
          Reload
        </button>
      </div>
    );
  }
}
