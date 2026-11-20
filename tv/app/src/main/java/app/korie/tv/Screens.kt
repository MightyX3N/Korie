package app.korie.tv

// The screens, as the web pages have them: Who's watching (Profiles.tsx), Home (Home.tsx),
// Films and Series (Library.tsx), Live TV and an add-on's page (Rows.tsx), and opening a card
// or holding OK on it (common.tsx).

import android.content.Context
import android.net.wifi.WifiManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/** The page's gutter (--gutter: 3.4rem). */
@Composable
fun gutter(): Dp = rem()(3.4f)

/** Asks Korie again and again until it answers (a screen's data), and again when [key] changes. */
@Composable
fun <T> useData(key: Any?, topics: List<String> = emptyList(), load: suspend () -> T): Triple<T?, String, () -> Unit> {
    var data by remember(key) { mutableStateOf<T?>(null) }
    var error by remember(key) { mutableStateOf("") }
    var n by remember(key) { mutableStateOf(0) }
    LaunchedEffect(key, n) {
        try { data = load(); error = "" } catch (e: Exception) { error = e.message ?: "Korie didn't answer." }
    }
    // asked again when Korie says one of [topics] changed (data.ts useData)
    if (topics.isNotEmpty()) LaunchedEffect(key, topics) {
        @OptIn(kotlinx.coroutines.FlowPreview::class)
        Korie.changes.filter { w -> w.any { it in topics } }.debounce(150).collect { n++ }
    }
    return Triple(data, error, { n++ })
}

// --- opening a card, and its options (common.tsx useOpener) --------------------------------

class Opener(private val nav: Nav, private val scope: CoroutineScope, private val me: Screen, private val onChange: (() -> Unit)? = null) {
    fun open(c: Card) {
        when (c.kind) {
            "film", "series", "album", "game" -> nav.push("item", mapOf("id" to c.id))
            "page" -> nav.push("page", mapOf("id" to c.id, "title" to c.title, "only" to c.only))
            "track" -> {
                val album = c.album
                if (!album.isNullOrEmpty()) scope.launch { Music.playList(album, c.id); nav.push("nowplaying") }
                else nav.push("player", mapOf("id" to c.id, "mode" to "start", "title" to c.title))
            }
            "episode", "live" -> nav.push("player", mapOf("id" to c.id, "mode" to if (c.kind == "live") "start" else "resume", "title" to c.title))
            else -> nav.push("item", mapOf("id" to c.id))
        }
    }

    fun menu(c: Card, playlist: String? = null) {
        scope.launch {
            if (c.kind == "playlist") {
                val v = Ui.menu(c.title, listOf(Choice("Rename", "name", R.drawable.lc_pencil), Choice("Delete ${c.title}…", "delete", R.drawable.lc_trash, danger = true)))
                val pid = c.id.drop(9)
                if (v == "name") {
                    val t = Ui.text("Name of the playlist", c.title)?.trim()
                    if (!t.isNullOrEmpty()) try { Korie.api("/api/playlists/$pid", buildJsonObject { put("name", t) }) } catch (e: Exception) { Ui.toast(e.message ?: "") }
                } else if (v == "delete") {
                    val ok = Ui.ask("Delete ${c.title}?", "The songs stay in your music.", listOf(Choice("Delete", "yes", danger = true), Choice("Keep", "no", primary = true)))
                    if (ok == "yes") try { Korie.api("/api/playlists/$pid", null, "DELETE") } catch (e: Exception) { Ui.toast(e.message ?: "") }
                }
                onChange?.invoke()
                return@launch
            }
            val choices = mutableListOf<Choice>()
            if (c.kind in listOf("film", "episode", "game")) {
                choices += Choice(if (c.progress > 0) "Resume" else "Play", "play", R.drawable.lc_play)
                if (c.progress > 0) choices += Choice("Play from the start", "start", R.drawable.lc_rotate_ccw)
            }
            if (c.kind in listOf("film", "episode", "series")) choices += if (c.watched) Choice("Mark as not watched", "unwatched", R.drawable.lc_eye_off) else Choice("Mark as watched", "watched", R.drawable.lc_eye)
            if (c.kind == "track") choices += Choice("Play", "song", R.drawable.lc_play)
            if (c.kind == "track" || c.kind == "album") choices += Choice("Add to playlist", "playlist", R.drawable.lc_list_plus)
            if (c.kind == "track" && playlist != null) choices += Choice("Remove from this playlist", "take", R.drawable.lc_list_minus)
            if (c.kind != "live" && c.kind != "page") choices += Choice("Favourite (add or remove)", "fav", R.drawable.lc_heart)
            if (c.source.isEmpty() && (c.kind == "film" || c.kind == "series")) {
                // fixing what a film is changes the library: only for those who may change settings
                val who = Korie.meOrNull()
                if (who?.person?.canSettings == true) choices += Choice(if (c.kind == "film") "Fix details (wrong film?)" else "Fix details (wrong series?)", "fix", R.drawable.lc_wand_sparkles)
                if (who?.person?.admin == true) choices += Choice("Age rating: ${c.cert.ifEmpty { "none" }}", "age", R.drawable.lc_baby)
            }
            if (choices.isEmpty()) return@launch
            when (Ui.menu(c.title, choices)) {
                "play" -> nav.push("player", mapOf("id" to c.id, "mode" to "resume", "title" to c.title))
                "start" -> nav.push("player", mapOf("id" to c.id, "mode" to "start", "title" to c.title))
                "watched" -> try { Korie.watched(c.id, true) } catch (e: Exception) { Ui.toast(e.message ?: "") }
                "unwatched" -> try { Korie.watched(c.id, false) } catch (e: Exception) { Ui.toast(e.message ?: "") }
                "fav" -> try { Ui.toast(if (Korie.favourite(c.id)) "Added to Favourites" else "Removed from Favourites") } catch (_: Exception) {}
                "fix" -> fixMatch(c.id, c.title)
                "song" -> open(c)
                "playlist" -> addToPlaylist(c.id)
                "take" -> if (playlist != null) {
                    try { Korie.api("/api/playlists/$playlist", buildJsonObject { put("take", c.id) }) } catch (e: Exception) { Ui.toast(e.message ?: "") }
                    onChange?.invoke()
                }
                "age" -> {
                    val ages = listOf("15" to "Age 15", "11" to "Age 11", "7" to "Age 7", "0" to "For everyone", "none" to "No age rating (hidden from people with an age limit)")
                    val a = Ui.menu("Age rating for ${c.title}", ages.map { (v, l) -> Choice(l, v) })
                    if (a != null) try {
                        Korie.api("/api/age", buildJsonObject { put("id", c.id); if (a == "none") put("age", kotlinx.serialization.json.JsonNull) else put("age", a.toInt()) })
                        Ui.toast("Age rating changed")
                    } catch (e: Exception) { Ui.toast(e.message ?: "") }
                }
            }
        }
    }
}

/** Puts a song, or all of an album's songs, on a playlist (a new one, or one you have). */
suspend fun addToPlaylist(id: String) {
    val r = try { Korie.api("/api/playlists").jsonObject["playlists"]!!.jsonArray.map { it.jsonObject } } catch (e: Exception) { Ui.toast(e.message ?: ""); return }
    fun str(o: kotlinx.serialization.json.JsonObject, k: String) = o[k]?.jsonPrimitive?.content ?: ""
    val v = Ui.menu("Add to playlist", r.map { Choice("${str(it, "name")} · ${str(it, "count")} songs", str(it, "id")) } + Choice("New playlist", "@new", R.drawable.lc_plus)) ?: return
    if (v == "@new") {
        val name = Ui.text("Name of the playlist")?.trim()
        if (!name.isNullOrEmpty()) try { Korie.api("/api/playlists", buildJsonObject { put("name", name); put("item", id) }); Ui.toast("$name made.") } catch (e: Exception) { Ui.toast(e.message ?: "") }
        return
    }
    val pl = r.first { str(it, "id") == v }
    try {
        val a = Korie.api("/api/playlists/$v", buildJsonObject { put("add", id) }).jsonObject["added"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
        Ui.toast(if (a > 0) "Added to ${str(pl, "name")}." else "It's on ${str(pl, "name")} already.")
    } catch (e: Exception) { Ui.toast(e.message ?: "") }
}

/** Fix details: TMDb's answers for a name, and the right one picked (common.tsx fixMatch). */
suspend fun fixMatch(id: String, title: String) {
    val q = Ui.text("Which is it? Type the name", title) ?: return
    val res = try { Korie.api("/api/match?id=${Korie.enc(id)}&q=${Korie.enc(q)}").jsonObject["results"]!!.jsonArray.map { it.jsonObject } } catch (e: Exception) { Ui.toast(e.message ?: ""); return }
    if (res.isEmpty()) { Ui.message("Nothing found", "TMDb has nothing called \"$q\". Try a shorter or the original name."); return }
    fun str(o: kotlinx.serialization.json.JsonObject, k: String) = o[k]?.jsonPrimitive?.content ?: ""
    val v = Ui.menu("Pick the right one", res.take(8).map { x ->
        val t = str(x, "title"); val y = str(x, "year"); val o = str(x, "original")
        Choice(t + (if (y.isNotEmpty()) " ($y)" else "") + (if (o.isNotEmpty() && o != t) " · $o" else ""), str(x, "id"))
    }) ?: return
    try { Korie.api("/api/match", buildJsonObject { put("id", id); put("tmdb", v.toInt()) }); Ui.toast("Details changed") } catch (e: Exception) { Ui.toast(e.message ?: "") }
}

@Composable
fun rememberOpener(nav: Nav, me: Screen, onChange: (() -> Unit)? = null): Opener {
    val scope = rememberCoroutineScope()
    return remember(me) { Opener(nav, scope, me, onChange) }
}

/**
 * Rows of cards under the screen's title (Home, Live TV, a page). The card that opened what's on
 * top gets the focus back.
 */
@Composable
fun RowsPage(me: Screen, header: @Composable () -> Unit, rows: List<Row>?, status: String?, opener: Opener, firstFocus: FocusRequester? = null, reqs: MutableMap<String, FocusRequester> = remember(me) { mutableMapOf() }) {
    val r = rem()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = r(2.2f), bottom = r(5))) {
        item { Box(Modifier.padding(horizontal = gutter())) { header() } }
        if (rows != null) {
            itemsIndexed(rows, key = { i, row -> row.id + i }) { i, row ->
                // a card is known by its row too: the same film can be in two rows
                RowView(row, gutter(), first = if (i == 0) firstFocus else null, reqFor = { c -> reqs.getOrPut(row.id + "\u0000" + c.id) { FocusRequester() } },
                    onFocus = { me.focused = row.id + "\u0000" + it.id }, onOpen = opener::open, onMenu = { opener.menu(it) })
            }
        }
        item { Box(Modifier.padding(horizontal = gutter())) { Status(status) } }
    }
    BackToCard(me, reqs, rows != null, rows)
}

/** Back from what a card opened: the focus goes to that card again. */
@Composable
fun BackToCard(me: Screen, reqs: Map<String, FocusRequester>, ready: Boolean, again: Any? = null) {
    val memory = LocalFocusMemory.current
    // [again] (the screen's data) changed: if what had the focus went away with it, back to the same thing
    LaunchedEffect(again) {
        if (again == null) return@LaunchedEffect
        delay(150)
        if (memory?.last != null || Ui.busy) return@LaunchedEffect
        val id = me.focused ?: return@LaunchedEffect
        repeat(6) {
            delay(80)
            val fr = reqs[id] ?: id.substringAfter('\u0000').let { item -> reqs.entries.firstOrNull { it.key.substringAfter('\u0000') == item }?.value }
            if (fr != null) { try { fr.requestFocus(); return@LaunchedEffect } catch (_: Exception) {} }
        }
    }
    LaunchedEffect(ready, me.params, Ui.closed) {
        val id = me.focused ?: return@LaunchedEffect
        if (!ready) return@LaunchedEffect
        repeat(10) {
            delay(80)
            if (Ui.busy) return@LaunchedEffect
            // the same card, or failing that (its row is gone, like Continue watching after the end) the item in another row
            val fr = reqs[id] ?: id.substringAfter('\u0000').let { item -> reqs.entries.firstOrNull { it.key.substringAfter('\u0000') == item }?.value }
            if (fr != null) { try { fr.requestFocus(); return@LaunchedEffect } catch (_: Exception) {} }
        }
    }
}

// --- finding Korie on the network (the web pages are served by it, the TV app looks) -------

suspend fun discover(ctx: Context): List<String> = withContext(Dispatchers.IO) {
    val found = linkedSetOf<String>()
    val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val lock = wifi?.createMulticastLock("korie")?.apply { setReferenceCounted(false); acquire() }
    try {
        DatagramSocket().use { sock ->
            sock.broadcast = true
            sock.soTimeout = 600
            val msg = "KORIE_DISCOVER".toByteArray()
            val targets = mutableListOf(InetAddress.getByName("255.255.255.255"))
            val d = wifi?.dhcpInfo
            if (d != null && d.ipAddress != 0) {
                val bc = (d.ipAddress and d.netmask) or d.netmask.inv()
                targets += InetAddress.getByAddress(byteArrayOf((bc and 0xff).toByte(), (bc shr 8 and 0xff).toByte(), (bc shr 16 and 0xff).toByte(), (bc shr 24 and 0xff).toByte()))
            }
            repeat(3) {
                for (t in targets) try { sock.send(DatagramPacket(msg, msg.size, t, 7361)) } catch (_: Exception) {}
                while (true) {
                    val buf = ByteArray(2048)
                    val p = DatagramPacket(buf, buf.size)
                    try { sock.receive(p) } catch (_: SocketTimeoutException) { break }
                    val text = String(p.data, 0, p.length)
                    val port = Regex("\"port\"\\s*:\\s*(\\d+)").find(text)?.groupValues?.get(1) ?: continue
                    found += "http://${p.address.hostAddress}:$port"
                }
            }
        }
    } catch (_: Exception) {
    } finally {
        lock?.release()
    }
    if (found.isEmpty()) {
        // networks that drop broadcasts: the router and the emulator's host, on Korie's port
        val guesses = mutableListOf("http://10.0.2.2:8100")
        wifi?.dhcpInfo?.gateway?.takeIf { it != 0 }?.let { g -> guesses += "http://${g and 0xff}.${g shr 8 and 0xff}.${g shr 16 and 0xff}.${g shr 24 and 0xff}:8100" }
        coroutineScope { guesses.map { u -> async { if (Korie.hello(u)) u else null } }.awaitAll() }.filterNotNull().forEach { found += it }
    }
    found.toList()
}

/** Typing with the remote: the on-screen keyboard (ui.tsx TextEntry). */
@Composable
fun KeyboardRows(keys: List<String>, columns: Int, first: FocusRequester?, onKey: (String) -> Unit) {
    val r = rem()
    Column(verticalArrangement = Arrangement.spacedBy(r(0.4f))) {
        keys.chunked(columns).forEach { line ->
            Row(Modifier.fillMaxWidth().height(r(3.1f)), horizontalArrangement = Arrangement.spacedBy(r(0.4f))) {
                line.forEach { k ->
                    val wide = k.length > 1
                    Key(k, Modifier.weight(if (wide) 2f else 1f).then(if (k == keys[0] && first != null) Modifier.focusRequester(first) else Modifier)) { onKey(k) }
                }
            }
        }
    }
}

@Composable
fun Connect(onFound: (String) -> Unit) {
    val ctx = LocalContext.current
    val r = rem()
    val scope = rememberCoroutineScope()
    var looking by remember { mutableStateOf(true) }
    val servers = remember { mutableStateListOf<String>() }
    var typed by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        servers.addAll(discover(ctx))
        looking = false
        if (servers.size == 1) onFound(servers[0])
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = r(46)).clip(RoundedCornerShape(r(1.1f))).background(C.panel2).padding(horizontal = r(2.4f), vertical = r(2.2f)),
            verticalArrangement = Arrangement.spacedBy(r(1.2f)),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                Box(Modifier.size(r(0.75f)).clip(RoundedCornerShape(r(0.18f))).background(C.accent))
                Text("korie", style = heading(1.6f))
            }
            Text(if (looking) "Looking for Korie…" else if (servers.isEmpty()) "No Korie answered on this network" else "Which Korie?", style = heading(2f))
            servers.forEachIndexed { i, u -> Btn(u.removePrefix("http://"), primary = i == 0, modifier = if (i == 0) Modifier.focusRequester(first) else Modifier) { onFound(u) } }
            if (!looking) {
                Text("Or type its address (like 192.168.1.20:8100):", style = body(1.1f, C.body))
                // .field
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(r(0.7f))).background(C.ground).border(r(0.12f), C.accent, RoundedCornerShape(r(0.7f)))
                        .padding(horizontal = r(1), vertical = r(0.8f)),
                ) { Text(typed.ifEmpty { " " }, style = body(1.4f)) }
                KeyboardRows("1234567890.:abcdefghijklmnopqrstuvwxyz".map { it.toString() } + listOf("Delete", "Look again", "Done"), 10, if (servers.isEmpty()) first else null) { k ->
                    when (k) {
                        "Delete" -> typed = typed.dropLast(1)
                        "Look again" -> scope.launch { looking = true; servers.clear(); servers.addAll(discover(ctx)); looking = false }
                        "Done" -> scope.launch {
                            val u = "http://" + typed.trim().let { if (it.contains(':')) it else "$it:8100" }
                            if (Korie.hello(u)) onFound(u) else error = "No Korie answered at ${typed.trim()}."
                        }
                        else -> typed += k
                    }
                }
                if (error.isNotEmpty()) Text(error, style = body(1.05f, C.bad))
            }
        }
    }
    LaunchedEffect(looking) { if (!looking) { delay(80); try { first.requestFocus() } catch (_: Exception) {} } }
}

// --- Who's watching (Profiles.tsx) ----------------------------------------------------------

/** An admin says who they are (their PIN), for Add person: their sign-in key, or null. */
private suspend fun asAdmin(people: List<Person>): String? {
    val admins = people.filter { it.admin }
    if (admins.isEmpty()) return null
    var who = admins[0]
    if (admins.size > 1) {
        val id = Ui.menu("Which admin are you?", admins.map { Choice(it.name, it.id) }) ?: return null
        who = admins.firstOrNull { it.id == id } ?: return null
    }
    var pin: String? = null
    if (who.hasPin) pin = Ui.pin("${who.name}'s PIN") ?: return null
    return try { Korie.loginToken(who.id, pin) } catch (e: Exception) { Ui.toast(e.message ?: ""); null }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Profiles(onSignedIn: () -> Unit, onOtherServer: () -> Unit, onManage: (String) -> Unit) {
    val ctx = LocalContext.current
    val r = rem()
    val scope = rememberCoroutineScope()
    var people by remember { mutableStateOf<List<Person>?>(null) }
    var error by remember { mutableStateOf("") }
    var n by remember { mutableStateOf(0) }
    val first = remember { FocusRequester() }
    val faces = remember { mutableMapOf<String, FocusRequester>() }
    var picked by remember { mutableStateOf<String?>(null) }
    // away from home: the household's sign-in first; and which household this TV is in
    var needHousehold by remember { mutableStateOf(false) }
    var hello by remember { mutableStateOf<HelloInfo?>(null) }
    LaunchedEffect(n) {
        error = ""
        needHousehold = false
        try { hello = Korie.helloInfo() } catch (_: Exception) {}
        try { people = Korie.people(ctx) } catch (e: KorieError) {
            if (e.kind == "needed") needHousehold = true else error = e.message ?: "Korie didn't answer."
        } catch (e: Exception) { error = e.message ?: "Korie didn't answer." }
    }
    fun pick(p: Person) = scope.launch {
        var pin: String? = null
        if (p.hasPin) pin = Ui.pin("${p.name}'s PIN") ?: return@launch
        try { Korie.login(ctx, p.id, pin); onSignedIn() } catch (e: KorieError) {
            when (e.kind) {
                "refused" -> Ui.message("Can't watch right now", e.message + if (e.url.isNotEmpty()) "\n\n" + e.url else "")
                "needed", "stopped" -> { Ui.message("Sign in again", e.message ?: ""); n++ }
                else -> Ui.toast(e.message ?: "")
            }
        } catch (e: Exception) { Ui.toast(e.message ?: "") }
    }
    fun householdSignIn() = scope.launch {
        val name = Ui.text("Your household's name") ?: return@launch
        if (name.isBlank()) return@launch
        val pw = Ui.text("${name.trim()}'s password", secret = true) ?: return@launch
        try { Korie.householdSignIn(ctx, name.trim(), pw); n++ } catch (e: KorieError) {
            Ui.message("Couldn't sign in", e.message + if (e.url.isNotEmpty()) "\n\n" + e.url else "")
        } catch (e: Exception) { Ui.toast(e.message ?: "") }
    }
    Box(Modifier.fillMaxSize()) {
        // .profiles-top: the brand on the left, the clock on the right
        Row(Modifier.fillMaxWidth().padding(top = r(2.2f), start = gutter(), end = gutter()), verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                Box(Modifier.size(r(0.75f)).clip(RoundedCornerShape(r(0.18f))).background(C.accent))
                Text("korie", style = heading(2.2f))
            }
            Spacer(Modifier.weight(1f))
            Clock(2f)
        }
        Column(
            Modifier.fillMaxSize().padding(top = r(6), bottom = r(3), start = gutter(), end = gutter()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(r(2.6f), Alignment.CenterVertically),
        ) {
            Text(if (needHousehold) "Sign in to your household" else "Who's watching?", style = heading(3.6f))
            if (needHousehold) {
                Column(Modifier.widthIn(max = r(46)).clip(RoundedCornerShape(r(1.1f))).background(C.panel2).padding(horizontal = r(2.4f), vertical = r(2.2f)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(r(1.2f))) {
                    Text("This TV is away from home. Sign in once with your household's name and password, and then pick who's watching.", style = body(1.1f, C.body).copy(textAlign = TextAlign.Center))
                    Btn("Sign in", primary = true, modifier = Modifier.focusRequester(first)) { householdSignIn() }
                    Btn("Another Korie…", outline = true) { onOtherServer() }
                }
            } else if (error.isNotEmpty()) {
                Column(Modifier.clip(RoundedCornerShape(r(1.1f))).background(C.panel2).padding(horizontal = r(2.4f), vertical = r(2.2f)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(r(1.2f))) {
                    Text(error, style = body(1.1f, C.body))
                    Btn("Try again", primary = true, modifier = Modifier.focusRequester(first)) { n++ }
                    Btn("Another Korie…", outline = true) { onOtherServer() }
                }
            } else {
                FlowRow(Modifier.padding(r(0.8f)), horizontalArrangement = Arrangement.spacedBy(r(1.4f), Alignment.CenterHorizontally)) {
                    people?.forEachIndexed { i, p ->
                        Face(p.name, colorOf(p.color), lock = p.hasPin, modifier = (if (i == 0) Modifier.focusRequester(first) else Modifier).focusRequester(faces.getOrPut(p.id) { FocusRequester() })) { picked = p.id; pick(p) }
                    }
                    val ps = people
                    if (!ps.isNullOrEmpty() && ps.any { it.admin }) {
                        Face("Add person", null, add = true) {
                            scope.launch {
                                val t = asAdmin(ps) ?: return@launch
                                try {
                                    val name = Ui.text("Name of the new person")
                                    if (!name.isNullOrBlank()) Korie.addPerson(t, name.trim())
                                } catch (e: Exception) { Ui.toast(e.message ?: "") } finally { Korie.logoutToken(t) }
                                n++
                            }
                        }
                    }
                }
                if (!people.isNullOrEmpty()) Row(Modifier.offset(y = -r(1)), horizontalArrangement = Arrangement.spacedBy(r(1))) {
                    if (people!!.any { it.admin }) Btn("Manage people", outline = true) { scope.launch { val t = asAdmin(people!!); if (t != null) onManage(t) } }
                    val hh = hello?.household
                    if (hh != null && Korie.household.isNotEmpty()) Btn("Leave ${hh.name}", outline = true) {
                        scope.launch {
                            if (Ui.ask("Leave ${hh.name} on this TV?", "You'll need the household's name and password to come back.", listOf(Choice("Leave", "leave", primary = true), Choice("Cancel", "no"))) == "leave") { Korie.leaveHousehold(ctx); people = null; n++ }
                        }
                    }
                }
            }
        }
        if (!needHousehold && hello?.outside != true) Text(
            "This TV can also sign in as one person by itself: Settings, This device.", style = body(0.95f, C.dim).copy(textAlign = TextAlign.Center),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = r(2)),
        )
    }
    LaunchedEffect(people, error, needHousehold) { if (!people.isNullOrEmpty() || error.isNotEmpty() || needHousehold) { delay(80); try { first.requestFocus() } catch (_: Exception) {} } }
    // a wrong or cancelled PIN: back on the face that was picked
    LaunchedEffect(Ui.closed) { val id = picked ?: return@LaunchedEffect; delay(80); if (Ui.busy) return@LaunchedEffect; try { faces[id]?.requestFocus() } catch (_: Exception) {} }
}

/** .face-btn: an 11 rem tile with the initial; focused: a ring 0.4 rem out, 0.3 rem wide. */
@Composable
fun Face(name: String, color: Color?, lock: Boolean = false, add: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(1.4f))
    Focusable(modifier.width(r(13.8f)), onClick = onClick) { f ->
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(r(1))) {
            Box(
                Modifier.size(r(11) + r(1.4f))
                    .then(if (f) Modifier.border(r(0.3f), C.accent, RoundedCornerShape(r(2.1f))) else Modifier)
                    .padding(r(0.7f)),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(r(11)).then(if (f) Modifier.shadow(r(1.2f), shape) else Modifier).clip(shape)
                        .then(if (color != null) Modifier.background(color) else Modifier)
                        .then(if (add) Modifier.drawBehind {
                            drawRoundRect(color = if (f) C.soft else Color(0x809DB0C4), cornerRadius = CornerRadius(r(1.4f).toPx()), style = Stroke(width = r(0.15f).toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(r(0.5f).toPx(), r(0.4f).toPx()))))
                        } else Modifier),
                    contentAlignment = Alignment.Center,
                ) {
                    if (add) Icon(painterResource(R.drawable.lc_plus), null, tint = C.soft, modifier = Modifier.size(r(2.4f)))
                    else Text(name.take(1).uppercase(), style = heading(5.5f, C.ground))
                    if (lock) Box(Modifier.align(Alignment.BottomEnd).padding(r(0.9f)).size(r(2.2f)).clip(CircleShape).background(Color(0xE60A1420)), contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.lc_lock), null, tint = C.ink, modifier = Modifier.size(r(1.2f)))
                    }
                }
            }
            Text(name, style = body(1.8f, if (f) C.ink else C.soft, FontWeight.Medium))
        }
    }
}

// --- Home ------------------------------------------------------------------------------------

// --- Live TV, Games, an add-on's page (Rows.tsx) ---------------------------------------------

@Composable
fun RowsScreen(nav: Nav, me: Screen, title: String, topics: List<String> = emptyList(), load: suspend () -> Rows) {
    val (data, error) = useData(me.name, topics) { load() }
    val opener = rememberOpener(nav, me)
    RowsPage(me, { Top(title) }, data?.rows, error.ifEmpty { data?.status ?: "" }, opener)
}

/** Live TV: the channels as rows; with channels from the library, a Guide button at the top. */
@Composable
fun LiveScreen(nav: Nav, me: Screen) {
    val (data, error) = useData(me.name, listOf("browse", "channels")) { Korie.live() }
    val opener = rememberOpener(nav, me)
    val hasChannels = data?.rows?.any { it.id == "channels" } == true
    RowsPage(me, {
        Top("Live TV") { if (hasChannels) Btn("Guide", R.drawable.lc_layout_grid) { nav.push("guide") } }
    }, data?.rows, error.ifEmpty { data?.status ?: "" }, opener)
}

@Composable
fun BackLink(nav: Nav, modifier: Modifier = Modifier, label: String = "Back") {
    val r = rem()
    val shape = RoundedCornerShape(r(0.7f))
    Focusable(modifier.padding(bottom = r(1.4f)), onClick = { nav.back() }) { f ->
        Row(
            Modifier.then(if (f) Modifier.border(r(0.16f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else Color.Transparent)
                .padding(start = r(0.4f), end = r(0.7f), top = r(0.35f), bottom = r(0.35f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.4f)),
        ) {
            Icon(painterResource(R.drawable.lc_chevron_left), null, tint = if (f) C.ink else C.soft, modifier = Modifier.size(r(1.3f)))
            Text(label, style = body(1.05f, if (f) C.ink else C.soft))
        }
    }
}

@Composable
fun AddonPage(nav: Nav, me: Screen) {
    val id = me.params["id"] ?: ""
    val only = me.params["only"] ?: ""
    val (data, error) = useData("$id|$only") { Korie.page(id, only) }
    val opener = rememberOpener(nav, me)
    val first = remember { FocusRequester() }
    RowsPage(me, {
        Column { BackLink(nav); Top(data?.title?.ifEmpty { null } ?: me.params["title"] ?: "") }
    }, data?.rows, error.ifEmpty { data?.status ?: "Loading…" }, opener, firstFocus = first)
    // a page opens on its first row, not on Back
    LaunchedEffect(data != null) { if (data?.rows?.isNotEmpty() == true && me.focused == null) { delay(100); try { first.requestFocus() } catch (_: Exception) {} } }
}

// --- Films and Series (Library.tsx) ----------------------------------------------------------

private val SORTS = listOf("added" to "Recently added", "title" to "A–Z", "year" to "Newest first", "rating" to "Best rated")
private val SHOWS = listOf("categories" to "Categories", "all" to "All", "unwatched" to "Unwatched", "progress" to "In progress")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Library(nav: Nav, me: Screen, kind: String, title: String) {
    val r = rem()
    val scope = rememberCoroutineScope()
    val source = me.params["source"] ?: ""
    val sort = me.params["sort"] ?: "added"
    val show = me.params["show"] ?: "categories"
    val (data, _) = useData("$kind|$source|$sort|$show", listOf("library", "browse")) { Korie.section(kind, source, sort, show) }
    val opener = rememberOpener(nav, me)
    // the sources stay while another one loads, so the pill that was picked keeps the focus
    var known by remember(me) { mutableStateOf<List<Source>?>(null) }
    data?.sources?.let { known = it }
    val sources = data?.sources ?: known ?: listOf(Source("", if (title == "Films") "Your films" else "Your series"))
    val items = data?.items
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    fun req(k: String) = Modifier.focusRequester(reqs.getOrPut(k) { FocusRequester() })
    // a pill keeps the focus while what's below it changes
    fun pick(k: String, p: Map<String, String>) { me.focused = k; nav.replace(p) }
    val pills: @Composable (Float) -> Unit = { bottom ->
        FlowRow(Modifier.padding(bottom = r(bottom)), horizontalArrangement = Arrangement.spacedBy(r(0.6f)), verticalArrangement = Arrangement.spacedBy(r(0.6f))) {
            sources.forEach { s -> Pill(s.name, s.id == source, modifier = req("src:" + s.id)) { pick("src:" + s.id, mapOf("source" to s.id)) } }
            if (source.isEmpty()) {
                Spacer(Modifier.width(r(1)))
                SHOWS.forEach { (id, label) -> Pill(label, id == show, modifier = req("show:$id")) { pick("show:$id", mapOf("show" to id)) } }
                if (show != "categories") Pill(SORTS.first { it.first == sort }.second, false, icon = R.drawable.lc_arrow_down_up, modifier = req("sort")) {
                    me.focused = "sort"
                    scope.launch {
                        val v = Ui.menu("Sort by", SORTS.map { (id, label) -> Choice((if (id == sort) "✓ " else "") + label, id) })
                        if (v != null) pick("sort", mapOf("sort" to v))
                    }
                }
            }
        }
    }
    val count = if (items != null) "${items.size} $kind" else data?.count?.let { "$it $kind" }
    val bottom = if (Music.current != null) 7f else 5f
    Box(Modifier.fillMaxSize()) {
    if (items != null) {
        // .grid: as many 9.6 rem columns as fit
        LazyVerticalGrid(
            columns = GridCells.Adaptive(r(9.6f)),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(bottom)),
            horizontalArrangement = Arrangement.spacedBy(r(1)),
            verticalArrangement = Arrangement.spacedBy(r(1.4f)),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { Column { Top(title, count); pills(0f) } }
            itemsIndexed(items, key = { _, c -> c.id }) { _, c ->
                CardView(c, "poster", width = r(9.6f), modifier = Modifier.fillMaxWidth().focusRequester(reqs.getOrPut(c.id) { FocusRequester() }), onFocus = { me.focused = it.id }, onOpen = opener::open, onMenu = { opener.menu(it) })
            }
            item(span = { GridItemSpan(maxLineSpan) }) { Status(data.status) }
        }
        BackToCard(me, reqs, true, items)
    } else {
        RowsPage(me, { Column { Top(title, count); pills(1.4f) } }, data?.rows, data?.status, opener, reqs = reqs)
    }
    MusicBar(nav, Modifier.align(Alignment.BottomCenter))
    }
}
