// Template MainActivity for the generated Android project. setup-android.mjs
// copies this over android/app/src/main/java/ca/persistent/app/MainActivity.java
// so the custom AlarmPlugin is registered with the Capacitor bridge. The plugin
// class lives in the app module (ca.persistent.app.alarm) and carries the
// @CapacitorPlugin annotation, but app-module plugins must still be registered
// explicitly here (only plugins shipped as npm packages auto-register).
package ca.persistent.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import ca.persistent.app.alarm.AlarmPlugin;
import ca.persistent.app.alarm.UpdatePlugin;
import ca.persistent.app.alarm.PasskeyPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(PasskeyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
