package app.korie.tv

// The player (Player.tsx). Korie says how something plays: as it is (ExoPlayer seeks itself), or
// as a stream Korie makes as it goes (seeking asks for a new stream from that point). Subtitles
// are drawn here, so they look the same everywhere. OK pauses, Left/Right jump, Up/Down show the
// controls, Back leaves.

import android.net.Uri
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class Cue(val start: Double, val end: Double, val text: String)

private fun parseVtt(text: String): List<Cue> {
    fun t(s: String): Double {
        val p = s.trim().split(":").map { it.replace(',', '.').toDoubleOrNull() ?: 0.0 }
        return if (p.size == 3) p[0] * 3600 + p[1] * 60 + p[2] else if (p.size == 2) p[0] * 60 + p[1] else 0.0
    }
    val cues = mutableListOf<Cue>()
    for (block in text.replace("\r", "").split(Regex("\n\n+"))) {
        val lines = block.split("\n")
        val i = lines.indexOfFirst { it.contains("-->") }
        if (i < 0) continue
        val (a, b) = lines[i].split("-->")
        val body = lines.drop(i + 1).joinToString("\n").replace(Regex("<[^>]+>"), "").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim()
        if (body.isNotEmpty()) cues += Cue(t(a), t(b.trim().split(Regex("\\s"))[0]), body)
    }
    return cues
}

@OptIn(UnstableApi::class)
@kotlin.OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Player(nav: Nav, me: Screen) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val r = rem()
    val scope = rememberCoroutineScope()
    val exo = remember { ExoPlayer.Builder(ctx).build() }
    var id by remember { mutableStateOf(me.params["id"] ?: "") }
    val mode = me.params["mode"] ?: "resume"
    var plan by remember { mutableStateOf<Play?>(null) }
    var offset by remember { mutableDoubleStateOf(0.0) } // where the stream started (stream mode)
    var now by remember { mutableDoubleStateOf(0.0) }
    var paused by remember { mutableStateOf(false) }
    var waiting by remember { mutableStateOf(true) }
    var osd by remember { mutableStateOf(true) }
    var idle by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var panel by remember { mutableStateOf(false) }
    var subId by remember { mutableStateOf<String?>(null) }
    var cues by remember { mutableStateOf<List<Cue>>(emptyList()) }
    var pendingSeek by remember { mutableStateOf<Double?>(null) }
    var triedStream by remember { mutableStateOf(false) }
    var introDone by remember { mutableStateOf(false) }
    var lastSave by remember { mutableLongStateOf(0L) }
    val playBtn = remember { FocusRequester() }
    val subsBtn = remember { FocusRequester() }
    val panelFirst = remember { FocusRequester() }
    val skipBtn = remember { FocusRequester() }
    var seekFocused by remember { mutableStateOf(false) }

    fun time(): Double = offset + exo.currentPosition / 1000.0
    fun duration(): Double = plan?.duration?.takeIf { it > 0 } ?: (exo.duration.takeIf { it > 0 }?.let { offset + it / 1000.0 } ?: 0.0)

    fun save(ended: Boolean = false) {
        val p = plan ?: return
        // live, and a channel from the library: nothing to come back to
        if (p.live || p.channel != null) return
        val position = time()
        if (!ended && position < 5) return
        val dur = if (p.duration > 0) p.duration else position
        scope.launch { Korie.progress(p.id, if (ended) dur else position, dur, ended) }
    }

    /** Start at a time: a file seeks itself; a stream starts again there (a copied one at a key frame). */
    suspend fun start(p: Play, at: Double, after: Boolean = false) {
        waiting = true
        var s = maxOf(0.0, at)
        if (p.mode == "direct") {
            offset = 0.0
            exo.setMediaItem(MediaItem.fromUri(Uri.parse(Korie.url(p.url))))
            exo.prepare()
            exo.seekTo((s * 1000).toLong())
        } else {
            if (s > 0 && !p.live) {
                val m = Regex("/api/stream/([^?]+)\\?(.*)$").find(p.url)
                val v = m?.groupValues?.get(2)?.split("&")?.firstOrNull { it.startsWith("v=") }?.removePrefix("v=") ?: "copy"
                if (m != null) s = Korie.seekStart(m.groupValues[1], s, v, after)
            }
            offset = s
            exo.setMediaItem(MediaItem.fromUri(Uri.parse(Korie.url(p.url) + if (s > 0) "&start=%.3f".format(java.util.Locale.ROOT, s) else "")))
            exo.prepare()
        }
        exo.playWhenReady = true
    }

    suspend fun load(audio: Int? = null, burn: Int? = null, at: Double? = null, forceStream: Boolean = false, pin: String? = null, nextProgramme: Boolean = false) {
        waiting = true
        val p = try {
            Korie.play(id, audio, burn, forceStream, pin)
        } catch (e: Exception) {
            // a PIN that can't unlock it: the programme stays covered
            if (pin != null) { waiting = false; Ui.message("That PIN can't unlock this", e.message ?: ""); return }
            Ui.message("Couldn't play this", e.message ?: "")
            nav.back()
            return
        }
        if (p.web != null) {
            // a game: its own web player (RomM), on its own screen; Back returns
            view.context.startActivity(android.content.Intent(view.context, WebActivity::class.java).putExtra("url", Korie.url(p.web)))
            nav.back()
            return
        }
        plan = p
        // above this person's age limit: covered until someone types their PIN
        if (p.locked) { exo.stop(); exo.clearMediaItems(); waiting = false; return }
        // a channel is where it's at now (the next programme from its start, when it's only just begun)
        val start = if (p.channel != null) (if (nextProgramme && p.resume < 20) 0.0 else p.resume)
            else at ?: if (mode == "resume" && p.resume > 30) p.resume else 0.0
        if (audio == null && burn == null) subId = p.subs.firstOrNull { it.isDefault && !it.burn }?.id
        start(p, start)
    }

    LaunchedEffect(id) { triedStream = false; introDone = false; load() }

    // subtitles: fetched as text and drawn here
    LaunchedEffect(subId, plan) {
        val s = plan?.subs?.firstOrNull { it.id == subId }
        cues = if (s == null || s.url.isEmpty()) emptyList() else try { parseVtt(Korie.text(s.url)) } catch (_: Exception) { emptyList() }
    }

    // time, progress and hiding the controls
    LaunchedEffect(Unit) {
        while (true) {
            delay(250)
            now = time()
            if (exo.isPlaying && System.currentTimeMillis() - idle > 4500 && !panel) osd = false
            if (System.currentTimeMillis() - lastSave > 10000) { lastSave = System.currentTimeMillis(); save() }
        }
    }

    fun poke() { idle = System.currentTimeMillis(); osd = true }

    fun seekTo(t: Double, after: Boolean = false) {
        val p = plan ?: return
        if (p.live || p.channel != null) return
        val target = maxOf(0.0, minOf(t, (if (p.duration > 0) p.duration else Double.MAX_VALUE) - 2))
        if (p.mode == "direct") exo.seekTo((target * 1000).toLong()) else scope.launch { start(p, target, after) }
        now = target
    }

    fun jump(d: Double) { poke(); pendingSeek = maxOf(0.0, (pendingSeek ?: time()) + d) }

    // a jump settles for a moment before it's done, so pressing right five times is one seek
    LaunchedEffect(pendingSeek) {
        val t = pendingSeek ?: return@LaunchedEffect
        delay(650)
        seekTo(t)
        pendingSeek = null
    }

    fun togglePause() { poke(); if (exo.isPlaying) exo.pause() else exo.play() }

    fun next(): Boolean {
        val n = plan?.next ?: return false
        save(true)
        id = n
        return true
    }

    // the intro: skipped by itself, or a Skip intro button while it plays (Back hides it)
    val intro = plan?.intro
    val inIntro = intro != null && now >= intro.start && now < intro.end - 1
    LaunchedEffect(inIntro) {
        if (intro != null && now < intro.start) introDone = false
        if (inIntro && intro?.auto == true && !introDone) { introDone = true; seekTo(intro.end, true); Ui.toast("Skipped the intro") }
    }
    val showSkip = inIntro && intro?.auto != true && !introDone
    LaunchedEffect(showSkip) { if (showSkip) { delay(50); try { skipBtn.requestFocus() } catch (_: Exception) {} } }

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { paused = !isPlaying && exo.playbackState == Player.STATE_READY && !exo.playWhenReady; if (!isPlaying) poke() }
            override fun onPlaybackStateChanged(state: Int) {
                waiting = state == Player.STATE_BUFFERING || state == Player.STATE_IDLE
                if (state == Player.STATE_ENDED) {
                    // a channel: the next programme
                    if (plan?.channel != null) { scope.launch { load(nextProgramme = true) }; return }
                    save(true); if (!next()) nav.back()
                }
            }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { paused = !playWhenReady }
            override fun onPlayerError(e: PlaybackException) {
                val p = plan
                // it said it could play it but couldn't: let Korie convert it
                if (p != null && p.mode == "direct" && !triedStream) {
                    triedStream = true
                    scope.launch { load(at = time(), forceStream = true) }
                    return
                }
                val tok = p?.url?.let { Regex("/api/stream/([^?]+)").find(it)?.groupValues?.get(1) }
                scope.launch {
                    var why = if (tok != null) Korie.streamError(tok) else ""
                    if (why.isEmpty()) why = if (p?.mode == "direct") "this device couldn't decode it" else "the server couldn't make a stream of it"
                    Ui.message("Couldn't play this", "\"${p?.title ?: ""}\" stopped: $why.")
                    nav.back()
                }
            }
        }
        exo.addListener(l)
        onDispose {
            save()
            exo.removeListener(l)
            exo.release()
            view.keepScreenOn = false
        }
    }

    BackHandler(enabled = panel || showSkip) {
        if (panel) { panel = false; scope.launch { delay(30); try { subsBtn.requestFocus() } catch (_: Exception) {} } }
        else introDone = true
    }

    // with the controls hidden the player itself holds the focus, so the remote's keys reach it
    val root = remember { FocusRequester() }
    LaunchedEffect(osd, showSkip, plan?.locked) {
        delay(30)
        if (plan?.locked == true) return@LaunchedEffect
        try { if (osd && !panel) playBtn.requestFocus() else if (!osd && !showSkip) root.requestFocus() } catch (_: Exception) {}
    }

    val p = plan
    val chan = p?.channel
    val locked = p?.locked == true
    val coverBtn = remember { FocusRequester() }
    // covered: when the programme ends, see whether the next one is alright
    LaunchedEffect(locked, chan?.programme?.end) {
        if (!locked || chan == null) return@LaunchedEffect
        delay(80)
        try { coverBtn.requestFocus() } catch (_: Exception) {}
        delay(maxOf(1000L, chan.programme.end * 1000 - System.currentTimeMillis() + 800))
        load()
    }
    val dur = duration()
    val progress = if (dur > 0) minOf(1.0, (pendingSeek ?: now) / dur) else 0.0
    val sub = cues.firstOrNull { now >= it.start && now <= it.end + 0.05 }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown || Ui.busy || locked) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.MediaPlayPause, Key.Spacebar -> { togglePause(); return@onPreviewKeyEvent true }
                    Key.MediaNext -> { next(); return@onPreviewKeyEvent true }
                    Key.MediaFastForward -> { jump(30.0); return@onPreviewKeyEvent true }
                    Key.MediaRewind -> { jump(-10.0); return@onPreviewKeyEvent true }
                }
                // while "Skip intro" shows, OK skips
                if (showSkip && intro != null && (e.key == Key.DirectionCenter || e.key == Key.Enter) && !osd) { introDone = true; seekTo(intro.end, true); return@onPreviewKeyEvent true }
                if (osd) { idle = System.currentTimeMillis(); return@onPreviewKeyEvent false }
                when (e.key) {
                    Key.DirectionLeft -> { jump(-10.0); true }
                    Key.DirectionRight -> { jump(30.0); true }
                    Key.DirectionCenter, Key.Enter -> { togglePause(); true }
                    Key.DirectionUp, Key.DirectionDown -> { poke(); true }
                    else -> false
                }
            }
            .focusRequester(root).focusable(),
    ) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    subtitleView?.visibility = android.view.View.GONE
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    player = exo
                    isFocusable = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                }
            },
            modifier = Modifier.fillMaxSize().focusProperties { canFocus = false },
        )
        // .subs: drawn here, higher up while the controls show
        if (sub != null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                // .subs / .subs.up, with its 0.2s move
                val lift by androidx.compose.animation.core.animateDpAsState(if (osd) r(13) else r(4.3f), tween(200), label = "subs")
                SubLines(sub.text, Modifier.fillMaxWidth(0.88f).padding(bottom = lift))
            }
        }
        if (waiting) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner() }
        // covered: above this person's age limit
        if (locked && chan != null) {
            Box(Modifier.fillMaxSize().background(C.ground), contentAlignment = Alignment.Center) {
                Column(Modifier.widthIn(max = r(50)).padding(r(2)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(r(1.2f))) {
                    Text("${chan.name}: for older viewers", style = heading(2.4f))
                    Text("What's on now until ${hhmm(chan.programme.end)} is above your age limit.${chan.next?.let { " Next at ${hhmm(it.start)}: ${it.title}." } ?: ""}",
                        style = body(1.2f, C.body).copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center))
                    Row(horizontalArrangement = Arrangement.spacedBy(r(0.8f))) {
                        Btn("Type a PIN", R.drawable.lc_lock, primary = true, modifier = Modifier.focusRequester(coverBtn)) {
                            scope.launch {
                                val pin = Ui.pin("The PIN of someone who may watch it") ?: return@launch
                                load(pin = pin)
                            }
                        }
                        Btn("Back") { nav.back() }
                    }
                }
            }
        }
        // .osd
        // .osd, fading in and out in 0.25s
        androidx.compose.animation.AnimatedVisibility(osd && !locked, enter = androidx.compose.animation.fadeIn(tween(250)), exit = androidx.compose.animation.fadeOut(tween(250))) {
            Column(
                Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0xAA000000), 0.25f to Color(0x00000000), 0.6f to Color(0x00000000), 1f to Color(0xDD000000))),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.padding(horizontal = gutter(), vertical = r(2.2f))) {
                    Text(p?.title ?: me.params["title"] ?: "", style = heading(2.2f))
                    if (!p?.subtitle.isNullOrEmpty()) Text(p!!.subtitle, style = body(1.1f, C.soft))
                }
                Column(
                    Modifier.padding(start = gutter(), end = gutter(), bottom = r(2.4f)).trapFocus(),
                    verticalArrangement = Arrangement.spacedBy(r(1)),
                ) {
                    // a channel: how far into the programme, and what's next
                    if (chan != null) {
                        val nowS = System.currentTimeMillis() / 1000.0
                        val frac = ((nowS - chan.programme.start) / maxOf(1L, chan.programme.end - chan.programme.start)).coerceIn(0.0, 1.0)
                        Box(Modifier.fillMaxWidth().height(r(0.45f)).clip(RoundedCornerShape(r(0.3f))).background(Color(0x33FFFFFF))) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(frac.toFloat()).clip(RoundedCornerShape(r(0.3f))).background(C.accent))
                        }
                        Text("${chan.name} · until ${hhmm(chan.programme.end)}${chan.next?.let { " · Next: ${it.title} at ${hhmm(it.start)}" } ?: ""}", style = body(1.1f, C.soft))
                    }
                    if (p?.live != true && chan == null) {
                        // .seek: focused, Left/Right jump and OK pauses
                        Focusable(
                            Modifier.fillMaxWidth().onPreviewKeyEvent { e ->
                                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                when (e.key) { Key.DirectionLeft -> { jump(-10.0); true }; Key.DirectionRight -> { jump(30.0); true }; else -> false }
                            },
                            onClick = { togglePause() },
                            onFocus = { seekFocused = true },
                        ) { f ->
                            seekFocused = f
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1))) {
                                Text(fmtTime(pendingSeek ?: now), style = body(1.1f))
                                Box(Modifier.weight(1f).height(r(1.2f)), contentAlignment = Alignment.CenterStart) {
                                    Box(Modifier.fillMaxWidth().height(if (f) r(0.6f) else r(0.45f)).clip(RoundedCornerShape(r(0.3f))).background(Color(0x33FFFFFF))) {
                                        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.toFloat()).clip(RoundedCornerShape(r(0.3f))).background(C.accent))
                                    }
                                    if (f) Box(Modifier.fillMaxWidth(progress.toFloat().coerceAtLeast(0.001f)), contentAlignment = Alignment.CenterEnd) {
                                        Box(Modifier.offset(x = r(0.6f)).size(r(1.2f)).clip(CircleShape).background(Color.White))
                                    }
                                }
                                Text(if (dur > 0) fmtTime(dur) else "", style = body(1.1f))
                            }
                        }
                    }
                    // .ctl
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(0.7f))) {
                        if (p?.live != true && chan == null) Btn(null, R.drawable.lc_rotate_ccw) { jump(-10.0) }
                        Btn(null, if (paused) R.drawable.lc_play else R.drawable.lc_pause, modifier = Modifier.focusRequester(playBtn)) { togglePause() }
                        if (p?.live != true && chan == null) Btn(null, R.drawable.lc_rotate_cw) { jump(30.0) }
                        if (p?.next != null) Btn("Next", R.drawable.lc_skip_forward) { next() }
                        Box(Modifier.weight(1f))
                        if (p != null && (p.audio.size > 1 || p.subs.isNotEmpty())) {
                            Btn("Audio & subtitles", R.drawable.lc_subtitles, modifier = Modifier.focusRequester(subsBtn)) {
                                panel = true
                                scope.launch { delay(50); try { panelFirst.requestFocus() } catch (_: Exception) {} }
                            }
                        }
                    }
                }
            }
        }
        // .panel: audio and subtitles
        if (panel && p != null) {
            Column(
                Modifier.align(Alignment.BottomEnd).padding(end = gutter(), bottom = r(9)).width(r(26)).heightIn(max = r(32))
                    .clip(RoundedCornerShape(r(1))).background(Color(0xF20A1420)).verticalScroll(rememberScrollState()).padding(r(0.8f))
                    .trapFocus(),
                verticalArrangement = Arrangement.spacedBy(r(0.5f)),
            ) {
                var firstSet = false
                fun firstMod(): Modifier = if (!firstSet) { firstSet = true; Modifier.focusRequester(panelFirst) } else Modifier
                if (p.audio.size > 1) {
                    Text("Audio", style = heading(0.95f, C.dim), modifier = Modifier.padding(start = r(0.8f), top = r(0.6f), bottom = r(0.3f)))
                    p.audio.forEach { a ->
                        val chosen = a.id.toIntOrNull() == p.audioIndex
                        ListItem(a.label, Modifier.fillMaxWidth().then(firstMod()), icon = if (chosen) R.drawable.lc_check else null, iconSpace = !chosen) {
                            panel = false
                            scope.launch { load(audio = a.id.toIntOrNull(), at = time()) }
                        }
                    }
                }
                Text("Subtitles", style = heading(0.95f, C.dim), modifier = Modifier.padding(start = r(0.8f), top = r(0.6f), bottom = r(0.3f)))
                ListItem("Off", Modifier.fillMaxWidth().then(firstMod()), icon = if (subId == null) R.drawable.lc_check else null, iconSpace = subId != null) { subId = null; panel = false }
                p.subs.forEach { s ->
                    ListItem(s.label, Modifier.fillMaxWidth(), icon = if (subId == s.id) R.drawable.lc_check else null, iconSpace = subId != s.id) {
                        panel = false
                        if (s.burn) scope.launch { load(audio = p.audioIndex, burn = s.id.drop(1).toIntOrNull(), at = time()) } else subId = s.id
                    }
                }
            }
        }
        if (showSkip && intro != null) {
            Box(Modifier.align(Alignment.BottomEnd).padding(end = r(4), bottom = r(8))) {
                Btn("Skip intro", primary = true, modifier = Modifier.focusRequester(skipBtn)) { introDone = true; seekTo(intro.end, true) }
            }
        }
    }
}

/** .subs span: inline text, so each line gets its own dark box (box-decoration-break: clone). */
@Composable
private fun SubLines(text: String, modifier: Modifier) {
    val r = rem()
    var layout by remember { mutableStateOf<androidx.compose.ui.text.TextLayoutResult?>(null) }
    Text(
        text, style = body(2.1f, Color.White).copy(lineHeight = r.sp(3.05f), textAlign = TextAlign.Center),
        onTextLayout = { layout = it },
        modifier = modifier.padding(horizontal = r(0.5f)).drawBehind {
            val l = layout ?: return@drawBehind
            val px = r(0.5f).toPx(); val py = r(0.1f).toPx()
            for (i in 0 until l.lineCount) {
                val a = l.getLineLeft(i); val b = l.getLineRight(i)
                if (b - a < 1f) continue
                // an inline span's background covers the font's box (Barlow: 1em above the baseline, 0.2em below), not the line height
                val em = r(2.1f).toPx(); val base = l.getLineBaseline(i)
                drawRect(Color(0xB3000000), topLeft = Offset(a - px, base - em - py), size = Size(b - a + 2 * px, 1.2f * em + 2 * py))
            }
        },
    )
}

/** .spinner: a ring with an accent part, turning. */
@Composable
fun Spinner() {
    val r = rem()
    val t = rememberInfiniteTransition(label = "spin")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "a")
    Box(Modifier.size(r(3.4f)).drawBehind {
        val w = r(0.32f).toPx()
        drawArc(Color(0x22FFFFFF), 0f, 360f, false, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), style = Stroke(w))
        drawArc(C.accent, a - 90f, 90f, false, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), style = Stroke(w))
    })
}

/** A clock time in this TV's own way of writing it (13:20 or 1:20 PM). */
fun hhmm(t: Long): String = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(t * 1000))
