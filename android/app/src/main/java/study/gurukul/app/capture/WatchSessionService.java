package study.gurukul.app.capture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import study.gurukul.app.capture.funnel.CaptureFunnel;
import study.gurukul.app.capture.funnel.ForegroundAppResolver;
import study.gurukul.app.capture.funnel.FrameSample;
import study.gurukul.app.capture.funnel.FunnelCounters;
import study.gurukul.app.capture.funnel.FunnelDecision;
import study.gurukul.app.capture.funnel.MlKitOcrProvider;

/**
 * Stage 2 — one MediaProjection session (§4.1) + §5 on-device funnel.
 * Does not replace Stage 1 tap ({@link OneShotCaptureService}).
 * Raw frames are never written to disk (§11).
 */
public class WatchSessionService extends Service {
  public static final String EXTRA_RESULT_CODE = "resultCode";
  public static final String EXTRA_RESULT_DATA = "resultData";
  public static final String ACTION_STOP = "study.gurukul.app.capture.WATCH_STOP";
  public static final String ACTION_WATCH_ENDED =
      "study.gurukul.app.capture.WATCH_ENDED";

  private static final String TAG = "GurukulWatch";
  private static final String CHANNEL = "gurukul_watch_session";
  private static final int NOTIF_ID = 7703;
  /** Sample interval — not a verdict timer (§5.3). Verdict is content-triggered. */
  private static final long SAMPLE_MS = 400L;
  /** Cap pending SENDs until JS consumes — avoid OOM / silent overwrite. */
  private static final int MAX_PENDING_SEND = 8;

  private static final FunnelCounters COUNTERS = new FunnelCounters();
  private static final ArrayDeque<String[]> PENDING_SEND = new ArrayDeque<>();
  private static volatile boolean active;

  private MediaProjection projection;
  private VirtualDisplay display;
  private ImageReader reader;
  private HandlerThread worker;
  private Handler handler;
  private Bitmap previous;
  private CaptureFunnel funnel;
  private MlKitOcrProvider ocr;
  private ForegroundAppResolver foreground;
  private volatile boolean ocrInFlight;
  private final Runnable tick = this::sampleOnce;

  public static boolean isActive() {
    return active;
  }

  public static FunnelCounters countersSnapshot() {
    return COUNTERS.snapshot();
  }

  /**
   * Pop the oldest SEND frame for the bridge (§11 ephemeral after deliver).
   * Returns {base64, package} or {null, null} when empty.
   */
  public static synchronized String[] consumeLastSent() {
    String[] next = PENDING_SEND.pollFirst();
    if (next == null) return new String[] { null, null };
    return next;
  }

  public static synchronized int pendingSendCount() {
    return PENDING_SEND.size();
  }

  public static void resetCountersForTests() {
    COUNTERS.reset();
    synchronized (WatchSessionService.class) {
      PENDING_SEND.clear();
    }
    active = false;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      stopWatching(true);
      stopSelf();
      return START_NOT_STICKY;
    }
    startAsForeground();
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
    Intent data = intent.getParcelableExtra(EXTRA_RESULT_DATA);
    if (resultCode != Activity.RESULT_OK || data == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    COUNTERS.reset();
    COUNTERS.sessionStartedAtMs = System.currentTimeMillis();
    synchronized (WatchSessionService.class) {
      PENDING_SEND.clear();
    }
    ocr = new MlKitOcrProvider();
    funnel = new CaptureFunnel(COUNTERS, frame -> "");
    funnel.resetSendCooldown();
    foreground = new ForegroundAppResolver(this);

    MediaProjectionManager mpm =
        (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
    projection = mpm.getMediaProjection(resultCode, data);
    if (projection == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    worker = new HandlerThread("gurukul-funnel");
    worker.start();
    handler = new Handler(worker.getLooper());

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      projection.registerCallback(new MediaProjection.Callback() {
        @Override
        public void onStop() {
          Log.i(TAG, "MediaProjection stopped by system");
          if (handler != null) {
            handler.post(() -> {
              stopWatching(true);
              stopSelf();
            });
          } else {
            stopWatching(true);
            stopSelf();
          }
        }
      }, handler);
    }

    WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
    DisplayMetrics metrics = new DisplayMetrics();
    wm.getDefaultDisplay().getRealMetrics(metrics);
    int width = Math.max(360, metrics.widthPixels / 2);
    int height = Math.max(640, metrics.heightPixels / 2);
    int density = metrics.densityDpi;

    reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
    display = projection.createVirtualDisplay(
        "gurukul-watch",
        width,
        height,
        density,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        reader.getSurface(),
        null,
        null
    );

    active = true;
    handler.postDelayed(tick, SAMPLE_MS);
    return START_STICKY;
  }

  private void sampleOnce() {
    try {
      Image image = reader != null ? reader.acquireLatestImage() : null;
      if (image == null) {
        scheduleNext();
        return;
      }
      Bitmap bmp = imageToBitmap(image);
      image.close();
      if (bmp == null) {
        scheduleNext();
        return;
      }

      String pkg = foreground.foregroundPackageOrNull();
      Set<String> allowed = loadAllowedPackages();
      double delta = previous == null ? 0.0 : MlKitOcrProvider.meanAbsDelta(previous, bmp);
      double textDensity = MlKitOcrProvider.textInkDensity(bmp);
      boolean colour = MlKitOcrProvider.verdictColourPresent(bmp);

      FrameSample sample = new FrameSample(
          pkg == null ? "" : pkg,
          allowed,
          delta,
          textDensity,
          colour,
          null,
          false
      );

      Optional<FunnelDecision> early = funnel.dropThrough53(sample);
      if (early.isPresent()) {
        recyclePrevious(bmp);
        scheduleNext();
        return;
      }

      // Keep sampling while OCR runs so §5.1/§5.2 still drop; skip another OCR.
      if (ocrInFlight) {
        recyclePrevious(bmp);
        scheduleNext();
        return;
      }

      ocrInFlight = true;
      final Bitmap forOcr = bmp.copy(bmp.getConfig() != null ? bmp.getConfig() : Bitmap.Config.ARGB_8888, false);
      recyclePrevious(bmp);
      final String pkgFinal = pkg;
      handler.post(() -> {
        try {
          if (forOcr == null) return;
          String text = ocr.recogniseBitmap(forOcr);
          FunnelDecision decision = funnel.finishWithOcrText(text == null ? "" : text);
          if (decision == FunnelDecision.SEND) {
            enqueueSend(bitmapToPngBase64(forOcr), pkgFinal);
            Intent ready = new Intent(ScreenCaptureMistakePlugin.ACTION_WATCH_FRAME_READY);
            ready.setPackage(getPackageName());
            sendBroadcast(ready);
          }
        } catch (Exception e) {
          Log.w(TAG, "OCR/funnel tick failed", e);
        } finally {
          ocrInFlight = false;
          if (forOcr != null) forOcr.recycle();
        }
      });
      scheduleNext();
      return;
    } catch (Exception e) {
      Log.w(TAG, "sampleOnce failed", e);
    }
    scheduleNext();
  }

  private void recyclePrevious(Bitmap bmp) {
    if (previous != null && previous != bmp) previous.recycle();
    previous = bmp;
  }

  private static synchronized void enqueueSend(String b64, String pkg) {
    if (PENDING_SEND.size() >= MAX_PENDING_SEND) {
      PENDING_SEND.pollFirst();
      Log.w(TAG, "pending SEND queue full — dropped oldest");
    }
    PENDING_SEND.addLast(new String[] { b64, pkg });
  }

  private void scheduleNext() {
    if (handler != null && active) handler.postDelayed(tick, SAMPLE_MS);
  }

  private Set<String> loadAllowedPackages() {
    SharedPreferences prefs = getSharedPreferences(ScreenCaptureMistakePlugin.PREFS, MODE_PRIVATE);
    String raw = prefs.getString(ScreenCaptureMistakePlugin.KEY_ALLOWED, "");
    Set<String> out = new HashSet<>();
    if (raw != null && !raw.isEmpty()) {
      out.addAll(Arrays.asList(raw.split(",")));
    }
    return out;
  }

  private void startAsForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL,
          "Gurukul mistake watch",
          NotificationManager.IMPORTANCE_LOW
      );
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) nm.createNotificationChannel(ch);
    }
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL)
        : new Notification.Builder(this);
    Notification n = builder
        .setContentTitle("Gurukul is watching for mistakes")
        .setContentText("Screen capture is on. Turn it off anytime in Gurukul.")
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

  private void stopWatching(boolean notifyJs) {
    if (!active && projection == null && reader == null) return;
    active = false;
    COUNTERS.sessionEndedAtMs = System.currentTimeMillis();
    if (handler != null) handler.removeCallbacks(tick);
    if (worker != null) {
      worker.quitSafely();
      worker = null;
      handler = null;
    }
    if (display != null) {
      display.release();
      display = null;
    }
    if (reader != null) {
      reader.close();
      reader = null;
    }
    if (projection != null) {
      try {
        projection.stop();
      } catch (Exception ignored) {}
      projection = null;
    }
    if (previous != null) {
      previous.recycle();
      previous = null;
    }
    stopForeground(true);
    if (notifyJs) {
      Intent ended = new Intent(ACTION_WATCH_ENDED);
      ended.setPackage(getPackageName());
      sendBroadcast(ended);
    }
  }

  private static Bitmap imageToBitmap(Image image) {
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
    return Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
  }

  private static String bitmapToPngBase64(Bitmap bitmap) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 85, out);
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
  }

  @Override
  public void onDestroy() {
    stopWatching(false);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
