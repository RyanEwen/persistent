package ca.persistent.app.alarm

import android.content.Context
import androidx.core.app.NotificationCompat

/** Play builds leave notifications untouched because they contain no Android Auto support. */
object CarNotificationProjection {
    fun extend(
        @Suppress("UNUSED_PARAMETER") context: Context,
        @Suppress("UNUSED_PARAMETER") builder: NotificationCompat.Builder,
        @Suppress("UNUSED_PARAMETER") spec: AlarmSpec,
        @Suppress("UNUSED_PARAMETER") defaultSnoozeMinutes: Int
    ) = Unit
}
