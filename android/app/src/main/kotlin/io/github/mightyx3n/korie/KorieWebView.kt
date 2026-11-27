package io.github.mightyx3n.korie

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory

/**
 * Korie's web page: the TV's own WebView (the Chrome engine Android apps use), shown in Flutter.
 * Each page has a channel "korie/web/<id>": Flutter sends load, back, forward, reload, scrollBy;
 * the page tells "started", "progress", "finished" (with url, title, back, forward), "crashed".
 *
 * A page whose renderer crashes (out of memory on a small TV, say) is opened again instead of
 * taking all of Korie down, which is what WebView does when no one handles it; if it crashes
 * again within a minute it is left closed.
 *
 * A page left with the remote's Home button keeps running in the background ("park" before the
 * view goes, with a key); a new view made with "resume" = that key takes the same page back, as
 * it is, without loading it again. "korie/web" "close" with the key ends a page in the background.
 */
class KorieWebViewFactory(private val messenger: BinaryMessenger) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    init {
        MethodChannel(messenger, "korie/web").setMethodCallHandler { call, result ->
            when (call.method) {
                "close" -> { KorieWebView.parked.remove(call.arguments as String)?.destroy(); result.success(true) }
                else -> result.notImplemented()
            }
        }
    }

    override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
        val a = args as? Map<*, *> ?: emptyMap<String, Any?>()
        return KorieWebView(context, MethodChannel(messenger, "korie/web/$viewId"), a)
    }
}

@SuppressLint("SetJavaScriptEnabled")
class KorieWebView(private val context: Context, private val channel: MethodChannel, args: Map<*, *>) : PlatformView {
    private val frame = android.widget.FrameLayout(context)
    private var lastCrash = 0L
    private var parkAs: String? = null
    private var web: WebView = (args["resume"] as? String)?.let { parked.remove(it) }?.also { configure(it) } ?: make()

    companion object {
        /** Pages running in the background, by key. */
        val parked = HashMap<String, WebView>()
    }

    init {
        frame.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
        if (args["resume"] == null || web.url == null) (args["url"] as? String)?.let { if (it.isNotEmpty()) web.loadUrl(it) }
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "load" -> { web.loadUrl(call.arguments as String); result.success(true) }
                "back" -> { if (web.canGoBack()) web.goBack(); result.success(true) }
                "forward" -> { if (web.canGoForward()) web.goForward(); result.success(true) }
                "reload" -> { web.reload(); result.success(true) }
                "canBack" -> result.success(web.canGoBack())
                "scrollY" -> result.success(web.scrollY)
                "focus" -> { web.requestFocus(); result.success(true) }
                "picture" -> picture(result)
                "park" -> { parkAs = call.arguments as String; result.success(true) }
                else -> result.notImplemented()
            }
        }
    }

    private fun make(): WebView = WebView(context).also { configure(it) }

    /** Settings and the clients that report to this view's channel (again for a resumed page). */
    private fun configure(w: WebView) = w.apply {
        isFocusable = true
        isFocusableInTouchMode = true
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false // a stream plays as soon as it opens
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setSupportZoom(false)
        // Pages as on a computer: phone layouts are too big and too few on a TV.
        settings.userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
        setBackgroundColor(android.graphics.Color.WHITE)
        webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) = send("progress", mapOf("progress" to newProgress))
            override fun onReceivedTitle(view: WebView, title: String?) = send("title", state())
        }
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: ""
                return scheme != "http" && scheme != "https" && scheme != "about" && scheme != "data" && scheme != "blob"
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = send("started", state())
            override fun onPageFinished(view: WebView, url: String?) = send("finished", state())
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = send("url", state())
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail?): Boolean {
                // The page's renderer is gone: put a new web view in its place and open the page again.
                val url = view.url
                // Opened again once; a page that keeps crashing is left closed instead of looping.
                val now = android.os.SystemClock.elapsedRealtime()
                val again = lastCrash != 0L && now - lastCrash < 60_000
                lastCrash = now
                frame.removeView(view)
                view.destroy()
                web = make()
                frame.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
                send("crashed", mapOf("url" to url, "reloaded" to (!again && url != null)))
                if (!again && url != null) web.loadUrl(url)
                return true
            }
        }
    }

    /** The page as it shows now, drawn by the web view itself, at most 480 wide. */
    private fun picture(result: MethodChannel.Result) {
        val w = web.width
        val h = web.height
        if (w <= 0 || h <= 0) { result.success(null); return }
        val scale = minOf(1f, 480f / w)
        val bmp = Bitmap.createBitmap(maxOf(1, (w * scale).toInt()), maxOf(1, (h * scale).toInt()), Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bmp)
        canvas.scale(scale, scale)
        canvas.translate(-web.scrollX.toFloat(), -web.scrollY.toFloat())
        try { web.draw(canvas) } catch (e: Exception) { result.success(null); return }
        Thread {
            val out = java.io.ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 80, out)
            web.post { result.success(out.toByteArray()) }
        }.start()
    }

    private fun state(): Map<String, Any?> =
        mapOf("url" to web.url, "title" to web.title, "back" to web.canGoBack(), "forward" to web.canGoForward())

    private fun send(event: String, value: Map<String, Any?>) {
        web.post { channel.invokeMethod(event, value) }
    }

    override fun getView(): View = frame

    override fun dispose() {
        channel.setMethodCallHandler(null)
        val key = parkAs
        if (key != null) {
            frame.removeView(web)
            parked.remove(key)?.destroy()
            parked[key] = web
            return
        }
        web.stopLoading()
        web.destroy()
    }
}
