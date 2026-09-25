package study.gurukul.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import study.gurukul.app.capture.ScreenCaptureMistakePlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScreenCaptureMistakePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
