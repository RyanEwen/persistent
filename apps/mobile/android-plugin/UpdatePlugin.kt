// In-app updater. Downloads a release APK via the system DownloadManager and
// launches the package installer when it finishes, emitting "updateState" events
// (downloading | ready | failed) the web UI observes. Lives in the alarm package
// only because setup-android.mjs copies every plugin .kt there; it is otherwise
// unrelated to the alarm engine.
package ca.persistent.app.alarm

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Update")
class UpdatePlugin : Plugin() {

    private var receiver: BroadcastReceiver? = null

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url")
        if (url == null) {
            call.reject("url is required")
            return
        }

        val ctx = context
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("Persistent update")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(ctx, null, "persistent-update.apk")
            .setMimeType("application/vnd.android.package-archive")

        unregister()
        val downloadId = dm.enqueue(request)

        receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
                if (id != downloadId) return
                unregister()
                val uri = if (status(dm, downloadId) == DownloadManager.STATUS_SUCCESSFUL) {
                    dm.getUriForDownloadedFile(downloadId)
                } else {
                    null
                }
                if (uri != null) {
                    launchInstall(uri)
                    emit("ready")
                } else {
                    emit("failed")
                }
            }
        }
        ContextCompat.registerReceiver(
            ctx,
            receiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        )

        emit("downloading")
        call.resolve()
    }

    private fun status(dm: DownloadManager, id: Long): Int {
        dm.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            }
        }
        return -1
    }

    private fun launchInstall(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
    }

    private fun emit(state: String) {
        notifyListeners("updateState", JSObject().put("state", state))
    }

    private fun unregister() {
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Already unregistered; ignore.
            }
        }
        receiver = null
    }

    override fun handleOnDestroy() {
        unregister()
        super.handleOnDestroy()
    }
}
