package app.korie.tv

// The Store (Store.tsx): add-ons to get, the ones you have, themes, and each add-on's page with
// its settings.

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
data class AddonSetting(val key: String, val label: String = "", val type: String = "text", val help: String = "", val value: JsonElement? = null) {
    val list: List<String> get() = (value as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    val text: String get() = (value as? JsonPrimitive)?.contentOrNull ?: ""
}

@Serializable
data class Addon(
    val id: String, val name: String = "", val version: String = "", val storeVersion: String = "", val author: String = "", val description: String = "",
    val games: Boolean = false, val installed: Boolean = false, val builtin: Boolean = false, val enabled: Boolean = false, val error: String = "",
    val status: String = "", val busy: Boolean = false, val internet: Boolean = false, val hosts: List<String> = emptyList(), val hostsFromSettings: Boolean = false,
    val settings: List<AddonSetting> = emptyList(), val log: List<String> = emptyList(),
)

@Serializable
data class AddonList(val addons: List<Addon> = emptyList(), val store: StoreState = StoreState()) {
    @Serializable
    data class StoreState(val loading: Boolean = false, val error: String = "")
}

@Serializable
data class ThemeView(val id: String, val name: String = "", val version: String = "", val author: String = "", val description: String = "", val builtin: Boolean = false, val installed: Boolean = false, val update: Boolean = false)

@Serializable
data class Themes(val themes: List<ThemeView> = emptyList(), val store: List<ThemeView> = emptyList())

private fun iconOf(a: Addon) = if (a.games) R.drawable.lc_gamepad_2 else if (listOf("drtv", "stremio", "films").any { a.id.contains(it) }) R.drawable.lc_clapperboard else R.drawable.lc_puzzle

private fun stateOf(a: Addon): String = when {
    a.busy -> "Installing…"
    a.error.isNotEmpty() -> "Can't run"
    !a.installed -> "Get"
    a.status == "update" -> "Update ready"
    a.builtin -> if (a.enabled) "Built in · On" else "Built in · Off"
    else -> if (a.enabled) "On" else "Off"
}

/** .tile: an icon, the name and a line under it, and what it does; focused: panel with an accent ring. */
@Composable
private fun Tile(icon: Int, name: String, small: String, text: String, modifier: Modifier = Modifier, onFocus: (() -> Unit)? = null, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.9f))
    Focusable(modifier.fillMaxWidth(), onClick = onClick, onFocus = onFocus) { f ->
        Column(
            Modifier.fillMaxWidth().heightIn(min = r(9)).then(if (f) Modifier.border(r(0.22f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else C.panel2)
                .padding(horizontal = r(1.2f), vertical = r(1.1f)),
            verticalArrangement = Arrangement.spacedBy(r(0.6f)),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.9f))) {
                Box(Modifier.size(r(2.6f)).clip(RoundedCornerShape(r(0.6f))).background(Color(0x10FFFFFF)), contentAlignment = Alignment.Center) {
                    Icon(painterResource(icon), null, tint = C.accent, modifier = Modifier.size(r(1.4f)))
                }
                Column {
                    Text(name, style = heading(1.25f))
                    Text(small, style = body(0.88f, C.dim))
                }
            }
            Text(text, style = body(0.92f, C.soft), maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun Note(text: String, modifier: Modifier = Modifier) {
    val r = rem()
    Text(text, style = body(0.95f, C.dim), modifier = modifier.padding(top = r(0.8f)).widthIn(max = r(52)))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Store(nav: Nav, me: Screen, who: Me) {
    val r = rem()
    val scope = rememberCoroutineScope()
    val tab = me.params["tab"] ?: "installed"
    val (data, _) = useData("addons", listOf("store", "addons")) { Korie.read<AddonList>(Korie.api("/api/addons")) }
    val (themes, _, reloadThemes) = useData("themes", listOf("themes", "store")) { Korie.read<Themes>(Korie.api("/api/themes")) }
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    fun req(k: String) = Modifier.focusRequester(reqs.getOrPut(k) { FocusRequester() })
    val all = data?.addons ?: emptyList()
    val list = all.filter { if (tab == "store") !it.installed else it.installed }
    fun theme(t: ThemeView) {
        if (!who.person.canInstall) return
        scope.launch {
            if (!t.installed || t.update) {
                Ui.toast("Getting ${t.name}…")
                try { Korie.api("/api/theme/install", buildJsonObject { put("id", t.id) }); Ui.toast("${t.name} is on the server. Choose it on a TV under Settings › Theme.") }
                catch (e: Exception) { Ui.message("Couldn't get it", e.message ?: "") }
            } else if (!t.builtin) {
                val ok = Ui.ask("Remove ${t.name}?", "TVs that use it keep it until they choose another.", listOf(Choice("Remove", "yes", danger = true), Choice("Keep it", "no", primary = true)))
                if (ok == "yes") try { Korie.api("/api/theme/remove", buildJsonObject { put("id", t.id) }) } catch (e: Exception) { Ui.toast(e.message ?: "") }
            }
            reloadThemes()
        }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(r(20)),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5)),
        horizontalArrangement = Arrangement.spacedBy(r(1)),
        verticalArrangement = Arrangement.spacedBy(r(1)),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                Top("Add-ons")
                FlowRow(Modifier.padding(bottom = r(0.4f)), horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                    listOf("installed" to "Installed · ${all.count { it.installed }}", "store" to "Get more", "themes" to "Themes").forEach { (id, label) ->
                        Pill(label, tab == id, modifier = req("tab:$id")) { me.focused = "tab:$id"; nav.replace(mapOf("tab" to id)) }
                    }
                }
            }
        }
        if (tab == "themes") {
            val ts = (themes?.themes ?: emptyList()) + (themes?.store ?: emptyList())
            items(ts, key = { "t:" + it.id }) { t ->
                Tile(R.drawable.lc_palette, t.name, (if (t.builtin) "Comes with Korie" else if (t.update) "Update ready" else if (t.installed) "On the server" else "Get") + (if (t.version.isNotEmpty()) " · ${t.version}" else ""),
                    t.description.ifEmpty { if (t.author.isNotEmpty()) "By ${t.author}" else "" }, req("t:" + t.id), onFocus = { me.focused = "t:" + t.id }) { theme(t) }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    if (themes != null && ts.isEmpty()) Status("No themes yet.")
                    Note("Themes change how Korie looks on the TVs. Each TV picks its own under Settings › Theme.")
                }
            }
        } else {
            items(list, key = { it.id }) { a ->
                Tile(iconOf(a), a.name, stateOf(a) + (if (a.version.isNotEmpty()) " · ${a.version}" else ""), a.description, req(a.id), onFocus = { me.focused = a.id }) {
                    nav.push("addon", mapOf("id" to a.id))
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    Status(data?.store?.error?.ifEmpty { null } ?: if (data != null && list.isEmpty()) (if (tab == "store") (if (data.store.loading) "Loading the Store…" else "You have everything in the Store.") else "No add-ons installed.") else "")
                    if (!who.person.canInstall) Note("Ask an admin to let you get and turn on add-ons.")
                }
            }
        }
    }
    BackToCard(me, reqs, data != null, data)
}

/** An add-on's page: what it is, Get / Turn on / Load again / Remove, its settings, what it said lately. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddonInfo(nav: Nav, me: Screen, who: Me) {
    val r = rem()
    val id = me.params["id"] ?: ""
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val (a, error, reload) = useData(id, listOf("store", "addons")) { Korie.read<Addon>(Korie.api("/api/addon?id=" + Korie.enc(id))) }
    val main = remember { FocusRequester() }
    val back = remember { FocusRequester() }
    val reqs = remember(me) { mutableMapOf<String, FocusRequester>() }
    fun req(k: String) = Modifier.focusRequester(reqs.getOrPut(k) { FocusRequester() })
    if (a == null) {
        Column(Modifier.padding(start = gutter(), end = gutter(), top = r(2.2f))) {
            BackLink(nav, Modifier.focusRequester(back), "Store")
            Status(error.ifEmpty { "Loading…" })
        }
        LaunchedEffect(Unit) { delay(80); try { back.requestFocus() } catch (_: Exception) {} }
        return
    }
    suspend fun run(action: String, extra: JsonObject = JsonObject(emptyMap())): JsonObject? {
        busy = true
        return try {
            Korie.api("/api/addon/$action", JsonObject(mapOf("id" to JsonPrimitive(a.id)) + extra)) as? JsonObject
        } catch (e: Exception) {
            Ui.message("That didn't work", e.message ?: ""); null
        } finally { busy = false; reload() }
    }
    suspend fun turnOn() {
        val res = run("enable") ?: return
        if (res["needsInternet"]?.jsonPrimitive?.content == "true") {
            val hosts = (res["hosts"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
            val fromSettings = res["hostsFromSettings"]?.jsonPrimitive?.content == "true"
            val where = if (hosts.isNotEmpty()) "It can fetch things from ${hosts.joinToString(", ")}${if (fromSettings) ", and from the addresses an admin types into its settings" else ""}." else "It can fetch things only from the addresses an admin types into its settings."
            val v = Ui.ask("Let ${a.name} use the internet?", "$where\nNothing else: it can't open the server's files or run programs.\n\nFrom: ${a.author} · version ${a.version}", listOf(Choice("Allow", "yes", primary = true), Choice("Don't allow", "no")))
            if (v == "yes") run("enable", buildJsonObject { put("internet", true) })
        }
    }
    fun edit(s: AddonSetting) {
        me.focused = "set:" + s.key
        scope.launch {
            if (s.type == "list") {
                val list = s.list
                val v = Ui.menu(s.label, list.mapIndexed { i, x -> Choice("Remove $x", "$i") } + Choice("Add one", "add")) ?: return@launch
                if (v == "add") {
                    val t = Ui.text(s.label, "", hint = s.help)?.trim()
                    if (!t.isNullOrEmpty()) run("setting", buildJsonObject { put("key", s.key); put("value", buildJsonArray { (list + t).forEach { add(JsonPrimitive(it)) } }) })
                } else run("setting", buildJsonObject { put("key", s.key); put("value", buildJsonArray { list.filterIndexed { i, _ -> "$i" != v }.forEach { add(JsonPrimitive(it)) } }) })
                return@launch
            }
            val t = Ui.text(s.label, if (s.type == "password") "" else s.text, secret = s.type == "password", hint = s.help) ?: return@launch
            run("setting", buildJsonObject { put("key", s.key); put("value", if (s.type == "password") t else t.trim()) })
        }
    }
    val may = who.person.canInstall
    data class B(val key: String, val label: String, val icon: Int, val primary: Boolean = false, val danger: Boolean = false, val act: suspend () -> Unit)
    val buttons = mutableListOf<B>()
    if (may && a.error.isEmpty()) {
        if (!a.installed) buttons += B("main", if (a.busy || busy) "Getting it…" else "Get", R.drawable.lc_download, primary = true) { if (run("install") != null) turnOn() }
        else {
            if (a.status == "update") buttons += B("main", "Update", R.drawable.lc_download, primary = true) { if (run("install") != null) Ui.toast("${a.name} updated") }
            buttons += B(if (buttons.isNotEmpty()) "power" else "main", if (a.enabled) "Turn off" else "Turn on", R.drawable.lc_power, primary = buttons.isEmpty()) { if (a.enabled) run("disable") else turnOn() }
            if (a.enabled) buttons += B("refresh", "Load again", R.drawable.lc_refresh_cw) { run("refresh"); Ui.toast("${a.name} is loading again") }
            if (!a.builtin) buttons += B("remove", "Remove", R.drawable.lc_trash, danger = true) {
                val v = Ui.ask("Remove ${a.name}?", "Its settings are kept, in case you get it again.", listOf(Choice("Remove", "yes", danger = true), Choice("Keep it", "no", primary = true)))
                if (v == "yes" && run("remove") != null) nav.back()
            }
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5))) {
        BackLink(nav, Modifier.focusRequester(back), "Store")
        Column(Modifier.widthIn(max = r(60)), verticalArrangement = Arrangement.spacedBy(r(1))) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.9f))) {
                Box(Modifier.size(r(3.6f)).clip(RoundedCornerShape(r(0.6f))).background(Color(0x10FFFFFF)), contentAlignment = Alignment.Center) {
                    Icon(painterResource(iconOf(a)), null, tint = C.accent, modifier = Modifier.size(r(1.4f)))
                }
                Column {
                    Text(a.name, style = heading(3f))
                    Text("${stateOf(a)} · version ${a.version.ifEmpty { a.storeVersion }} · by ${a.author}", style = body(1f, C.dim))
                }
            }
            if (buttons.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(r(0.7f)), verticalArrangement = Arrangement.spacedBy(r(0.7f))) {
                buttons.forEach { b ->
                    Btn(b.label, b.icon, primary = b.primary, danger = b.danger, modifier = if (b.key == "main") Modifier.focusRequester(main) else req(b.key)) { me.focused = b.key; scope.launch { b.act() } }
                }
            }
            Text(a.description, style = body(1.1f, C.body).copy(lineHeight = r.sp(1.65f)), maxLines = 12, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = r(46)))
            if (a.error.isNotEmpty()) Status(a.error)
            if (a.internet) Note((if (a.hosts.isNotEmpty()) "Fetches from ${a.hosts.joinToString(", ")}${if (a.hostsFromSettings) " and the addresses in its settings" else ""}." else "Fetches only from the addresses in its settings.") + " It can't open the server's files or run programs.")
        }
        if (a.installed && a.settings.isNotEmpty()) {
            Text("Settings", style = heading(1.15f, C.soft), modifier = Modifier.padding(top = r(2), bottom = r(0.8f)))
            Column(Modifier.widthIn(max = r(60)), verticalArrangement = Arrangement.spacedBy(r(0.5f))) {
                a.settings.forEach { s ->
                    val value = when (s.type) { "password" -> if (s.text.isNotEmpty()) "••••••••" else "Not set"; "list" -> "${s.list.size} added"; else -> s.text.ifEmpty { "Not set" } }
                    SettingItem(s.label, s.help, value, if (s.type == "password") R.drawable.lc_key_round else if (s.type == "list") R.drawable.lc_list else R.drawable.lc_type, req("set:" + s.key)) { edit(s) }
                }
            }
            a.settings.firstOrNull { it.type == "list" }?.let { l -> if (l.value is JsonArray) Note(l.list.joinToString("\n")) }
        }
        if (who.person.admin && a.log.isNotEmpty()) {
            Text("What it said lately", style = heading(1.15f, C.soft), modifier = Modifier.padding(top = r(2), bottom = r(0.8f)))
            Text(a.log.joinToString("\n"), style = body(0.85f, C.dim), modifier = Modifier.widthIn(max = r(52)))
        }
    }
    LaunchedEffect(Unit) {
        delay(100)
        val f = me.focused
        try { if (f != null && reqs.containsKey(f)) reqs[f]!!.requestFocus() else if (buttons.isNotEmpty()) main.requestFocus() else back.requestFocus() } catch (_: Exception) {}
    }
    LaunchedEffect(Ui.closed) { val f = me.focused ?: return@LaunchedEffect; delay(80); if (Ui.busy) return@LaunchedEffect; try { (reqs[f] ?: if (f == "main") main else null)?.requestFocus() } catch (_: Exception) {} }
}

/** .item in a .list: an icon, the name with a line under it, the value on the right. */
@Composable
fun SettingItem(label: String, help: String, value: String, icon: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.7f))
    Focusable(modifier.fillMaxWidth(), onClick = onClick) { f ->
        Row(
            Modifier.fillMaxWidth().then(if (f) Modifier.border(r(0.2f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else C.panel2)
                .padding(horizontal = r(1.1f), vertical = r(0.9f)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1)),
        ) {
            Icon(painterResource(icon), null, tint = C.soft, modifier = Modifier.size(r(1.4f)))
            Column(Modifier.weight(1f)) {
                Text(label, style = body(1f))
                if (help.isNotEmpty()) Text(help, style = body(0.9f, C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = r(0.15f)))
            }
            Text(value, style = body(1f, C.soft), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = r(24)))
        }
    }
}
