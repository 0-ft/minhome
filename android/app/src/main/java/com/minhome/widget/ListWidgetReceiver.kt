package com.minhome.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import kotlinx.coroutines.*

class ListWidgetReceiver : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateWidget(context, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) ListWidgetPrefs.delete(context, id)
    }

    companion object {
        private const val TAG = "ListWidget"

        fun updateWidget(context: Context, widgetId: Int) {
            val config = ListWidgetPrefs.load(context, widgetId)
            if (config == null) {
                pushPlaceholder(context, widgetId)
                return
            }

            val pending = goAsync(context, widgetId)
            CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
                try {
                    val prefs = Prefs(context)
                    if (!prefs.isLoggedIn) {
                        pushStatic(context, widgetId, config, "?")
                        return@launch
                    }
                    val list = ListApi.fetchList(prefs, config.listId)
                    val count = list.items.count { it.statusId == config.columnId }
                    pushStatic(context, widgetId, config, count.toString())
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to update widget $widgetId", e)
                    pushStatic(context, widgetId, config, "!")
                } finally {
                    pending?.finish()
                }
            }
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ListWidgetReceiver::class.java))
            for (id in ids) updateWidget(context, id)
        }

        private fun pushStatic(context: Context, widgetId: Int, config: ListWidgetConfig, count: String) {
            val views = RemoteViews(context.packageName, R.layout.list_widget_layout)
            views.setTextViewText(R.id.list_widget_count, count)
            views.setTextViewText(R.id.list_widget_column_name, config.columnName)
            views.setTextViewText(R.id.list_widget_list_name, config.listName)

            val launchIntent = Intent(context, ListOverlayActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("list_id", config.listId)
                .putExtra("column_id", config.columnId)
            views.setOnClickPendingIntent(
                R.id.list_widget_tap_area,
                PendingIntent.getActivity(
                    context, widgetId, launchIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            )

            val micIntent = Intent(context, ListVoiceOverlayActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("list_id", config.listId)
                .putExtra("list_name", config.listName)
                .putExtra("column_name", config.columnName)
            views.setOnClickPendingIntent(
                R.id.list_widget_mic_btn,
                PendingIntent.getActivity(
                    context, widgetId + 10000, micIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            )

            AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
        }

        private fun pushPlaceholder(context: Context, widgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.list_widget_layout)
            views.setTextViewText(R.id.list_widget_count, "–")
            views.setTextViewText(R.id.list_widget_column_name, "Not configured")
            views.setTextViewText(R.id.list_widget_list_name, "")
            AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
        }

        private fun goAsync(context: Context, widgetId: Int): android.content.BroadcastReceiver.PendingResult? {
            return null
        }
    }
}
