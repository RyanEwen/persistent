package ca.persistent.app.alarm

import android.content.Context

/** Play builds contain no car screen to refresh. */
object CarListRefresh {
    fun notifyChanged(@Suppress("UNUSED_PARAMETER") context: Context) = Unit
}
