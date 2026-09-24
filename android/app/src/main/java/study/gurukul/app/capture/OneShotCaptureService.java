package study.gurukul.app.capture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * One-shot MediaProjection capture behind the Stage 1 tap (§4 / §10.1).
 * Encodes PNG to base64 in memory — never writes the frame to storage (§11).
 */
public class OneShotCaptureService extends Service {
  public static final String EXTRA_RESULT_CODE = "resultCode";
  public static final String EXTRA_RESULT_DATA = "resultData";
  public static final String ACTION_REQUEST_FROM_OVERLAY =
    "study.gurukul.app.capture.REQUEST_CAPTURE";

  private static final String CHANNEL = "gurukul_media_projection";
  private static final int NOTIF_ID = 7702;

  private static PluginCall pendingCall;

  public static void setPendingCall(PluginCall call) {
    pendingCall = call;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    startAsForeground();
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
    Intent data = intent.getParcelableExtra(EXTRA_RESULT_DATA);
    if (resultCode != Activity.RESULT_OK || data == null) {
      fail("capture_consent_denied");
      stopSelf();
      return START_NOT_STICKY;
    }

    MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(
      MEDIA_PROJECTION_SERVICE
    );
    MediaProjection projection = mpm.getMediaProjection(resultCode, data);
    if (projection == null) {
      fail("media_projection_null");
      stopSelf();
      return START_NOT_STICKY;
    }

    WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
    DisplayMetrics metrics = new DisplayMetrics();
    wm.getDefaultDisplay().getRealMetrics(metrics);
    int width = metrics.widthPixels;
    int height = metrics.heightPixels;
    int density = metrics.densityDpi;

    ImageReader reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
    VirtualDisplay display = projection.createVirtualDisplay(
      "gurukul-oneshot",
      width,
      height,
      density,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.getSurface(),
      null,
      null
    );

    new Handler(Looper.getMainLooper()).postDelayed(() -> {
      try {
        Image image = reader.acquireLatestImage();
        if (image == null) {
          fail("no_frame");
        } else {
          String b64 = imageToPngBase64(image);
          image.close();
          JSObject ret = new JSObject();
          ret.put("image_base64", b64);
          ret.put("mime_type", "image/png");
          ret.put("width", width);
          ret.put("height", height);
          // Caller must supply package_name from UsageStats (Stage 2) or leave
          // empty so the edge intake refuses missing_package — Stage 1 JS can
          // pass the foreground package when known.
          if (pendingCall != null) {
            pendingCall.resolve(ret);
            pendingCall = null;
          }
        }
      } catch (Exception e) {
        fail(e.getMessage() != null ? e.getMessage() : "capture_failed");
      } finally {
        try {
          display.release();
        } catch (Exception ignored) {}
        try {
          projection.stop();
        } catch (Exception ignored) {}
        reader.close();
        stopForeground(true);
        stopSelf();
      }
    }, 350);

    return START_NOT_STICKY;
  }

  private void startAsForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
        CHANNEL,
        "Gurukul screen capture",
        NotificationManager.IMPORTANCE_LOW
      );
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) nm.createNotificationChannel(ch);
    }
    Notification.Builder builder;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder = new Notification.Builder(this, CHANNEL);
    } else {
      builder = new Notification.Builder(this);
    }
    Notification n = builder
      .setContentTitle("Gurukul is capturing one frame")
      .setContentText("Screen capture is active for this tap only.")
      .setSmallIcon(study.gurukul.app.R.mipmap.ic_launcher)
      .setOngoing(true)
      .build();
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        NOTIF_ID,
        n,
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      );
    } else {
      startForeground(NOTIF_ID, n);
    }
  }

  private static String imageToPngBase64(Image image) {
    Image.Plane[] planes = image.getPlanes();
    ByteBuffer buffer = planes[0].getBuffer();
    int pixelStride = planes[0].getPixelStride();
    int rowStride = planes[0].getRowStride();
    int rowPadding = rowStride - pixelStride * image.getWidth();
    Bitmap bitmap = Bitmap.createBitmap(
      image.getWidth() + rowPadding / pixelStride,
      image.getHeight(),
      Bitmap.Config.ARGB_8888
    );
    bitmap.copyPixelsFromBuffer(buffer);
    Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    cropped.compress(Bitmap.CompressFormat.PNG, 100, out);
    if (cropped != bitmap) cropped.recycle();
    bitmap.recycle();
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
  }

  private void fail(String msg) {
    if (pendingCall != null) {
      pendingCall.reject(msg);
      pendingCall = null;
    }
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
