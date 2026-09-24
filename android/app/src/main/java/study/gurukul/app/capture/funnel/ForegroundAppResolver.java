package study.gurukul.app.capture.funnel;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

/**
 * §5.1 — which app is in front. Requires PACKAGE_USAGE_STATS (Settings grant).
 * Binding: docs/screen-capture-mistakes-spec.md §4 / §5.1
 */
public final class ForegroundAppResolver {
  private final Context appContext;

  public ForegroundAppResolver(Context context) {
    this.appContext = context.getApplicationContext();
  }

  public boolean hasUsageAccess() {
    AppOpsManager appOps = (AppOpsManager) appContext.getSystemService(Context.APP_OPS_SERVICE);
    if (appOps == null) return false;
    int mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        appContext.getPackageName()
    );
    return mode == AppOpsManager.MODE_ALLOWED;
  }

  public Intent usageAccessSettingsIntent() {
    return new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
  }

  /**
   * Most recent MOVE_TO_FOREGROUND package in the last few seconds, or null.
   * Never reads screen content — package name only.
   */
  public String foregroundPackageOrNull() {
    if (!hasUsageAccess()) return null;
    UsageStatsManager usm =
        (UsageStatsManager) appContext.getSystemService(Context.USAGE_STATS_SERVICE);
    if (usm == null) return null;
    long end = System.currentTimeMillis();
    long begin = end - 15_000L;
    UsageEvents events = usm.queryEvents(begin, end);
    if (events == null) return null;
    UsageEvents.Event event = new UsageEvents.Event();
    String last = null;
    while (events.hasNextEvent()) {
      events.getNextEvent(event);
      if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND
          || (Build.VERSION.SDK_INT >= 29
              && event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED)) {
        last = event.getPackageName();
      }
    }
    return last;
  }
}
