package app.korie.tv

import androidx.compose.ui.focus.onFocusChanged

import kotlinx.coroutines.launch

import androidx.compose.foundation.layout.fillMaxHeight

import androidx.compose.foundation.layout.height

import androidx.compose.foundation.layout.IntrinsicSize

import androidx.compose.ui.input.key.onPreviewKeyEvent

// What sits on top of a screen (ui.tsx): a message with buttons, a menu, the PIN pad and the
// toast at the bottom. Each one takes the remote until it's answered; Back answers "nothing".

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay

data class Choice(val label: String, val value: String, val icon: Int? = null, val primary: Boolean = false, val danger: Boolean = false)

private sealed class Layer(val done: CompletableDeferred<String?>) {
    class Ask(val title: String, val text: String, val choices: List<Choice>, d: CompletableDeferred<String?>) : Layer(d)
    class Menu(val title: String, val choices: List<Choice>, d: CompletableDeferred<String?>) : Layer(d)
    class Pin(val title: String, d: CompletableDeferred<String?>) : Layer(d)
    class TextIn(val title: String, val value: String, val secret: Boolean, val hint: String, d: CompletableDeferred<String?>) : Layer(d)
}

object Ui {
    private val layers = mutableStateListOf<Layer>()
    private val mainScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main)
    private var toastText by mutableStateOf("")
    private var toastSeq by mutableStateOf(0)

    val busy: Boolean get() = layers.isNotEmpty()

    /** Counts closed overlays: the screen under one puts the focus back where it was (BackToCard). */
    var closed by mutableStateOf(0)
        private set

    private suspend fun show(l: Layer): String? {
        layers.add(l)
        try { return l.done.await() } finally {
            layers.remove(l)
            // counted a moment later, and only if no other dialog followed this one (a walk through folders)
            mainScope.launch { kotlinx.coroutines.delay(60); if (layers.isEmpty()) closed++ }
        }
    }

    suspend fun ask(title: String, text: String, choices: List<Choice>): String? = show(Layer.Ask(title, text, choices, CompletableDeferred()))
    suspend fun message(title: String, text: String) { ask(title, text, listOf(Choice("OK", "ok", primary = true))) }
    suspend fun menu(title: String, choices: List<Choice>): String? = show(Layer.Menu(title, choices, CompletableDeferred()))
    suspend fun pin(title: String): String? = show(Layer.Pin(title, CompletableDeferred()))
    suspend fun text(title: String, value: String = "", secret: Boolean = false, hint: String = ""): String? = show(Layer.TextIn(title, value, secret, hint, CompletableDeferred()))
    fun toast(text: String) { toastText = text; toastSeq++ }

    @Composable
    fun Host() {
        val top = layers.lastOrNull()
        if (top != null) Overlay(top)
        if (toastText.isNotEmpty()) {
            val r = rem()
            LaunchedEffect(toastSeq) { delay(2800); toastText = "" }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                Text(
                    toastText, style = body(1.05f),
                    modifier = Modifier.padding(bottom = r(2)).shadow(r(1), RoundedCornerShape(r(0.8f))).clip(RoundedCornerShape(r(0.8f))).background(C.panel)
                        .padding(horizontal = r(1.4f), vertical = r(0.8f)),
                )
            }
        }
    }

    /** .overlay and .dialog: a dark veil, a panel in the middle; the focus can't leave it. */
    @OptIn(ExperimentalComposeUiApi::class)
    @Composable
    private fun Overlay(l: Layer) {
        val r = rem()
        val first = remember(l) { FocusRequester() }
        val inside = remember(l) { androidx.compose.runtime.mutableStateOf(false) }
        BackHandler { l.done.complete(null) }
        Box(Modifier.fillMaxSize().background(Color(0xD9050B12)).padding(r(1.5f)), contentAlignment = Alignment.Center) {
            val width = when (l) { is Layer.Menu -> r(30); is Layer.Pin -> r(26); is Layer.TextIn -> r(44); else -> r(46) }
            Column(
                Modifier.widthIn(max = width).fillMaxWidth().shadow(r(2), RoundedCornerShape(r(1.1f))).clip(RoundedCornerShape(r(1.1f))).background(C.panel2)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = r(2.4f), vertical = r(2.2f))
                    .onFocusChanged { inside.value = it.hasFocus }
                    .trapFocus(),
                verticalArrangement = Arrangement.spacedBy(if (l is Layer.Menu) r(0.3f) else r(1.2f)),
                horizontalAlignment = if (l is Layer.Pin) Alignment.CenterHorizontally else Alignment.Start,
            ) {
                when (l) {
                    is Layer.Ask -> {
                        Text(l.title, style = heading(2f))
                        if (l.text.isNotEmpty()) Text(l.text, style = body(1.1f, C.body))
                        val pick = maxOf(0, l.choices.indexOfFirst { it.primary })
                        Row(horizontalArrangement = Arrangement.spacedBy(r(0.7f))) {
                            l.choices.forEachIndexed { i, c ->
                                Btn(c.label, c.icon, primary = c.primary, danger = c.danger, modifier = if (i == pick) Modifier.focusRequester(first) else Modifier) { l.done.complete(c.value) }
                            }
                        }
                    }
                    is Layer.Menu -> {
                        if (l.title.isNotEmpty()) Text(l.title, style = heading(1.3f, C.soft), modifier = Modifier.padding(bottom = r(0.6f)))
                        val ticks = l.choices.any { it.label.startsWith("✓ ") }
                        l.choices.forEachIndexed { i, c ->
                            val ticked = c.label.startsWith("✓ ")
                            ListItem(
                                if (ticked) c.label.drop(2) else c.label, icon = if (ticked) R.drawable.lc_check else c.icon, iconSpace = ticks,
                                modifier = Modifier.fillMaxWidth().then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                            ) { l.done.complete(c.value) }
                        }
                    }
                    is Layer.Pin -> PinPad(l, first)
                    is Layer.TextIn -> TextEntry(l, first)
                }
            }
        }
        // the dialog takes the focus, and takes it back whenever something under it grabs it (for as long as it's open)
        LaunchedEffect(l) {
            delay(60)
            while (!l.done.isCompleted) {
                if (!inside.value) try { first.requestFocus() } catch (_: Exception) {}
                delay(250)
            }
        }
    }

    /** Four digits; the fourth answers by itself. */
    @Composable
    private fun PinPad(l: Layer.Pin, first: FocusRequester) {
        val r = rem()
        var pin by remember { mutableStateOf("") }
        Text(l.title, style = heading(2f).copy(textAlign = TextAlign.Center))
        Row(Modifier.padding(top = r(0.4f), bottom = r(0.6f)), horizontalArrangement = Arrangement.spacedBy(r(1))) {
            for (i in 0 until 4) Box(Modifier.size(r(1)).clip(CircleShape).background(if (i < pin.length) C.accent else Color(0x22FFFFFF)))
        }
        LaunchedEffect(pin) { if (pin.length == 4) { delay(120); l.done.complete(pin) } }
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "✕", "0", "⌫")
        // digits typed on a keyboard (or a remote's number keys) count too; Backspace deletes
        Column(Modifier.onPreviewKeyEvent { e ->
            val n = e.nativeKeyEvent
            if (n.action != android.view.KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
            val d = n.unicodeChar.toChar()
            when {
                n.keyCode == android.view.KeyEvent.KEYCODE_DEL -> { pin = pin.dropLast(1); true }
                d in '0'..'9' && n.keyCode != android.view.KeyEvent.KEYCODE_DPAD_CENTER -> { if (pin.length < 4) pin += d; true }
                else -> false
            }
        }, verticalArrangement = Arrangement.spacedBy(r(0.7f))) {
            for (row in 0 until 4) {
                // a grid row: its keys as tall as the tallest
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(r(0.7f))) {
                    for (col in 0 until 3) {
                        val k = keys[row * 3 + col]
                        Key(k, Modifier.width(r(4.6f)).fillMaxHeight().then(if (k == "1") Modifier.focusRequester(first) else Modifier), size = 1.6f, padV = 0.8f) {
                            when (k) {
                                "✕" -> l.done.complete(null)
                                "⌫" -> pin = pin.dropLast(1)
                                else -> if (pin.length < 4) pin += k
                            }
                        }
                    }
                }
            }
        }
    }
}

private val KEYS = "abcdefghijklmnopqrstuvwxyz0123456789.-_:/@".map { it.toString() }

/** The on-screen keyboard (ui.tsx TextEntry): the text in a field, keys, Done and Cancel. */
@Composable
private fun TextEntry(l: Layer.TextIn, first: FocusRequester) {
    val r = rem()
    var text by remember(l) { mutableStateOf(l.value) }
    var upper by remember(l) { mutableStateOf(false) }
    Text(l.title, style = heading(2f))
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(r(0.7f))).background(C.ground)
            .border(r(0.12f), C.accent, RoundedCornerShape(r(0.7f))).padding(horizontal = r(1), vertical = r(0.8f)),
    ) { Text((if (l.secret) "•".repeat(text.length) else text) + "▏", style = body(1.4f)) }
    if (l.hint.isNotEmpty()) Text(l.hint, style = body(0.95f, C.dim))
    val keys = KEYS.map { if (upper) it.uppercase() else it }
    // a real keyboard types too; Enter after typing is Done, the remote's OK presses the focused key
    var typed by remember(l) { mutableStateOf(false) }
    Column(Modifier.onPreviewKeyEvent { e ->
        val n = e.nativeKeyEvent
        if (n.action != android.view.KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
        when {
            n.keyCode == android.view.KeyEvent.KEYCODE_ENTER -> if (typed) { l.done.complete(text); true } else false
            n.keyCode == android.view.KeyEvent.KEYCODE_DEL -> { text = text.dropLast(1); typed = true; true }
            n.keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER -> { typed = false; false }
            n.unicodeChar != 0 && !n.isCtrlPressed && !Character.isISOControl(n.unicodeChar) -> { text += String(Character.toChars(n.unicodeChar)); typed = true; true }
            else -> false
        }
    }, verticalArrangement = Arrangement.spacedBy(r(0.4f))) {
        keys.chunked(10).forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(r(0.4f))) {
                line.forEach { k -> Key(k, Modifier.weight(1f).then(if (k.equals("a", true)) Modifier.focusRequester(first) else Modifier)) { text += k } }
                repeat(10 - line.size) { Box(Modifier.weight(1f)) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(r(0.4f))) {
            Key(if (upper) "abc" else "ABC", Modifier.weight(1f)) { upper = !upper }
            Key("Space", Modifier.weight(1f)) { text += " " }
            Key("⌫", Modifier.weight(1f)) { text = text.dropLast(1) }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(r(0.7f))) {
        Btn("Done", R.drawable.lc_check, primary = true) { l.done.complete(text) }
        Btn("Cancel") { l.done.complete(null) }
    }
}

/** .key: a key of the on-screen keyboard or the PIN pad; focused: accent. */
@Composable
fun Key(label: String, modifier: Modifier = Modifier, size: Float = 1.1f, padV: Float = 0.55f, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.45f))
    Focusable(modifier, onClick = onClick) { f ->
        Box(Modifier.fillMaxSize().clip(shape).background(if (f) C.accent else C.panel).padding(vertical = r(padV)), contentAlignment = Alignment.Center) {
            if (label == "⌫") Icon(painterResource(R.drawable.lc_delete), null, tint = if (f) C.onAccent else C.ink, modifier = Modifier.size(r(1.4f)))
            else Text(label, style = body(size, if (f) C.onAccent else C.ink))
        }
    }
}
