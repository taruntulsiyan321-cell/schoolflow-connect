package study.gurukul.app.capture;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * Stage 1 tap + Stage 2 watch session — docs/screen-capture-mistakes-spec.md §4, §5, §10.
 * MediaProjection consent per session (Android 14+). Stage 1 overlay tap unchanged.
 * Stage 2: one watch session; §5 funnel drops frames on-device before the network.
 */
@CapacitorPlugin(name = "ScreenCaptureMistake")
public class ScreenCaptureMistakePlugin extends Plugin {

  public static final String PREFS = "gurukul_capture";
  public static final String KEY_ALLOWED = "allowed_packages";
  public static final String ACTION_WATCH_FRAME_READY =
      "study.gurukul.app.capture.WATCH_FRAME_READY";

  private final BroadcastReceiver tapReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      notifyListeners("tapRequested", new JSObject());
    }
  };

  private final BroadcastReceiver watchFrameReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      // Drain the whole pending queue so slow JS never drops SENDs.
      while (true) {
        String[] sent = WatchSessionService.consumeLastSent();
        String b64 = sent[0];
        String pkg = sent[1];
        if (b64 == null) break;
        JSObject payload = new JSObject();
        payload.put("image_base64", b64);
        if (pkg != null) payload.put("package_name", pkg);
        payload.put("mime_type", "image/png");
        notifyListeners("watchFrameReady", payload);
      }
    }
  };

  private final BroadcastReceiver watchEndedReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      notifyListeners("watchSessionEnded", new JSObject());
    }
  };

  @Override
  public void load() {
    IntentFilter tap = new IntentFilter(CaptureOverlayService.ACTION_TAP);
    IntentFilter watch = new IntentFilter(ACTION_WATCH_FRAME_READY);
    IntentFilter ended = new IntentFilter(WatchSessionService.ACTION_WATCH_ENDED);
    if (Build.VERSION.SDK_INT >= 33) {
      getContext().registerReceiver(tapReceiver, tap, Context.RECEIVER_NOT_EXPORTED);
      getContext().registerReceiver(watchFrameReceiver, watch, Context.RECEIVER_NOT_EXPORTED);
      getContext().registerReceiver(watchEndedReceiver, ended, Context.RECEIVER_NOT_EXPORTED);
    } else {
      getContext().registerReceiver(tapReceiver, tap);
      getContext().registerReceiver(watchFrameReceiver, watch);
      getContext().registerReceiver(watchEndedReceiver, ended);
    }
  }

  @Override
  protected void handleOnDestroy() {
    try {
      getContext().unregisterReceiver(tapReceiver);
    } catch (Exception ignored) {}
    try {
      getContext().unregisterReceiver(watchFrameReceiver);
    } catch (Exception ignored) {}
    try {
      getContext().unregisterReceiver(watchEndedReceiver);
    } catch (Exception ignored) {}
    super.handleOnDestroy();
  }

  @PluginMethod
  public void canDrawOverlays(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("allowed", Settings.canDrawOverlays(getContext()));
    call.resolve(ret);
  }

  @PluginMethod
  public void requestOverlayPermission(PluginCall call) {
    if (Settings.canDrawOverlays(getContext())) {
      JSObject ret = new JSObject();
      ret.put("allowed", true);
      call.resolve(ret);
      return;
    }
    Intent intent = new Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + getContext().getPackageName())
    );
    startActivityForResult(call, intent, "overlayResult");
  }

  @ActivityCallback
  private void overlayResult(PluginCall call, ActivityResult result) {
    JSObject ret = new JSObject();
    ret.put("allowed", Settings.canDrawOverlays(getContext()));
    call.resolve(ret);
  }

  @PluginMethod
  public void setAllowedPackages(PluginCall call) {
    JSArray arr = call.getArray("packages");
    List<String> pkgs = new ArrayList<>();
    if (arr != null) {
      try {
        for (int i = 0; i < arr.length(); i++) {
          String p = arr.getString(i);
          if (p != null && !p.trim().isEmpty()) pkgs.add(p.trim());
        }
      } catch (JSONException e) {
        call.reject("invalid packages");
        return;
      }
    }
    getContext()
      .getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
      .edit()
      .putString(KEY_ALLOWED, String.join(",", pkgs))
      .apply();
    JSObject ret = new JSObject();
    ret.put("count", pkgs.size());
    call.resolve(ret);
  }

  @PluginMethod
  public void showTapOverlay(PluginCall call) {
    if (!Settings.canDrawOverlays(getContext())) {
      call.reject("overlay_permission_required");
      return;
    }
    Intent i = new Intent(getContext(), CaptureOverlayService.class);
    i.setAction(CaptureOverlayService.ACTION_SHOW);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(i);
    } else {
      getContext().startService(i);
    }
    call.resolve();
  }

  @PluginMethod
  public void hideTapOverlay(PluginCall call) {
    Intent i = new Intent(getContext(), CaptureOverlayService.class);
    i.setAction(CaptureOverlayService.ACTION_HIDE);
    getContext().startService(i);
    call.resolve();
  }

  /**
   * One tap → system capture consent (if needed) → one frame → base64 to JS.
   * Frame is NOT persisted on disk (§11).
   */
  @PluginMethod
  public void captureOnce(PluginCall call) {
    // One MediaProjection session at a time (§4.1) — tap must not steal watch.
    if (WatchSessionService.isActive()) {
      call.reject("watch_session_active");
      return;
    }
    MediaProjectionManager mpm = (MediaProjectionManager) getContext()
      .getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
    if (mpm == null) {
      call.reject("media_projection_unavailable");
      return;
    }
    Intent intent = mpm.createScreenCaptureIntent();
    startActivityForResult(call, intent, "projectionResult");
  }

  @PluginMethod
  public void isWatchSessionActive(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("active", WatchSessionService.isActive());
    call.resolve(ret);
  }

  @ActivityCallback
  private void projectionResult(PluginCall call, ActivityResult result) {
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      call.reject("capture_consent_denied");
      return;
    }
    Intent svc = new Intent(getContext(), OneShotCaptureService.class);
    svc.putExtra(OneShotCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
    svc.putExtra(OneShotCaptureService.EXTRA_RESULT_DATA, result.getData());
    OneShotCaptureService.setPendingCall(call);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(svc);
    } else {
      getContext().startService(svc);
    }
  }

  // ── Stage 2 watch session (§4.1 / §5) ─────────────────────────────────────

  @PluginMethod
  public void hasUsageAccess(PluginCall call) {
    study.gurukul.app.capture.funnel.ForegroundAppResolver resolver =
        new study.gurukul.app.capture.funnel.ForegroundAppResolver(getContext());
    JSObject ret = new JSObject();
    ret.put("allowed", resolver.hasUsageAccess());
    call.resolve(ret);
  }

  @PluginMethod
  public void openUsageAccessSettings(PluginCall call) {
    study.gurukul.app.capture.funnel.ForegroundAppResolver resolver =
        new study.gurukul.app.capture.funnel.ForegroundAppResolver(getContext());
    Intent intent = resolver.usageAccessSettingsIntent();
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(intent);
    call.resolve();
  }

  @PluginMethod
  public void startWatchSession(PluginCall call) {
    study.gurukul.app.capture.funnel.ForegroundAppResolver resolver =
        new study.gurukul.app.capture.funnel.ForegroundAppResolver(getContext());
    if (!resolver.hasUsageAccess()) {
      call.reject("usage_access_required");
      return;
    }
    // Android 15: mediaProjection FGS from background needs a visible overlay (§13).
    if (!Settings.canDrawOverlays(getContext())) {
      call.reject("overlay_permission_required");
      return;
    }
    if (WatchSessionService.isActive()) {
      call.resolve();
      return;
    }
    MediaProjectionManager mpm = (MediaProjectionManager) getContext()
        .getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
    if (mpm == null) {
      call.reject("media_projection_unavailable");
      return;
    }
    Intent intent = mpm.createScreenCaptureIntent();
    startActivityForResult(call, intent, "watchProjectionResult");
  }

  @ActivityCallback
  private void watchProjectionResult(PluginCall call, ActivityResult result) {
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      call.reject("capture_consent_denied");
      return;
    }
    Intent svc = new Intent(getContext(), WatchSessionService.class);
    svc.putExtra(WatchSessionService.EXTRA_RESULT_CODE, result.getResultCode());
    svc.putExtra(WatchSessionService.EXTRA_RESULT_DATA, result.getData());
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(svc);
    } else {
      getContext().startService(svc);
    }
    call.resolve();
  }

  @PluginMethod
  public void stopWatchSession(PluginCall call) {
    Intent i = new Intent(getContext(), WatchSessionService.class);
    i.setAction(WatchSessionService.ACTION_STOP);
    getContext().startService(i);
    call.resolve();
  }

  @PluginMethod
  public void getFunnelCounters(PluginCall call) {
    study.gurukul.app.capture.funnel.FunnelCounters c =
        WatchSessionService.countersSnapshot();
    JSObject ret = new JSObject();
    ret.put("frames_seen", c.framesSeen);
    ret.put("dropped_at_5_1", c.droppedAt51);
    ret.put("dropped_at_5_2", c.droppedAt52);
    ret.put("dropped_at_5_3", c.droppedAt53);
    ret.put("dropped_at_5_4", c.droppedAt54);
    ret.put("dropped_duplicate", c.droppedDuplicate);
    ret.put("sent", c.sent);
    ret.put("ocr_invocations", c.ocrInvocations);
    ret.put("frames_sent_per_hour", c.framesSentPerHour());
    ret.put("session_started_at_ms", c.sessionStartedAtMs);
    ret.put("session_ended_at_ms", c.sessionEndedAtMs);
    ret.put("pending_send", WatchSessionService.pendingSendCount());
    ret.put("watch_active", WatchSessionService.isActive());
    call.resolve(ret);
  }
}
