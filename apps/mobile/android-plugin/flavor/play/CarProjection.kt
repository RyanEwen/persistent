package ca.persistent.app.alarm

import android.content.Context

/** Play builds contain no Android Auto integration, so projection is always inactive. */
object CarProjection {
    const val projecting: Boolean = false
    const val projectingSince: Long = 0L

    fun init(@Suppress("UNUSED_PARAMETER") context: Context) = Unit
}
