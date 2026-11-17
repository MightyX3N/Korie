package app.korie.tv

// Search (Search.tsx): the box across the top, kinds to narrow it to, letters for the remote on
// the left, and what's found in groups of two-column cards.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.debounce
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

private val SEARCH_KEYS = "abcdefghijklmnopqrstuvwxyzæøå1234567890".map { it.toString() }
private val CHIPS = listOf("all" to "Everything", "film" to "Films", "series" to "Series", "album" to "Music", "addons" to "Add-ons")

@OptIn(ExperimentalLayoutApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun SearchScreen(nav: Nav, me: Screen) {
    val r = rem()
    var q by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }
    var term by remember { mutableStateOf(q.trim()) }
    var groups by remember { mutableStateOf<List<Group>?>(null) }
    val opener = rememberOpener(nav, me)
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    val firstKey = remember { FocusRequester() }
    // Music only for people who have it (as the web's chips)
    var music by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) { music = try { Korie.meOrNull()?.person?.music != false } catch (_: Exception) { true } }
    LaunchedEffect(q) { delay(350); term = q.trim() }
    var again by remember { mutableStateOf(0) }
    LaunchedEffect(term, again) {
        if (term.isEmpty()) { groups = null; return@LaunchedEffect }
        groups = try { Korie.search(term).groups } catch (_: Exception) { if (again > 0) groups else emptyList() }
    }
    // an add-on that was still searching says so when it's done ("search" changed)
    LaunchedEffect(Unit) {
        @OptIn(kotlinx.coroutines.FlowPreview::class)
        Korie.changes.filter { "search" in it }.debounce(150).collect { again++ }
    }
    fun kindOf(g: Group) = if (g.id in listOf("film", "series", "album")) g.id else "addons"
    val found = if (term.isNotEmpty()) groups ?: emptyList() else emptyList()
    val shown = found.filter { filter == "all" || kindOf(it) == filter }

    // typing on a keyboard works anywhere here; Backspace deletes (while there's something to delete)
    Column(Modifier.fillMaxSize().onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown || Ui.busy) return@onPreviewKeyEvent false
        val n = e.nativeKeyEvent
        if (n.keyCode == android.view.KeyEvent.KEYCODE_DEL) { if (q.isNotEmpty()) { q = q.dropLast(1); true } else false }
        else {
            val ch = n.unicodeChar
            if (ch != 0 && !n.isCtrlPressed && !n.isAltPressed && !Character.isISOControl(ch) && n.keyCode !in listOf(android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER)) { q += String(Character.toChars(ch)); true } else false
        }
    }.focusProperties { enter = { firstKey } }.focusGroup().padding(start = gutter(), end = gutter(), top = r(2.2f))) {
        // .top with the search box
        Row(Modifier.padding(bottom = r(1.3f)).heightIn(min = r(3)), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).padding(end = r(2)).height(r(3.5f)).clip(RoundedCornerShape(r(0.6f))).background(C.panel2)
                    .border(r(0.1f), C.accent, RoundedCornerShape(r(0.6f))).padding(horizontal = r(1)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(painterResource(R.drawable.lc_search), null, tint = C.soft, modifier = Modifier.padding(end = r(0.8f)).size(r(1.3f)))
                if (q.isEmpty()) Text("Films, series, music, add-ons", style = body(1.6f, C.dim)) else Text("$q▏", style = body(1.6f))
            }
            Clock()
        }
        FlowRow(Modifier.padding(bottom = r(1.4f)), horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
            CHIPS.filter { it.first != "album" || music }.forEach { (id, label) ->
                val none = id != "all" && term.isNotEmpty() && found.none { kindOf(it) == id && it.items.isNotEmpty() }
                Pill(label, id == filter, dimmed = none) { filter = id }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(r(1.2f))) {
            // .skeys: letters for the remote
            Column(Modifier.width(r(23.6f))) {
                Column(verticalArrangement = Arrangement.spacedBy(r(0.3f))) {
                    (SEARCH_KEYS + listOf("Space", "Delete", "Clear")).let { keys ->
                        val lines = keys.take(SEARCH_KEYS.size).chunked(6) + listOf(keys.drop(SEARCH_KEYS.size))
                        lines.forEach { line ->
                            Row(horizontalArrangement = Arrangement.spacedBy(r(0.3f))) {
                                line.forEach { k ->
                                    Key(k, Modifier.weight(if (k.length > 1) 2f else 1f).then(if (k == SEARCH_KEYS.first()) Modifier.focusRequester(firstKey) else Modifier), size = 1.15f, padV = 0.95f) {
                                        when (k) { "Space" -> q += " "; "Delete" -> q = q.dropLast(1); "Clear" -> q = ""; else -> q += k }
                                    }
                                }
                                if (line.size < 6 && line.all { it.length == 1 }) repeat(6 - line.size) { Box(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
                Text("For the remote. Typing on a keyboard works anywhere in Korie.", style = body(0.9f, C.dim), modifier = Modifier.padding(top = r(0.8f)))
            }
            // .sresults
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = r(5))) {
                items(shown, key = { it.id + it.title }) { g ->
                    if (g.loading) Text("Still searching ${g.title}…", style = heading(1.4f, C.soft), modifier = Modifier.padding(bottom = r(0.5f)))
                    else if (g.items.isNotEmpty()) Column(Modifier.padding(bottom = r(1.2f))) {
                        Text("${if (kindOf(g) == "addons") "From ${g.title}" else g.title} · ${g.items.size}", style = heading(1.4f, C.soft), modifier = Modifier.padding(bottom = r(0.5f)))
                        Column(verticalArrangement = Arrangement.spacedBy(r(0.5f))) {
                            g.items.chunked(2).forEach { pair ->
                                Row(horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                                    pair.forEach { c ->
                                        Result(c, term, g.id == "album", Modifier.weight(1f).focusRequester(reqs.getOrPut(c.id) { FocusRequester() }), onFocus = { me.focused = c.id }, onLong = { opener.menu(c) }) { opener.open(c) }
                                    }
                                    if (pair.size == 1) Box(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }
                item {
                    if (q.isBlank()) Status("Type to search your films, series and music, and the add-ons that can search (DRTV, Stremio, RomM).")
                    else if (term.isNotEmpty() && groups != null && shown.isEmpty()) Status("Nothing found for \"$term\".")
                }
            }
        }
    }
    BackToCard(me, reqs, groups != null, groups)
}

/** .result: a small picture, the title with what was typed in the accent colour, year and more. */
@Composable
fun Result(c: Card, q: String, square: Boolean, modifier: Modifier, onFocus: () -> Unit, onLong: () -> Unit, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.6f))
    Focusable(modifier, onClick = onClick, onLong = onLong, onFocus = onFocus) { f ->
        Row(
            Modifier.fillMaxWidth().heightIn(min = r(8.6f)).then(if (f) Modifier.border(r(0.18f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else C.panel2)
                .padding(start = r(0.3f), end = r(0.8f), top = r(0.3f), bottom = r(0.3f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.9f)),
        ) {
            Box(Modifier.padding(start = r(0.3f)).width(r(4)).height(if (square) r(4) else r(5.9f)).clip(RoundedCornerShape(r(0.3f))).background(C.panel)
                .border(r(0.06f), C.line, RoundedCornerShape(r(0.3f)))) {
                val src = c.poster.ifEmpty { c.thumb }
                if (src.isNotEmpty()) AsyncImage(model = Korie.pic(src, pxOf(r(4))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Column(Modifier.weight(1f)) {
                val i = if (q.isNotEmpty()) c.title.lowercase().indexOf(q.lowercase()) else -1
                Text(
                    buildAnnotatedString {
                        if (i < 0) append(c.title) else {
                            append(c.title.substring(0, i))
                            withStyle(SpanStyle(color = C.accent)) { append(c.title.substring(i, i + q.length)) }
                            append(c.title.substring(i + q.length))
                        }
                    },
                    style = body(1.25f, C.ink, FontWeight.SemiBold).copy(lineHeight = r.sp(1.56f)), maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                val small = listOf(c.year, if (c.subtitle.isNotEmpty() && c.subtitle != c.year) c.subtitle.removePrefix("${c.year} · ") else "").filter { it.isNotEmpty() }.joinToString(" · ")
                if (small.isNotEmpty()) Text(small, style = body(0.95f, C.soft), modifier = Modifier.padding(top = r(0.3f)), maxLines = 1)
            }
        }
    }
}
