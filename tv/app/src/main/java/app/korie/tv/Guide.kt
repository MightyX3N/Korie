package app.korie.tv

// The guide (Live › Guide): the channels made from the library down the side, time across, a line
// for now. The programme on now plays its channel; one later says what it is.

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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.fillMaxHeight
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState

@Composable
fun GuideScreen(nav: Nav, me: Screen) {
    val r = rem()
    // from the half hour before now, six hours ahead (a TV draws all of it at once)
    val from = remember { System.currentTimeMillis() / 1000 / 1800 * 1800 - 1800 }
    val hours = 6
    val (data, error) = useData("guide", listOf("channels")) { Korie.guide(from, hours) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); tick++ } }
    val nowS = System.currentTimeMillis() / 1000 + 0 * tick
    val perMin = r(0.32f)
    val side = r(11)
    val rowH = r(5.2f)
    val rulerH = r(2.4f)
    fun xOf(t: Long) = perMin * ((t - from) / 60f)
    val total = perMin * (hours * 60f)
    val firstNow = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(1.5f))) {
        BackLink(nav, label = "Live")
        Top("Guide")
        Status(error.ifEmpty { if (data != null && data.channels.isEmpty()) "No channels yet. They're made from the films and series in your library." else if (data == null) "Loading…" else "" })
        val d = data ?: return@Column
        if (d.channels.isEmpty()) return@Column
        val hs = rememberScrollState()
        Row(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(r(1))).background(C.panel2).verticalScroll(rememberScrollState())) {
            // the channels' names
            Column(Modifier.width(side)) {
                Spacer(Modifier.height(rulerH))
                d.channels.forEach { c ->
                    Box(Modifier.height(rowH).fillMaxWidth().padding(horizontal = r(1)), contentAlignment = Alignment.CenterStart) {
                        Text(c.name, style = body(1.15f, C.ink, FontWeight.SemiBold), maxLines = 1)
                    }
                }
            }
            Box(Modifier.weight(1f).horizontalScroll(hs)) {
                Column(Modifier.width(total)) {
                    // the times, each half hour
                    Box(Modifier.height(rulerH).fillMaxWidth()) {
                        for (i in 0 until hours * 2) {
                            Text(hhmm(from + i * 1800L), style = body(0.95f, C.soft), modifier = Modifier.offset(x = perMin * (i * 30f) + r(0.4f), y = r(0.6f)))
                        }
                    }
                    d.channels.forEachIndexed { ci, c ->
                        Box(Modifier.height(rowH).fillMaxWidth()) {
                            // at most 40 a channel: very short programmes would make it too much for a TV
                            c.programmes.take(40).forEach { p ->
                                val l = maxOf(0.dp, xOf(p.start))
                                val w = minOf(total, xOf(p.end)) - l
                                if (w > 0.dp) {
                                    val on = p.start <= nowS && p.end > nowS
                                    Focusable(
                                        Modifier.offset(x = l).width(maxOf(w, r(0.8f))).fillMaxHeight().padding(vertical = r(0.3f), horizontal = r(0.1f))
                                            .then(if (on && ci == 0) Modifier.focusRequester(firstNow) else Modifier),
                                        onClick = {
                                            if (p.start <= System.currentTimeMillis() / 1000 && p.end > System.currentTimeMillis() / 1000) nav.push("player", mapOf("id" to c.id, "mode" to "start", "title" to c.name))
                                            else scope.launch { Ui.message(if (p.locked) "For older viewers" else p.title, "${c.name} · ${hhmm(p.start)}–${hhmm(p.end)}${if (p.subtitle.isNotEmpty() && !p.locked) " · " + p.subtitle else ""}${if (p.overview.isNotEmpty()) "\n\n" + p.overview else ""}") }
                                        },
                                    ) { f ->
                                        val shape = RoundedCornerShape(r(0.5f))
                                        Column(
                                            Modifier.fillMaxSize().clip(shape).background(if (f) C.accent else if (on) Color(0xFF1D4664) else C.panel)
                                                .padding(horizontal = r(0.6f)),
                                            verticalArrangement = Arrangement.Center,
                                        ) {
                                            Text(if (p.locked) "For older viewers" else p.title, style = body(1.05f, if (f) C.onAccent else if (p.locked) C.soft else C.ink, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            Text(hhmm(p.start) + if (p.subtitle.isNotEmpty() && !p.locked) " · " + p.subtitle else "", style = body(0.9f, if (f) C.onAccent else C.soft), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // now
                Box(Modifier.offset(x = xOf(nowS)).width(r(0.12f)).height(rulerH + rowH * d.channels.size).background(C.accent))
            }
        }
        // opens on what's on now, on the first channel
        LaunchedEffect(Unit) {
            delay(150)
            try { firstNow.requestFocus() } catch (_: Exception) {}
        }
    }
}
