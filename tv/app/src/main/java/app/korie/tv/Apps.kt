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
import kotlinx.coroutines.launch

class TvApp(val pkg: String, val label: String, val icon: ImageBitmap?, val launch: Intent, val banner: Boolean = false)

// --- Korie as the TV's home screen ---------------------------------------------------------------

/** Is Korie the app the Home button opens? */
fun isHomeApp(ctx: Context): Boolean {
    val ri = ctx.packageManager.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
    return ri?.activityInfo?.packageName == ctx.packageName
}

/** Opens where the TV picks its home app (or its settings, where that page doesn't exist). */
fun askToBeHome(ctx: Context) {
    for (action in listOf(android.provider.Settings.ACTION_HOME_SETTINGS, android.provider.Settings.ACTION_SETTINGS)) {
        try { ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {}
    }
    Ui.toast("This TV doesn't let apps open that setting")
}

// --- which apps are on Home, in which order, and which are hidden (this TV, per person) -----------

object AppPrefs {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("korie.apps", Context.MODE_PRIVATE)
    fun favourites(ctx: Context, person: String): List<String> = prefs(ctx).getString("fav.$person", "")!!.split("|").filter { it.isNotEmpty() }
    fun hidden(ctx: Context, person: String): Set<String> = prefs(ctx).getString("hide.$person", "")!!.split("|").filter { it.isNotEmpty() }.toSet()
    fun setFavourites(ctx: Context, person: String, l: List<String>) { prefs(ctx).edit().putString("fav.$person", l.joinToString("|")).apply(); changed.value++ }
    fun setHidden(ctx: Context, person: String, l: Set<String>) { prefs(ctx).edit().putString("hide.$person", l.joinToString("|")).apply(); changed.value++ }
    /** Bumped on every change, so Home and Apps draw again. */
    val changed = androidx.compose.runtime.mutableIntStateOf(0)
}

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
            val banner = try { ri.activityInfo.loadBanner(pm) ?: pm.getApplicationBanner(pkg) } catch (_: Exception) { null }
            val d = banner ?: try { ri.loadIcon(pm) } catch (_: Exception) { null }
            out += TvApp(pkg, ri.loadLabel(pm).toString(), d?.let { bitmapOf(it) }, launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), banner != null)
        }
    }
    return out.sortedBy { it.label.lowercase() }
}

/** The map and navigation apps on this device: those that open a place (geo:) or a route. */
fun mapApps(ctx: Context): List<TvApp> {
    val pm = ctx.packageManager
    val pkgs = linkedSetOf<String>()
    for (uri in listOf("geo:0,0?q=", "google.navigation:q=0,0")) {
        for (ri in pm.queryIntentActivities(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(uri)), 0)) pkgs += ri.activityInfo.packageName
    }
    pkgs -= ctx.packageName
    return tvApps(ctx).filter { it.pkg in pkgs }
}

private fun bitmapOf(d: Drawable): ImageBitmap {
    val w = d.intrinsicWidth.takeIf { it > 0 } ?: 160
    val h = d.intrinsicHeight.takeIf { it > 0 } ?: 90
    val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    d.setBounds(0, 0, w, h)
    d.draw(Canvas(b))
    return b.asImageBitmap()
}

/** An app's tile: its banner filling the tile, or its icon in the middle with the name under it. */
@Composable
fun AppTile(a: TvApp, modifier: Modifier = Modifier, dim: Boolean = false, onLong: (() -> Unit)? = null, onClick: () -> Unit) {
    val r = rem()
    Focusable(modifier, onClick = onClick, onLong = onLong) { f ->
        val shape = RoundedCornerShape(r(0.7f))
        Column {
            Box(
                Modifier.fillMaxWidth().aspectRatio(16f / 9f).then(if (f) Modifier.border(r(0.22f), C.accent, shape) else Modifier).clip(shape).background(C.panel),
                contentAlignment = Alignment.Center,
            ) {
                if (a.pkg.isEmpty()) androidx.tv.material3.Icon(androidx.compose.ui.res.painterResource(R.drawable.lc_layout_grid), null, tint = if (f) C.ink else C.soft, modifier = Modifier.fillMaxWidth(0.22f).aspectRatio(1f))
                else if (a.icon != null) {
                    if (a.banner) Image(a.icon, null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxSize(), alpha = if (dim) 0.4f else 1f)
                    else Image(a.icon, null, modifier = Modifier.fillMaxWidth(0.38f).aspectRatio(1f), alpha = if (dim) 0.4f else 1f)
                }
            }
            Text(a.label, style = body(0.95f, if (f) C.ink else if (dim) C.dim else C.body), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = r(0.55f)))
        }
    }
}

/** What can be done with an app (hold OK): open it, put it on Home, move it there, hide it. */
fun appMenu(ctx: Context, person: String, a: TvApp, scope: kotlinx.coroutines.CoroutineScope) {
    scope.launch {
        val fav = AppPrefs.favourites(ctx, person)
        val hid = AppPrefs.hidden(ctx, person)
        val i = fav.indexOf(a.pkg)
        val v = Ui.menu(a.label, listOfNotNull(
            Choice("Open", "open", R.drawable.lc_play),
            if (i < 0) Choice("Add to Home", "fav", R.drawable.lc_plus) else Choice("Take off Home", "unfav", R.drawable.lc_list_minus),
            if (i > 0) Choice("Move left on Home", "left", R.drawable.lc_chevron_left) else null,
            if (i >= 0 && i < fav.size - 1) Choice("Move right on Home", "right", R.drawable.lc_chevron_right) else null,
            if (a.pkg in hid) Choice("Show it in Apps again", "show", R.drawable.lc_eye) else Choice("Hide it from Apps", "hide", R.drawable.lc_eye_off),
        )) ?: return@launch
        when (v) {
            "open" -> try { ctx.startActivity(a.launch) } catch (e: Exception) { Ui.toast(e.message ?: "") }
            "fav" -> AppPrefs.setFavourites(ctx, person, fav + a.pkg)
            "unfav" -> AppPrefs.setFavourites(ctx, person, fav - a.pkg)
            "left" -> AppPrefs.setFavourites(ctx, person, fav.toMutableList().apply { add(i - 1, removeAt(i)) })
            "right" -> AppPrefs.setFavourites(ctx, person, fav.toMutableList().apply { add(i + 1, removeAt(i)) })
            "hide" -> AppPrefs.setHidden(ctx, person, hid + a.pkg)
            "show" -> AppPrefs.setHidden(ctx, person, hid - a.pkg)
        }
    }
}

/** The apps this person may open on this TV. */
fun allowedApps(every: List<TvApp>, me: Me): List<TvApp> {
    val allowed = me.person.apps
    return every.filter { a -> allowed == null || (allowed is JsonPrimitive && allowed.content == "all") || (allowed is JsonArray && allowed.any { it.jsonPrimitive.content == a.pkg }) }
}

@Composable
fun Apps(me: Me) {
    val r = rem()
    val ctx = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val every = remember { tvApps(ctx) }
    val apps = allowedApps(every, me)
    val person = me.person.id
    @Suppress("UNUSED_VARIABLE") val tick = AppPrefs.changed.intValue
    val fav = AppPrefs.favourites(ctx, person).mapNotNull { p -> apps.firstOrNull { it.pkg == p } }
    val hid = AppPrefs.hidden(ctx, person)
    val rest = apps.filter { it.pkg !in hid && fav.none { f -> f.pkg == it.pkg } }
    val hidden = apps.filter { it.pkg in hid }
    // Korie learns which apps this TV has, so an admin can choose who may open which
    LaunchedEffect(every.size) {
        if (every.isNotEmpty()) try {
            Korie.api("/api/apps", buildJsonObject {
                put("apps", buildJsonArray { every.forEach { a -> add(buildJsonObject { put("pkg", a.pkg); put("label", a.label) }) } })
            })
        } catch (_: Exception) {}
    }
    val open: (TvApp) -> Unit = { a -> try { ctx.startActivity(a.launch) } catch (e: Exception) { Ui.toast(e.message ?: "") } }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(r(11)),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5)),
        horizontalArrangement = Arrangement.spacedBy(r(1)),
        verticalArrangement = Arrangement.spacedBy(r(1.4f)),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                Top("Apps")
                Text("Hold OK on an app to put it on Home, move it, or hide it.", style = body(0.95f, C.dim), modifier = Modifier.padding(bottom = r(0.4f)))
            }
        }
        if (fav.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) { Text("On Home", style = heading(1.4f, C.soft)) }
            itemsIndexed(fav, key = { _, a -> "f:" + a.pkg }) { _, a -> AppTile(a, Modifier.fillMaxWidth(), onLong = { appMenu(ctx, person, a, scope) }) { open(a) } }
            item(span = { GridItemSpan(maxLineSpan) }) { Text("All apps", style = heading(1.4f, C.soft), modifier = Modifier.padding(top = r(0.6f))) }
        }
        itemsIndexed(rest, key = { _, a -> a.pkg }) { _, a -> AppTile(a, Modifier.fillMaxWidth(), onLong = { appMenu(ctx, person, a, scope) }) { open(a) } }
        if (hidden.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) { Text("Hidden", style = heading(1.4f, C.dim), modifier = Modifier.padding(top = r(0.6f))) }
            itemsIndexed(hidden, key = { _, a -> "h:" + a.pkg }) { _, a -> AppTile(a, Modifier.fillMaxWidth(), dim = true, onLong = { appMenu(ctx, person, a, scope) }) { open(a) } }
        }
        if (apps.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Status("No apps found.") }
    }
}


/** Maps: the device's map and navigation apps, to open from Korie (in the car, say). */
@Composable
fun MapsScreen(me: Me) {
    val r = rem()
    val ctx = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val apps = remember { allowedApps(mapApps(ctx), me) }
    val open: (TvApp) -> Unit = { a -> try { ctx.startActivity(a.launch) } catch (e: Exception) { Ui.toast(e.message ?: "") } }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(r(11)),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = r(2.2f), bottom = r(5)),
        horizontalArrangement = Arrangement.spacedBy(r(1)),
        verticalArrangement = Arrangement.spacedBy(r(1.4f)),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) { Top("Maps") }
        if (apps.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Status("No map apps on this device.") }
        itemsIndexed(apps, key = { _, a -> a.pkg }) { _, a -> AppTile(a, onLong = { appMenu(ctx, me.person.id, a, scope) }) { open(a) } }
    }
}
