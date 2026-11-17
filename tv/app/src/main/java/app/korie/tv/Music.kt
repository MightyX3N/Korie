package app.korie.tv

// Music that keeps playing while you look around Korie (music.ts): one player for the whole app,
// a queue (an album or a playlist, in order or shuffled), and the screens that show it: Now
// playing, the bar along the bottom of Music, and Music itself (Library.tsx Music).

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class Song(val id: String, val title: String, val artist: String, val album: String, val year: String, val cover: String, val duration: Double)

object Music {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var app: Context? = null
    private var exo: ExoPlayer? = null

    var queue by mutableStateOf<List<Song>>(emptyList()); private set
    var pos by mutableStateOf(0); private set
    var playing by mutableStateOf(false); private set
    var time by mutableStateOf(0.0); private set
    var duration by mutableStateOf(0.0); private set
    var shuffle by mutableStateOf(false); private set
    var repeat by mutableStateOf(false); private set
    var list by mutableStateOf(""); private set
    var error by mutableStateOf(""); private set
    private var order: List<Song> = emptyList() // the list as it is (shuffle plays from a mixed copy)
    private var lastSave = 0L

    val current: Song? get() = queue.getOrNull(pos)

    fun init(ctx: Context) { app = ctx.applicationContext }

    private fun player(): ExoPlayer = exo ?: ExoPlayer.Builder(app!!).build().also { p ->
        exo = p
        p.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && p.duration > 0) duration = p.duration / 1000.0
                if (state == Player.STATE_ENDED) {
                    val s = current
                    if (s != null) scope.launch { Korie.progress(s.id, time, time, true) }
                    if (pos + 1 < queue.size || repeat) next() else playing = false
                }
            }
            override fun onPlayerError(e: PlaybackException) { playing = false; error = "This song couldn't be played." }
        })
        // the time, and where it got to, every so often
        scope.launch {
            while (true) {
                delay(500)
                val x = exo ?: break
                if (x.playbackState != Player.STATE_IDLE) time = x.currentPosition / 1000.0
                val s = current
                if (s != null && x.isPlaying && System.currentTimeMillis() - lastSave > 10000) {
                    lastSave = System.currentTimeMillis()
                    Korie.progress(s.id, time, if (duration > 0) duration else s.duration, false)
                }
            }
        }
    }

    private suspend fun start(i: Int) {
        val song = queue.getOrNull(i) ?: return
        pos = i; time = 0.0; duration = song.duration; error = ""
        try {
            val p = Korie.play(song.id)
            if (current?.id != song.id) return // another song was picked meanwhile
            val x = player()
            x.setMediaItem(MediaItem.fromUri(Uri.parse(Korie.url(p.url))))
            x.prepare()
            x.play()
        } catch (e: Exception) {
            playing = false; error = e.message ?: ""
        }
    }

    private fun mixed(songs: List<Song>, first: String): List<Song> {
        val f = songs.firstOrNull { it.id == first }
        val rest = songs.filter { it.id != first }.shuffled()
        return if (f != null) listOf(f) + rest else rest
    }

    /** Plays an album or a playlist (its id), from one of its songs (or the first); shuffled if asked. */
    suspend fun playList(id: String, from: String = "", shuffled: Boolean = false) {
        val d = Korie.item(id)
        order = (d.tracks ?: emptyList()).map { t ->
            Song(t.id, t.title, t.artist.ifEmpty { d.artist ?: "" }, t.albumTitle.ifEmpty { d.title }, if (t.albumTitle.isNotEmpty()) "" else d.year, t.poster.ifEmpty { d.poster }, t.duration)
        }
        val first = from.ifEmpty { if (shuffled) order.randomOrNull()?.id ?: "" else order.firstOrNull()?.id ?: "" }
        val q = if (shuffled) mixed(order, first) else order
        queue = q; shuffle = shuffled; list = id
        start(maxOf(0, q.indexOfFirst { it.id == first }))
    }

    fun toggle() { val x = exo ?: return; if (x.isPlaying) x.pause() else x.play() }
    fun next() { if (pos + 1 < queue.size) scope.launch { start(pos + 1) } else if (repeat && queue.isNotEmpty()) scope.launch { start(0) } }
    fun prev() {
        // early in a song: the one before; later: this one from the start
        val x = exo ?: return
        if (x.currentPosition > 4000 || pos == 0) x.seekTo(0) else scope.launch { start(pos - 1) }
    }
    fun jumpTo(i: Int) { scope.launch { start(i) } }
    fun seek(seconds: Double) { val x = exo ?: return; if (x.duration > 0) x.seekTo((x.currentPosition + (seconds * 1000).toLong()).coerceIn(0, x.duration - 500)) }
    fun shuffleOn(on: Boolean) {
        val now = current ?: run { shuffle = on; return }
        val q = if (on) mixed(order, now.id) else order
        shuffle = on; queue = q; pos = q.indexOfFirst { it.id == now.id }
    }
    fun repeatOn(on: Boolean) { repeat = on }
    fun stop() {
        exo?.let { it.stop(); it.clearMediaItems() }
        queue = emptyList(); pos = 0; playing = false; time = 0.0; list = ""
    }
}

// --- Now playing (NowPlaying.tsx) ---------------------------------------------------------

/** .npb: a round control; .small: no background, soft (accent when on); .big: the accent one. */
@Composable
private fun Npb(icon: Int, size: String = "", on: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val r = rem()
    val d = when (size) { "small" -> r(2.6f); "big" -> r(4.4f); else -> r(3.4f) }
    Focusable(modifier, onClick = onClick) { f ->
        val ring = if (f) Modifier.border(if (size == "big") r(0.25f) else r(0.18f), if (size == "big") C.ink else C.accent, CircleShape) else Modifier
        val bg = when (size) { "small" -> Color.Transparent; "big" -> C.accent; else -> C.panel }
        val fg = when (size) { "small" -> if (on) C.accent else C.soft; "big" -> C.onAccent; else -> C.ink }
        Box(
            Modifier.size(d).then(if (size == "big") Modifier.shadow(r(0.8f), CircleShape, ambientColor = C.accent, spotColor = C.accent) else Modifier)
                .clip(CircleShape).background(bg).then(ring),
            contentAlignment = Alignment.Center,
        ) { Icon(painterResource(icon), null, tint = fg, modifier = Modifier.size(if (size == "big") r(1.6f) else r(1.3f))) }
    }
}

@Composable
fun NowPlaying(nav: Nav) {
    val r = rem()
    val play = remember { FocusRequester() }
    val back = remember { FocusRequester() }
    val s = Music.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5))) {
        if (s == null) {
            BackLink(nav, Modifier.focusRequester(back), "Music")
            Status("Nothing is playing.")
            LaunchedEffect(Unit) { delay(80); try { back.requestFocus() } catch (_: Exception) {} }
            return@Column
        }
        // .top: Back, and the clock
        Row(verticalAlignment = Alignment.CenterVertically) {
            BackLink(nav, label = "Music")
            Box(Modifier.weight(1f))
            Clock()
        }
        val frac = if (Music.duration > 0) minOf(1.0, Music.time / Music.duration).toFloat() else 0f
        // .np: the cover, the song, and what's up next
        Row(Modifier.padding(top = r(1.4f)), horizontalArrangement = Arrangement.spacedBy(r(1.8f))) {
            Box(Modifier.weight(28f).widthIn(min = r(12)).aspectRatio(1f).shadow(r(2.4f), RoundedCornerShape(r(0.8f))).clip(RoundedCornerShape(r(0.8f))).background(C.panel)) {
                if (s.cover.isNotEmpty()) AsyncImage(model = Korie.pic(s.cover, pxOf(r(22))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Column(Modifier.weight(30f).padding(top = r(1))) {
                Text("Now playing · song ${Music.pos + 1} of ${Music.queue.size}", style = body(1.1f, C.soft))
                Text(s.title, style = heading(3.4f), modifier = Modifier.padding(top = r(0.4f), bottom = r(0.6f)))
                Text(s.artist, style = body(1.6f), modifier = Modifier.padding(bottom = r(0.6f)))
                Text(listOf(s.album, s.year).filter { it.isNotEmpty() }.joinToString(" · "), style = body(1.2f, C.soft), modifier = Modifier.padding(bottom = r(1.5f)))
                Box(Modifier.fillMaxWidth().height(r(0.32f)).clip(RoundedCornerShape(r(0.2f))).background(Color(0x26FFFFFF))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(frac).background(C.accent))
                }
                Row(Modifier.fillMaxWidth().padding(top = r(0.4f))) {
                    Text(fmtTime(Music.time), style = body(1f, C.soft))
                    Box(Modifier.weight(1f))
                    Text(if (Music.duration > 0) fmtTime(Music.duration) else "", style = body(1f, C.soft))
                }
                Row(Modifier.padding(top = r(1.2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1))) {
                    Npb(R.drawable.lc_shuffle, "small", Music.shuffle) { Music.shuffleOn(!Music.shuffle) }
                    Npb(R.drawable.lc_skip_back) { Music.prev() }
                    Npb(if (Music.playing) R.drawable.lc_pause else R.drawable.lc_play, "big", modifier = Modifier.focusRequester(play)) { Music.toggle() }
                    Npb(R.drawable.lc_skip_forward) { Music.next() }
                    Npb(R.drawable.lc_repeat, "small", Music.repeat) { Music.repeatOn(!Music.repeat) }
                }
                if (Music.error.isNotEmpty()) Status(Music.error)
            }
            Column(Modifier.weight(22f).widthIn(min = r(12))) {
                Text("Up next", style = heading(1.5f), modifier = Modifier.padding(top = r(1), bottom = r(0.6f)))
                Column(verticalArrangement = Arrangement.spacedBy(r(0.2f))) {
                    Music.queue.drop(Music.pos).take(8).forEachIndexed { i, q ->
                        Focusable(Modifier.fillMaxWidth(), onClick = { Music.jumpTo(Music.pos + i) }) { f ->
                            val bg = if (f) C.accent else if (i == 0) Color(0xFF12304A) else Color.Transparent
                            val fg = if (f) C.onAccent else if (i == 0) C.ink else C.body
                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(r(0.45f))).background(bg).padding(horizontal = r(0.8f), vertical = r(0.55f)), horizontalArrangement = Arrangement.spacedBy(r(1))) {
                                Text("${Music.pos + i + 1}. ${q.title}", style = body(1.1f, fg, if (i == 0) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Text(if (q.duration > 0) fmtTime(q.duration) else "", style = body(1.1f, fg))
                            }
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(s != null) { delay(100); try { play.requestFocus() } catch (_: Exception) {} }
}

/** .musicbar: along the bottom while a song plays; OK on the song opens Now playing. */
@Composable
fun MusicBar(nav: Nav, modifier: Modifier = Modifier) {
    val r = rem()
    val s = Music.current ?: return
    val frac = if (Music.duration > 0) minOf(1.0, Music.time / Music.duration).toFloat() else 0f
    Column(modifier.fillMaxWidth().background(C.rail)) {
        Box(Modifier.fillMaxWidth().height(r(0.06f)).background(Color(0x14FFFFFF)))
        Row(Modifier.fillMaxWidth().padding(horizontal = gutter(), vertical = r(0.8f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1.2f))) {
            Focusable(Modifier.widthIn(max = r(26)), onClick = { nav.push("nowplaying") }) { f ->
                Row(
                    Modifier.then(if (f) Modifier.border(r(0.18f), C.accent, RoundedCornerShape(r(0.5f))) else Modifier).padding(r(0.2f)),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.9f)),
                ) {
                    Box(Modifier.size(r(3.2f)).clip(RoundedCornerShape(r(0.3f))).background(C.panel)) {
                        if (s.cover.isNotEmpty()) AsyncImage(model = Korie.pic(s.cover, pxOf(r(3.2f))), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                    Column {
                        Text(s.title, style = body(1.15f, C.ink, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOf(s.artist, s.album).filter { it.isNotEmpty() }.joinToString(" · "), style = body(0.95f, C.soft), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Text(fmtTime(Music.time), style = body(0.95f, C.soft))
            Box(Modifier.weight(1f).height(r(0.32f)).clip(RoundedCornerShape(r(0.2f))).background(Color(0x26FFFFFF))) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(frac).background(C.accent))
            }
            Text(if (Music.duration > 0) fmtTime(Music.duration) else "", style = body(0.95f, C.soft))
            Npb(if (Music.playing) R.drawable.lc_pause else R.drawable.lc_play, "small") { Music.toggle() }
        }
    }
}

// --- Music (Library.tsx Music) --------------------------------------------------------------

private val MUSIC_TABS = listOf("albums" to "Albums", "artists" to "Artists", "songs" to "Songs", "genres" to "Genres", "playlists" to "Playlists")
private val MUSIC_SORTS = listOf("added" to "Newest", "artist" to "Artist A–Z", "title" to "A to Z", "year" to "Year")

@kotlinx.serialization.Serializable
data class MusicList(val items: List<Card> = emptyList(), val status: String = "", val title: String? = null, val counts: Counts? = null) {
    @kotlinx.serialization.Serializable
    data class Counts(val albums: Int = 0, val artists: Int = 0)
}

/** Music: albums, artists, songs, genres and playlists; or one artist's or genre's albums, or a playlist's songs. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MusicScreen(nav: Nav, me: Screen) {
    val r = rem()
    val scope = rememberCoroutineScope()
    val p = me.params
    val by = p["by"] ?: "albums"
    val sort = p["sort"] ?: "added"
    val sub = p["artist"]?.let { "artist=" + Korie.enc(it) } ?: p["genre"]?.let { "genre=" + Korie.enc(it) } ?: p["playlist"]?.let { "playlist=" + Korie.enc(it) } ?: ""
    val path = "/api/music?" + sub.ifEmpty { "by=$by&sort=$sort" }
    val (data, _, reload) = useData(path, listOf("library", "playlists")) { Korie.read<MusicList>(Korie.api(path)) }
    val opener = rememberOpener(nav, me, onChange = reload)
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    fun req(k: String) = Modifier.focusRequester(reqs.getOrPut(k) { FocusRequester() })
    val items = data?.items ?: emptyList()
    val n = data?.counts
    val title = p["artist"] ?: p["genre"] ?: if (p["playlist"] != null) data?.title ?: "Playlist" else "Music"
    val count = if (sub.isNotEmpty()) (if (items.size == 1) "1 ${if (p["playlist"] != null) "song" else "album"}" else "${items.size} ${if (p["playlist"] != null) "songs" else "albums"}")
        else n?.let { "${it.albums} album${if (it.albums == 1) "" else "s"} · ${it.artists} artist${if (it.artists == 1) "" else "s"}" }
    val songs = p["playlist"] != null || (sub.isEmpty() && by == "songs")
    fun pickSort() {
        me.focused = "sort"
        scope.launch {
            val v = Ui.menu("Sort by", MUSIC_SORTS.map { (id, label) -> Choice((if (id == sort) "✓ " else "") + label, id) })
            if (v != null) nav.replace(mapOf("sort" to v))
        }
    }
    fun newPlaylist() {
        me.focused = "newpl"
        scope.launch {
            val name = Ui.text("Name of the playlist")?.trim() ?: return@launch
            if (name.isEmpty()) return@launch
            try { Korie.api("/api/playlists", buildJsonObject { put("name", name) }); reload() } catch (e: Exception) { Ui.toast(e.message ?: "") }
        }
    }
    val header: @Composable () -> Unit = {
        Column {
            Top(title, count)
            if (sub.isEmpty()) {
                // .pills: the tabs, and the sort at the far end (albums)
                Row(Modifier.fillMaxWidth().padding(bottom = r(1.4f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                    MUSIC_TABS.forEach { (id, label) -> Pill(label, id == by, modifier = req("tab:$id")) { me.focused = "tab:$id"; nav.replace(mapOf("by" to id)) } }
                    if (by == "albums") {
                        Box(Modifier.weight(1f))
                        Pill(MUSIC_SORTS.first { it.first == sort }.second, false, modifier = req("sort"), icon = R.drawable.lc_arrow_down_up, plain = true) { pickSort() }
                    }
                }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        if (songs) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(if (Music.current != null) 7 else 5))) {
                header()
                // .tracks
                Column(Modifier.widthIn(max = r(52)).padding(top = r(0.6f)), verticalArrangement = Arrangement.spacedBy(r(0.2f))) {
                    items.forEachIndexed { i, t ->
                        TrackRow(t.n.takeIf { it > 0 } ?: (i + 1), t.title, t.subtitle, t.length, modifier = req(t.id), onFocus = { me.focused = t.id }, onLong = { opener.menu(t, p["playlist"]) }) {
                            scope.launch { Music.playList(if (p["playlist"] != null) "playlist:${p["playlist"]}" else t.album ?: "", t.id); nav.push("nowplaying") }
                        }
                    }
                }
                Status(data?.status)
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(r(10.5f)),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(if (Music.current != null) 7 else 5)),
                horizontalArrangement = Arrangement.spacedBy(r(1)),
                verticalArrangement = Arrangement.spacedBy(r(1.4f)),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) { header() }
                itemsIndexed(items, key = { _, c -> c.id }) { _, c ->
                    CardView(c, "square", width = r(10.5f), modifier = Modifier.fillMaxWidth().then(req(c.id)), onFocus = { me.focused = it.id }, onOpen = {
                        when (c.kind) {
                            "artist" -> nav.push("music", mapOf("artist" to c.title))
                            "genre" -> nav.push("music", mapOf("genre" to c.title))
                            "playlist" -> nav.push("music", mapOf("playlist" to c.id.drop(9)))
                            else -> opener.open(c)
                        }
                    }, onMenu = { opener.menu(it) })
                }
                if (by == "playlists" && sub.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(Modifier.padding(top = r(1.2f))) { Btn("New playlist", R.drawable.lc_plus, outline = true, modifier = req("newpl")) { newPlaylist() } }
                }
                item(span = { GridItemSpan(maxLineSpan) }) { Status(data?.status) }
            }
        }
        MusicBar(nav, Modifier.align(Alignment.BottomCenter))
    }
    BackToCard(me, reqs, data != null, data)
}

/** .track: number, title, length; focused: panel with an accent ring; the playing one in accent. */
@Composable
fun TrackRow(n: Int, title: String, extra: String, length: Double, modifier: Modifier = Modifier, onFocus: (() -> Unit)? = null, onLong: (() -> Unit)? = null, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.7f))
    Focusable(modifier.fillMaxWidth(), onClick = onClick, onLong = onLong, onFocus = onFocus) { f ->
        Row(
            Modifier.fillMaxWidth().then(if (f) Modifier.border(r(0.18f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else Color.Transparent)
                .padding(horizontal = r(0.9f), vertical = r(0.6f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1)),
        ) {
            Text("$n", style = body(1f, C.dim).copy(textAlign = androidx.compose.ui.text.style.TextAlign.End), modifier = Modifier.width(r(2)))
            Row(Modifier.weight(1f)) {
                Text(title, style = body(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (extra.isNotEmpty()) Text(" · $extra", style = body(1f, C.dim), maxLines = 1)
            }
            Text(if (length > 0) fmtTime(length) else "", style = body(1f, C.dim))
        }
    }
}
