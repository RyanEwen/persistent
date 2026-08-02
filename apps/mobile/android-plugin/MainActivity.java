// Template MainActivity for the generated Android project. setup-android.mjs
// copies this over android/app/src/main/java/ca/persistent/app/MainActivity.java
// so the custom AlarmPlugin is registered with the Capacitor bridge. The plugin
// class lives in the app module (ca.persistent.app.alarm) and carries the
// @CapacitorPlugin annotation, but app-module plugins must still be registered
// explicitly here (only plugins shipped as npm packages auto-register).
package ca.persistent.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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
        drawEdgeToEdge();
        // Cold start from a notification tap: the WebView drains the store on startup.
        storePendingNav(getIntent());
    }

    /**
     * Let the WebView fill the display, under transparent system bars.
     *
     * This used to pad the content root by the system-bar insets instead, which
     * kept the layout correct but left a band above and below the WebView showing
     * the *window* background — a flat grey the app has no control over, framing
     * every screen. The web UI paints its own themed background (several themes,
     * all dark but different), so the fix is to stop insetting and let it reach the
     * edges.
     *
     * The web side now carries `env(safe-area-inset-*)` padding on the top bar and
     * bottom nav (`components/AppLayout.tsx`, `components/BottomNav.tsx`) to keep
     * the controls clear of the bars; `viewport-fit=cover` in index.html is what
     * makes those values non-zero. Ship the web change FIRST: while the old bundle
     * is still being served, insets read as 0 and the header would ride under the
     * status bar.
     *
     * `setDecorFitsSystemWindows(false)` is the edge-to-edge switch. Disabling
     * contrast enforcement matters just as much on API 29+, since the system
     * otherwise draws its own translucent scrim behind the bars — which is grey,
     * and would put back most of what this removes.
     */
    private void drawEdgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        // Deprecated in API 35 (javac says so on every build) and deliberately kept:
        // on 35 the bars are already transparent so these are no-ops, but the app
        // floor is far below that and they are what makes the bars transparent there.
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        // Every app theme is dark, so the bar icons stay light.
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        // Behind the WebView before first paint, so launch shows the app's own dark
        // background rather than a white or grey flash.
        window.setBackgroundDrawable(new ColorDrawable(APP_BACKGROUND));
    }

    /** Matches the web shell's darkest theme background (see settings/themes.ts). */
    private static final int APP_BACKGROUND = 0xFF0B0F19;

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
        // Push it to the WebView rather than waiting for Capacitor's `resume`, which
        // never arrives when the activity was already foreground behind the shade.
        AlarmPlugin.notifyPendingNavigation();
        // Consume it so a later relaunch from Recents (which replays the same intent)
        // doesn't bounce the user back to this reminder.
        intent.removeExtra(AlarmReceiver.EXTRA_REMINDER_ID);
    }
}
