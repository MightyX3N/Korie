package app.korie.tv

import androidx.compose.ui.focus.focusRequester

import androidx.compose.ui.focus.FocusRequester

import androidx.compose.runtime.DisposableEffect

import androidx.compose.ui.input.key.onPreviewKeyEvent

// Korie's look, as in the web pages' styles.css: the same colours, the same fonts (Barlow and
// Barlow Semi Condensed), and every size in rem, where 1 rem follows the screen (size.ts):
// min(width / 96, height / 54), so 20 px on a 1920x1080 TV.

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object C {
    val ground = Color(0xFF0A1420)
    val rail = Color(0xFF070E17)
    val panel = Color(0xFF16293F)
    val panel2 = Color(0xFF102033)
    val line = Color(0x14FFFFFF)
    val ink = Color(0xFFEAF1F8)
    val body = Color(0xFFC9D6E6)
    val soft = Color(0xFF9FB2C8)
    val dim = Color(0xFF6F8399)
    val accent = Color(0xFF2FB0EA)
    val onAccent = Color(0xFF04131D)
    val warm = Color(0xFFE8A33D)
    val bad = Color(0xFFE86A5C)
    val good = Color(0xFF6CC28A)
}

val Barlow = FontFamily(
    Font(R.font.barlow_regular, FontWeight.Normal),
    Font(R.font.barlow_medium, FontWeight.Medium),
    Font(R.font.barlow_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_bold, FontWeight.Bold),
)
val BarlowSemi = FontFamily(Font(R.font.barlow_semicondensed_semibold, FontWeight.SemiBold))

/** 1 rem on this screen, in dp, and the same as text size. */
class Rem(val dp: Float, private val fontScale: Float) {
    operator fun invoke(n: Float): Dp = (dp * n).dp
    operator fun invoke(n: Int): Dp = (dp * n).dp
    fun sp(n: Float): TextUnit = (dp * n / fontScale).sp
}

val LocalRem = staticCompositionLocalOf { Rem(10f, 1f) }

@Composable
fun rem(): Rem = LocalRem.current

@Composable
fun Look(content: @Composable () -> Unit) {
    val cfg = LocalConfiguration.current
    // everything in rem, from the screen's size; bigger when this device asks for it (Settings, This
    // device, Size), or by itself on a screen that isn't a TV and is short (a car's screen, say),
    // where the TV's sizes come out small
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val tv = (cfg.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK) == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    val pick = UiSize.choice.intValue
    // (automatic: a very wide screen, as cars have, or one that isn't a TV and is short)
    val wide = cfg.screenWidthDp > cfg.screenHeightDp * 2.1f
    val scale = if (pick > 0) pick / 100f else if (wide || (!tv && cfg.screenHeightDp < 520)) 1.3f else 1f
    UiSize.load(ctx)
    val base = minOf(cfg.screenWidthDp / 96f, cfg.screenHeightDp / 54f) * scale
    CompositionLocalProvider(LocalRem provides Rem(base, LocalDensity.current.fontScale)) {
        androidx.tv.material3.MaterialTheme(content = content)
    }
}

/** body { font-family: Barlow; font-size: 1rem } and the headings' Barlow Semi Condensed 600. */
@Composable
fun body(size: Float = 1f, color: Color = C.ink, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontFamily = Barlow, fontSize = rem().sp(size), color = color, fontWeight = weight, lineHeight = rem().sp(size * 1.35f))

@Composable
fun heading(size: Float, color: Color = C.ink) =
    TextStyle(fontFamily = BarlowSemi, fontSize = rem().sp(size), color = color, fontWeight = FontWeight.SemiBold, lineHeight = rem().sp(size * 1.1f))

/**
 * Something the remote can land on and press (the web pages' F). OK presses it; holding OK
 * opens its options (onLong). How it looks focused is up to the caller, from [focused].
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Focusable(
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onLong: (() -> Unit)? = null,
    onFocus: (() -> Unit)? = null,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    // the screen remembers its last focused thing, for coming back to it from the rail
    val memory = LocalFocusMemory.current
    val mine = remember { FocusRequester() }
    DisposableEffect(memory) { onDispose { if (memory?.last === mine) memory.last = null } }
    LaunchedEffect(focused) { if (focused) { memory?.last = mine; onFocus?.invoke() } }
    // holding OK on the remote: the key repeats (or comes marked as a long press), which opens the menu once;
    // the release after it does nothing more. An OK released here that was pressed somewhere else (in a
    // dialog that has just closed) does nothing either.
    var held by remember { mutableStateOf(false) }
    var down by remember { mutableStateOf(false) }
    val keys = Modifier.onPreviewKeyEvent { e ->
        val n = e.nativeKeyEvent
        if (n.keyCode != android.view.KeyEvent.KEYCODE_DPAD_CENTER && n.keyCode != android.view.KeyEvent.KEYCODE_ENTER && n.keyCode != android.view.KeyEvent.KEYCODE_NUMPAD_ENTER) return@onPreviewKeyEvent false
        when {
            n.action == android.view.KeyEvent.ACTION_DOWN && n.repeatCount == 0 && !n.isLongPress -> { down = true; false }
            n.action == android.view.KeyEvent.ACTION_DOWN && onLong != null -> { if (!held) { held = true; onLong() }; true }
            n.action == android.view.KeyEvent.ACTION_DOWN -> true
            n.action == android.view.KeyEvent.ACTION_UP && held -> { held = false; down = false; true }
            n.action == android.view.KeyEvent.ACTION_UP && !down -> true
            n.action == android.view.KeyEvent.ACTION_UP -> { down = false; false }
            else -> false
        }
    }
    Box(modifier.focusRequester(mine).then(keys).combinedClickable(interactionSource = src, indication = null, onClick = onClick)) { content(focused) }
}

/** .btn: panel, ink; .primary: ink on ground; focused: accent with a glow. .icon: square. */
@Composable
fun Btn(
    label: String?,
    icon: Int? = null,
    primary: Boolean = false,
    danger: Boolean = false,
    outline: Boolean = false,
    modifier: Modifier = Modifier,
    onFocus: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    val r = rem()
    val shape = RoundedCornerShape(if (outline) r(2) else r(0.7f))
    Focusable(modifier, onClick = onClick, onFocus = onFocus) { f ->
        val bg = when {
            f && danger -> C.bad
            f -> C.accent
            outline -> Color.Transparent
            primary -> C.ink
            else -> C.panel
        }
        val fg = when {
            f && danger -> Color.White
            f -> C.onAccent
            outline -> C.body
            primary -> C.ground
            else -> C.ink
        }
        Row(
            Modifier
                .then(if (f) Modifier.border(r(0.18f), Color(0x552FB0EA), shape) else Modifier)
                .then(if (outline && !f) Modifier.border(r(0.1f), Color(0x739DB0C4), shape) else Modifier)
                .clip(shape).background(bg)
                .padding(horizontal = if (label == null) r(0.7f) else if (outline) r(1.4f) else r(1.3f), vertical = if (outline) r(0.75f) else r(0.7f)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(r(0.6f)),
        ) {
            if (icon != null) Icon(painterResource(icon), null, tint = fg, modifier = Modifier.size(r(1.2f)))
            if (label != null) Text(label, style = body(1.05f, fg, if (outline) FontWeight.Medium else FontWeight.SemiBold), maxLines = 1)
        }
    }
}

/** .pill: round, panel; .on: ink on ground; focused: accent. .plain: no background. */
@Composable
fun Pill(label: String, on: Boolean, modifier: Modifier = Modifier, icon: Int? = null, plain: Boolean = false, dimmed: Boolean = false, onFocus: (() -> Unit)? = null, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(99))
    Focusable(modifier, onClick = onClick, onFocus = onFocus) { f ->
        val bg = if (f) C.accent else if (on) C.ink else if (plain) Color.Transparent else C.panel
        val fg = if (f) C.onAccent else if (on) C.ground else if (plain) C.soft else C.body
        Row(
            Modifier.clip(shape).background(bg).padding(horizontal = r(1), vertical = r(0.42f)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) Icon(painterResource(icon), null, tint = fg, modifier = Modifier.padding(end = r(0.35f)).size(r(1)))
            Text(label, style = body(1f, fg.copy(alpha = if (dimmed && !f) 0.45f else 1f), FontWeight.Medium), maxLines = 1)
        }
    }
}

/** .item: a line in a list or a menu; focused: panel with an accent ring. */
@Composable
fun ListItem(label: String, modifier: Modifier = Modifier, icon: Int? = null, iconSpace: Boolean = false, onClick: () -> Unit) {
    val r = rem()
    val shape = RoundedCornerShape(r(0.7f))
    Focusable(modifier, onClick = onClick) { f ->
        Row(
            Modifier.fillMaxWidth().then(if (f) Modifier.border(r(0.2f), C.accent, shape) else Modifier).clip(shape).background(if (f) C.panel else C.panel2)
                .padding(horizontal = r(1.1f), vertical = r(0.9f)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(r(1)),
        ) {
            if (icon != null) Icon(painterResource(icon), null, tint = C.soft, modifier = Modifier.size(r(1.4f)))
            else if (iconSpace) Box(Modifier.size(r(1.4f)))
            Text(label, style = body(1f, C.ink))
        }
    }
}

@Composable
fun Clock(size: Float = 1.7f) {
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { delay(15000); now = Date() } }
    Text(SimpleDateFormat("HH:mm", Locale.getDefault()).format(now), style = heading(size))
}

/** .top: the screen's title, a count, what's on the right, the date (Home) and the clock. */
@Composable
fun Top(title: String, count: String? = null, date: Boolean = false, right: @Composable RowScope.() -> Unit = {}) {
    val r = rem()
    Row(Modifier.padding(bottom = r(1.3f)).heightIn(min = r(3)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(r(1.2f))) {
        Text(title, style = heading(2.3f))
        if (count != null) Text(count, style = body(1.1f, C.dim))
        Box(Modifier.weight(1f))
        right()
        if (date) Text(SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEEMMMMd"), Locale.getDefault()).format(Date()), style = body(1f, C.soft), modifier = Modifier.padding(end = r(0.8f)))
        Clock()
    }
}

/** .status: a line of soft text (loading, nothing here, an error). */
@Composable
fun Status(text: String?) {
    if (text.isNullOrEmpty()) return
    val r = rem()
    Text(text, style = body(1.1f, C.soft), modifier = Modifier.padding(vertical = r(1)).widthIn(max = r(46)))
}

fun fmtTime(sec: Double): String {
    val s = maxOf(0L, sec.toLong())
    val h = s / 3600; val m = s % 3600 / 60; val ss = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, ss) else "%d:%02d".format(m, ss)
}

fun fmtRuntime(min: Double): String {
    if (min <= 0) return ""
    val m = Math.round(min).toInt()
    return if (m < 60) "$m min" else if (m % 60 != 0) "${m / 60} h ${m % 60} min" else "${m / 60} h"
}

fun colorOf(hex: String): Color = try { Color(android.graphics.Color.parseColor(hex)) } catch (_: Exception) { C.warm }


/** Keeps the remote's arrows inside (a dialog, the player's controls), while code can still move the focus out. */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun Modifier.trapFocus(): Modifier = this.focusProperties {
    exit = { d ->
        if (d == androidx.compose.ui.focus.FocusDirection.Left || d == androidx.compose.ui.focus.FocusDirection.Right ||
            d == androidx.compose.ui.focus.FocusDirection.Up || d == androidx.compose.ui.focus.FocusDirection.Down
        ) androidx.compose.ui.focus.FocusRequester.Cancel else androidx.compose.ui.focus.FocusRequester.Default
    }
}.then(Modifier.focusGroup())


/** What had the focus last on the screen (the web's focus memory per screen): the rail goes back to it. */
class FocusMemory { var last: FocusRequester? = null }
val LocalFocusMemory = androidx.compose.runtime.staticCompositionLocalOf<FocusMemory?> { null }


/** How big everything is on this device: 0 is automatic, else a percentage (Settings, This device). */
object UiSize {
    val choice = androidx.compose.runtime.mutableIntStateOf(0)
    private var loaded = false
    fun load(ctx: android.content.Context) {
        if (loaded) return
        loaded = true
        choice.intValue = ctx.getSharedPreferences("korie", android.content.Context.MODE_PRIVATE).getInt("uiSize", 0)
    }
    fun set(ctx: android.content.Context, v: Int) {
        choice.intValue = v
        ctx.getSharedPreferences("korie", android.content.Context.MODE_PRIVATE).edit().putInt("uiSize", v).apply()
    }
}
