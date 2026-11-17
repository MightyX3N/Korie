package app.korie.tv

// Cards, rows of cards and grids, as in cards.tsx and styles.css (.card, .row, .strip, .grid).

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage

private val CAPTIONS = mapOf(
    "film" to "Film", "series" to "Series", "episode" to "Episode", "album" to "Music", "track" to "Song", "live" to "Channel",
    "game" to "Game", "page" to "Add-on", "playlist" to "Playlist", "artist" to "Artist", "genre" to "Genre",
)

@Composable
fun pxOf(d: Dp): Int = with(LocalDensity.current) { d.roundToPx() }

/** A picture from Korie at the width it's shown; its title when there's none or it won't load. */
@Composable
fun Picture(src: String, width: Dp, alt: String, modifier: Modifier = Modifier) {
    var failed by remember(src) { mutableStateOf(false) }
    if (src.isEmpty() || failed) {
        // .ph: the title, soft, Barlow Semi Condensed
        Box(modifier.fillMaxSize().padding(rem()(0.8f)), contentAlignment = Alignment.Center) {
            Text(alt, style = heading(1.1f, C.soft).copy(textAlign = TextAlign.Center), maxLines = 5, overflow = TextOverflow.Ellipsis)
        }
    } else {
        AsyncImage(model = Korie.pic(src, pxOf(width)), contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.fillMaxSize(), onError = { failed = true })
    }
}

/** The width of a card of a row's kind (poster 9.6 rem, wide 17, text 12, fav 12.9). */
@Composable
fun cardWidth(shape: String): Dp {
    val r = rem()
    return when (shape) { "wide" -> r(17); "text" -> r(12); "fav" -> r(12.9f); "square" -> r(10.5f); else -> r(9.6f) }
}

@Composable
fun CardView(c: Card, shape: String, modifier: Modifier = Modifier, width: Dp? = null, onFocus: (Card) -> Unit = {}, onOpen: (Card) -> Unit, onMenu: ((Card) -> Unit)? = null) {
    val r = rem()
    val radius = RoundedCornerShape(r(0.7f))
    val w = width ?: cardWidth(shape)
    if (shape == "fav") {
        // a Favourites tile: what it is, small, above its name
        Focusable(modifier.width(w), onClick = { onOpen(c) }, onLong = onMenu?.let { { it(c) } }, onFocus = { onFocus(c) }) { f ->
            Column(
                Modifier.fillMaxWidth().height(r(6.5f)).then(if (f) Modifier.border(r(0.18f), C.accent, radius) else Modifier).clip(radius).background(C.panel)
                    .padding(horizontal = r(1.1f), vertical = r(0.8f)),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(if (c.source.isNotEmpty()) "From ${c.source}" else CAPTIONS[c.kind] ?: "", style = body(0.95f, C.soft), maxLines = 1)
                Text(c.title, style = heading(1.45f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        return
    }
    val wide = shape == "wide"
    val text = shape == "text"
    val src = if (wide) c.thumb.ifEmpty { c.backdrop }.ifEmpty { c.poster } else c.poster.ifEmpty { c.thumb }
    val ratio = when (shape) { "wide" -> 16f / 9f; "square" -> 1f; "text" -> 16f / 7f; else -> 2f / 3f }
    Focusable(modifier.width(w), onClick = { onOpen(c) }, onLong = onMenu?.let { { it(c) } }, onFocus = { onFocus(c) }) { f ->
        Column {
            Box(
                Modifier.fillMaxWidth().aspectRatio(ratio)
                    .then(if (f) Modifier.shadow(r(0.8f), radius).border(r(0.22f), C.accent, radius) else Modifier)
                    .clip(radius)
                    .background(if (text) Brush.linearGradient(listOf(Color(0xFF1B3550), Color(0xFF10223A))) else Brush.linearGradient(listOf(C.panel, C.panel))),
            ) {
                if (text) {
                    Text(c.title, style = heading(1.3f).copy(textAlign = TextAlign.Center), modifier = Modifier.align(Alignment.Center).padding(r(0.6f)), maxLines = 3, overflow = TextOverflow.Ellipsis)
                } else {
                    Picture(src, w, c.title)
                }
                if (c.kind == "live") {
                    Text(
                        "LIVE", style = body(0.7f, Color.White, FontWeight.Bold),
                        modifier = Modifier.padding(r(0.5f)).clip(RoundedCornerShape(r(0.3f))).background(C.bad).padding(horizontal = r(0.4f), vertical = r(0.1f)),
                    )
                }
                if (c.watched && c.kind != "live") {
                    Box(Modifier.align(Alignment.TopEnd).padding(r(0.45f)).size(r(1.4f)).clip(CircleShape).background(Color(0xCC0A1420)), contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.lc_check), null, tint = C.accent, modifier = Modifier.size(r(0.9f)))
                    }
                }
                if (c.progress > 0) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(r(0.28f)).background(Color(0x99000000))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(c.progress.toFloat().coerceIn(0f, 1f)).background(C.accent))
                    }
                }
            }
            if (!text) {
                Text(c.title, style = body(0.95f, if (f) C.ink else C.body), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = r(0.45f)))
                if (c.subtitle.isNotEmpty()) Text(c.subtitle, style = body(0.8f, C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * .row: its title and a strip of cards side by side. The page's own padding (the gutter) is the
 * strip's too, so the first card lines up with the title.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun RowView(row: Row, gutter: Dp, first: FocusRequester? = null, reqFor: ((Card) -> FocusRequester)? = null, onFocus: (Card) -> Unit = {}, onOpen: (Card) -> Unit, onMenu: ((Card) -> Unit)? = null) {
    val r = rem()
    Column(Modifier.fillMaxWidth().padding(bottom = r(1.6f))) {
        if (row.title.isNotEmpty()) Text(row.title, style = heading(1.25f, C.body), modifier = Modifier.padding(start = gutter, bottom = r(0.6f)))
        // coming back into the strip lands on the card that had the focus (by hand: focusRestorer
        // inside a lazy column crashes in this Compose, "Release should only be called once")
        val own = remember(row.id) { mutableMapOf<Int, FocusRequester>() }
        val shown = remember(row.id) { mutableSetOf<Int>() }
        var last by remember(row.id) { mutableStateOf(0) }
        LazyRow(
            modifier = Modifier.focusGroup(),
            contentPadding = PaddingValues(start = gutter, end = gutter, top = r(0.4f), bottom = r(0.6f)),
            horizontalArrangement = Arrangement.spacedBy(r(1)),
        ) {
            itemsIndexed(row.items, key = { i, c -> c.id + i }) { i, c ->
                var m: Modifier = Modifier.focusRequester(own.getOrPut(i) { FocusRequester() })
                DisposableEffect(i) { shown += i; onDispose { shown -= i } }
                if (reqFor != null) m = m.focusRequester(reqFor(c))
                if (i == 0 && first != null) m = m.focusRequester(first)
                CardView(c, row.kind, modifier = m, onFocus = { last = i; onFocus(it) }, onOpen = onOpen, onMenu = onMenu)
            }
        }
    }
}

