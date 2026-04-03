package com.minhome.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ListWidgetConfigActivity : ComponentActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                ConfigScreen(
                    onConfirm = { config ->
                        ListWidgetPrefs.save(this, appWidgetId, config)
                        ListWidgetReceiver.updateWidget(this, appWidgetId)
                        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
                        finish()
                    },
                    onCancel = { finish() }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConfigScreen(onConfirm: (ListWidgetConfig) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    var lists by remember { mutableStateOf<List<ListData>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var selectedList by remember { mutableStateOf<ListData?>(null) }

    LaunchedEffect(Unit) {
        try {
            val result = withContext(Dispatchers.IO) {
                ListApi.fetchAllLists(Prefs(context))
            }
            lists = result
        } catch (e: Exception) {
            error = e.message ?: "Failed to load lists"
        }
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (selectedList == null) "Select List" else "Select Column") },
            )
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (loading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (error != null) {
                Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(error!!, color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = onCancel) { Text("Cancel") }
                }
            } else if (selectedList == null) {
                ListPicker(lists) { selectedList = it }
            } else {
                ColumnPicker(selectedList!!) { column ->
                    onConfirm(ListWidgetConfig(
                        listId = selectedList!!.id,
                        listName = selectedList!!.name,
                        columnId = column.id,
                        columnName = column.name,
                    ))
                }
            }
        }
    }
}

@Composable
private fun ListPicker(lists: List<ListData>, onSelect: (ListData) -> Unit) {
    if (lists.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No lists found", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(lists) { list ->
            Card(
                modifier = Modifier.fillMaxWidth().clickable { onSelect(list) },
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(list.name, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${list.columns.size} columns · ${list.items.size} items",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnPicker(list: ListData, onSelect: (ListColumn) -> Unit) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                "Pick a column from \u201c${list.name}\u201d",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }
        items(list.columns) { column ->
            val count = list.items.count { it.statusId == column.id }
            Card(
                modifier = Modifier.fillMaxWidth().clickable { onSelect(column) },
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(column.name, fontWeight = FontWeight.SemiBold)
                    Text(
                        "$count items",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
