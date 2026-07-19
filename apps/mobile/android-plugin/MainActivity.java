// Template MainActivity for the generated Android project. setup-android.mjs
// copies this over android/app/src/main/java/ca/persistent/app/MainActivity.java
// so the custom AlarmPlugin is registered with the Capacitor bridge. The plugin
// class lives in the app module (ca.persistent.app.alarm) and carries the
// @CapacitorPlugin annotation, but app-module plugins must still be registered
// explicitly here (only plugins shipped as npm packages auto-register).
package ca.persistent.app;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import com.getcapacitor.BridgeActivity;
import ca.persistent.app.alarm.AlarmPlugin;
import ca.persistent.app.alarm.AlarmReceiver;
import ca.persistent.app.alarm.PendingNavStore;
import ca.persistent.app.alarm.PasskeyPlugin;
import ca.persistent.app.alarm.GoogleAuthPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        registerPlugin(PasskeyPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        // Flavor-specific plugins: `direct` registers the in-app updater, `play`
        // registers nothing (see flavor/*/FlavorPlugins.java). UpdatePlugin cannot
        // be named here because it is not compiled into the play flavor.
        FlavorPlugins.register(this);
        super.onCreate(savedInstanceState);
        // Cold start from a notification tap: the WebView drains the store on startup.
        storePendingNav(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Warm tap (launchMode=singleTask, so an existing task is reused rather than
        // re-created): record the target before Capacitor emits its `resume` event,
        // which is what makes nativeSync drain the store and navigate.
        setIntent(intent);
        storePendingNav(intent);
    }

    /**
     * A notification's content intent targets this activity directly (starting it
     * from AlarmReceiver would be a notification trampoline, which Android 12+
     * blocks). The reminder id rides along as an extra; park it where the WebView
     * can pick it up, since it owns the router.
     */
    private void storePendingNav(Intent intent) {
        if (intent == null) return;
        String reminderId = intent.getStringExtra(AlarmReceiver.EXTRA_REMINDER_ID);
        if (TextUtils.isEmpty(reminderId)) return;
        PendingNavStore.INSTANCE.set(this, reminderId);
        // Consume it so a later relaunch from Recents (which replays the same intent)
        // doesn't bounce the user back to this reminder.
        intent.removeExtra(AlarmReceiver.EXTRA_REMINDER_ID);
    }
}
