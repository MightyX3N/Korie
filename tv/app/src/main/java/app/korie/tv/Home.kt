package app.korie.tv

// Home: a big picture of something to watch at the top (what's half watched, else something new),
// the person's apps under it (the ones put on Home in Apps), then the rows.

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil.compose.AsyncImage

@Composable
fun Home(nav: Nav, me: Screen, who: Me) {
    val (data, error) = useData("home", listOf("library", "browse", "status", "progress")) { Korie.home() }
    val opener = rememberOpener(nav, me)
    val empty = data != null && data.rows.isEmpty()
    // what's big at the top: the newest half-watched thing, else the newest with a picture
    val hero = data?.rows?.let { rows ->
        rows.firstOrNull { it.id == "continue" }?.items?.firstOrNull { it.backdrop.isNotEmpty() || it.thumb.isNotEmpty() }
            ?: rows.flatMap { it.items }.firstOrNull { it.backdrop.isNotEmpty() && (it.kind == "film" || it.kind == "series") }
    }
    RowsPage(me, {
        Column {
            Top("Home", date = true)
            if (hero != null) Hero(hero, nav, opener)
            FavouriteApps(nav, who)
        }
    }, data?.rows, error.ifEmpty { if (empty) "Nothing here yet. Add folders with films, series or music in Settings → Libraries, or get add-ons in the Store." else null }, opener)
}

@Composable
private fun Hero(c: Card, nav: Nav, opener: Opener) {
    val r = rem()
    val w = LocalConfiguration.current.screenWidthDp
    val shape = RoundedCornerShape(r(1))
    // (at most half the screen's height, so rows show under it on a short screen)
    val cfgH = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp.dp
    // (and then without the overview, so the buttons still fit)
    val short = r(20) > cfgH * 0.5f
    Box(Modifier.fillMaxWidth().height(minOf(r(20), cfgH * 0.5f)).clip(shape).background(C.panel)) {
        AsyncImage(model = Korie.pic(c.backdrop.ifEmpty { c.thumb }, pxOf(w.dp)), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xF20A1420), 0.45f to Color(0xB30A1420), 1f to Color(0x100A1420))))
        Column(Modifier.padding(r(2)).widthIn(max = r(34)), verticalArrangement = Arrangement.spacedBy(r(0.7f))) {
            val half = c.progress > 0 && !c.watched
            Text(if (half) "Continue watching" else if (c.kind == "series") "New series" else "New film", style = body(0.95f, C.accent))
            Text(c.title, style = heading(2.6f), maxLines = if (short) 1 else 2, overflow = TextOverflow.Ellipsis)
            if (c.subtitle.isNotEmpty()) Text(c.subtitle, style = body(1.05f, C.soft), maxLines = 1)
            if (c.overview.isNotEmpty() && !short) Text(c.overview, style = body(1f, C.body), maxLines = 3, overflow = TextOverflow.Ellipsis)
            Row(Modifier.padding(top = r(0.4f)), horizontalArrangement = Arrangement.spacedBy(r(0.7f))) {
                if (c.kind == "film" || c.kind == "episode") Btn(if (half) "Resume" else "Play", R.drawable.lc_play, primary = true) {
                    nav.push("player", mapOf("id" to c.id, "mode" to "resume", "title" to c.title))
                }
                Btn(if (c.kind == "series") "Open" else "More", if (c.kind == "series") R.drawable.lc_play else null, primary = c.kind == "series") { opener.open(c.copy(kind = if (c.kind == "episode") "series" else c.kind, id = if (c.kind == "episode" && c.series.isNotEmpty()) c.series else c.id)) }
            }
        }
    }
}

/** The apps put on Home (in Apps: hold OK, Add to Home), in their order; the last tile opens Apps. */
@Composable
private fun FavouriteApps(nav: Nav, who: Me) {
    val r = rem()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val every = remember { tvApps(ctx) }
    @Suppress("UNUSED_VARIABLE") val tick = AppPrefs.changed.intValue
    val apps = allowedApps(every, who).let { list -> AppPrefs.favourites(ctx, who.person.id).mapNotNull { p -> list.firstOrNull { it.pkg == p } } }
    if (apps.isEmpty()) return
    Column(Modifier.padding(top = r(1.6f), bottom = r(1.2f))) {
        Text("Apps", style = heading(1.4f, C.soft), modifier = Modifier.padding(bottom = r(0.6f)))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(r(1)), contentPadding = PaddingValues(end = r(2))) {
            items(apps, key = { it.pkg }) { a ->
                AppTile(a, Modifier.width(r(11)), onLong = { appMenu(ctx, who.person.id, a, scope) }) {
                    try { ctx.startActivity(a.launch) } catch (e: Exception) { Ui.toast(e.message ?: "") }
                }
            }
            item {
                AppTile(TvApp("", "All apps", null, android.content.Intent()), Modifier.width(r(11))) { nav.go("apps") }
            }
        }
    }
}
