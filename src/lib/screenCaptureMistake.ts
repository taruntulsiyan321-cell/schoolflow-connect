/**
 * Thin Capacitor bridge for Stage 1 tap + Stage 2 watch session.
 * Binding: docs/screen-capture-mistakes-spec.md §5 / §10
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type CaptureFrame = {
  image_base64: string;
  mime_type: string;
  width?: number;
  height?: number;
  package_name?: string;
};

export type FunnelCountersJs = {
  frames_seen: number;
  dropped_at_5_1: number;
  dropped_at_5_2: number;
  dropped_at_5_3: number;
  dropped_at_5_4: number;
  sent: number;
  ocr_invocations: number;
  frames_sent_per_hour: number;
  session_started_at_ms: number;
  session_ended_at_ms: number;
};

type ScreenCaptureMistakePlugin = {
  canDrawOverlays(): Promise<{ allowed: boolean }>;
  requestOverlayPermission(): Promise<{ allowed: boolean }>;
  setAllowedPackages(options: { packages: string[] }): Promise<{ count: number }>;
  showTapOverlay(): Promise<void>;
  hideTapOverlay(): Promise<void>;
  captureOnce(): Promise<CaptureFrame>;
  hasUsageAccess(): Promise<{ allowed: boolean }>;
  openUsageAccessSettings(): Promise<void>;
  startWatchSession(): Promise<void>;
  stopWatchSession(): Promise<void>;
  getFunnelCounters(): Promise<FunnelCountersJs>;
  addListener(
    eventName: "tapRequested" | "watchFrameReady",
    listenerFunc: (event?: CaptureFrame) => void,
  ): Promise<PluginListenerHandle>;
};

const ScreenCaptureMistake = registerPlugin<ScreenCaptureMistakePlugin>(
  "ScreenCaptureMistake",
);

export function isNativeScreenCaptureAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export { ScreenCaptureMistake };
