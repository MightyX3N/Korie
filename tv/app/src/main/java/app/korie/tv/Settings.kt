package app.korie.tv

// Settings (Settings.tsx): categories on the left, their settings on the right, and a search
// across all of them. People shows beside the categories: everyone, then what the chosen person
// may do on the right.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
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
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.text.DateFormat
import java.util.Date

@Serializable
data class Folder(val id: Int, val path: String = "", val kind: String = "", val scanned: Long = 0, val error: String = "")

@Serializable
data class SettingsData(
    val settings: JsonObject = JsonObject(emptyMap()), val folders: List<Folder> = emptyList(), val status: ScanStatus = ScanStatus(),
    val counts: Map<String, Int> = emptyMap(), val tmdb: Boolean = false, val version: String = "",
) {
    @Serializable
    data class ScanStatus(val scanning: Boolean = false, val text: String = "")
    fun str(k: String) = (settings[k] as? JsonPrimitive)?.contentOrNull ?: ""
    fun flag(k: String) = (settings[k] as? JsonPrimitive)?.booleanOrNull ?: false
}

@Serializable
data class PersonFull(
    val id: String, val name: String = "", val color: String = "#e8a33d", val hasPin: Boolean = false, val admin: Boolean = false, val canSettings: Boolean = false,
    val addons: JsonElement? = null, val music: Boolean = true, val canInstall: Boolean = false, val canDelete: Boolean = false, val apps: JsonElement? = null,
    val maxAge: Int? = null, val autoDevice: String? = null,
) {
    fun all(e: JsonElement?) = e == null || (e is JsonPrimitive && e.content == "all")
    fun list(e: JsonElement?) = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
}

@Serializable
data class PeopleData(val people: List<PersonFull> = emptyList(), val addons: List<NameId> = emptyList(), val apps: List<AppName> = emptyList(), val devices: List<Device> = emptyList()) {
    @Serializable data class NameId(val id: String, val name: String = "")
    @Serializable data class AppName(val pkg: String, val label: String = "")
    @Serializable data class Device(val id: String, val name: String = "", val seen: Long = 0)
}

private val SKIPS = listOf("button" to "Show a Skip button", "auto" to "Skip by itself", "off" to "Never")
private val LANGS = listOf("en-US" to "English", "da-DK" to "Dansk", "sv-SE" to "Svenska", "nb-NO" to "Norsk", "de-DE" to "Deutsch", "fr-FR" to "Français", "es-ES" to "Español")
val AGES: List<Int?> = listOf(null, 15, 11, 7, 0)
fun ageLabel(a: Int?) = if (a == null) "Everything" else if (a == 0) "For everyone" else "Age $a"
val COLORS = listOf("#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c")

/** When a device was last used: today, yesterday or the date. */
private fun seen(t: Long): String {
    val d = java.util.Calendar.getInstance().apply { timeInMillis = t * 1000 }
    val now = java.util.Calendar.getInstance()
    fun same(a: java.util.Calendar, b: java.util.Calendar) = a.get(java.util.Calendar.YEAR) == b.get(java.util.Calendar.YEAR) && a.get(java.util.Calendar.DAY_OF_YEAR) == b.get(java.util.Calendar.DAY_OF_YEAR)
    if (same(d, now)) return "today"
    if (same(d, (now.clone() as java.util.Calendar).apply { add(java.util.Calendar.DAY_OF_YEAR, -1) })) return "yesterday"
    return java.text.SimpleDateFormat("d MMM", java.util.Locale.getDefault()).format(d.time)
}

/** What's typed in "Search settings": rows that don't match it hide themselves. */
private val LocalQuery = compositionLocalOf { "" }
/** In a search: the rows of a category that match, so its title shows only with some (.st-sec:not(:has(.srow))). */
private class Hits { val keys = androidx.compose.runtime.mutableStateListOf<String>() }
private val LocalHits = compositionLocalOf<Hits?> { null }
/** The Settings screen, so a row remembers itself when it opens a dialog (the focus comes back to it). */
private val LocalSettingsScreen = compositionLocalOf<Screen?> { null }

/** .srow: one setting, its name and a line about it on the left, its value on the right. */
@Composable
private fun SRow(key: String, label: String, help: String = "", words: String = "", reqs: MutableMap<String, FocusRequester>, onClick: (() -> Unit)? = null, value: @Composable (Boolean) -> Unit = {}) {
    val q = LocalQuery.current
    if (q.isNotEmpty() && !"$label $help $words".lowercase().contains(q)) return
    val r = rem()
    val shape = RoundedCornerShape(r(0.6f))
    val screen = LocalSettingsScreen.current
    val hits = LocalHits.current
    if (hits != null) androidx.compose.runtime.DisposableEffect(key) { hits.keys += key; onDispose { hits.keys -= key } }
    Focusable(Modifier.fillMaxWidth().focusRequester(reqs.getOrPut(key) { FocusRequester() }), onClick = { screen?.focused = key; onClick?.invoke() }) { f ->
        Row(
            Modifier.fillMaxWidth().heightIn(min = r(4.9f))
                .then(if (f) Modifier.shadow(r(1.6f), shape, ambientColor = C.accent, spotColor = C.accent) else Modifier)
                .clip(shape).background(if (f) C.accent else C.panel2).padding(start = r(1.3f), end = r(0.8f), top = r(0.7f), bottom = r(0.7f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1)),
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, style = body(1.3f, if (f) C.onAccent else C.ink, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (help.isNotEmpty()) Text(help, style = body(1f, if (f) C.onAccent else C.soft), modifier = Modifier.padding(top = r(0.15f)))
            }
            value(f)
        }
    }
}

/** .sel: a value you change by choosing. */
@Composable
private fun Sel(text: String, onAccent: Boolean) {
    val r = rem()
    Row(
        Modifier.widthIn(min = r(6.5f), max = r(18)).clip(RoundedCornerShape(r(0.4f))).background(if (onAccent) Color(0xFF08131F) else C.panel)
            .padding(start = r(0.8f), end = r(0.6f), top = r(0.5f), bottom = r(0.5f)),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.8f)),
    ) {
        Text(text, style = body(1.1f, C.ink), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Icon(painterResource(R.drawable.lc_chevron_down), null, tint = C.ink, modifier = Modifier.size(r(1)))
    }
}

/** .tickbox: ticked or not. */
@Composable
private fun Tick(on: Boolean, onAccent: Boolean = false) {
    val r = rem()
    Box(
        Modifier.size(r(1.6f)).clip(RoundedCornerShape(r(0.2f))).background(if (on) (if (onAccent) Color(0xFF0B2233) else C.accent) else Color(0xFFF4F7FB)),
        contentAlignment = Alignment.Center,
    ) { if (on) Icon(painterResource(R.drawable.lc_check), null, tint = Color.White, modifier = Modifier.size(r(1.2f))) }
}

@Composable
private fun Val(text: String, f: Boolean) {
    val r = rem()
    Text(text, style = body(1.1f, if (f) C.onAccent else C.soft), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = r(24)))
}

@Composable
private fun Ico(icon: Int, f: Boolean) {
    val r = rem()
    Icon(painterResource(icon), null, tint = if (f) C.onAccent else C.soft, modifier = Modifier.padding(end = r(0.6f)).size(r(1.5f)))
}

/** .face: a person's colour with their letter. */
@Composable
private fun Face(name: String, color: String, size: Dp? = null) {
    val r = rem()
    Box(Modifier.size(size ?: r(2.6f)).clip(RoundedCornerShape(r(0.5f))).background(colorOf(color)), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), style = body(1.2f, C.ground, FontWeight.SemiBold))
    }
}

private val CATS = listOf("look" to "Look", "playback" to "Playback", "libraries" to "Libraries", "people" to "People", "server" to "Server", "addons" to "Add-ons", "device" to "This device", "about" to "About")

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Settings(nav: Nav, me: Screen, who: Me, refresh: () -> Unit, signOut: () -> Unit) {
    val r = rem()
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    val cat = me.params["tab"] ?: "playback"
    val cats = CATS.map { (id, label) -> if (id == "people" && !who.person.admin) "people" to "You" else id to label }
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    val catReqs = remember { mutableMapOf<String, FocusRequester>() }
    val searchReq = remember { FocusRequester() }
    fun search() { me.focused = "@search"; scope.launch { val t = Ui.text("Search settings", q); if (t != null) q = t.trim().lowercase() } }
    @Composable
    fun Body(id: String) {
        val may = who.person.canSettings
        when (id) {
            "look" -> Look(nav, reqs)
            "playback" -> Playback(who, refresh, reqs)
            "libraries" -> if (may) Libraries(who, reqs) else Locked()
            // (only for search: the People category itself shows PeoplePane)
            "people" -> if (who.person.admin) PeopleSummary(reqs) { id -> q = ""; nav.replace(mapOf("tab" to "people", "id" to id)) } else You(who, refresh, reqs)
            "server" -> if (may) ServerSettings(reqs) else Locked()
            "addons" -> AddonsList(nav, reqs)
            "device" -> ThisDevice(nav, who, signOut, reqs)
            else -> About(who, reqs)
        }
    }
    Column(Modifier.fillMaxSize().padding(start = gutter(), end = gutter(), top = r(2.2f))) {
        // .top: the title, the search, the clock
        Row(Modifier.padding(bottom = r(1.3f)).heightIn(min = r(3)), verticalAlignment = Alignment.CenterVertically) {
            Text("Settings", style = heading(2.3f))
            Focusable(Modifier.padding(start = r(2.2f)).focusRequester(searchReq), onClick = { search() }) { f ->
                Row(
                    Modifier.width(r(28.5f)).height(r(3.2f)).then(if (f) Modifier.border(r(0.18f), C.accent, RoundedCornerShape(r(0.6f))) else Modifier)
                        .clip(RoundedCornerShape(r(0.6f))).background(C.panel2).padding(horizontal = r(1.1f)),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.8f)),
                ) {
                    Icon(painterResource(R.drawable.lc_search), null, tint = C.soft, modifier = Modifier.size(r(1.2f)))
                    Text(q.ifEmpty { "Search settings" }, style = body(1.15f, if (q.isEmpty()) C.dim else C.body))
                }
            }
            if (q.isNotEmpty()) Pill("Clear", false, modifier = Modifier.padding(start = r(1.2f))) {
                q = ""
                // the Clear pill goes away: the focus to the search box
                scope.launch { delay(50); try { searchReq.requestFocus() } catch (_: Exception) {} }
            }
            Box(Modifier.weight(1f))
            Clock()
        }
        // .st-body: the categories, and the chosen one's settings
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(r(1.2f))) {
            if (q.isEmpty()) {
                // back from the right: on the category shown
                Column(Modifier.width(r(15)).focusProperties { enter = { catReqs[cat] ?: FocusRequester.Default } }.focusGroup(), verticalArrangement = Arrangement.spacedBy(r(0.25f))) {
                    cats.forEach { (id, label) ->
                        val on = id == cat
                        Focusable(Modifier.fillMaxWidth().focusRequester(catReqs.getOrPut(id) { FocusRequester() }),
                            onFocus = { if (id != cat) nav.replace(mapOf("tab" to id)) },
                            onClick = { nav.replace(mapOf("tab" to id)) }) { f ->
                            val shape = RoundedCornerShape(r(0.55f))
                            Box(Modifier.fillMaxWidth().clip(shape).background(if (f) C.accent else if (on) Color(0xFF12304A) else Color.Transparent)) {
                                Text(label, style = body(1.3f, if (f) C.onAccent else if (on) C.ink else C.soft), modifier = Modifier.padding(start = r(1.1f), end = r(0.9f), top = r(0.85f), bottom = r(0.85f)))
                                if (on && !f) Box(Modifier.matchParentSize(), contentAlignment = Alignment.CenterStart) {
                                    Box(Modifier.width(r(0.22f)).fillMaxHeight().clip(RoundedCornerShape(r(0.2f))).background(C.accent))
                                }
                            }
                        }
                    }
                }
            }
            // People has its own list and cards (and their scrolling) beside the categories
            if (q.isEmpty() && cat == "people" && who.person.admin) PeoplePane(nav, me, who, refresh, modifier = Modifier.weight(1f))
            else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = r(5))) {
                CompositionLocalProvider(LocalQuery provides q, LocalSettingsScreen provides me) {
                    if (q.isNotEmpty()) cats.forEach { (id, label) ->
                        // .st-sec: each category's matches under its name (no name without matches)
                        val hits = remember(id) { Hits() }
                        if (hits.keys.isNotEmpty()) Text(label, style = heading(1.5f), modifier = Modifier.padding(top = r(1.2f), bottom = r(0.6f)))
                        CompositionLocalProvider(LocalHits provides hits) { Body(id) }
                    } else Body(cat)
                }
            }
        }
    }
    LaunchedEffect(Unit) { delay(120); try { (if (me.focused == "@search") searchReq else catReqs[cat])?.requestFocus() } catch (_: Exception) {} }
    LaunchedEffect(Ui.closed) {
        val f = me.focused ?: return@LaunchedEffect
        delay(80)
        if (Ui.busy) return@LaunchedEffect
        try { (if (f == "@search") searchReq else reqs[f])?.requestFocus() } catch (_: Exception) {}
    }
}

@Composable
private fun Locked() {
    if (LocalQuery.current.isNotEmpty()) return
    Status("Ask an admin to let you change settings.")
}

@Composable
private fun Rows(content: @Composable () -> Unit) {
    val r = rem()
    Column(verticalArrangement = Arrangement.spacedBy(r(0.55f))) { content() }
}

@Composable
private fun Look(nav: Nav, reqs: MutableMap<String, FocusRequester>) {
    Rows {
        SRow("look-theme", "Theme", "Colours and fonts of Korie's own pages. (Jellyfin's apps on the TVs draw their own screens.)", "colours fonts", reqs, { nav.push("store", mapOf("tab" to "themes")) }) { Sel("Themes", it) }
    }
}

/** Your own languages: every screen in the house starts films in them. */
@Composable
private fun Playback(who: Me, refresh: () -> Unit, reqs: MutableMap<String, FocusRequester>) {
    val scope = rememberCoroutineScope()
    val langs = who.languages.filter { it.size >= 2 }.map { it[0] to it[1] }
    fun name(code: String) = langs.firstOrNull { it.first == code }?.second ?: code
    val q = LocalQuery.current
    val audio = who.person.audio
    val subs = who.person.subs
    val skip = who.person.skipIntro.ifEmpty { "button" }
    suspend fun save(k: String, v: String) {
        try { Korie.api("/api/me/playback", buildJsonObject { put(k, v) }) } catch (e: Exception) { Ui.toast(e.message ?: "") }
        refresh()
    }
    Rows {
        SRow("pb-audio", "Audio language", "Picked first when a film has several", reqs = reqs, onClick = {
            scope.launch {
                val v = Ui.menu("Audio language", listOf(Choice((if (audio == "") "✓ " else "") + "Original language", "@orig")) + langs.map { (c, n) -> Choice((if (c == audio) "✓ " else "") + n, c) })
                if (v != null) save("audio", if (v == "@orig") "" else v)
            }
        }) { Sel(if (audio.isNotEmpty()) name(audio) else "Original language", it) }
        SRow("pb-subs", "Subtitles", "Shown when the audio isn't in your language", reqs = reqs, onClick = {
            scope.launch {
                val v = Ui.menu("Subtitles", langs.map { (c, n) -> Choice((if (c == subs) "✓ " else "") + n, c) } + Choice((if (subs == "off") "✓ " else "") + "Off", "off") + Choice((if (subs == "") "✓ " else "") + "As the film says", "@file"))
                if (v != null) save("subs", if (v == "@file") "" else v)
            }
        }) { Sel(if (subs == "off") "Off" else if (subs.isNotEmpty()) name(subs) else "As the film says", it) }
        SRow("pb-skip", "Skip intros", "For series where Korie found the intro", "intro series episode", reqs, {
            scope.launch {
                val v = Ui.menu("Skip intros", SKIPS.map { (id, label) -> Choice((if (id == skip) "✓ " else "") + label, id) })
                if (v != null) save("skipIntro", v)
            }
        }) { Sel(SKIPS.firstOrNull { it.first == skip }?.second ?: "Show a Skip button", it) }
        if (q.isEmpty()) Note("Yours, on every screen.")
    }
}

@Composable
private fun Libraries(who: Me, reqs: MutableMap<String, FocusRequester>) {
    val scope = rememberCoroutineScope()
    val q = LocalQuery.current
    val (data, _, reload) = useData("settings", listOf("library", "status")) { Korie.read<SettingsData>(Korie.api("/api/settings")) }
    data ?: return
    fun add() = scope.launch {
        // walk the server's folders with the remote
        var path = ""
        while (true) {
            val d = try { Korie.api("/api/dirs?path=" + Korie.enc(path)) as JsonObject } catch (e: Exception) { Ui.toast(e.message ?: ""); return@launch }
            val here = d["path"]?.jsonPrimitive?.content ?: "/"
            val parent = (d["parent"] as? JsonPrimitive)?.contentOrNull
            val dirs = (d["dirs"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
            val choices = mutableListOf<Choice>()
            if (here != "/") choices += Choice("✓ Use this folder", "@use")
            choices += Choice("Type a path", "@type")
            if (parent != null) choices += Choice("‹ Up one level", "@up")
            choices += dirs.map { Choice(it, it, R.drawable.lc_folder) }
            val v = Ui.menu(here, choices) ?: return@launch
            when (v) {
                "@up" -> path = parent ?: "/"
                "@type" -> { val t = Ui.text("The folder's path on the server", here, hint = "Like /media/films. In Docker, the folders you mapped into the container."); if (!t.isNullOrEmpty()) path = t.trim() }
                "@use" -> { path = here; break }
                else -> path = (if (here.endsWith("/")) here else "$here/") + v
            }
        }
        val kind = Ui.menu("What's in $path?", listOf(Choice("Films", "films"), Choice("Series", "series"), Choice("Music", "music"))) ?: return@launch
        try { Korie.api("/api/folders", buildJsonObject { put("path", path); put("kind", kind) }); Ui.toast("Added. Korie is looking through it.") } catch (e: Exception) { Ui.message("Couldn't add it", e.message ?: "") }
        reload()
    }
    fun folder(f: Folder) = scope.launch {
        val v = Ui.menu(f.path, listOf(Choice("Look through it again", "scan"), Choice("Remove from the library", "remove", danger = true)))
        if (v == "scan") try { Korie.api("/api/scan", buildJsonObject { }) } catch (_: Exception) {}
        if (v == "remove") {
            val ok = Ui.ask("Remove this folder?", "${f.path}\nIts films, series or music leave Korie. The files themselves stay where they are.", listOf(Choice("Remove", "yes", danger = true), Choice("Keep it", "no", primary = true)))
            if (ok == "yes") try { Korie.api("/api/folders/${f.id}", null, "DELETE") } catch (e: Exception) { Ui.toast(e.message ?: "") }
        }
        reload()
    }
    Rows {
        data.folders.forEach { f ->
            val help = if (f.error.isNotEmpty()) f.error else if (f.scanned > 0) "Looked through " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(f.scanned * 1000)) else "Looking through it…"
            SRow("folder-${f.id}", f.path, help, "folder library", reqs, { folder(f) }) { Val(f.kind.replaceFirstChar { it.uppercase() }, it) }
        }
        if (who.person.admin) SRow("folder-add", "Add a folder", "A folder on the server with films, series or music", "library", reqs, { add() }) { Ico(R.drawable.lc_folder_plus, it) }
        SRow("folder-scan", "Look for new files now",
            if (data.status.scanning) data.status.text.ifEmpty { "Looking…" } else "${data.counts["film"] ?: 0} films, ${data.counts["series"] ?: 0} series, ${data.counts["album"] ?: 0} albums",
            "scan library", reqs, { scope.launch { try { Korie.api("/api/scan", buildJsonObject { }) } catch (_: Exception) {}; Ui.toast("Looking for new files…") } })
        SRow("folder-removed", "Removed from the library", "Films and series removed with the options menu; bring them back here", reqs = reqs, onClick = {
            scope.launch {
                val items = try { (Korie.api("/api/removed") as JsonObject)["items"] as JsonArray } catch (e: Exception) { Ui.toast(e.message ?: ""); return@launch }
                if (items.isEmpty()) { Ui.toast("Nothing has been removed."); return@launch }
                val id = Ui.menu("Bring back to the library", items.map { e ->
                    val o = e as JsonObject
                    val y = o["year"]?.jsonPrimitive?.contentOrNull ?: ""
                    Choice((o["title"]?.jsonPrimitive?.contentOrNull ?: "") + (if (y.isNotEmpty()) " ($y)" else ""), o["id"]!!.jsonPrimitive.content)
                }) ?: return@launch
                try { Korie.api("/api/remove", buildJsonObject { put("id", id); put("restore", true) }); Ui.toast("It's back in the library.") } catch (e: Exception) { Ui.toast(e.message ?: "") }
            }
        })
        if (q.isEmpty()) Note("Names work the Kodi and Jellyfin way: Films/Alien (1979)/Alien (1979).mkv, Series/Arcane/Season 1/Arcane S01E01.mkv, Music/Artist/Album/01 Song.flac. Your own .nfo files and pictures (poster.jpg, fanart.jpg) win over TMDb.")
    }
}

@Composable
private fun ServerSettings(reqs: MutableMap<String, FocusRequester>) {
    val scope = rememberCoroutineScope()
    val (data, _, reload) = useData("server-settings") { Korie.read<SettingsData>(Korie.api("/api/settings")) }
    val s = data ?: return
    suspend fun set(key: String, value: JsonElement) {
        try { Korie.api("/api/settings", buildJsonObject { put("key", key); put("value", value) }) } catch (e: Exception) { Ui.toast(e.message ?: "") }
        reload()
    }
    Rows {
        SRow("srv-name", "Server name", "What devices show when they find it", reqs = reqs, onClick = {
            scope.launch { val t = Ui.text("The server's name", s.str("server_name"))?.trim(); if (!t.isNullOrEmpty()) set("server_name", JsonPrimitive(t)) }
        }) { Sel(s.str("server_name"), it) }
        SRow("srv-lang", "Language of film and series details", "Titles and descriptions from TMDb", reqs = reqs, onClick = {
            scope.launch { val v = Ui.menu("Language for details from TMDb", LANGS.map { (id, l) -> Choice((if (id == s.str("language")) "✓ " else "") + l, id) }); if (v != null) set("language", JsonPrimitive(v)) }
        }) { Sel(LANGS.firstOrNull { it.first == s.str("language") }?.second ?: s.str("language"), it) }
        SRow("srv-tmdb", "TMDb key", if (s.tmdb) "Details and pictures come from TMDb" else "No key: Korie can't fetch details", reqs = reqs, onClick = {
            scope.launch { val t = Ui.text("Your own TMDb API key (empty: Korie's)", "", secret = true); if (t != null) set("tmdb_key", JsonPrimitive(t.trim())) }
        }) { Sel(if (s.str("tmdb_key").isNotEmpty()) "Your own" else "Korie's", it) }
        SRow("srv-scan", "Look for new files when the server starts", "Off: only when you ask, or when a folder is added", reqs = reqs, onClick = {
            scope.launch { set("scan_on_start", JsonPrimitive(!s.flag("scan_on_start"))) }
        }) { Tick(s.flag("scan_on_start"), it) }
    }
}

@Composable
private fun AddonsList(nav: Nav, reqs: MutableMap<String, FocusRequester>) {
    val (data, _) = useData("addons-list", listOf("addons")) { Korie.read<AddonList>(Korie.api("/api/addons")) }
    data ?: return
    Rows {
        data.addons.filter { it.installed }.forEach { a ->
            SRow("sa-${a.id}", a.name, a.error.ifEmpty { a.description }, "add-on addon", reqs, { nav.push("addon", mapOf("id" to a.id)) }) { Val(if (a.enabled) "On" else "Off", it) }
        }
        SRow("sa-more", "Get more add-ons", "Radio, podcasts, online catalogues and more from the Store", "store install", reqs, { nav.push("store", mapOf("tab" to "store")) }) { Ico(R.drawable.lc_plus, it) }
    }
}

@Composable
private fun ThisDevice(nav: Nav, who: Me, signOut: () -> Unit, reqs: MutableMap<String, FocusRequester>) {
    val ctx = LocalContext.current
    val (data, _) = useData(if (who.person.admin) "people-all" else null, listOf("people")) { if (who.person.admin) Korie.read<PeopleData>(Korie.api("/api/people/all")) else null }
    val auto = data?.people?.firstOrNull { it.autoDevice == Korie.deviceId }
    Rows {
        SRow("dev-who", "Switch person", "Back to Who's watching", "profile sign out", reqs, signOut) { Val(who.person.name, it) }
        if (who.person.admin) SRow("dev-auto", "Signs in by itself as", "${Korie.deviceName}: skip Who's watching and start as one person (set in People)", "automatic sign in", reqs, {
            nav.replace(if (auto != null) mapOf("tab" to "people", "id" to auto.id) else mapOf("tab" to "people"))
        }) { Sel(auto?.name ?: "Nobody: asks who's watching", it) }
        SRow("dev-server", "Change server", "Look for Korie servers again, or type an address", reqs = reqs, onClick = { Korie.forgetServer(ctx) })
        SRow("dev-android", "Android settings", "The TV's own settings: network, display, sound, apps", "android system settings", reqs = reqs, onClick = {
            try { ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { Ui.toast(e.message ?: "") }
        })
        SRow("dev-home", if (isHomeApp(ctx)) "Korie is the home screen" else "Make Korie the home screen", if (isHomeApp(ctx)) "The Home button opens Korie. Change it in the TV's settings." else "The Home button opens Korie instead of the TV's own home screen", "launcher home app", reqs = reqs, onClick = { askToBeHome(ctx) })
    }
}

@Composable
private fun About(who: Me, reqs: MutableMap<String, FocusRequester>) {
    val ctx = LocalContext.current
    val q = LocalQuery.current
    val app = remember { try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" } }
    Rows {
        SRow("about-v", "Korie ${who.server.version}", "Server “${who.server.name}” · TV app $app", "version", reqs)
        if (q.isEmpty()) Note("Film and series details and pictures come from The Movie Database (TMDb). This product uses the TMDb API but is not endorsed or certified by TMDb. Video is converted with FFmpeg when a device can't play a file as it is.")
    }
}

@Composable
private fun You(who: Me, refresh: () -> Unit, reqs: MutableMap<String, FocusRequester>) {
    val scope = rememberCoroutineScope()
    Rows {
        SRow("you-name", "Your name", reqs = reqs, onClick = {
            scope.launch {
                val t = Ui.text("Your name", who.person.name)?.trim()
                if (!t.isNullOrEmpty()) { try { Korie.api("/api/people/${who.person.id}", buildJsonObject { put("name", t) }, "PATCH") } catch (e: Exception) { Ui.toast(e.message ?: "") }; refresh() }
            }
        }) { Sel(who.person.name, it) }
        SRow("you-pin", if (who.person.hasPin) "Change your PIN" else "Set a PIN", "Asked for when you pick yourself in Who's watching", reqs = reqs, onClick = {
            scope.launch {
                val pin = Ui.pin("A new four-digit PIN") ?: return@launch
                try { Korie.api("/api/people/${who.person.id}/pin", buildJsonObject { put("pin", pin) }); Ui.toast("PIN set") } catch (e: Exception) { Ui.toast(e.message ?: "") }
            }
        })
    }
}

fun personNote(p: PersonFull): String {
    if (p.admin) return "Runs the server"
    val limited = p.maxAge != null || !p.all(p.addons) || !p.all(p.apps) || !p.music
    return listOf(if (p.hasPin) "PIN" else "", if (limited) "Limited" else "").filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "May watch everything" }
}

/** In Settings: everyone, each opening People. */
@Composable
private fun PeopleSummary(reqs: MutableMap<String, FocusRequester>, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val (data, _, reload) = useData("people-all", listOf("people")) { Korie.read<PeopleData>(Korie.api("/api/people/all")) }
    data ?: return
    Rows {
        data.people.forEach { p ->
            SRow("sp-${p.id}", p.name, personNote(p), "people person pin", reqs, { open(p.id) }) { Face(p.name, p.color) }
        }
        SRow("sp-add", "Add person", words = "people new", reqs = reqs, onClick = {
            scope.launch {
                val t = Ui.text("Name of the new person")?.trim()
                if (!t.isNullOrEmpty()) try {
                    val n = Korie.read<PersonFull>(Korie.api("/api/people", buildJsonObject { put("name", t) }))
                    reload(); open(n.id)
                } catch (e: Exception) { Ui.toast(e.message ?: "") }
            }
        }) { Ico(R.drawable.lc_plus, it) }
    }
}

/** .pline: a line in a People card; focused: accent. */
@Composable
private fun PLine(modifier: Modifier = Modifier, onClick: () -> Unit, content: @Composable (Boolean) -> Unit) {
    val r = rem()
    Focusable(modifier, onClick = onClick) { f ->
        Row(
            Modifier.heightIn(min = r(2.7f)).clip(RoundedCornerShape(r(0.45f))).background(if (f) C.accent else Color.Transparent).padding(horizontal = r(0.5f), vertical = r(0.25f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.8f)),
        ) { content(f) }
    }
}

@Composable
private fun PCard(title: String?, modifier: Modifier = Modifier, row: Boolean = false, content: @Composable () -> Unit) {
    val r = rem()
    Column(modifier.clip(RoundedCornerShape(r(0.6f))).background(C.panel2).padding(start = r(0.8f), end = r(0.8f), top = if (row) r(0.7f) else r(1), bottom = if (row) r(0.7f) else r(0.6f)), verticalArrangement = Arrangement.spacedBy(r(0.15f))) {
        if (title != null) Text(title, style = body(1.15f, C.body, FontWeight.SemiBold), modifier = Modifier.padding(start = r(0.5f), end = r(0.5f), bottom = r(0.4f)))
        content()
    }
}

/** People on a screen of its own (Manage people from Who's watching): Back closes it. */
@Composable
fun People(nav: Nav, me: Screen, who: Me, refresh: () -> Unit) {
    val r = rem()
    Column(Modifier.fillMaxSize().padding(start = gutter(), end = gutter(), top = r(2.2f))) {
        Row(Modifier.padding(bottom = r(1.3f)).heightIn(min = r(3)), verticalAlignment = Alignment.Bottom) {
            Text("People", style = heading(2.3f))
            Box(Modifier.weight(1f))
            Clock()
        }
        PeoplePane(nav, me, who, refresh, grabFocus = true)
    }
}

/** Settings › People: everyone, and who may do what. In Settings it sits beside the categories;
 *  [grabFocus]: on a screen of its own, the chosen person has the focus at once. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalComposeUiApi::class)
@Composable
fun PeoplePane(nav: Nav, me: Screen, who: Me, refresh: () -> Unit, grabFocus: Boolean = false, modifier: Modifier = Modifier) {
    val r = rem()
    val scope = rememberCoroutineScope()
    val (data, _, reload) = useData("people-all", listOf("people")) { Korie.read<PeopleData>(Korie.api("/api/people/all")) }
    val listReqs = remember { mutableMapOf<String, FocusRequester>() }
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    fun req(k: String) = Modifier.focusRequester(reqs.getOrPut(k) { FocusRequester() })
    val d = data ?: return
    val p = d.people.firstOrNull { it.id == me.params["id"] } ?: d.people.firstOrNull() ?: return
    fun act(key: String, block: suspend () -> Unit) { me.focused = key; scope.launch { block() } }
    suspend fun change(body: JsonObject) {
        try { Korie.api("/api/people/${p.id}", body, "PATCH") } catch (e: Exception) { Ui.toast(e.message ?: "") }
        reload(); refresh()
    }
    suspend fun choose(key: String, id: String) {
        val all = if (key == "addons") d.addons.map { it.id } else d.apps.map { it.pkg }
        val el = if (key == "addons") p.addons else p.apps
        val cur = if (p.all(el)) all else p.list(el)
        val next = if (id in cur) cur - id else cur + id
        change(buildJsonObject { if (next.size == all.size) put(key, "all") else put(key, buildJsonArray { next.forEach { add(JsonPrimitive(it)) } }) })
    }
    fun mayAddon(id: String) = p.all(p.addons) || id in p.list(p.addons)
    fun mayApp(pkg: String) = p.all(p.apps) || pkg in p.list(p.apps)
    val devName = d.devices.firstOrNull { it.id == p.autoDevice }?.name ?: "No device"
    run {
        Row(modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(r(1.2f))) {
            // .pp-list: everyone
            // coming in from the side: on the person shown, not the nearest line
            Column(Modifier.width(r(16)).focusProperties { enter = { listReqs[p.id] ?: FocusRequester.Default } }.focusGroup().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(r(0.25f))) {
                d.people.forEach { x ->
                    val on = x.id == p.id
                    Focusable(Modifier.fillMaxWidth().focusRequester(listReqs.getOrPut(x.id) { FocusRequester() }), onFocus = { if (x.id != p.id) nav.replace(mapOf("id" to x.id)) }, onClick = { nav.replace(mapOf("id" to x.id)) }) { f ->
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(r(0.55f))).background(if (f) C.accent else if (on) Color(0xFF12304A) else Color.Transparent)) {
                            Row(Modifier.padding(horizontal = r(0.8f), vertical = r(0.55f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.8f))) {
                                Face(x.name, x.color)
                                Column {
                                    Text(x.name, style = body(1.25f, if (f) C.onAccent else C.ink, FontWeight.SemiBold))
                                    Text(personNote(x), style = body(0.95f, if (f) C.onAccent else C.soft))
                                }
                            }
                            if (on && !f) Box(Modifier.matchParentSize(), contentAlignment = Alignment.CenterStart) {
                                Box(Modifier.width(r(0.22f)).fillMaxHeight().clip(RoundedCornerShape(r(0.2f))).background(C.accent))
                            }
                        }
                    }
                }
                // the last line: Down stays here (not out to the Settings categories)
                Focusable(Modifier.fillMaxWidth().focusProperties { down = FocusRequester.Cancel }, onClick = {
                    scope.launch {
                        val t = Ui.text("Name of the new person")?.trim()
                        if (!t.isNullOrEmpty()) try { val n = Korie.read<PersonFull>(Korie.api("/api/people", buildJsonObject { put("name", t) })); reload(); nav.replace(mapOf("id" to n.id))
                            // on the new person once they're in the list
                            repeat(10) { delay(120); listReqs[n.id]?.let { try { it.requestFocus(); return@launch } catch (_: Exception) {} } } } catch (e: Exception) { Ui.toast(e.message ?: "") }
                    }
                }) { f ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(r(0.55f))).background(if (f) C.accent else Color.Transparent).padding(horizontal = r(0.8f), vertical = r(0.55f)),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.8f))) {
                        Box(Modifier.size(r(2.6f)).clip(RoundedCornerShape(r(0.5f))).border(r(0.15f), Color(0x809DB0C4), RoundedCornerShape(r(0.5f))), contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.lc_plus), null, tint = if (f) C.onAccent else C.soft, modifier = Modifier.size(r(1.2f)))
                        }
                        Text("Add person", style = body(1.25f, if (f) C.onAccent else C.soft, FontWeight.SemiBold))
                    }
                }
            }
            // .pp-pane: two columns of cards
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = r(5)), verticalArrangement = Arrangement.spacedBy(r(0.8f))) {
                val half = Modifier.weight(1f)
                Row(horizontalArrangement = Arrangement.spacedBy(r(0.8f)), verticalAlignment = Alignment.Top) {
                    PCard("Signing in", half) {
                        PLine(req("pin").fillMaxWidth(), onClick = {
                            act("pin") {
                                if (p.hasPin) {
                                    val w = Ui.menu("PIN for ${p.name}", listOf(Choice("Change the PIN", "set"), Choice("No PIN", "clear", danger = true)))
                                    if (w == "clear") try { Korie.api("/api/people/${p.id}/pin", buildJsonObject { put("pin", JsonNull) }) } catch (_: Exception) {}
                                    if (w != "set") { reload(); return@act }
                                }
                                val v = Ui.pin("A new four-digit PIN for ${p.name}")
                                if (v != null) try { Korie.api("/api/people/${p.id}/pin", buildJsonObject { put("pin", v) }); Ui.toast("PIN set") } catch (e: Exception) { Ui.toast(e.message ?: "") }
                                reload()
                            }
                        }) { f -> Text("Needs a PIN", style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Tick(p.hasPin, f) }
                        PLine(req("auto").fillMaxWidth(), onClick = {
                            act("auto") {
                                val here = Korie.deviceId
                                val v = Ui.menu("${p.name} signs in by itself on", listOf(Choice((if (p.autoDevice == null) "✓ " else "") + "No device", "@none")) +
                                    d.devices.map { x -> Choice((if (p.autoDevice == x.id) "✓ " else "") + x.name + (if (x.id == here) " (this one)" else " · used ${seen(x.seen)}"), x.id) })
                                if (v != null) change(buildJsonObject { if (v == "@none") put("autoDevice", JsonNull) else put("autoDevice", v) })
                            }
                        }) { f -> Text("Signs in by itself on", style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Sel(devName, f) }
                    }
                    PCard("Films and series", half) {
                        if (!p.admin) PLine(req("age").fillMaxWidth(), onClick = {
                            act("age") {
                                val v = Ui.menu("Films and series ${p.name} may watch", AGES.map { a -> Choice((if (p.maxAge == a) "✓ " else "") + ageLabel(a) + (if (a == null) "" else if (a == 0) " (rated for all ages)" else " (rated $a and under)"), "$a") })
                                if (v != null) change(buildJsonObject { if (v == "null") put("maxAge", JsonNull) else put("maxAge", v.toInt()) })
                            }
                        }) { f -> Text("Only rated up to", style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Sel(ageLabel(p.maxAge), f) }
                        PLine(req("music").fillMaxWidth(), onClick = { act("music") { change(buildJsonObject { put("music", !p.music) }) } }) { f ->
                            Text("Music", style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Tick(p.music, f)
                        }
                        if (p.admin) Note("Admins may watch everything.", Modifier.padding(horizontal = r(0.5f)))
                    }
                }
                if (!p.admin) Row(horizontalArrangement = Arrangement.spacedBy(r(0.8f)), verticalAlignment = Alignment.Top) {
                    PCard("Add-ons they may use", half) {
                        d.addons.forEach { a ->
                            PLine(req("a:" + a.id).fillMaxWidth(), onClick = { act("a:" + a.id) { choose("addons", a.id) } }) { f ->
                                Text(a.name, style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Tick(mayAddon(a.id), f)
                            }
                        }
                        if (d.addons.isEmpty()) Note("No add-ons yet.", Modifier.padding(horizontal = r(0.5f)))
                    }
                    if (d.apps.isNotEmpty()) PCard("Android apps they may use", half) {
                        d.apps.forEach { a ->
                            PLine(req("p:" + a.pkg).fillMaxWidth(), onClick = { act("p:" + a.pkg) { choose("apps", a.pkg) } }) { f ->
                                Text(a.label, style = body(1.15f, if (f) C.onAccent else C.body), modifier = Modifier.weight(1f)); Tick(mayApp(a.pkg), f)
                            }
                        }
                    } else Box(half)
                }
                if (!p.admin) PCard(null, Modifier.fillMaxWidth(), row = true) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(r(0.6f)), verticalArrangement = Arrangement.spacedBy(r(0.6f))) {
                        listOf(Triple("canInstall", "Install add-ons", p.canInstall), Triple("canSettings", "Change settings", p.canSettings), Triple("canDelete", "Delete from the library", p.canDelete)).forEach { (k, label, on) ->
                            PLine(req(k).padding(end = r(0.5f)), onClick = { act(k) { change(buildJsonObject { put(k, !on) }) } }) { f -> Tick(on, f); Text(label, style = body(1.15f, if (f) C.onAccent else C.body)) }
                        }
                    }
                }
                PCard(null, Modifier.fillMaxWidth(), row = true) {
                    Btn("Name, colour and admin…", modifier = req("more")) {
                        act("more") {
                            val v = Ui.menu(p.name, listOf(Choice("Rename", "name"), Choice("Colour", "color"), Choice(if (p.admin) "Not an admin" else "Make an admin", "admin")) +
                                if (p.id != who.person.id) listOf(Choice("Remove ${p.name}…", "remove", danger = true)) else emptyList())
                            when (v) {
                                "name" -> { val t = Ui.text("Name", p.name)?.trim(); if (!t.isNullOrEmpty()) change(buildJsonObject { put("name", t) }) }
                                "color" -> { val c = Ui.menu("Colour", COLORS.map { x -> Choice((if (x == p.color) "✓ " else "") + x, x) }); if (c != null) change(buildJsonObject { put("color", c) }) }
                                "admin" -> change(buildJsonObject { put("admin", !p.admin) })
                                "remove" -> {
                                    val ok = Ui.ask("Remove ${p.name}?", "What they watched and their favourites go too.", listOf(Choice("Remove", "yes", danger = true), Choice("Keep", "no", primary = true)))
                                    if (ok == "yes") {
                                        try { Korie.api("/api/people/${p.id}", null, "DELETE") } catch (e: Exception) { Ui.message("Couldn't remove", e.message ?: "") }
                                        nav.replace(mapOf("id" to "")); reload()
                                    }
                                }
                            }
                        }
                    }
                    if (p.maxAge != null) Note("Films and series without an age rating are hidden from ${p.name} too. Give one with the options menu on the film (Age rating).", Modifier.padding(horizontal = r(0.5f)))
                }
            }
        }
    }
    if (grabFocus) LaunchedEffect(Unit) { delay(120); try { listReqs[p.id]?.requestFocus() } catch (_: Exception) {} }
    LaunchedEffect(Ui.closed) { val f = me.focused ?: return@LaunchedEffect; delay(80); if (Ui.busy) return@LaunchedEffect; try { reqs[f]?.requestFocus() } catch (_: Exception) {} }
}
