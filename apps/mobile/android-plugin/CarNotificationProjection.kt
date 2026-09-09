package ca.persistent.app.alarm

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.notification.CarPendingIntent
import androidx.core.app.NotificationCompat
import ca.persistent.app.R

/** Adds Android Auto-only content and actions to a reminder notification. */
object CarNotificationProjection {
    fun extend(
        context: Context,
        builder: NotificationCompat.Builder,
        spec: AlarmSpec,
        defaultSnoozeMinutes: Int
    ) {
        // Done acknowledges directly. The phone's two-step confirmation guards against
        // pocket taps, while a dashboard action is already deliberate.
        val donePending = PendingIntent.getBroadcast(
            context,
            ("cardone:" + spec.occurrenceId).hashCode(),
            Intent(context, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_CONFIRM)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Use a fixed duration because launching the phone's picker is not useful in-car.
        val snoozePending = PendingIntent.getBroadcast(
            context,
            ("carsnooze:" + spec.occurrenceId).hashCode(),
            Intent(context, AlarmReceiver::class.java)
                .setAction(AlarmReceiver.ACTION_SNOOZE)
                .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
                .putExtra(AlarmReceiver.EXTRA_MINUTES, defaultSnoozeMinutes),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val extender = CarAppExtender.Builder()
            .setContentTitle(spec.title)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setImportance(NotificationManager.IMPORTANCE_HIGH)
            .addAction(R.drawable.ic_action_done, "Done", donePending)
            .addAction(R.drawable.ic_action_snooze, "Snooze ${defaultSnoozeMinutes}m", snoozePending)
        if (spec.body.isNotBlank()) extender.setContentText(spec.body)
        carAppPendingIntent(context, spec)?.let { extender.setContentIntent(it) }
        builder.extend(extender.build())
    }

    private fun carAppPendingIntent(context: Context, spec: AlarmSpec): PendingIntent? = runCatching {
        val match = context.packageManager
            .queryIntentServices(
                Intent("androidx.car.app.CarAppService").setPackage(context.packageName),
                0
            )
            .firstOrNull() ?: return null
        val intent = Intent(Intent.ACTION_VIEW)
            .setComponent(ComponentName(context.packageName, match.serviceInfo.name))
            .putExtra(AlarmReceiver.EXTRA_OCCURRENCE_ID, spec.occurrenceId)
            .putExtra(AlarmReceiver.EXTRA_REMINDER_ID, spec.reminderId)
        CarPendingIntent.getCarApp(
            context,
            ("caropen:" + spec.occurrenceId).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }.getOrNull()
}
