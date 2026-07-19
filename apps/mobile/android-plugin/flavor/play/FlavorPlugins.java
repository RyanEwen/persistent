// `play` flavor: no in-app updater.
//
// Google Play updates the app itself, and an app it distributes may not install
// APKs by any other route. UpdatePlugin is not compiled into this flavor at all,
// so there is nothing to register — and because the plugin is absent, the web UI's
// `Capacitor.isPluginAvailable('Update')` check hides the update prompt and the
// Settings section without needing a separate web build.
package ca.persistent.app;

import com.getcapacitor.BridgeActivity;

public final class FlavorPlugins {
    private FlavorPlugins() {}

    public static void register(BridgeActivity activity) {
        // intentionally empty
    }
}
