// `direct` flavor: the sideloaded build keeps the in-app updater.
//
// MainActivity lives in src/main and so cannot reference UpdatePlugin directly —
// that class only exists in this flavor's source set. Both flavors provide a
// FlavorPlugins with the same signature; MainActivity calls it blind.
package ca.persistent.app;

import com.getcapacitor.BridgeActivity;
import ca.persistent.app.alarm.UpdatePlugin;

public final class FlavorPlugins {
    private FlavorPlugins() {}

    public static void register(BridgeActivity activity) {
        activity.registerPlugin(UpdatePlugin.class);
    }
}
