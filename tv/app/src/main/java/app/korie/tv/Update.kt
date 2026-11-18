package app.korie.tv

// Updating the TV app itself: GitHub Actions builds every new version and puts it in the newest
// release on GitHub (korie-tv.apk and version.json). The app looks there when it starts and in
// Settings, About; Update downloads it and hands it to Android's installer. Every version is
// signed with the same key, so it installs over the one before and keeps its settings.

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

object Update {
    private val RELEASES = BuildConfig.UPDATES
    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    /** Asked about once since the app started: not again until next time. */
    var asked = false

    data class Newer(val code: Int, val version: String)

    fun installed(ctx: Context): Pair<Int, String> {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else @Suppress("DEPRECATION") pi.versionCode
        return code to (pi.versionName ?: "")
    }

    /** The newest version on GitHub, when it's newer than this one. */
    suspend fun check(ctx: Context): Newer? = withContext(Dispatchers.IO) {
        val res = http.newCall(Request.Builder().url(RELEASES + "version.json").build()).execute()
        res.use {
            if (it.code == 404) throw Exception("There's no TV app release on GitHub yet.")
            if (!it.isSuccessful) throw Exception("GitHub answered ${it.code}.")
            val o = Json.parseToJsonElement(it.body!!.string()).jsonObject
            val n = Newer(o["versionCode"]!!.jsonPrimitive.int, o["version"]?.jsonPrimitive?.content ?: "")
            if (n.code > installed(ctx).first) n else null
        }
    }

    /** Downloads the new version and opens Android's installer (asking for the right to, the first time). */
    suspend fun install(ctx: Context, n: Newer) {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            Ui.message("Allow Korie to install its updates", "Android asks once: in the next screen, turn on \"Allow from this source\" for Korie, then press Back. The update carries on by itself.")
            try {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {
                ctx.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            // waits (up to 5 minutes) for the switch to be turned on
            var waited = 0
            while (!ctx.packageManager.canRequestPackageInstalls()) {
                if (waited++ > 300) return
                kotlinx.coroutines.delay(1000)
            }
        }
        Ui.toast("Downloading Korie ${n.version}…")
        val file = withContext(Dispatchers.IO) {
            val dir = File(ctx.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
            val f = File(dir, "korie-tv.apk")
            http.newCall(Request.Builder().url(RELEASES + "korie-tv.apk").build()).execute().use { res ->
                if (!res.isSuccessful) throw Exception("GitHub answered ${res.code}")
                f.outputStream().use { out -> res.body!!.byteStream().copyTo(out) }
            }
            f
        }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".updates", file)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** At the start: says so when there's a new version (once per start). */
    suspend fun offer(ctx: Context, quiet: Boolean = true) {
        val n = try { check(ctx) } catch (e: Exception) { if (!quiet) Ui.message("Couldn't look for updates", e.message ?: "No answer from GitHub."); return }
        if (n == null) { if (!quiet) Ui.message("Korie is up to date", "This is the newest TV app (${installed(ctx).second})."); return }
        if (quiet && asked) return
        asked = true
        val v = Ui.ask("A new Korie TV app", "Version ${n.version} is ready (this is ${installed(ctx).second}).", listOf(Choice("Update now", "yes", R.drawable.lc_download, primary = true), Choice("Later", "no")))
        if (v == "yes") try { install(ctx, n) } catch (e: Exception) { Ui.message("Couldn't update", e.message ?: "") }
    }
}
