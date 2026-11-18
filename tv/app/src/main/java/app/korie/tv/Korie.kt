package app.korie.tv

import android.content.Context
import android.media.MediaCodecList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.isActive
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.TimeUnit

// --- what Korie sends --------------------------------------------------------------------

@Serializable
data class Person(
    val id: String,
    val name: String,
    val color: String = "#e8a33d",
    val hasPin: Boolean = false,
    val admin: Boolean = false,
)

@Serializable
data class MePerson(
    val id: String, val name: String, val color: String = "#e8a33d", val admin: Boolean = false, val canSettings: Boolean = false, val music: Boolean? = null,
    /** "all", or the Android apps this person may open */
    val apps: JsonElement? = null,
    val canInstall: Boolean = false, val canDelete: Boolean = false,
    val hasPin: Boolean = false, val audio: String = "", val subs: String = "", val skipIntro: String = "button",
)

@Serializable
data class ServerInfo(val name: String = "", val version: String = "", val id: String = "")

@Serializable
data class Me(val person: MePerson, val games: Boolean = false, val server: ServerInfo = ServerInfo(), val languages: List<List<String>> = emptyList())

@Serializable
data class Source(val id: String, val name: String)

@Serializable
data class Section(val sources: List<Source> = emptyList(), val source: String = "", val items: List<Card>? = null, val rows: List<Row>? = null, val status: String = "")

@Serializable
data class Card(
    val id: String,
    val kind: String = "",
    val title: String = "",
    val subtitle: String = "",
    val year: String = "",
    val poster: String = "",
    val thumb: String = "",
    val backdrop: String = "",
    val progress: Double = 0.0,
    val watched: Boolean = false,
    val source: String = "",
    val overview: String = "",
    val genres: List<String> = emptyList(),
    val rating: Double = 0.0,
    val runtime: Double = 0.0,
    val album: String? = null,
    val length: Double = 0.0,
    val n: Int = 0,
    val cert: String = "",
)

@Serializable
data class Row(val id: String, val title: String, val kind: String = "poster", val items: List<Card> = emptyList(), val more: Int = 0)

@Serializable
data class Rows(val rows: List<Row> = emptyList(), val loading: Boolean = false, val status: String = "")

@Serializable
data class PageRows(val title: String = "", val rows: List<Row> = emptyList(), val status: String = "")

@Serializable
data class NavItem(val id: String, val title: String)

@Serializable
data class NavList(val items: List<NavItem> = emptyList())

@Serializable
data class CastMember(val name: String = "", val role: String = "", val photo: String = "")

@Serializable
data class Episode(
    val id: String,
    val n: Int = 0,
    val title: String = "",
    val overview: String = "",
    val runtime: Double = 0.0,
    val thumb: String = "",
    val progress: Double = 0.0,
    val watched: Boolean = false,
)

@Serializable
data class Season(val n: Int = 0, val title: String = "", val episodes: List<Episode> = emptyList())

@Serializable
data class Item(
    val id: String,
    val kind: String = "",
    val title: String = "",
    val year: String = "",
    val overview: String = "",
    val genres: List<String> = emptyList(),
    val rating: Double = 0.0,
    val runtime: Double = 0.0,
    val director: String = "",
    val cast: List<CastMember> = emptyList(),
    val poster: String = "",
    val backdrop: String = "",
    val thumb: String = "",
    val favourite: Boolean = false,
    val source: String = "",
    val subtitle: String = "",
    val cert: String = "",
    val position: Double = 0.0,
    val duration: Double = 0.0,
    val watched: Boolean = false,
    val seasons: List<Season> = emptyList(),
    val local: Boolean = false,
    val error: String = "",
    val artist: String? = null,
    val tracks: List<AlbumTrack>? = null,
)

@Serializable
data class AlbumTrack(val id: String, val n: Int = 0, val title: String = "", val artist: String = "", val duration: Double = 0.0, val albumTitle: String = "", val poster: String = "")

@Serializable
data class Track(val id: String, val label: String = "", val lang: String = "", val isDefault: Boolean = false, val url: String = "", val burn: Boolean = false)

@Serializable
data class Intro(val start: Double = 0.0, val end: Double = 0.0, val auto: Boolean = false)

@Serializable
data class Play(
    val mode: String = "stream",
    val url: String = "",
    val duration: Double = 0.0,
    val live: Boolean = false,
    val seekable: Boolean = true,
    val audio: List<Track> = emptyList(),
    val subs: List<Track> = emptyList(),
    val id: String = "",
    val title: String = "",
    val subtitle: String = "",
    val resume: Double = 0.0,
    val next: String? = null,
    val web: String? = null,
    val audioIndex: Int? = null,
    val intro: Intro? = null,
)

@Serializable
data class Group(val id: String = "", val title: String = "", val items: List<Card> = emptyList(), val loading: Boolean = false)

@Serializable
data class Found(val groups: List<Group> = emptyList())

@Serializable
data class Category(val title: String = "", val items: List<Card> = emptyList())

class KorieError(message: String) : Exception(message)

// --- talking to Korie --------------------------------------------------------------------

object Korie {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }
    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    // for "is a Korie there?": a quick no, so looking around the network doesn't hang
    private val quick = OkHttpClient.Builder().connectTimeout(1500, TimeUnit.MILLISECONDS).readTimeout(2, TimeUnit.SECONDS).build()
    private const val PREFS = "korie"

    /** What changed on Korie ("library", "browse", "search", …), from its event stream (api.ts connectEvents). */
    val changes = kotlinx.coroutines.flow.MutableSharedFlow<List<String>>(extraBufferCapacity = 16)

    /** Listens to /api/events while signed in, and again after the connection drops. */
    suspend fun listen() = withContext(Dispatchers.IO) {
        val stream = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
        while (kotlinx.coroutines.currentCoroutineContext().isActive) {
            val t = token
            if (t.isNotEmpty()) try {
                val call = stream.newCall(Request.Builder().url("$server/api/events?t=" + java.net.URLEncoder.encode(t, "UTF-8")).build())
                kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]?.invokeOnCompletion { call.cancel() }
                call.execute().use { res ->
                    val src = res.body?.source() ?: return@use
                    while (true) {
                        val line = src.readUtf8Line() ?: break
                        if (!line.startsWith("data:")) continue
                        val what = try { json.parseToJsonElement(line.removePrefix("data:").trim()).let { e -> (e as kotlinx.serialization.json.JsonArray).map { it.jsonPrimitive.content } } } catch (_: Exception) { continue }
                        changes.tryEmit(what)
                    }
                }
            } catch (_: Exception) {}
            kotlinx.coroutines.delay(3000)
        }
    }

    var server: String = ""
        private set
    var token: String = ""
    lateinit var deviceId: String
        private set

    fun load(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        server = p.getString("server", "") ?: ""
        token = p.getString("token", "") ?: ""
        deviceId = p.getString("device", null) ?: UUID.randomUUID().toString().also { p.edit().putString("device", it).apply() }
    }

    fun setServer(ctx: Context, url: String) {
        server = url.trimEnd('/')
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("server", server).apply()
    }

    val deviceName: String get() = android.os.Build.MODEL ?: "TV"

    /** Settings › This device › Change server: look for servers again. */
    var forgotten by androidx.compose.runtime.mutableStateOf(0)
        private set
    fun forgetServer(ctx: Context) {
        signOut(ctx)
        server = ""
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("server").apply()
        forgotten++
    }

    /** For a while only (Manage people from Who's watching): not kept for the next start. */
    fun useToken(t: String) { token = t }

    fun setToken(ctx: Context, t: String) {
        token = t
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", t).apply()
    }

    /** A picture from Korie, at the width it's shown (Korie shrinks it). */
    fun pic(path: String, widthPx: Int): String =
        if (path.isEmpty()) "" else if (path.startsWith("http")) path else "$server$path${if (path.contains('?')) "&" else "?"}w=$widthPx"

    fun url(path: String): String = if (path.startsWith("http")) path else server + path

    private suspend fun call(method: String, path: String, body: JsonObject? = null, base: String = server): String = withContext(Dispatchers.IO) {
        val b = Request.Builder().url(base + path)
        if (token.isNotEmpty()) b.header("Authorization", "Bearer $token")
        if (body != null) b.method(method, body.toString().toRequestBody("application/json".toMediaType()))
        else if (method != "GET") b.method(method, "{}".toRequestBody("application/json".toMediaType()))
        val res = try { http.newCall(b.build()).execute() } catch (e: java.io.IOException) {
            throw KorieError("Can't reach the Korie server. Check that it's running and that this device is on the same network.")
        }
        res.use {
            val text = try { res.body?.string() ?: "" } catch (e: java.io.IOException) { throw KorieError("Can't reach the Korie server. Check that it's running and that this device is on the same network.") }
            if (!res.isSuccessful) {
                val msg = try { json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content } catch (_: Exception) { null }
                throw KorieError(msg ?: "The server answered ${res.code}.")
            }
            text
        }
    }

    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call("GET", path))
    private suspend inline fun <reified T> post(path: String, body: JsonObject): T = json.decodeFromString(call("POST", path, body))

    /** Whether a Korie answers at this address (http://host:port). */
    suspend fun hello(base: String): Boolean = withContext(Dispatchers.IO) {
        try {
            quick.newCall(Request.Builder().url(base.trimEnd('/') + "/api/hello").build()).execute().use { r ->
                r.isSuccessful && (r.body?.string() ?: "").contains("\"korie\":true")
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun people(): List<Person> {
        val el: JsonElement = json.parseToJsonElement(call("GET", "/api/people"))
        val list = if (el is JsonObject) el["people"] ?: el else el
        return json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(Person.serializer()), list)
    }

    suspend fun login(ctx: Context, person: String, pin: String?) {
        val t = call("POST", "/api/login", buildJsonObject {
            put("person", person)
            if (pin != null) put("pin", pin)
            put("device", android.os.Build.MODEL ?: "TV")
            put("deviceId", deviceId)
        })
        setToken(ctx, json.parseToJsonElement(t).jsonObject["token"]!!.jsonPrimitive.content)
    }

    suspend fun meOrNull(): Me? = try { get<Me>("/api/me") } catch (_: Exception) { null }

    fun signOut(ctx: Context) {
        val t = token
        setToken(ctx, "")
        if (t.isNotEmpty()) Thread { try { http.newCall(Request.Builder().url("$server/api/logout").header("Authorization", "Bearer $t").post("{}".toRequestBody("application/json".toMediaType())).build()).execute().close() } catch (_: Exception) {} }.start()
    }

    suspend fun section(kind: String, source: String, sort: String, show: String): Section = get("/api/$kind?source=${enc(source)}&sort=$sort&show=$show")
    suspend fun addPerson(adminToken: String, name: String) { callAs(adminToken, "POST", "/api/people", buildJsonObject { put("name", name) }) }
    suspend fun loginToken(person: String, pin: String?): String {
        val t = call("POST", "/api/login", buildJsonObject {
            put("person", person); if (pin != null) put("pin", pin); put("device", android.os.Build.MODEL ?: "TV"); put("deviceId", deviceId)
        })
        return json.parseToJsonElement(t).jsonObject["token"]!!.jsonPrimitive.content
    }
    suspend fun logoutToken(t: String) { try { callAs(t, "POST", "/api/logout", buildJsonObject {}) } catch (_: Exception) {} }
    private suspend fun callAs(t: String, method: String, path: String, body: JsonObject?): String {
        val saved = token
        token = t
        try { return call(method, path, body) } finally { token = saved }
    }

    suspend fun home(): Rows = get("/api/home")
    suspend fun live(): Rows = get("/api/live")
    suspend fun page(id: String): PageRows = get("/api/page?id=" + enc(id))
    suspend fun item(id: String): Item = get("/api/item?id=" + enc(id))
    suspend fun search(q: String): Found = get("/api/search?q=" + enc(q))

    suspend fun play(id: String, audio: Int? = null, burn: Int? = null, forceStream: Boolean = false): Play = post("/api/play", buildJsonObject {
        put("id", id)
        put("caps", if (forceStream) "v:h264;a:aac;c:none" else caps)
        if (audio != null) put("audio", audio)
        if (burn != null) put("burn", burn)
    })

    suspend fun seekStart(tok: String, t: Double, v: String, after: Boolean): Double = try {
        json.parseToJsonElement(call("GET", "/api/seek/$tok?t=$t&v=$v${if (after) "&after=1" else ""}")).jsonObject["start"]!!.jsonPrimitive.content.toDouble()
    } catch (_: Exception) { t }

    suspend fun streamError(tok: String): String = try {
        json.parseToJsonElement(call("GET", "/api/stream-error/$tok")).jsonObject["error"]?.jsonPrimitive?.content ?: ""
    } catch (_: Exception) { "" }

    suspend fun text(url: String): String = call("GET", url.removePrefix(server))

    suspend fun progress(id: String, position: Double, duration: Double, ended: Boolean) {
        try {
            call("POST", "/api/progress", buildJsonObject {
                put("id", id); put("position", position); put("duration", duration); put("ended", ended)
            })
        } catch (_: Exception) { /* the next report catches up */ }
    }

    suspend fun favourite(id: String): Boolean = json.parseToJsonElement(call("POST", "/api/favourite", buildJsonObject { put("id", id) })).jsonObject["favourite"]?.jsonPrimitive?.content == "true"
    suspend fun watched(id: String, watched: Boolean) { call("POST", "/api/watched", buildJsonObject { put("id", id); put("watched", watched) }) }
    /** Several at once (a season's episodes). */
    suspend fun watched(ids: List<String>, watched: Boolean) { call("POST", "/api/watched", buildJsonObject { put("ids", kotlinx.serialization.json.JsonArray(ids.map { kotlinx.serialization.json.JsonPrimitive(it) })); put("watched", watched) }) }

    fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    /** Any of Korie's calls (api.ts api()): a body makes it a POST unless [method] says otherwise. */
    suspend fun api(path: String, body: JsonObject? = null, method: String = if (body != null) "POST" else "GET"): JsonElement {
        val t = call(method, path, body)
        return if (t.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(t)
    }
    val format: Json get() = json
    inline fun <reified T> read(e: JsonElement): T = format.decodeFromJsonElement(e)

    /** What this device plays as it is, so Korie sends files untouched when it can. */
    val caps: String by lazy {
        val types = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }.flatMap { it.supportedTypes.toList() }.map { it.lowercase() }.toSet()
        val v = mutableListOf("h264")
        if ("video/hevc" in types) v += "hevc"
        if ("video/x-vnd.on2.vp9" in types) v += "vp9"
        if ("video/x-vnd.on2.vp8" in types) v += "vp8"
        if ("video/av01" in types) v += "av1"
        if ("video/mpeg2" in types) v += "mpeg2video"
        val a = mutableListOf("aac", "mp3", "opus", "vorbis", "flac")
        if ("audio/ac3" in types) a += "ac3"
        if ("audio/eac3" in types) a += "eac3"
        "v:${v.joinToString(",")};a:${a.joinToString(",")};c:mp4,mkv,webm"
    }
}
