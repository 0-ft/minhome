package com.minhome.widget

import android.content.Context

data class ListWidgetConfig(
    val listId: String,
    val listName: String,
    val columnId: String,
    val columnName: String,
)

object ListWidgetPrefs {
    private const val PREFS_NAME = "list_widget_prefs"

    fun save(context: Context, widgetId: Int, config: ListWidgetConfig) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString("list_id_$widgetId", config.listId)
            .putString("list_name_$widgetId", config.listName)
            .putString("column_id_$widgetId", config.columnId)
            .putString("column_name_$widgetId", config.columnName)
            .apply()
    }

    fun load(context: Context, widgetId: Int): ListWidgetConfig? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val listId = prefs.getString("list_id_$widgetId", null) ?: return null
        return ListWidgetConfig(
            listId = listId,
            listName = prefs.getString("list_name_$widgetId", "") ?: "",
            columnId = prefs.getString("column_id_$widgetId", "") ?: "",
            columnName = prefs.getString("column_name_$widgetId", "") ?: "",
        )
    }

    fun delete(context: Context, widgetId: Int) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .remove("list_id_$widgetId")
            .remove("list_name_$widgetId")
            .remove("column_id_$widgetId")
            .remove("column_name_$widgetId")
            .apply()
    }
}
