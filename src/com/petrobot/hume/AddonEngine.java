package com.petrobot.hume;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

import org.luaj.vm2.LuaError;
import org.luaj.vm2.LuaValue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Korie add-ons: one running add-on. Its Lua runs on a thread of its own, so a slow or stuck
 * script never freezes the launcher; everything it shows is drawn by the launcher on the main
 * thread. This class is the {@link AddonLua.Host}: every korie.* call from the script lands in
 * {@link #call}.
 */
final class AddonEngine implements AddonLua.Host {

    final Context app;
    final AddonPack pack;
    final File dataDir;
    /** Screens this add-on has open, bottom first. Touched on the main thread only. */
    /** Set when something went wrong while starting; shown in Settings. */
    volatile String error;
    volatile boolean running;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ArrayDeque<String> log = new ArrayDeque<>();
    private final Map<String, List<LuaValue>> listeners = new HashMap<>();
    private final Map<Integer, Runnable> timers = new HashMap<>();
    private HandlerThread thread;
    private Handler lh;
    private AddonLua lua;
    private int nextId = 1;
    /** The screen host while it is alive; main thread only. */

    AddonEngine(Context c, AddonPack pack) {
        this.app = c.getApplicationContext();
        this.pack = pack;
        this.dataDir = new File(new File(app.getFilesDir(), "addon-data"), pack.id);
    }

    // ------------------------------------------------------------------ life cycle

    void start() {
        if (running) return;
        running = true;
        error = null;
        dataDir.mkdirs();
        thread = new HandlerThread("addon-" + pack.id);
        thread.start();
        lh = new Handler(thread.getLooper());
        lh.post(() -> {
            try {
                Map<String, Object> info = new LinkedHashMap<>();
                info.put("id", pack.id);
                info.put("name", pack.name);
                info.put("version", pack.version);
                info.put("dir", pack.dir.getAbsolutePath());
                lua = new AddonLua(pack.dir, this, info);
                lua.run(new File(pack.dir, pack.main));
                log("started (version " + pack.version + ")");
                Addons.changed();  // Home asks again now that this add-on can answer
            } catch (Throwable t) {
                error = message(t);
                log("could not start: " + error);
            }
        });
    }

    void stop() {
        if (!running) return;
        running = false;
        final HandlerThread t = thread;
        final Handler h = lh;
        if (h != null) {
            h.post(() -> {
                fireNow("stop");
                for (Runnable r : timers.values()) h.removeCallbacks(r);
                timers.clear();
                if (t != null) t.quitSafely();
            });
        }
    }

    /** Runs a callback of the add-on on its own thread. */
    void callback(final LuaValue fn, final Object... args) {
        if (fn == null || !running || lh == null) return;
        lh.post(() -> {
            try {
                lua.callback(fn, args);
            } catch (Throwable t) {
                fail(t);
            }
        });
    }

    void fire(final String event, final Object... args) {
        if (!running || lh == null) return;
        lh.post(() -> fireNow(event, args));
    }

    /** As fire, then runs after on the add-on's thread once every handler is done (or at once if not running). */
    void fireThen(final String event, final Runnable after, final Object... args) {
        if (!running || lh == null) {
            after.run();
            return;
        }
        lh.post(() -> {
            fireNow(event, args);
            after.run();
        });
    }

    private void fireNow(String event, Object... args) {
        List<LuaValue> fns = listeners.get(event);
        if (fns == null || lua == null) return;
        for (LuaValue fn : new ArrayList<>(fns)) {
            try {
                lua.callback(fn, args);
            } catch (Throwable t) {
                fail(t);
            }
        }
    }

    /** True when the add-on registered a handler for this question with korie.on(name, fn). */
    boolean answers(String event) {
        List<LuaValue> l = listeners.get(event);
        return running && error == null && l != null && !l.isEmpty();
    }

    /**
     * Asks the add-on a question (korie.on("search", fn) and so on) and waits for what its
     * function returns, as Java values. Never call it on the UI thread. Returns null when the
     * add-on has no handler, fails, or takes longer than timeoutMs.
     */
    Object request(final String event, long timeoutMs, final Object... args) {
        if (!running || lh == null || Looper.myLooper() == Looper.getMainLooper()) return null;
        final Object[] out = new Object[1];
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        lh.post(() -> {
            try {
                List<LuaValue> fns = listeners.get(event);
                if (fns != null && !fns.isEmpty() && lua != null) out[0] = lua.callback(fns.get(fns.size() - 1), args);
            } catch (Throwable t) {
                log("error in " + event + ": " + message(t));
            } finally {
                done.countDown();
            }
        });
        try {
            if (!done.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)) {
                log(event + " took longer than " + timeoutMs / 1000 + " s");
                return null;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
        return out[0];
    }

    /**
     * korie.play{url=, title=, start=, audio=, mime=, headers=, ref=}: Korie's own player. Video
     * opens the player screen; audio = true plays in the background with the now-playing pill on
     * Home. The add-on hears about progress through korie.on("playback", function(ref, info) end).
     */
    private Object play(Map<String, Object> m) throws Exception {
        final Playback.Request r = Playback.request(pack.id, m);
        if (r.url.isEmpty()) throw new Exception("play needs a url");
        need(AddonPack.USE_INTERNET, r.url);
        ui.post(() -> {
            if (r.audio) {
                Playback.playAudio(app, r);
            } else {
                PlayerActivity.next = r;
                // A player that is open (on to the next episode) takes this over in place; otherwise a new one opens.
                PlayerActivity open = PlayerActivity.open;
                if (open != null && !open.isFinishing() && !open.isDestroyed()) open.takeOver();
                else app.startActivity(new Intent(app, PlayerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        });
        return true;
    }

    private void fail(Throwable t) {
        final String m = message(t);
        log("error: " + m);
        ui.post(() -> Addons.toast(pack.name + ": " + m));
    }

    /** The reason something failed, in words a person can act on. */
    static String message(Throwable t) {
        if (t instanceof java.net.UnknownHostException) return "no internet connection, or that address does not exist";
        if (t instanceof java.net.SocketTimeoutException) return "the server took too long to answer";
        if (t instanceof java.net.ConnectException) return "could not connect to the server";
        if (t instanceof javax.net.ssl.SSLException) return "the secure connection to the server failed";
        if (t instanceof java.io.FileNotFoundException) return "that file or address was not found";
        String m = t instanceof LuaError ? t.getMessage() : t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
        if (m == null) m = "error";
        return m.length() > 300 ? m.substring(0, 300) + "…" : m;
    }

    void log(String s) {
        synchronized (log) {
            log.addLast(new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(new Date()) + "  " + s);
            while (log.size() > 200) log.removeFirst();
        }
        android.util.Log.i("KorieAddon", pack.id + ": " + s);
    }

    List<String> logLines() {
        synchronized (log) {
            return new ArrayList<>(log);
        }
    }

    // ------------------------------------------------------------------ opening from Home

    // ------------------------------------------------------------------ korie.* calls

    @Override
    public Object call(String name, Object[] a) throws Exception {
        switch (name) {
            case "log":
                log(join(a));
                return null;
            case "toast":
                final String msg = AddonLua.str(arg(a, 0), "");
                ui.post(() -> Addons.toast(msg));
                return null;
            case "http.get": {
                Map<String, Object> o = new LinkedHashMap<>(AddonLua.map(arg(a, 1)));
                o.put("url", arg(a, 0));
                return http(o);
            }
            case "http.post": {
                Map<String, Object> o = new LinkedHashMap<>(AddonLua.map(arg(a, 2)));
                o.put("url", arg(a, 0));
                o.put("body", arg(a, 1));
                if (!o.containsKey("method")) o.put("method", "POST");
                return http(o);
            }
            case "http.request":
                return http(AddonLua.map(arg(a, 0)));
            case "store.get": {
                String raw = store().getString(AddonLua.str(arg(a, 0), ""), null);
                if (raw == null) return arg(a, 1);
                try {
                    return AddonLua.parseJson(raw);
                } catch (RuntimeException e) {
                    return arg(a, 1);
                }
            }
            case "store.set":
                if (arg(a, 1) == null) store().edit().remove(AddonLua.str(arg(a, 0), "")).apply();
                else store().edit().putString(AddonLua.str(arg(a, 0), ""), AddonLua.toJson(arg(a, 1))).apply();
                return null;
            case "store.remove":
                store().edit().remove(AddonLua.str(arg(a, 0), "")).apply();
                return null;
            case "setting":
                return setting(AddonLua.str(arg(a, 0), ""));
            case "set_setting":
                setSetting(AddonLua.str(arg(a, 0), ""), arg(a, 1));
                return null;
            case "apps.list":
                need(AddonPack.USE_APPS, null);
                return appsList();
            case "apps.open":
                need(AddonPack.USE_APPS, null);
                return appsOpen(AddonLua.str(arg(a, 0), ""));
            case "open":
                need(AddonPack.USE_APPS, null);
                return openIntent(arg(a, 0));
            case "timer":
                return timer(AddonLua.num(arg(a, 0), 1), AddonLua.fn(arg(a, 1)), AddonLua.bool(arg(a, 2), false));
            case "cancel": {
                Runnable r = timers.remove((int) AddonLua.num(arg(a, 0), -1));
                if (r != null) lh.removeCallbacks(r);
                return null;
            }
            case "on": {
                LuaValue fn = AddonLua.fn(arg(a, 1));
                String ev = AddonLua.str(arg(a, 0), "");
                if (fn != null && !ev.isEmpty()) {
                    List<LuaValue> l = listeners.get(ev);
                    if (l == null) listeners.put(ev, l = new ArrayList<>());
                    l.add(fn);
                }
                return null;
            }
            case "device":
                return Addons.device(app);
            case "play":
                return play(AddonLua.map(arg(a, 0)));
            case "stop":
                ui.post(Playback::stopAudio);
                return null;
            case "refresh":  // fetch the catalog again now (after a setting changed what it should hold)
                Addons.io.execute(() -> Addons.loadCatalog(this, true));
                return null;
            case "ask":  // a question on screen; waits here (on the add-on's thread) for the answer
                return Addons.ask(this, AddonLua.map(arg(a, 0)));
            case "net.broadcast":
                need(AddonPack.USE_INTERNET, null);
                return broadcast((int) AddonLua.num(arg(a, 0), 0), arg(a, 1), AddonLua.num(arg(a, 2), 2));
            case "profile":
                return Addons.profile(app, Profiles.current(app));
            case "profiles.list": {
                List<Object> out = new ArrayList<>();
                for (Profiles.Profile x : Profiles.list(app)) out.add(Addons.profile(app, x));
                return out;
            }
            case "profiles.add": {
                String n = AddonLua.str(arg(a, 0), "").trim();
                if (n.isEmpty()) return new Object[]{null, "a profile needs a name"};
                for (Profiles.Profile x : Profiles.list(app)) if (x.name.equalsIgnoreCase(n)) return Addons.profile(app, x);
                Profiles.Profile made = Profiles.add(app, n);
                if (made == null) return new Object[]{null, "Korie has room for " + Profiles.MAX + " profiles"};
                return Addons.profile(app, made);
            }
            default:
                throw new Exception("is not available");
        }
    }

    /**
     * Sends one message to everything on the local network (UDP broadcast) and collects the answers
     * for a few seconds: how servers such as Jellyfin are found without typing an address.
     */
    private Object broadcast(int port, Object message, double seconds) {
        List<Object> out = new ArrayList<>();
        if (port <= 0 || port > 65535) return out;
        byte[] data = message instanceof byte[] ? (byte[]) message : AddonLua.str(message, "").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        long end = System.currentTimeMillis() + (long) (Math.max(0.5, Math.min(seconds, 10)) * 1000);
        try (java.net.DatagramSocket s = new java.net.DatagramSocket()) {
            s.setBroadcast(true);
            java.util.Set<java.net.InetAddress> to = new java.util.LinkedHashSet<>();
            to.add(java.net.InetAddress.getByName("255.255.255.255"));
            try {  // each network's own broadcast address too; some routers drop the general one
                for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (java.net.InterfaceAddress ia : ni.getInterfaceAddresses()) if (ia.getBroadcast() != null) to.add(ia.getBroadcast());
                }
            } catch (Exception ignored) {
            }
            for (java.net.InetAddress t : to) {
                try {
                    s.send(new java.net.DatagramPacket(data, data.length, t, port));
                } catch (Exception ignored) {
                }
            }
            byte[] buf = new byte[8192];
            java.util.Set<String> seen = new java.util.HashSet<>();
            while (System.currentTimeMillis() < end && out.size() < 32) {
                s.setSoTimeout((int) Math.max(1, end - System.currentTimeMillis()));
                java.net.DatagramPacket p = new java.net.DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (java.net.SocketTimeoutException e) {
                    break;
                }
                String text = new String(p.getData(), 0, p.getLength(), java.nio.charset.StandardCharsets.UTF_8);
                if (!seen.add(p.getAddress().getHostAddress() + text)) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("address", p.getAddress().getHostAddress());
                m.put("text", text);
                out.add(m);
            }
        } catch (Exception e) {
            log("broadcast: " + message(e));
        }
        return out;
    }

    private static Object arg(Object[] a, int i) {
        return a != null && i < a.length ? a[i] : null;
    }

    private static String join(Object[] a) {
        StringBuilder sb = new StringBuilder();
        if (a != null) {
            for (Object o : a) {
                if (sb.length() > 0) sb.append(' ');
                sb.append(o instanceof String ? (String) o : AddonLua.toJson(o));
            }
        }
        return sb.toString();
    }

    private static String urlOf(Object o) {
        return o instanceof String ? (String) o : AddonLua.str(AddonLua.map(o).get("url"), "");
    }

    /** Refuses what the add-on did not declare. For media and pictures only web addresses need "internet". */
    private void need(String use, String urlOrNull) throws Exception {
        if (urlOrNull != null && !urlOrNull.startsWith("http://") && !urlOrNull.startsWith("https://")) return;
        if (!pack.uses(use)) {
            throw new Exception("this add-on has not listed \"" + use + "\" under \"uses\" in addon.json");
        }
    }



    // ------------------------------------------------------------------ internet

    private Object http(Map<String, Object> o) throws Exception {
        need(AddonPack.USE_INTERNET, null);
        String url = AddonLua.str(o.get("url"), "");
        if (!url.startsWith("http://") && !url.startsWith("https://")) throw new Exception("the address must start with http:// or https://");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            int timeout = (int) (AddonLua.num(o.get("timeout"), 15) * 1000);
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setInstanceFollowRedirects(true);
            String method = AddonLua.str(o.get("method"), "GET").toUpperCase(Locale.ROOT);
            c.setRequestMethod(method);
            c.setRequestProperty("User-Agent", "Korie/" + Addons.appVersion(app) + " (add-on " + pack.id + ")");
            for (Map.Entry<String, Object> h : AddonLua.map(o.get("headers")).entrySet()) {
                c.setRequestProperty(h.getKey(), AddonLua.str(h.getValue(), ""));
            }
            Object body = o.get("body");
            if (body != null) {
                byte[] bytes;
                if (body instanceof byte[]) {
                    bytes = (byte[]) body;
                } else if (body instanceof String) {
                    bytes = ((String) body).getBytes("UTF-8");
                } else {
                    bytes = AddonLua.toJson(body).getBytes("UTF-8");
                    if (c.getRequestProperty("Content-Type") == null) c.setRequestProperty("Content-Type", "application/json");
                }
                c.setDoOutput(true);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] data = in == null ? new byte[0] : readCapped(in, 32L * 1024 * 1024);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("status", status);
            r.put("ok", status >= 200 && status < 300);
            r.put("body", data);
            Map<String, Object> hs = new LinkedHashMap<>();
            for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
                if (h.getKey() != null && !h.getValue().isEmpty()) hs.put(h.getKey().toLowerCase(Locale.ROOT), h.getValue().get(0));
            }
            r.put("headers", hs);
            return r;
        } catch (java.io.IOException e) {
            // No connection, timeout, unknown host: nil plus the reason, so scripts can show it.
            return new Object[]{null, message(e)};
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static byte[] readCapped(InputStream in, long max) throws java.io.IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > max) throw new java.io.IOException("the answer is larger than " + (max / 1024 / 1024) + " MB");
            }
            return out.toByteArray();
        }
    }

    // ------------------------------------------------------------------ storage

    private SharedPreferences store() {
        return app.getSharedPreferences("addon_store_" + pack.id, Context.MODE_PRIVATE);
    }

    static SharedPreferences settingsPrefs(Context c, String id) {
        return c.getSharedPreferences("addon_settings_" + id, Context.MODE_PRIVATE);
    }

    Object setting(String key) {
        for (Map<String, Object> def : pack.settings) {
            if (!key.equals(AddonLua.str(def.get("key"), ""))) continue;
            String raw = settingsPrefs(app, pack.id).getString(key, null);
            if (raw == null) return def.get("default");
            try {
                return AddonLua.parseJson(raw);
            } catch (RuntimeException e) {
                return def.get("default");
            }
        }
        return null;
    }

    void setSetting(String key, Object value) {
        SharedPreferences.Editor e = settingsPrefs(app, pack.id).edit();
        if (value == null) e.remove(key);
        else e.putString(key, AddonLua.toJson(value));
        e.apply();
        fire("setting", key, value);
    }

    // ------------------------------------------------------------------ apps and look

    private Object appsList() {
        PackageManager pm = app.getPackageManager();
        List<Object> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String cat : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(cat), 0)) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(app.getPackageName()) || !seen.add(pkg)) continue;
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("id", pkg);
                e.put("name", String.valueOf(ri.loadLabel(pm)));
                out.add(e);
            }
        }
        return out;
    }

    private Object appsOpen(String pkg) {
        PackageManager pm = app.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        final Intent launch = i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ui.post(() -> {
            try {
                app.startActivity(launch);
            } catch (RuntimeException e) {
                Addons.toast(pack.name + ": " + message(e));
            }
        });
        return true;
    }

    private Object openIntent(Object o) {
        Map<String, Object> m = AddonLua.map(o);
        String url = urlOf(o);
        final Intent i = new Intent(Intent.ACTION_VIEW).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String type = AddonLua.str(m.get("type"), null);
        if (type != null) i.setDataAndType(Uri.parse(url), type);
        else i.setData(Uri.parse(url));
        String pkg = AddonLua.str(m.get("app"), null);
        if (pkg != null) i.setPackage(pkg);
        if (i.resolveActivity(app.getPackageManager()) == null) return false;
        ui.post(() -> {
            try {
                app.startActivity(i);
            } catch (RuntimeException e) {
                Addons.toast(pack.name + ": " + message(e));
            }
        });
        return true;
    }

    // ------------------------------------------------------------------ timers

    private Object timer(double seconds, final LuaValue fn, final boolean repeat) throws Exception {
        if (fn == null) throw new Exception("needs a function");
        final long ms = Math.max(50, (long) (seconds * 1000));
        final int id = nextId++;
        Runnable r = new Runnable() {
            @Override
            public void run() {
                if (!running || !timers.containsKey(id)) return;
                if (repeat) lh.postDelayed(this, ms);
                else timers.remove(id);
                try {
                    lua.callback(fn);
                } catch (Throwable t) {
                    fail(t);
                }
            }
        };
        timers.put(id, r);
        lh.postDelayed(r, ms);
        return id;
    }

    static int sdk() {
        return Build.VERSION.SDK_INT;
    }
}
