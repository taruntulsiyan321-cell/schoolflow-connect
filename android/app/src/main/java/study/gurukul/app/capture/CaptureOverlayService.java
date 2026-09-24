package study.gurukul.app.capture;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import androidx.core.app.NotificationCompat;

/**
 * Floating Gurukul tap control (§10.1). Does not watch screens — tap only.
 * Tap notifies the Capacitor plugin; JS then calls captureOnce().
 */
public class CaptureOverlayService extends Service {
  public static final String ACTION_SHOW = "study.gurukul.app.capture.SHOW";
  public static final String ACTION_HIDE = "study.gurukul.app.capture.HIDE";
  public static final String ACTION_TAP = "study.gurukul.app.capture.TAP";
  private static final String CHANNEL = "gurukul_capture_overlay";
  private static final int NOTIF_ID = 7701;

  private WindowManager windowManager;
  private View overlay;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : ACTION_SHOW;
    if (ACTION_HIDE.equals(action)) {
      removeOverlay();
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }
    startAsForeground();
    showOverlay();
    return START_STICKY;
  }

  private void startAsForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
        CHANNEL,
        "Gurukul capture",
        NotificationManager.IMPORTANCE_LOW
      );
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) nm.createNotificationChannel(ch);
    }
    Notification n = new NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle("Gurukul mistake tap")
      .setContentText("Tap the Gurukul button when you get a question wrong.")
      .setSmallIcon(study.gurukul.app.R.mipmap.ic_launcher)
      .setOngoing(true)
      .build();
    startForeground(NOTIF_ID, n);
  }

  private void showOverlay() {
    if (overlay != null) return;
    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    Button btn = new Button(this);
    btn.setText("G");
    btn.setContentDescription("Capture mistake for Gurukul");
    btn.setOnClickListener(v -> {
      Intent tap = new Intent(ACTION_TAP);
      tap.setPackage(getPackageName());
      sendBroadcast(tap);
    });
    int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      : WindowManager.LayoutParams.TYPE_PHONE;
    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    );
    params.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
    params.x = 24;
    params.y = 0;
    overlay = btn;
    windowManager.addView(overlay, params);
  }

  private void removeOverlay() {
    if (overlay != null && windowManager != null) {
      try {
        windowManager.removeView(overlay);
      } catch (Exception ignored) {}
      overlay = null;
    }
  }

  @Override
  public void onDestroy() {
    removeOverlay();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
