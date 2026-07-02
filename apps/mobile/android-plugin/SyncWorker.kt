package ca.persistent.app.alarm

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Autonomous background re-sync. On a ~15-minute cadence (WorkManager's floor) and
 * whenever connectivity returns, this re-pulls the server's alarm set and re-arms
 * on-device via [SyncClient] — with no WebView and no server push involved. It's
 * what makes on-device exact alarms the real trigger and server push mere insurance:
 * even if push is completely down and the app is never opened, the device keeps its
 * own schedule fresh and self-heals (past-due alarms already fire from AlarmStore;
 * this closes the gap for occurrences materialized/changed after the last sync).
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val result = try {
            // false (not signed in / origin not yet mirrored) is not a failure — just
            // nothing to do until the WebView has run once; try again next cycle.
            SyncClient.sync(applicationContext)
            Result.success()
        } catch (_: Exception) {
            // Transient (network/server); let WorkManager back off and retry. Alarms
            // are already armed locally, so a delayed refresh is harmless.
            Result.retry()
        }
        // Regardless of the server sync (even offline), restore any overdue soft nag
        // whose notification the OS dropped — from the locally persisted set. This is
        // the durable keep-alive that makes a nag survive the process being killed.
        runCatching { AlarmService.ensureNags(applicationContext) }
        return result
    }

    companion object {
        private const val UNIQUE_NAME = "persistent-background-sync"

        /** Enqueue the periodic worker (idempotent — KEEP preserves the existing schedule). */
        fun ensureScheduled(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
