package app.korie.tv

// A film or a series: its page (Item.tsx). It opens with Play focused.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Item(nav: Nav, me: Screen, who: Me) {
    val r = rem()
    val id = me.params["id"] ?: ""
    val scope = rememberCoroutineScope()
    val (data, error, reload) = useData(id, listOf("library")) { Korie.item(id) }
    var season by rememberSaveable { mutableStateOf<Int?>(null) }
    val play = remember { FocusRequester() }
    val back = remember { FocusRequester() }
    val epReqs = remember { mutableMapOf<String, FocusRequester>() }

    if (data == null) {
        Column(Modifier.padding(start = gutter(), end = gutter(), top = r(2.2f))) {
            BackLink(nav, Modifier.focusRequester(back))
            Status(error.ifEmpty { "Loading…" })
        }
        LaunchedEffect(Unit) { delay(80); try { back.requestFocus() } catch (_: Exception) {} }
        return
    }
    val d = data
    val isSeries = d.kind == "series"
    val isAlbum = d.kind == "album"
    val seasons = d.seasons
    val cur = seasons.firstOrNull { it.n == season } ?: seasons.firstOrNull { s -> s.episodes.any { !it.watched } } ?: seasons.firstOrNull()
    val all = seasons.flatMap { it.episodes }
    val nextEp = if (isSeries) all.firstOrNull { it.progress > 0 } ?: all.firstOrNull { !it.watched } else null
    fun playIt(mode: String, target: String = d.id) { me.focused = "play"; nav.push("player", mapOf("id" to target, "mode" to mode, "title" to d.title)) }
    val meta = listOf(d.year, fmtRuntime(d.runtime), d.genres.take(3).joinToString(", "), if (d.kind == "game") d.subtitle else "", if (d.director.isNotEmpty()) "Directed by ${d.director}" else "", d.artist ?: "", if (d.source.isNotEmpty()) "From ${d.source}" else "").filter { it.isNotEmpty() }
    val canFix = d.local && (d.kind == "film" || isSeries) && who.person.canSettings
    val firstLabel = if (isSeries) {
        if (nextEp != null) {
            val sn = seasons.firstOrNull { it.episodes.contains(nextEp) }?.n
            if (nextEp.progress > 0) "Resume S${sn}E${nextEp.n}" else "Play S${sn}E${nextEp.n}"
        } else "Play"
    } else if (isAlbum) "Play" else if (d.position > 30) "Resume from ${fmtTime(d.position)}" else "Play"

    Box(Modifier.fillMaxSize()) {
        // .hero: the backdrop, darkened from the left and the bottom
        val w = LocalConfiguration.current.screenWidthDp
        if (d.backdrop.isNotEmpty() || d.poster.isNotEmpty()) {
            AsyncImage(model = Korie.pic(d.backdrop.ifEmpty { d.poster }, pxOf(w.dp)), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xF70A1420), 0.38f to Color(0xF00A1420), 0.64f to Color(0xA80A1420), 1f to Color(0x550A1420))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color(0x000A1420), 1f to C.ground)))

        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = gutter(), end = gutter(), top = r(2), bottom = r(5))) {
            BackLink(nav, Modifier.focusRequester(back))
            // .dtop: the poster and what it is
            Row(horizontalArrangement = Arrangement.spacedBy(r(2.6f)), verticalAlignment = Alignment.Top) {
                Box(Modifier.width(r(15)).aspectRatio(if (isAlbum) 1f else 2f / 3f).shadow(r(1.2f), RoundedCornerShape(r(0.8f))).clip(RoundedCornerShape(r(0.8f))).background(C.panel)) {
                    if (d.poster.isNotEmpty()) AsyncImage(model = Korie.pic(d.poster, pxOf(r(15))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Column(Modifier.weight(1f).widthIn(max = r(52)), verticalArrangement = Arrangement.spacedBy(r(1))) {
                    Text(d.title, style = heading(3f))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(r(1.3f)), verticalArrangement = Arrangement.spacedBy(r(0.4f))) {
                        meta.forEach { Text(it, style = body(1.05f, C.soft)) }
                        if (d.rating > 0) Text("★ %.1f".format(d.rating), style = body(1.05f, C.warm))
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(r(0.7f)), verticalArrangement = Arrangement.spacedBy(r(0.7f))) {
                        Btn(firstLabel, R.drawable.lc_play, primary = true, modifier = Modifier.focusRequester(play)) {
                            if (isSeries) { if (nextEp != null) playIt("resume", nextEp.id) }
                            else if (isAlbum) { if (!d.tracks.isNullOrEmpty()) scope.launch { me.focused = "play"; Music.playList(d.id); nav.push("nowplaying") } }
                            else playIt("resume")
                        }
                        if (!isSeries && !isAlbum && d.position > 30) Btn("From the start", R.drawable.lc_rotate_ccw) { playIt("start") }
                        if (isAlbum) Btn("Shuffle", R.drawable.lc_shuffle) { if (!d.tracks.isNullOrEmpty()) scope.launch { Music.playList(d.id, "", true); nav.push("nowplaying") } }
                        if (d.kind != "game") Btn(null, if (d.favourite) R.drawable.lc_heart_fill else R.drawable.lc_heart) {
                            scope.launch { try { Korie.favourite(d.id) } catch (e: Exception) { Ui.toast(e.message ?: "") }; reload() }
                        }
                        if (!isAlbum && d.kind != "game") Btn(null, if (d.watched) R.drawable.lc_eye_off else R.drawable.lc_eye) {
                            scope.launch { try { Korie.watched(d.id, !d.watched) } catch (e: Exception) { Ui.toast(e.message ?: "") }; reload() }
                        }
                        if (canFix) Btn(null, R.drawable.lc_wand_sparkles) { scope.launch { fixMatch(d.id, d.title); reload() } }
                    }
                    if (d.overview.isNotEmpty()) Text(d.overview, style = body(1.1f, C.body).copy(lineHeight = r.sp(1.65f)), maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = r(46)))
                    if (d.error.isNotEmpty()) Status(d.error)
                }
            }
            // seasons and episodes
            if (isSeries && seasons.isNotEmpty() && cur != null) {
                Column(Modifier.padding(top = r(2.2f))) {
                    // the season pills, and marking the whole season shown as watched (or not)
                    val seen = cur.episodes.isNotEmpty() && cur.episodes.all { it.watched }
                    val sname = cur.title.ifEmpty { if (cur.n == 0) "Specials" else "Season ${cur.n}" }
                    FlowRow(Modifier.padding(bottom = r(1.4f)), horizontalArrangement = Arrangement.spacedBy(r(0.6f)), verticalArrangement = Arrangement.spacedBy(r(0.6f))) {
                        if (seasons.size > 1) seasons.forEach { s -> Pill(s.title.ifEmpty { "Season ${s.n}" }, s === cur, onFocus = { season = s.n }) { season = s.n } }
                        Btn(if (seen) "$sname watched" else "Mark ${sname.lowercase()} as watched", if (seen) R.drawable.lc_eye_off else R.drawable.lc_check) {
                            season = cur.n // stay on this season after it's reloaded
                            scope.launch { try { Korie.watched(cur.episodes.map { it.id }, !seen) } catch (e: Exception) { Ui.toast(e.message ?: "") }; reload() }
                        }
                    }
                    Column(Modifier.widthIn(max = r(64)).padding(top = r(1)), verticalArrangement = Arrangement.spacedBy(r(0.5f))) {
                        cur.episodes.forEach { e ->
                            Episode(e, Modifier.focusRequester(epReqs.getOrPut(e.id) { FocusRequester() }), onLong = {
                                // hold OK: what can be done with it without playing it
                                season = cur.n
                                scope.launch {
                                    val v = Ui.menu("${e.n}. ${e.title}", listOfNotNull(
                                        Choice(if (e.progress > 0 && !e.watched) "Resume" else "Play", "play", R.drawable.lc_play),
                                        if (e.progress > 0 && !e.watched) Choice("Play from the start", "start", R.drawable.lc_rotate_ccw) else null,
                                        Choice(if (e.watched) "Mark as not watched" else "Mark as watched", "seen", if (e.watched) R.drawable.lc_eye_off else R.drawable.lc_check),
                                        Choice("Mark everything up to here as watched", "upto", R.drawable.lc_check),
                                    )) ?: return@launch
                                    when (v) {
                                        "play", "start" -> { me.focused = e.id; nav.push("player", mapOf("id" to e.id, "mode" to if (v == "start") "start" else "resume", "title" to d.title)) }
                                        "seen" -> { try { Korie.watched(e.id, !e.watched) } catch (x: Exception) { Ui.toast(x.message ?: "") }; reload() }
                                        "upto" -> {
                                            val upTo = all.takeWhile { it.id != e.id }.map { it.id } + e.id
                                            try { Korie.watched(upTo, true) } catch (x: Exception) { Ui.toast(x.message ?: "") }; reload()
                                        }
                                    }
                                }
                            }) { me.focused = e.id; nav.push("player", mapOf("id" to e.id, "mode" to "resume", "title" to d.title)) }
                        }
                    }
                }
            }
            // .tracks: an album's songs
            if (isAlbum) {
                Column(Modifier.widthIn(max = r(52)).padding(top = r(2)), verticalArrangement = Arrangement.spacedBy(r(0.2f))) {
                    d.tracks?.forEachIndexed { i, t ->
                        TrackRow(t.n.takeIf { it > 0 } ?: (i + 1), t.title, if (t.artist.isNotEmpty() && t.artist != d.artist) t.artist else "", t.duration) {
                            scope.launch { Music.playList(d.id, t.id); nav.push("nowplaying") }
                        }
                    }
                }
            }
            if (isSeries && seasons.isEmpty()) Status(if (d.error.isNotEmpty()) "" else if (d.local) "No episodes found." else "Loading the episodes…")
            // .cast
            if (d.cast.isNotEmpty()) {
                FlowRow(Modifier.padding(top = r(2)), horizontalArrangement = Arrangement.spacedBy(r(0.8f)), verticalArrangement = Arrangement.spacedBy(r(0.8f))) {
                    d.cast.take(8).forEach { c ->
                        Row(
                            Modifier.clip(RoundedCornerShape(r(99))).background(Color(0xCC16293F)).padding(start = r(0.4f), end = r(1), top = r(0.4f), bottom = r(0.4f)),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.7f)),
                        ) {
                            Box(Modifier.size(r(2.4f)).clip(CircleShape).background(Color(0xFF2A4260)), contentAlignment = Alignment.Center) {
                                if (c.photo.isNotEmpty()) AsyncImage(model = Korie.pic(c.photo, pxOf(r(2.4f))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                                else Text(c.name.split(" ").mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString(""), style = body(0.85f, C.ink, FontWeight.SemiBold))
                            }
                            Column {
                                Text(c.name, style = body(1f))
                                if (c.role.isNotEmpty()) Text(c.role, style = body(0.8f, C.dim))
                            }
                        }
                    }
                }
            }
        }
    }
    // it opens with Play focused; back from an episode, that episode
    LaunchedEffect(Unit) {
        delay(100)
        val f = me.focused
        try { if (f != null && epReqs.containsKey(f)) epReqs[f]!!.requestFocus() else play.requestFocus() } catch (_: Exception) {}
    }
}

/** .ep: an episode's picture, number, title and story; focused: panel with an accent ring. */
@Composable
fun Episode(e: Episode, modifier: Modifier = Modifier, onLong: (() -> Unit)? = null, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.7f))
    Focusable(modifier.fillMaxWidth(), onClick = onClick, onLong = onLong) { f ->
        Row(
            Modifier.fillMaxWidth().then(if (f) Modifier.border(r(0.2f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else Color(0x99102033)).padding(r(0.55f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1.1f)),
        ) {
            Box(Modifier.width(r(12)).aspectRatio(16f / 9f).clip(RoundedCornerShape(r(0.5f))).background(C.panel)) {
                if (e.thumb.isNotEmpty()) AsyncImage(model = Korie.pic(e.thumb, pxOf(r(12))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                if (e.progress > 0) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(r(0.25f)).background(Color(0x99000000))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(e.progress.toFloat().coerceIn(0f, 1f)).background(C.accent))
                }
            }
            Column(Modifier.weight(1f)) {
                Text("Episode ${e.n}${if (e.runtime > 0) " · " + fmtRuntime(e.runtime) else ""}${if (e.watched) " · Watched ✓" else ""}${if (f && onLong != null) " · Hold OK for more" else ""}", style = body(0.9f, if (e.watched) C.accent else C.dim))
                Text(e.title, style = body(1.1f, C.ink, FontWeight.SemiBold))
                if (e.overview.isNotEmpty()) Text(e.overview, style = body(0.92f, C.soft), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
