package app.korie.tv

// Apps on this TV (Apps.tsx): the ones the person may open, as wide tiles; OK opens one.

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.tv.material3.Text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class TvApp(val pkg: String, val label: String, val icon: ImageBitmap?, val launch: Intent)

/** The apps this TV can open (its launcher's list), Korie itself left out. */
fun tvApps(ctx: Context): List<TvApp> {
    val pm = ctx.packageManager
    val seen = mutableSetOf<String>()
    val out = mutableListOf<TvApp>()
    for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
        for (ri in pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(cat), 0)) {
            val pkg = ri.activityInfo.packageName
            if (pkg == ctx.packageName || !seen.add(pkg)) continue
            val launch = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: continue
            val d = try { ri.activityInfo.loadBanner(pm) ?: ri.loadIcon(pm) } catch (_: Exception) { null }
            out += TvApp(pkg, ri.loadLabel(pm).toString(), d?.let { bitmapOf(it) }, launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
    return out.sortedBy { it.label.lowercase() }
}

private fun bitmapOf(d: Drawable): ImageBitmap {
    val w = d.intrinsicWidth.takeIf { it > 0 } ?: 160
    val h = d.intrinsicHeight.takeIf { it > 0 } ?: 90
    val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    d.setBounds(0, 0, w, h)
    d.draw(Canvas(b))
    return b.asImageBitmap()
}

@Composable
fun Apps(me: Me) {
    val r = rem()
    val ctx = LocalContext.current
    val every = remember { tvApps(ctx) }
    val allowed = me.person.apps
    val apps = every.filter { a -> allowed == null || (allowed is JsonPrimitive && allowed.content == "all") || (allowed is JsonArray && allowed.any { it.jsonPrimitive.content == a.pkg }) }
    // Korie learns which apps this TV has, so an admin can choose who may open which
    LaunchedEffect(every.size) {
        if (every.isNotEmpty()) try {
            Korie.api("/api/apps", buildJsonObject {
                put("apps", buildJsonArray { every.forEach { a -> add(buildJsonObject { put("pkg", a.pkg); put("label", a.label) }) } })
            })
        } catch (_: Exception) {}
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(r(11)),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5)),
        horizontalArrangement = Arrangement.spacedBy(r(1)),
        verticalArrangement = Arrangement.spacedBy(r(1.4f)),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) { Top("Apps") }
        itemsIndexed(apps, key = { _, a -> a.pkg }) { _, a ->
            Focusable(Modifier.fillMaxWidth(), onClick = { try { ctx.startActivity(a.launch) } catch (e: Exception) { Ui.toast(e.message ?: "") } }) { f ->
                val shape = RoundedCornerShape(r(0.7f))
                Column {
                    // .card.wide .pic: the icon in the middle of a panel
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(16f / 9f).then(if (f) Modifier.border(r(0.22f), C.accent, shape) else Modifier).clip(shape).background(C.panel),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (a.icon != null) Image(a.icon, null, modifier = Modifier.fillMaxWidth(0.45f))
                    }
                    Text(a.label, style = body(0.95f, if (f) C.ink else C.body), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = r(0.55f)))
                }
            }
        }
        if (apps.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Status("No apps found.") }
    }
}
