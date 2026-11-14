package app.korie.tv;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Korie on Android TV: the Korie web client full screen, from the Korie server
 * on the network. Finds the server by itself: one server answers, it connects;
 * several answer, it asks which (and remembers); none answer, it asks for the
 * address. It can be the TV box's home screen, and lists the box's apps.
 */
public class MainActivity extends Activity {
    static final String TAG = "Korie";
    static final int DISCOVERY_PORT = 7361;
    private WebView web;
    private SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile List<JSONObject> found = new ArrayList<>();
    private boolean onServer = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("korie", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = makeWebView();
        setContentView(web);
        hideBars();
        start();
    }

    /** The WebView, set up. Made again if Android's web engine stops (so Korie never closes over it). */
    private WebView makeWebView() {
        WebView web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0a1420"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " KorieApp/" + BuildConfig.VERSION_NAME + (isTv() ? " AndroidTV" : ""));
        web.addJavascriptInterface(new Bridge(), "KorieAndroid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "the web engine stopped (crash: " + detail.didCrash() + "); starting it again");
                main.post(() -> restartWebView());
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // the server went away: back to finding it
                if (req.isForMainFrame() && onServer) {
                    onServer = false;
                    showConnect("lost");
                }
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        return web;
    }

    private int restarts = 0;

    private void restartWebView() {
        WebView old = web;
        String url = old.getUrl();
        web = makeWebView();
        setContentView(web);
        old.destroy();
        if (++restarts > 3) {
            showConnect("lost");
            return;
        }
        if (url != null && !url.startsWith("file:")) web.loadUrl(url);
        else start();
    }

    private void start() {
        String saved = prefs.getString("server", "");
        showConnect("looking");
        new Thread(() -> {
            if (!saved.isEmpty() && hello(saved) != null) {
                main.post(() -> openServer(saved));
                return;
            }
            List<JSONObject> list = discover();
            found = list;
            String savedId = prefs.getString("serverId", "");
            for (JSONObject o : list) {
                // the remembered server, at a new address
                if (!savedId.isEmpty() && savedId.equals(o.optString("id"))) {
                    String url = o.optString("url");
                    main.post(() -> openServer(url));
                    return;
                }
            }
            if (list.size() == 1 && savedId.isEmpty()) {
                // only one Korie server on the network: that's the one
                String url = list.get(0).optString("url");
                main.post(() -> openServer(url));
                return;
            }
            main.post(() -> showConnect(list.isEmpty() ? "none" : "pick"));
        }).start();
    }

    private void showConnect(String why) {
        onServer = false;
        web.loadUrl("file:///android_asset/connect.html#" + why);
    }

    void openServer(String url) {
        String u = url.replaceAll("/+$", "");
        new Thread(() -> {
            JSONObject h = hello(u);
            main.post(() -> {
                if (h == null) {
                    showConnect("unreachable");
                    return;
                }
                prefs.edit().putString("server", u).putString("serverId", h.optString("id")).apply();
                onServer = true;
                web.loadUrl(u + "/" + (isTv() ? "?form=tv" : ""));
                web.requestFocus();
            });
        }).start();
    }

    /** GET /api/hello: null when no Korie server answers there. */
    static JSONObject hello(String base) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/hello").openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(2500);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONObject o = new JSONObject(out.toString("UTF-8"));
            return o.optBoolean("korie") ? o : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Asks the network who's a Korie server (UDP broadcast to 7361), for 1.5 seconds. */
    List<JSONObject> discover() {
        Map<String, JSONObject> out = new LinkedHashMap<>();
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("korie") : null;
        try (DatagramSocket sock = new DatagramSocket()) {
            if (lock != null) lock.acquire();
            sock.setBroadcast(true);
            sock.setSoTimeout(300);
            byte[] msg = "KORIE_DISCOVER".getBytes(StandardCharsets.UTF_8);
            long end = System.currentTimeMillis() + 1500;
            int sent = 0;
            while (System.currentTimeMillis() < end) {
                if (sent < 3) {
                    sock.send(new DatagramPacket(msg, msg.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
                    sent++;
                }
                try {
                    DatagramPacket p = new DatagramPacket(new byte[2048], 2048);
                    sock.receive(p);
                    JSONObject o = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                    if (!o.optBoolean("korie")) continue;
                    o.put("url", "http://" + p.getAddress().getHostAddress() + ":" + o.optInt("port", 8100));
                    out.put(o.optString("id"), o);
                } catch (SocketTimeoutException t) {
                    // keep listening until the time is up
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "discovery failed", e);
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }
        return new ArrayList<>(out.values());
    }

    boolean isTv() {
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
                || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || getPackageManager().hasSystemFeature("android.software.leanback_only");
    }

    /** What Korie's web client (and the connect page) can ask of this app. */
    class Bridge {
        @JavascriptInterface public boolean isTv() { return MainActivity.this.isTv(); }
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface public String servers() {
            JSONArray a = new JSONArray();
            for (JSONObject o : found) a.put(o);
            return a.toString();
        }

        @JavascriptInterface public void search() {
            new Thread(() -> {
                found = discover();
                main.post(() -> web.evaluateJavascript("window.onServers && window.onServers()", null));
            }).start();
        }

        @JavascriptInterface public void connect(String url) {
            String u = url.trim();
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://" + u;
            if (!u.matches("^https?://[^/]+:\\d+.*") && !u.matches("^https?://[^/]+/.*")) u = u + ":8100";
            String fu = u;
            main.post(() -> openServer(fu));
        }

        @JavascriptInterface public void forgetServer() {
            prefs.edit().remove("server").remove("serverId").apply();
            main.post(() -> showConnect("pick"));
        }

        @JavascriptInterface public String apps() {
            PackageManager pm = getPackageManager();
            Intent i = new Intent(Intent.ACTION_MAIN, null);
            i.addCategory(isTv() ? Intent.CATEGORY_LEANBACK_LAUNCHER : Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
            if (isTv()) {
                // some TV apps only have a phone launcher entry
                Intent j = new Intent(Intent.ACTION_MAIN, null);
                j.addCategory(Intent.CATEGORY_LAUNCHER);
                for (ResolveInfo r : pm.queryIntentActivities(j, 0)) {
                    boolean seen = false;
                    for (ResolveInfo x : list) if (x.activityInfo.packageName.equals(r.activityInfo.packageName)) seen = true;
                    if (!seen) list.add(r);
                }
            }
            List<JSONObject> out = new ArrayList<>();
            for (ResolveInfo r : list) {
                String pkg = r.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("pkg", pkg);
                    o.put("label", r.loadLabel(pm).toString());
                    o.put("icon", iconData(r.loadIcon(pm)));
                    out.add(o);
                } catch (Exception ignored) {
                }
            }
            Collections.sort(out, (a, b) -> a.optString("label").compareToIgnoreCase(b.optString("label")));
            JSONArray a = new JSONArray();
            for (JSONObject o : out) a.put(o);
            return a.toString();
        }

        @JavascriptInterface public void launch(String pkg) {
            PackageManager pm = getPackageManager();
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i != null) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            }
        }

        /** A web page on a screen of its own (RomM's game player); Back returns to Korie. */
        @JavascriptInterface public void openWeb(String url) {
            Intent i = new Intent(MainActivity.this, WebActivity.class);
            i.putExtra("url", url);
            startActivity(i);
        }
    }

    static String iconData(Drawable d) {
        int size = 96;
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, size, size);
        d.draw(c);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    // Back: the web client steps back itself; at its start screen nothing happens (Korie can be the home screen)
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("(window.korieBack ? window.korieBack() : false)", v -> {
                    if (!"true".equals(v) && !isHome() && !onServer) finish();
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private boolean isHome() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_HOME);
        ResolveInfo r = getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
        return r != null && getPackageName().equals(r.activityInfo.packageName);
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) hideBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }
}
