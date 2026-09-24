package study.gurukul.app.capture.funnel;

import android.graphics.Bitmap;
import android.graphics.Color;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.concurrent.TimeUnit;

/** §5.4 — ML Kit on-device OCR. Free, offline. */
public final class MlKitOcrProvider implements OcrProvider {
  private final TextRecognizer recognizer =
      TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

  @Override
  public String recognise(FrameSample frame) {
    // Production path uses BitmapOcrFrame; tests inject ocrTextOrNull.
    return "";
  }

  public String recogniseBitmap(Bitmap bitmap) {
    if (bitmap == null) return "";
    try {
      InputImage image = InputImage.fromBitmap(bitmap, 0);
      return Tasks.await(recognizer.process(image), 4, TimeUnit.SECONDS).getText();
    } catch (Exception e) {
      return "";
    }
  }

  /** Cheap §5.2 / §5.3 signals from a downscaled bitmap — no OCR. */
  public static double meanAbsDelta(Bitmap a, Bitmap b) {
    if (a == null || b == null) return 1.0;
    int w = Math.min(a.getWidth(), b.getWidth());
    int h = Math.min(a.getHeight(), b.getHeight());
    if (w < 2 || h < 2) return 1.0;
    long sum = 0;
    int n = 0;
    // Sample every Nth pixel for cost.
    int step = Math.max(1, Math.min(w, h) / 64);
    for (int y = 0; y < h; y += step) {
      for (int x = 0; x < w; x += step) {
        int ca = a.getPixel(x, y);
        int cb = b.getPixel(x, y);
        sum += Math.abs(Color.red(ca) - Color.red(cb))
            + Math.abs(Color.green(ca) - Color.green(cb))
            + Math.abs(Color.blue(ca) - Color.blue(cb));
        n += 1;
      }
    }
    if (n == 0) return 1.0;
    return (sum / (255.0 * 3.0)) / n;
  }

  public static double textInkDensity(Bitmap bmp) {
    if (bmp == null) return 0;
    int w = bmp.getWidth();
    int h = bmp.getHeight();
    int step = Math.max(1, Math.min(w, h) / 80);
    int ink = 0;
    int n = 0;
    for (int y = 0; y < h; y += step) {
      for (int x = 0; x < w; x += step) {
        int c = bmp.getPixel(x, y);
        int lum = (Color.red(c) + Color.green(c) + Color.blue(c)) / 3;
        if (lum < 90) ink++;
        n++;
      }
    }
    return n == 0 ? 0 : (ink * 1.0) / n;
  }

  /** Red/green verdict chips common on PW review screens. */
  public static boolean verdictColourPresent(Bitmap bmp) {
    if (bmp == null) return false;
    int w = bmp.getWidth();
    int h = bmp.getHeight();
    int step = Math.max(1, Math.min(w, h) / 60);
    int redish = 0;
    int greenish = 0;
    for (int y = 0; y < h; y += step) {
      for (int x = 0; x < w; x += step) {
        int c = bmp.getPixel(x, y);
        int r = Color.red(c);
        int g = Color.green(c);
        int b = Color.blue(c);
        if (r > 160 && g < 100 && b < 100) redish++;
        if (g > 140 && r < 120 && b < 120) greenish++;
      }
    }
    return redish > 8 || greenish > 8;
  }
}
