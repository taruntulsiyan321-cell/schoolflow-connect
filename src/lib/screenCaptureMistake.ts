/**
 * Thin Capacitor bridge for Stage 1 screen-capture mistakes.
 * Binding: docs/screen-capture-mistakes-spec.md §10.1
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type CaptureFrame = {
  image_base64: string;
  mime_type: string;
  width?: number;
  height?: number;
};

type ScreenCaptureMistakePlugin = {
  canDrawOverlays(): Promise<{ allowed: boolean }>;
  requestOverlayPermission(): Promise<{ allowed: boolean }>;
  setAllowedPackages(options: { packages: string[] }): Promise<{ count: number }>;
  showTapOverlay(): Promise<void>;
  hideTapOverlay(): Promise<void>;
  captureOnce(): Promise<CaptureFrame>;
  addListener(
    eventName: "tapRequested",
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
};

const ScreenCaptureMistake = registerPlugin<ScreenCaptureMistakePlugin>(
  "ScreenCaptureMistake",
);

export function isNativeScreenCaptureAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export { ScreenCaptureMistake };
