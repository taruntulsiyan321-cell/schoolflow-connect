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
 * Stage 1 tap capture — docs/screen-capture-mistakes-spec.md §4, §10.1.
 * MediaProjection consent per session (Android 14+); overlay for the tap button.
 * Automatic watching (Stage 2) is intentionally absent.
 */
@CapacitorPlugin(name = "ScreenCaptureMistake")
public class ScreenCaptureMistakePlugin extends Plugin {

  public static final String PREFS = "gurukul_capture";
  public static final String KEY_ALLOWED = "allowed_packages";

  private final BroadcastReceiver tapReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      notifyListeners("tapRequested", new JSObject());
    }
  };

  @Override
  public void load() {
    IntentFilter filter = new IntentFilter(CaptureOverlayService.ACTION_TAP);
    if (Build.VERSION.SDK_INT >= 33) {
      getContext().registerReceiver(tapReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    } else {
      getContext().registerReceiver(tapReceiver, filter);
    }
  }

  @Override
  protected void handleOnDestroy() {
    try {
      getContext().unregisterReceiver(tapReceiver);
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
    MediaProjectionManager mpm = (MediaProjectionManager) getContext()
      .getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
    if (mpm == null) {
      call.reject("media_projection_unavailable");
      return;
    }
    Intent intent = mpm.createScreenCaptureIntent();
    startActivityForResult(call, intent, "projectionResult");
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
}
