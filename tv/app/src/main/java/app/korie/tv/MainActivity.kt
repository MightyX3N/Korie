package app.korie.tv

// The frame (App.tsx): finding Korie, Who's watching, then the rail on the left and the screen
// on top of the stack beside it. Back goes down the stack; the player has the whole screen.

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A screen on the stack: its name and what it was opened with (nav.tsx). */
class Screen(val name: String, first: Map<String, String> = emptyMap()) {
    /** What it was opened with; a filter or a source changes it in place (the screen stays). */
    var params by mutableStateOf(first)
    val key: String = java.util.UUID.randomUUID().toString()
    /** What had the focus here when another screen opened on top; it gets it back. */
    var focused: String? = null
}

class Nav(first: String = "home") {
    val stack = mutableStateListOf(Screen(first))
    val top: Screen get() = stack.last()
    fun push(name: String, params: Map<String, String> = emptyMap()) { stack.add(Screen(name, params)) }
    /** A section from the rail: it replaces everything. */
    fun go(name: String) { stack.clear(); stack.add(Screen(name)) }
    fun replace(params: Map<String, String>) { top.params = top.params + params }
    fun back(): Boolean = if (stack.size > 1) { stack.removeAt(stack.lastIndex); true } else false
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Korie.load(this)
        Music.init(this)
        setContent { Look { App() } }
    }

    // the Home button, with Korie as the home screen: back to Korie's Home
    // away for 5 minutes or more (standby, another app) counts as a new start
    private var awayAt = 0L
    override fun onStop() { super.onStop(); awayAt = System.currentTimeMillis() }
    override fun onStart() {
        super.onStart()
        if (awayAt > 0 && System.currentTimeMillis() - awayAt >= 5 * 60_000) Korie.restarted++
        awayAt = 0
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(android.content.Intent.CATEGORY_HOME)) Korie.goHome.tryEmit(Unit)
    }
}

@Composable
fun App() {
    val ctx = LocalContext.current
    var stage by remember { mutableStateOf(if (Korie.server.isEmpty()) "connect" else "check") }
    var me by remember { mutableStateOf<Me?>(null) }
    val scope = rememberCoroutineScope()
    // the PIN of the person this TV starts as, when it asks for it at start
    var pinFor by remember { mutableStateOf<Person?>(null) }
    // only when the app starts: after that, whoever picks themselves in Who's watching is who it is
    var started by remember { mutableStateOf(false) }
    LaunchedEffect(stage) {
        if (stage == "check") {
            val first = !started
            started = true
            // this TV's own person (Settings, This device) comes first
            val a = if (first) Korie.autoStart(ctx) else null
            if (a?.needPin == true && a.person != null) { pinFor = a.person; stage = "pin"; return@LaunchedEffect }
            if (a?.token != null) Korie.setToken(ctx, a.token)
            me = if (Korie.token.isNotEmpty()) Korie.meOrNull() else null
            stage = if (me != null) "signed" else "people"
        }
        if (stage == "pin") {
            val p = pinFor ?: run { stage = "people"; return@LaunchedEffect }
            while (true) {
                val pin = Ui.pin("${p.name}'s PIN")
                if (pin == null) { Music.stop(); Korie.signOut(ctx); me = null; stage = "people"; return@LaunchedEffect }
                // (the next step runs as its own effect: this one is cancelled by the change)
                try { Korie.login(ctx, p.id, pin); stage = "check2"; return@LaunchedEffect } catch (e: Exception) { Ui.toast(e.message ?: "") }
            }
        }
        if (stage == "check2") {
            me = Korie.meOrNull()
            stage = if (me != null) "signed" else "people"
        }
    }
    // back after a while (the TV slept, or another app was open): the PIN again when this TV asks for it
    LaunchedEffect(Korie.restarted) {
        if (Korie.restarted == 0 || stage != "signed") return@LaunchedEffect
        val a = Korie.autoStart(ctx) ?: return@LaunchedEffect
        // only when it's still this TV's own person (someone who switched to themselves stays)
        if (a.needPin && a.person != null && me?.person?.id == a.person.id) { Music.stop(); pinFor = a.person; me = null; stage = "pin" }
    }
    // a new TV app is offered on any screen, even before there's a Korie to talk to
    LaunchedEffect(Unit) { delay(4000); Update.offer(ctx) }
    LaunchedEffect(Korie.forgotten) { if (Korie.forgotten > 0) { Music.stop(); me = null; stage = "connect" } }
    // what Korie knows about this person again (after a change in Settings, or to add-ons and people)
    val refresh: () -> Unit = { scope.launch { Korie.meOrNull()?.let { me = it } } }
    LaunchedEffect(stage) {
        if (stage == "signed") Korie.changes.collect { w -> if ("addons" in w || "people" in w) refresh() }
    }
    Box(Modifier.fillMaxSize().background(C.ground)) {
        when (stage) {
            "connect" -> Connect { url -> Korie.setServer(ctx, url); stage = "check" }
            "people" -> Profiles(onSignedIn = { stage = "check" }, onOtherServer = { stage = "connect" }, onManage = { t -> Korie.useToken(t); stage = "manage" })
            "signed" -> me?.let { m -> Signed(m, refresh) { Music.stop(); Korie.signOut(ctx); me = null; stage = "people" } }
            "manage" -> ManagePeople { scope.launch { Korie.logoutToken(Korie.token) }; Korie.useToken(""); stage = "people" }
        }
        Ui.Host()
    }
}

/** Settings › People on its own, from Who's watching, as an admin for a while; Back closes it (and signs the admin out). */
@Composable
fun ManagePeople(done: () -> Unit) {
    var me by remember { mutableStateOf<Me?>(null) }
    LaunchedEffect(Unit) { me = Korie.meOrNull(); if (me == null) done() }
    val nav = remember { Nav("people") }
    val m = me ?: return
    BackHandler(enabled = !Ui.busy) { if (!nav.back()) done() }
    LaunchedEffect(Unit) { Korie.listen() }
    People(nav, nav.top, m) { }
}

private data class RailItem(val id: String, val label: String, val icon: Int)

private val SECTIONS = listOf(
    RailItem("home", "Home", R.drawable.lc_home),
    RailItem("films", "Films", R.drawable.lc_film),
    RailItem("series", "Series", R.drawable.lc_tv),
    RailItem("music", "Music", R.drawable.lc_music),
    RailItem("live", "Live TV", R.drawable.lc_radio),
    RailItem("calendar", "Calendar", R.drawable.lc_calendar_days),
    RailItem("games", "Games", R.drawable.lc_gamepad_2),
    RailItem("store", "Add-ons", R.drawable.lc_puzzle),
    RailItem("maps", "Maps", R.drawable.lc_navigation),
    RailItem("apps", "Apps", R.drawable.lc_layout_grid),
    RailItem("search", "Search", R.drawable.lc_search),
    RailItem("settings", "Settings", R.drawable.lc_settings),
)

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Signed(me: Me, refresh: () -> Unit, signOut: () -> Unit) {
    val r = rem()
    val nav = remember { Nav() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { Korie.listen() }
    // a new version of the TV app on GitHub: offered once, a little after starting
    val holder = rememberSaveableStateHolder()
    val railFocus = remember { SECTIONS.associate { it.id to FocusRequester() } }
    val content = remember { FocusRequester() }
    // Back: down the stack; on a section's first screen, to Home; on Home, out of the app
    BackHandler(enabled = !Ui.busy && (nav.stack.size > 1 || nav.stack[0].name != "home")) {
        if (!nav.back()) { nav.go("home"); scope.launch { delay(150); try { railFocus["home"]?.requestFocus() } catch (_: Exception) {} } }
    }
    // Korie as the home screen: Back on Home stays (there's nothing under it), Home goes to Home
    val ctx = LocalContext.current
    BackHandler(enabled = !Ui.busy && nav.stack.size == 1 && nav.stack[0].name == "home" && isHomeApp(ctx)) { }
    LaunchedEffect(Unit) {
        Korie.goHome.collect { nav.go("home"); delay(150); try { railFocus["home"]?.requestFocus() } catch (_: Exception) {} }
    }
    val top = nav.top
    val section = nav.stack[0].name
    // the screen starts with the menu's own entry focused (Home on Home)
    LaunchedEffect(me.person.id) { delay(150); try { railFocus[section]?.requestFocus() } catch (_: Exception) {} }
    if (top.name == "player") {
        holder.SaveableStateProvider(top.key) { Player(nav, top) }
        // a film or a channel stops the music that was playing
        LaunchedEffect(top.key) { Music.stop() }
        return
    }
    Row(Modifier.fillMaxSize()) {
        // .rail
        // (it scrolls when the screen is short, or everything is made bigger; the person stays at the bottom otherwise)
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.width(r(13.5f)).fillMaxHeight().background(C.rail)) {
        val railHeight = maxHeight
        Column(
            Modifier.fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).heightIn(min = railHeight).padding(start = r(0.8f), end = r(0.8f), top = r(2.2f), bottom = r(1.4f))
                .focusProperties { enter = { railFocus[section] ?: FocusRequester.Default } }
                .focusGroup(),
            verticalArrangement = Arrangement.spacedBy(r(0.25f)),
        ) {
            Row(Modifier.padding(start = r(0.8f), end = r(0.8f), bottom = r(1.6f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.6f))) {
                Box(Modifier.size(r(0.75f)).clip(RoundedCornerShape(r(0.18f))).background(C.accent))
                Text("korie", style = heading(1.6f))
            }
            // Games when an add-on has games, Music unless this person may not
            // Maps only on a device with map apps (a car's screen, say)
            val hasMaps = remember(me.person.id) { allowedApps(mapApps(ctx), me).isNotEmpty() }
            val sections = SECTIONS.filter { (it.id != "games" || me.games) && (it.id != "music" || me.person.music != false) && (it.id != "maps" || hasMaps) }
            for (s in sections) {
                val active = section == s.id
                Focusable(Modifier.fillMaxWidth().focusRequester(railFocus[s.id]!!), onClick = {
                    if (active && nav.stack.size == 1) try { content.requestFocus() } catch (_: Exception) {} else nav.go(s.id)
                }) { f ->
                    val shape = RoundedCornerShape(r(0.7f))
                    Box(Modifier.fillMaxWidth().clip(shape).background(if (f) C.accent else if (active) Color(0x0DFFFFFF) else Color.Transparent)) {
                        Row(Modifier.heightIn(min = r(2.75f)).padding(horizontal = r(0.9f), vertical = r(0.62f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.9f))) {
                            val c = if (f) C.onAccent else if (active) C.ink else C.soft
                            Icon(painterResource(s.icon), null, tint = c, modifier = Modifier.size(r(1.3f)))
                            Text(s.label, style = body(1.12f, c, FontWeight.Medium))
                        }
                        // .nav.active::before: the accent mark on the left
                        if (active && !f) Box(Modifier.matchParentSize().padding(vertical = r(0.5f)), contentAlignment = Alignment.CenterStart) {
                            Box(Modifier.width(r(0.22f)).fillMaxHeight().clip(RoundedCornerShape(r(0.2f))).background(C.accent))
                        }
                    }
                }
            }
            Box(Modifier.weight(1f))
            // .who: who's signed in; OK switches person
            Focusable(Modifier.fillMaxWidth(), onClick = signOut) { f ->
                val shape = RoundedCornerShape(r(0.7f))
                Row(
                    Modifier.fillMaxWidth().then(if (f) Modifier.border(r(0.18f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else Color.Transparent)
                        .padding(horizontal = r(0.7f), vertical = r(0.55f)),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.7f)),
                ) {
                    Box(Modifier.size(r(2.2f)).clip(CircleShape).background(colorOf(me.person.color)), contentAlignment = Alignment.Center) {
                        Text(me.person.name.take(1).uppercase(), style = body(1f, C.ground, FontWeight.SemiBold))
                    }
                    Column {
                        Text(me.person.name, style = body(1f))
                        Text("Switch person", style = body(0.8f, C.dim))
                    }
                }
            }
        }
        }
        // .main: the screen on top of the stack
        val memory = remember { FocusMemory() }
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Box(Modifier.weight(1f).fillMaxWidth().focusRequester(content).focusProperties { enter = { memory.last ?: FocusRequester.Default } }.focusGroup()) {
                androidx.compose.runtime.CompositionLocalProvider(LocalFocusMemory provides memory) {
                    holder.SaveableStateProvider(top.key) { ScreenFor(nav, top, me, refresh, signOut) }
                }
            }
            // music or a radio station keeps playing while you look around: its bar along the bottom
            if (top.name != "nowplaying") MusicBar(nav)
        }
    }
}

@Composable
fun ScreenFor(nav: Nav, s: Screen, me: Me, refresh: () -> Unit, signOut: () -> Unit) {
    when (s.name) {
        "home" -> Home(nav, s, me)
        "films" -> Library(nav, s, "films", "Films")
        "series" -> Library(nav, s, "series", "Series")
        "music" -> MusicScreen(nav, s)
        "live" -> LiveScreen(nav, s)
        "calendar" -> RowsScreen(nav, s, "Calendar", listOf("calendar", "library")) { Korie.calendar() }
        "guide" -> GuideScreen(nav, s)
        "games" -> RowsScreen(nav, s, "Games", listOf("browse", "addons")) { Korie.read(Korie.api("/api/games")) }
        "apps" -> Apps(me)
        "maps" -> MapsScreen(me)
        "page" -> AddonPage(nav, s)
        "item" -> Item(nav, s, me)
        "search" -> SearchScreen(nav, s)
        "store" -> Store(nav, s, me)
        "addon" -> AddonInfo(nav, s, me)
        "settings" -> Settings(nav, s, me, refresh, signOut)
        "people" -> People(nav, s, me, refresh)
        "nowplaying" -> NowPlaying(nav)
        else -> Column(Modifier.padding(rem()(3.4f))) { Text("Not found", style = heading(2.3f)) }
    }
}
