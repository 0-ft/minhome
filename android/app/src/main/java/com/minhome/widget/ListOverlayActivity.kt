package com.minhome.widget

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val SandBg = Color(0xFFFEFCF9)
private val SandCard = Color(0xFFF5F0EA)
private val SandBorder = Color(0xFFD6CFC5)
private val SandText = Color(0xFF3B3530)
private val SandSecondary = Color(0xFF8D7368)
private val TealAccent = Color(0xFF2DD4BF)

private val CardShape = RoundedCornerShape(10.dp)
private val CardBorder = androidx.compose.foundation.BorderStroke(1.dp, SandBorder)
private val OverlayShape = RoundedCornerShape(24.dp)

class ListOverlayActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val listId = intent.getStringExtra("list_id") ?: run { finish(); return }
        val columnId = intent.getStringExtra("column_id") ?: ""

        setFinishOnTouchOutside(true)

        setContent {
            KanbanOverlay(
                listId = listId,
                focusColumnId = columnId,
                onDismiss = { finish() }
            )
        }
    }

}

@Composable
private fun KanbanOverlay(listId: String, focusColumnId: String, onDismiss: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var listData by remember { mutableStateOf<ListData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var refreshKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(listId, refreshKey) {
        try {
            val data = withContext(Dispatchers.IO) {
                ListApi.fetchList(Prefs(context), listId, context)
            }
            listData = data
        } catch (e: Exception) {
            if (listData == null) error = e.message ?: "Failed to load list"
        }
        loading = false
    }

    val onMoveItem: (ListItem, String) -> Unit = remember {
        { item, newStatusId ->
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        ListApi.moveItem(Prefs(context), listId, item.id, newStatusId)
                    }
                    refreshKey++
                } catch (_: Exception) { }
            }
        }
    }

    Surface(
        modifier = Modifier
            .widthIn(max = 380.dp)
            .heightIn(max = 520.dp),
        shape = OverlayShape,
        color = SandBg,
        shadowElevation = 6.dp,
    ) {
        when {
            loading && listData == null -> {
                Box(Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = SandSecondary)
                }
            }
            error != null && listData == null -> {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(error!!, color = Color(0xFFBF4342))
                }
            }
            listData != null -> {
                KanbanPager(listData!!, focusColumnId, onMoveItem)
            }
        }
    }
}

@Composable
private fun KanbanPager(list: ListData, focusColumnId: String, onMoveItem: (ListItem, String) -> Unit) {
    val columns = list.columns
    val initialPage = columns.indexOfFirst { it.id == focusColumnId }.coerceAtLeast(0)
    val pagerState = rememberPagerState(initialPage = initialPage) { columns.size }

    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            text = list.name,
            fontSize = 13.sp,
            color = SandSecondary,
            modifier = Modifier.padding(start = 20.dp, top = 16.dp, end = 20.dp)
        )

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp),
            pageSpacing = 12.dp,
        ) { page ->
            val column = columns[page]
            val items = list.items.filter { it.statusId == column.id }
            ColumnPage(column, items, columns, onMoveItem)
        }

        // Page indicators
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp, top = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            columns.forEachIndexed { index, _ ->
                val selected = pagerState.currentPage == index
                Box(
                    modifier = Modifier
                        .padding(horizontal = 3.dp)
                        .size(if (selected) 8.dp else 6.dp)
                        .clip(CircleShape)
                        .background(if (selected) SandSecondary else SandBorder)
                )
            }
        }
    }
}

@Composable
private fun ColumnPage(
    column: ListColumn,
    items: List<ListItem>,
    allColumns: List<ListColumn>,
    onMoveItem: (ListItem, String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = column.name,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = SandText,
            )
            Text(
                text = "${items.size}",
                fontSize = 13.sp,
                color = SandSecondary,
            )
        }

        if (items.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Text("No items", fontSize = 13.sp, color = SandSecondary)
            }
        } else {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items.forEach { item ->
                    ItemCard(item, column, allColumns, onMoveItem)
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}

@Composable
private fun ItemCard(
    item: ListItem,
    currentColumn: ListColumn,
    allColumns: List<ListColumn>,
    onMoveItem: (ListItem, String) -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }
    val otherColumns = allColumns.filter { it.id != currentColumn.id }

    Box {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(CardShape)
                .background(SandCard)
                .border(CardBorder, CardShape)
                .clickable(enabled = otherColumns.isNotEmpty()) { showMenu = true }
                .padding(12.dp)
        ) {
            Text(
                text = "#${item.id}",
                fontSize = 10.sp,
                color = SandSecondary,
                letterSpacing = 0.5.sp,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = item.title,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = SandText,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        DropdownMenu(
            expanded = showMenu,
            onDismissRequest = { showMenu = false },
        ) {
            Text(
                text = "Move to…",
                fontSize = 12.sp,
                color = SandSecondary,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
            otherColumns.forEach { col ->
                DropdownMenuItem(
                    text = { Text(col.name, fontSize = 14.sp) },
                    onClick = {
                        showMenu = false
                        onMoveItem(item, col.id)
                    }
                )
            }
        }
    }
}
