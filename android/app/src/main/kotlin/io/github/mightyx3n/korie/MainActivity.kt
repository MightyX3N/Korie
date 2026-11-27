package io.github.mightyx3n.korie

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Korie's link to Android: installed apps, starting them, App Info / Uninstall, and the TV
 * provider (other apps' Continue Watching lists and their own home-screen rows).
 */
class MainActivity : FlutterActivity() {
    private val worker = Executors.newFixedThreadPool(2)
    private var channel: MethodChannel? = null
    private var homeChannel: MethodChannel? = null
    private var permResult: MethodChannel.Result? = null
    /** A .korie file opened from a file manager, waiting for Flutter to ask for it. */
    private var pendingFile: String? = null

    // ------------------------------------------------------------------ the browser

    /**
     * A page open full screen (an add-on's, such as a game stream): every key and the controller go
     * straight to the page, not through Flutter. Only Back from the remote stays Korie's, so a
     * controller's B button (which Android otherwise turns into Back) plays the game.
     */
    @Volatile private var webDirect = false

    private fun findWebView(v: android.view.View?): android.webkit.WebView? {
        KorieWebView.full?.let { return it.web() }
        if (v is android.webkit.WebView && v.isShown) return v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) findWebView(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun fromController(e: android.view.InputEvent): Boolean {
        val s = e.source
        return (s and android.view.InputDevice.SOURCE_GAMEPAD) == android.view.InputDevice.SOURCE_GAMEPAD ||
            (s and android.view.InputDevice.SOURCE_JOYSTICK) == android.view.InputDevice.SOURCE_JOYSTICK
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (webDirect && !(event.keyCode == android.view.KeyEvent.KEYCODE_BACK && !fromController(event))) {
            val wv = findWebView(window.decorView)
            if (wv != null) {
                wv.dispatchKeyEvent(event)
                return true // handled: no Back made from an unused controller button
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(event: android.view.MotionEvent): Boolean {
        if (webDirect && fromController(event)) {
            val wv = findWebView(window.decorView)
            if (wv != null) return wv.dispatchGenericMotionEvent(event) || true
        }
        return super.dispatchGenericMotionEvent(event)
    }

    /** The TV went to sleep: Who's Watching is asked when it is used again. */
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            getSharedPreferences("korie.wake", MODE_PRIVATE).edit().putBoolean("slept", true).apply()
        }
    }

    /**
     * Has the TV slept or restarted since this was last asked? Pressing Home, or Android closing
     * Korie in the background and starting it again, does not count. Clears the answer.
     */
    private fun wokeUp(): Boolean {
        val p = getSharedPreferences("korie.wake", MODE_PRIVATE)
        val boots = try { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT) } catch (e: Exception) { -1 }
        val woke = p.getBoolean("slept", false) || p.getInt("boots", -2) != boots
        p.edit().putBoolean("slept", false).putInt("boots", boots).apply()
        return woke
    }

    private val packagesChanged = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            channel?.invokeMethod("appsChanged", null)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val ch = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "korie/android")
        channel = ch
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "apps" -> background(result) { listApps() }
                "launch" -> result.success(launch(call.arguments as String))
                "appInfo" -> result.success(start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + call.arguments))))
                "uninstall" -> result.success(start(Intent(Intent.ACTION_DELETE, Uri.parse("package:" + call.arguments))))
                "tvSettings" -> result.success(start(Intent(Settings.ACTION_SETTINGS)))
                "tvListingsSupported" -> result.success(listingsSupported())
                "tvListingsGranted" -> result.success(granted())
                "askTvListings" -> askTvListings(result)
                "shelf" -> background(result) { shelf() }
                "openItem" -> result.success(openItem(call.argument<String>("link") ?: "", call.argument<String>("pkg") ?: ""))
                "openUrl" -> result.success(start(Intent(Intent.ACTION_VIEW, Uri.parse(call.arguments as String))))
                "canReadDownloads" -> result.success(canReadDownloads())
                "askReadDownloads" -> result.success(askReadDownloads())
                "downloads" -> background(result) { downloads() }
                "readFile" -> background(result) { readUri(call.arguments as String) }
                "pendingFile" -> { result.success(pendingFile); pendingFile = null }
                "notifAccess" -> result.success(notifAccess())
                "askNotifAccess" -> result.success(start(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")))
                "isDefaultHome" -> result.success(isDefaultHome())
                "askDefaultHome" -> askDefaultHome(result)
                "locationGranted" -> result.success(locationGranted())
                "askLocation" -> askLocation(result)
                "deviceLocation" -> result.success(deviceLocation())
                "media" -> background(result) { media() }
                "versionCode" -> result.success(versionCode())
                "wokeUp" -> result.success(wokeUp())
                "webDirect" -> { webDirect = call.arguments as? Boolean ?: false; if (webDirect) findWebView(window.decorView)?.requestFocus(); result.success(true) }
                "versionName" -> result.success(packageManager.getPackageInfo(packageName, 0).versionName ?: "")
                "installProgress" -> result.success(installProgress)
                "installApk" -> installApk(call.arguments as String, result)
                "mediaAction" -> result.success(mediaAction(call.argument<String>("pkg") ?: "", call.argument<String>("action") ?: ""))
                else -> result.notImplemented()
            }
        }
        homeChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "korie/home")
        flutterEngine.platformViewsController.registry.registerViewFactory("korie/web", KorieWebViewFactory(this, flutterEngine.dartExecutor.binaryMessenger))
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        }
        registerReceiver(packagesChanged, f)
        registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        takeFile(intent)
    }

    /** Home pressed while Korie is already in front: tell Flutter to go back to the dock. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) homeChannel?.invokeMethod("home", null)
        if (takeFile(intent)) channel?.invokeMethod("fileOpened", null)
    }

    private fun takeFile(i: Intent?): Boolean {
        if (i?.action != Intent.ACTION_VIEW) return false
        val u = i.data ?: return false
        pendingFile = u.toString()
        return true
    }

    // ------------------------------------------------------------------ add-on files

    private fun canReadDownloads(): Boolean =
        if (Build.VERSION.SDK_INT >= 30) android.os.Environment.isExternalStorageManager()
        else checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    private fun askReadDownloads(): Boolean {
        if (Build.VERSION.SDK_INT >= 30) {
            if (start(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))) return true
            return start(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        }
        requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE), 8)
        return true
    }

    /** The .korie files in the Download folder, newest first. */
    private fun downloads(): List<Map<String, Any?>> {
        val dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
        val files = dir.listFiles { f -> f.isFile && f.name.lowercase(Locale.ROOT).endsWith(".korie") } ?: return emptyList()
        return files.sortedByDescending { it.lastModified() }.map { mapOf("name" to it.name, "path" to Uri.fromFile(it).toString()) }
    }

    private fun readUri(u: String): ByteArray? {
        val uri = Uri.parse(u)
        val input = if (uri.scheme == "file") java.io.FileInputStream(uri.path!!) else contentResolver.openInputStream(uri)
        return input?.use { s ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(65536)
            var total = 0
            while (true) {
                val n = s.read(buf); if (n < 0) break
                total += n; if (total > 32 shl 20) throw java.io.IOException("too big")
                out.write(buf, 0, n)
            }
            out.toByteArray()
        }
    }

    override fun onDestroy() {
        stopMedia()
        try { unregisterReceiver(packagesChanged) } catch (_: Exception) {}
        try { unregisterReceiver(screenOff) } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun background(result: MethodChannel.Result, work: () -> Any?) {
        worker.execute {
            val v = try { work() } catch (e: Exception) { android.util.Log.w("Korie", "work: $e"); null }
            runOnUiThread { result.success(v) }
        }
    }

    private fun start(i: Intent): Boolean = try {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); true
    } catch (e: Exception) { false }

    // ------------------------------------------------------------------ apps

    private fun listApps(): List<Map<String, Any?>> {
        val pm = packageManager
        val seen = LinkedHashMap<String, Map<String, Any?>>()
        for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            for (r in pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(cat), 0)) {
                val ai = r.activityInfo
                val pkg = ai.packageName
                if (pkg == packageName || seen.containsKey(pkg)) continue
                val banner = ai.loadBanner(pm) ?: ai.applicationInfo.loadBanner(pm)
                val icon = r.loadIcon(pm)
                val iconBmp = draw(icon, 128, 128)
                seen[pkg] = mapOf(
                    "id" to pkg,
                    "label" to r.loadLabel(pm).toString(),
                    "banner" to banner?.let { png(draw(it, 400, 240)) },
                    "icon" to png(iconBmp),
                    "color" to averageColor(iconBmp),
                    "system" to ((ai.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0),
                )
            }
        }
        return seen.values.toList()
    }

    private fun launch(pkg: String): Boolean {
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
        return i != null && start(i)
    }

    private fun draw(d: Drawable, w: Int, h: Int): Bitmap {
        if (d is BitmapDrawable && d.bitmap != null) return Bitmap.createScaledBitmap(d.bitmap, w, h, true)
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, w, h)
        d.draw(Canvas(b))
        return b
    }

    private fun png(b: Bitmap): ByteArray {
        val out = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray()
    }

    /** A tile colour for apps without a TV banner: the icon's average opaque colour, darkened a little. */
    private fun averageColor(b: Bitmap): Int {
        var r = 0L; var g = 0L; var bl = 0L; var n = 0L
        val s = Bitmap.createScaledBitmap(b, 24, 24, true)
        for (y in 0 until 24) for (x in 0 until 24) {
            val p = s.getPixel(x, y)
            if ((p ushr 24) < 200) continue
            r += (p shr 16) and 0xFF; g += (p shr 8) and 0xFF; bl += p and 0xFF; n++
        }
        if (n == 0L) return 0xFF2C2C30.toInt()
        val k = 0.8
        return (0xFF shl 24) or ((r / n * k).toInt() shl 16) or ((g / n * k).toInt() shl 8) or (bl / n * k).toInt()
    }

    // ------------------------------------------------------------------ TV provider

    private val perm = "android.permission.READ_TV_LISTINGS"

    private fun granted() = Build.VERSION.SDK_INT >= 26 && checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    /**
     * Continue Watching and apps' rows come from the TV's program guide (its TV provider). Phones,
     * tablets and car boxes have none, and there the permission does not even exist.
     */
    private fun listingsSupported(): Boolean {
        if (Build.VERSION.SDK_INT < 26) return false
        val defined = try { packageManager.getPermissionInfo(perm, 0); true } catch (e: Exception) { false }
        return defined && packageManager.resolveContentProvider("android.media.tv", 0) != null
    }

    private fun askTvListings(result: MethodChannel.Result) {
        if (!listingsSupported()) { result.success(false); return }
        if (granted()) { result.success(true); return }
        permResult = result
        requestPermissions(arrayOf(perm), 7)
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == 7) { permResult?.success(granted()); permResult = null }
        if (code == 9) { locResult?.success(locationGranted()); locResult = null }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(code: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(code, resultCode, data)
        if (code == 10) { homeResult?.success(isDefaultHome()); homeResult = null }
    }

    // ------------------------------------------------------------------ updating Korie itself

    private fun versionCode(): Long {
        val pi = packageManager.getPackageInfo(packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }

    /**
     * Downloads the new APK and hands it to Android's installer, which asks the viewer to confirm.
     * Answers "ok", "allow" (the viewer must first allow Korie to install apps; that screen is
     * open) or an error message.
     */
    /** How far the update's download is: 0 to 100, or -1 when the size is not known. */
    @Volatile private var installProgress = 0

    private fun installApk(url: String, result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            start(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            result.success("allow")
            return
        }
        worker.execute {
            val answer = try {
                val pi = packageManager.packageInstaller
                val params = android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                val id = pi.createSession(params)
                pi.openSession(id).use { session ->
                    var conn = URL(url).openConnection() as HttpURLConnection
                    var hops = 0
                    while (conn.responseCode in 300..399 && hops++ < 5) {
                        val next = conn.getHeaderField("Location"); conn.disconnect()
                        conn = URL(URL(url), next).openConnection() as HttpURLConnection
                    }
                    if (conn.responseCode != 200) throw java.io.IOException("the download answered " + conn.responseCode)
                    val total = conn.contentLengthLong
                    installProgress = if (total > 0) 0 else -1
                    conn.inputStream.use { input ->
                        session.openWrite("korie.apk", 0, total.coerceAtLeast(-1)).use { out ->
                            val buf = ByteArray(1 shl 16)
                            var done = 0L
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) installProgress = (done * 100 / total).toInt()
                            }
                            session.fsync(out)
                        }
                    }
                    val i = Intent(this, UpdateReceiver::class.java)
                    val flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) android.app.PendingIntent.FLAG_MUTABLE else 0)
                    session.commit(android.app.PendingIntent.getBroadcast(this, 0, i, flags).intentSender)
                }
                "ok"
            } catch (e: Exception) { e.message ?: e.toString() }
            runOnUiThread { result.success(answer) }
        }
    }

    // ------------------------------------------------------------------ what other apps play (the corner)

    private var sessions: android.media.session.MediaSessionManager? = null
    private val controllers = mutableListOf<android.media.session.MediaController>()
    private val mediaHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val mediaPing = Runnable { channel?.invokeMethod("mediaChanged", null) }
    private fun pingMedia() { mediaHandler.removeCallbacks(mediaPing); mediaHandler.postDelayed(mediaPing, 300) }

    private val controllerCallback = object : android.media.session.MediaController.Callback() {
        override fun onPlaybackStateChanged(state: android.media.session.PlaybackState?) = pingMedia()
        override fun onMetadataChanged(metadata: android.media.MediaMetadata?) = pingMedia()
        override fun onSessionDestroyed() = pingMedia()
    }

    private val sessionsChanged = android.media.session.MediaSessionManager.OnActiveSessionsChangedListener { list -> watch(list) }

    private fun watch(list: List<android.media.session.MediaController>?) = synchronized(controllers) {
        for (c in controllers) try { c.unregisterCallback(controllerCallback) } catch (_: Exception) {}
        controllers.clear()
        for (c in list ?: emptyList()) {
            if (c.packageName == packageName) continue
            controllers.add(c)
            c.registerCallback(controllerCallback, mediaHandler)
        }
        pingMedia()
    }

    /** Starts following other apps' media sessions; needs notification access. */
    @Synchronized
    private fun startMedia(): Boolean {
        if (sessions != null) return true
        if (!notifAccess()) return false
        return try {
            val m = getSystemService(android.media.session.MediaSessionManager::class.java) ?: return false
            val me = android.content.ComponentName(this, KorieNotifications::class.java)
            m.addOnActiveSessionsChangedListener(sessionsChanged, me, mediaHandler)
            sessions = m
            watch(m.getActiveSessions(me))
            true
        } catch (e: SecurityException) { false }
    }

    private fun stopMedia() {
        try { sessions?.removeOnActiveSessionsChangedListener(sessionsChanged) } catch (_: Exception) {}
        synchronized(controllers) {
            for (c in controllers) try { c.unregisterCallback(controllerCallback) } catch (_: Exception) {}
            controllers.clear()
        }
        sessions = null
    }

    /** What other apps are playing or have paused: [{pkg, app, title, sub, playing, art}]. */
    private fun media(): List<Map<String, Any?>>? {
        if (!startMedia()) return null
        val out = mutableListOf<Map<String, Any?>>()
        for (c in synchronized(controllers) { controllers.toList() }) {
            val st = c.playbackState?.state ?: continue
            if (st == android.media.session.PlaybackState.STATE_NONE || st == android.media.session.PlaybackState.STATE_STOPPED || st == android.media.session.PlaybackState.STATE_ERROR) continue
            val md = c.metadata ?: continue
            val title = md.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: md.getString(android.media.MediaMetadata.METADATA_KEY_TITLE) ?: continue
            val artist = md.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: md.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST) ?: ""
            val app = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(c.packageName, 0)).toString() } catch (_: Exception) { c.packageName }
            val bmp = md.getBitmap(android.media.MediaMetadata.METADATA_KEY_ALBUM_ART) ?: md.getBitmap(android.media.MediaMetadata.METADATA_KEY_ART) ?: md.getBitmap(android.media.MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            val art = bmp?.let { png(Bitmap.createScaledBitmap(it, 96, 96 * it.height / maxOf(1, it.width), true)) }
                ?: try { png(draw(packageManager.getApplicationIcon(c.packageName), 96, 96)) } catch (_: Exception) { null }
            out.add(mapOf(
                "pkg" to c.packageName, "app" to app, "title" to title,
                "sub" to listOf(artist, app).filter { it.isNotBlank() }.joinToString(" · "),
                "playing" to (st == android.media.session.PlaybackState.STATE_PLAYING || st == android.media.session.PlaybackState.STATE_BUFFERING),
                "art" to art,
            ))
        }
        return out
    }

    private fun mediaAction(pkg: String, action: String): Boolean {
        val c = synchronized(controllers) { controllers.firstOrNull { it.packageName == pkg } } ?: return false
        val t = c.transportControls
        when (action) {
            "toggle" -> if (c.playbackState?.state == android.media.session.PlaybackState.STATE_PLAYING) t.pause() else t.play()
            "stop" -> t.stop()
            "open" -> {
                val i = c.sessionActivity
                if (i != null) try { i.send(); return true } catch (_: Exception) {}
                return launch(pkg)
            }
        }
        return true
    }

    // ------------------------------------------------------------------ setup: corner, home, location

    /** Korie may see other apps' media sessions (music in the corner) once notification access is on. */
    private fun notifAccess(): Boolean {
        val s = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return s.split(":").any { it.startsWith("$packageName/") }
    }

    private fun isDefaultHome(): Boolean {
        val r = packageManager.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
        return r?.activityInfo?.packageName == packageName
    }

    private var homeResult: MethodChannel.Result? = null
    private fun askDefaultHome(result: MethodChannel.Result) {
        if (isDefaultHome()) { result.success(true); return }
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = getSystemService(android.app.role.RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME)) {
                try {
                    homeResult = result
                    @Suppress("DEPRECATION")
                    startActivityForResult(rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_HOME), 10)
                    return
                } catch (_: Exception) { homeResult = null }
            }
        }
        result.success(start(Intent(Settings.ACTION_HOME_SETTINGS)) && false)
    }

    private val locPerm = Manifest.permission.ACCESS_COARSE_LOCATION
    private var locResult: MethodChannel.Result? = null
    private fun locationGranted() = checkSelfPermission(locPerm) == PackageManager.PERMISSION_GRANTED
    private fun askLocation(result: MethodChannel.Result) {
        if (locationGranted()) { result.success(true); return }
        locResult = result
        requestPermissions(arrayOf(locPerm), 9)
    }

    /** The last place Android knows, from Wi-Fi or GPS: {lat, lon}, or null. */
    private fun deviceLocation(): Map<String, Double>? {
        if (!locationGranted()) return null
        val lm = getSystemService(android.location.LocationManager::class.java) ?: return null
        var best: android.location.Location? = null
        for (p in lm.getProviders(true)) {
            try {
                val l = lm.getLastKnownLocation(p) ?: continue
                if (best == null || l.time > best.time) best = l
            } catch (_: SecurityException) {}
        }
        return best?.let { mapOf("lat" to it.latitude, "lon" to it.longitude) }
    }

    private fun str(c: Cursor, col: String): String {
        val i = c.getColumnIndex(col)
        return if (i < 0 || c.isNull(i)) "" else (c.getString(i) ?: "").trim()
    }

    private fun num(c: Cursor, col: String, def: Long): Long {
        val i = c.getColumnIndex(col)
        return if (i < 0 || c.isNull(i)) def else c.getLong(i)
    }

    private fun installed(pkg: String) = try { packageManager.getApplicationInfo(pkg, 0); true } catch (e: Exception) { false }

    private fun appLabel(pkg: String) = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() } catch (e: Exception) { pkg }

    private fun appIcon(pkg: String): ByteArray? = try { png(draw(packageManager.getApplicationIcon(pkg), 96, 96)) } catch (e: Exception) { null }

    /** Continue Watching (Watch Next) first, then the rows apps publish for the home screen. */
    private fun shelf(): Map<String, Any?> {
        if (!granted()) return mapOf("granted" to false, "items" to emptyList<Any>())
        val items = ArrayList<Map<String, Any?>>()
        items.addAll(watchNext())
        items.addAll(appRows(items.map { (it["pkg"] as String) + "|" + norm(it["title"] as String) }.toSet()))
        return mapOf("granted" to true, "items" to items)
    }

    private fun norm(s: String) = s.lowercase(Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    private fun watchNext(): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        val perApp = HashMap<String, Int>()
        val shows = HashSet<String>()
        val now = System.currentTimeMillis()
        try {
            contentResolver.query(Uri.parse("content://android.media.tv/watch_next_program"), null, null, null,
                "last_engagement_time_utc_millis DESC")?.use { c ->
                while (c.moveToNext() && out.size < 12) {
                    val pkg = str(c, "package_name"); val title = str(c, "title")
                    if (pkg.isEmpty() || title.isEmpty() || pkg == packageName || !installed(pkg)) continue
                    if (num(c, "browsable", 1) == 0L) continue
                    val type = num(c, "watch_next_type", 0).toInt()   // 0 continue, 1 next, 2 new, 3 watchlist
                    if (type == 3) continue
                    var played = num(c, "last_engagement_time_utc_millis", 0)
                    if (played in 1 until 100_000_000_000L) played *= 1000
                    if (played > 0 && now - played > 60L * 24 * 3600 * 1000) continue      // not played for 60 days
                    val pos = num(c, "last_playback_position_millis", 0); val dur = num(c, "duration_millis", 0)
                    val scale = dur == 100L || dur == 1000L || dur == 10_000L || dur == 100_000L
                    if (!scale && dur in 1 until 10 * 60_000) continue                       // clips, trailers
                    var progress = -1.0; var left = -1
                    if (type == 0 && dur > 0 && pos in 1..dur) {
                        progress = pos.toDouble() / dur
                        if (progress >= 0.95) continue                                      // finished
                        if (!scale) { if (dur - pos < 2 * 60_000) continue; left = maxOf(1, ((dur - pos) / 60_000).toInt()) }
                    }
                    if (!shows.add(pkg + "|" + norm(title))) continue                       // one per show per app
                    val n = perApp[pkg] ?: 0
                    if (n >= 3) continue
                    perApp[pkg] = n + 1
                    out.add(mapOf(
                        "kind" to "continue", "pkg" to pkg, "app" to appLabel(pkg), "appIcon" to appIcon(pkg),
                        "key" to "wn|$pkg|${num(c, "_id", 0)}|$played",
                        "title" to title, "episode" to episode(c),
                        "overview" to str(c, "short_description"),
                        "tag" to when (type) { 1 -> "Up Next"; 2 -> "New"; else -> "" },
                        "left" to left, "progress" to progress,
                        "link" to str(c, "intent_uri"), "art" to loadArt(art(c)),
                    ))
                }
            }
        } catch (e: Exception) { android.util.Log.w("Korie", "watch next: $e") }
        return out
    }

    /** Apps' own rows (preview channels): at most two items per app and eight in all, taken in turn. */
    private fun appRows(skip: Set<String>): List<Map<String, Any?>> {
        val byApp = LinkedHashMap<String, ArrayList<Map<String, Any?>>>()
        try {
            val channels = HashMap<Long, String>()
            contentResolver.query(Uri.parse("content://android.media.tv/channel"), null, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    if (str(c, "type") != "TYPE_PREVIEW") continue
                    if (num(c, "browsable", 1) == 0L) continue
                    val pkg = str(c, "package_name")
                    if (pkg.isEmpty() || pkg == packageName || !installed(pkg)) continue
                    channels[num(c, "_id", -1)] = pkg
                }
            }
            contentResolver.query(Uri.parse("content://android.media.tv/preview_program"), null, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val pkg = channels[num(c, "channel_id", -1)] ?: continue
                    if (num(c, "browsable", 1) == 0L) continue
                    val title = str(c, "title")
                    if (title.isEmpty() || skip.contains(pkg + "|" + norm(title))) continue
                    val list = byApp.getOrPut(pkg) { ArrayList() }
                    if (list.size >= 2) continue
                    list.add(mapOf("pkg" to pkg, "title" to title, "episode" to episode(c), "overview" to str(c, "short_description"),
                        "link" to str(c, "intent_uri"), "artUri" to art(c), "key" to "row|$pkg|${num(c, "_id", 0)}"))
                }
            }
        } catch (e: Exception) { android.util.Log.w("Korie", "app rows: $e") }
        val out = ArrayList<Map<String, Any?>>()
        var round = 0
        while (out.size < 8) {
            var added = false
            for ((pkg, list) in byApp) {
                if (round < list.size && out.size < 8) {
                    val it = list[round]
                    out.add(mapOf("kind" to "app", "pkg" to pkg, "app" to appLabel(pkg), "appIcon" to appIcon(pkg),
                        "key" to it["key"], "title" to it["title"], "episode" to it["episode"], "overview" to it["overview"],
                        "tag" to "", "left" to -1, "progress" to -1.0, "link" to it["link"], "art" to loadArt(it["artUri"] as String)))
                    added = true
                }
            }
            if (!added) break
            round++
        }
        return out
    }

    private fun episode(c: Cursor): String {
        val s = str(c, "season_display_number"); val e = str(c, "episode_display_number"); val t = str(c, "episode_title")
        val b = StringBuilder()
        if (s.isNotEmpty()) b.append('S').append(s)
        if (e.isNotEmpty()) b.append(if (b.isNotEmpty()) " " else "").append('E').append(e)
        if (t.isNotEmpty()) b.append(if (b.isNotEmpty()) " " else "").append(t)
        return b.toString()
    }

    /** Wide artwork is used for the carousel; tall posters only when there is nothing else. */
    private fun art(c: Cursor): String {
        val poster = str(c, "poster_art_uri"); val thumb = str(c, "thumbnail_uri")
        val ratio = num(c, "poster_art_aspect_ratio", -1)
        if (poster.isNotEmpty() && ratio in 0..2) return poster
        return thumb.ifEmpty { poster }
    }

    /** Artwork as JPEG bytes, at most 1280 wide (enough for a TV, light to hold in memory). */
    private fun loadArt(uri: String): ByteArray? {
        if (uri.isEmpty()) return null
        return try {
            val bytes = if (uri.startsWith("http")) {
                val con = URL(uri).openConnection() as HttpURLConnection
                con.connectTimeout = 6000; con.readTimeout = 8000
                con.inputStream.use { it.readBytes() }
            } else contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() } ?: return null
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            var sample = 1
            while (o.outWidth / (sample * 2) >= 1280) sample *= 2
            val b = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
            val out = ByteArrayOutputStream()
            b.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray()
        } catch (e: Exception) { null }
    }

    private fun openItem(link: String, pkg: String): Boolean {
        if (link.isNotEmpty()) {
            try {
                var i = if (link.startsWith("intent:") || link.startsWith("#Intent")) Intent.parseUri(link, Intent.URI_INTENT_SCHEME)
                        else Intent(Intent.ACTION_VIEW, Uri.parse(link))
                i.selector = null
                if (i.`package` == null && i.component == null) {
                    val own = Intent(i).setPackage(pkg)
                    if (own.resolveActivity(packageManager) != null) i = own
                }
                if (start(i)) return true
            } catch (e: Exception) { android.util.Log.w("Korie", "open: $e") }
        }
        return launch(pkg)
    }
}
