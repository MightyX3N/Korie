package com.petrobot.hume;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Korie add-ons: small Lua programs (.korie packages) that supply content and actions — titles
 * for Search and the carousel, what a title's buttons do, a series' seasons and episodes. The
 * launcher owns every screen; an add-on never draws one.
 *
 * An add-on answers questions it registered for with korie.on(name, fn):
 *   "catalog"  ()               its whole list, saved on the device and searched locally
 *   "search"   (text)           titles for a search (for sources too big to list)
 *   "home"     ()               titles for the carousel
 *   "detail"   (item)           { buttons = {{id, label, sub}}, seasons = {{id, name}} }
 *   "episodes" (item, seasonId) { {id, title, thumb, overview, progress} }
 *   "action"   (item, buttonId) a button or an episode was chosen (korie.play / korie.open)
 */
final class Addons {
    static final long CATALOG_MAX_AGE_MS = 6L * 60 * 60 * 1000;
    static final long ASK_MS = 8000;

    static Context app;
    static final Map<String, AddonEngine> engines = new LinkedHashMap<>();
    static final Map<String, List<Object>> catalogs = new java.util.concurrent.ConcurrentHashMap<>();
    static final ExecutorService io = Executors.newSingleThreadExecutor();
    static final Handler ui = new Handler(Looper.getMainLooper());
    /** Bumped whenever add-ons or their catalogs change, so Home reloads its carousel. */
    static volatile int version;

    static File dir(Context c) {
        return new File(c.getFilesDir(), "addons");
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("addons", Context.MODE_PRIVATE);
    }

    /** Starts every enabled add-on once per process. */
    static synchronized void init(Context c) {
        if (app != null) return;
        app = c.getApplicationContext();
        if (app instanceof android.app.Application) watchScreens((android.app.Application) app);
        if (c instanceof android.app.Activity) front = new java.lang.ref.WeakReference<>((android.app.Activity) c);
        for (AddonPack p : installed(app)) if (enabled(app, p.id)) start(p);
    }

    static List<AddonPack> installed(Context c) {
        List<AddonPack> out = new ArrayList<>();
        File[] dirs = dir(c).listFiles();
        if (dirs == null) return out;
        java.util.Arrays.sort(dirs);
        for (File d : dirs) {
            if (!d.isDirectory() || d.getName().startsWith(".")) continue;
            try {
                out.add(AddonPack.read(d));
            } catch (Exception e) {
                android.util.Log.w("KorieAddon", d.getName() + ": " + e);
            }
        }
        return out;
    }

    static boolean enabled(Context c, String id) {
        return prefs(c).getBoolean("on_" + id, true);
    }

    static synchronized void setEnabled(Context c, String id, boolean on) {
        prefs(c).edit().putBoolean("on_" + id, on).apply();
        AddonEngine e = engines.remove(id);
        if (e != null) e.stop();
        catalogs.remove(id);
        if (on) for (AddonPack p : installed(c)) if (p.id.equals(id)) start(p);
        version++;
    }

    static synchronized void start(AddonPack p) {
        AddonEngine e = new AddonEngine(app, p);
        engines.put(p.id, e);
        e.start();
        io.execute(() -> loadCatalog(e, false));
    }

    static synchronized AddonEngine engine(String id) {
        return engines.get(id);
    }

    static synchronized List<AddonEngine> running() {
        return new ArrayList<>(engines.values());
    }

    /** Unpacks a .korie package next to the installed ones without installing it; the stream is closed. */
    static AddonPack stage(Context c, InputStream korieFile) throws Exception {
        init(c);
        File tmp = new File(dir(c), ".incoming");
        AddonPack.deleteTree(tmp);
        tmp.mkdirs();
        try (InputStream in = korieFile) {
            return AddonPack.unpack(in, tmp);
        } catch (Exception e) {
            AddonPack.deleteTree(tmp);
            throw e;
        }
    }

    static void discard(AddonPack staged) {
        if (staged != null) AddonPack.deleteTree(staged.dir);
    }

    /** Installs (or updates to) a staged package and starts it. */
    static synchronized AddonPack commit(Context c, AddonPack staged) throws Exception {
        AddonEngine old = engines.remove(staged.id);
        if (old != null) old.stop();
        File dest = new File(dir(c), staged.id);
        AddonPack.deleteTree(dest);
        if (!staged.dir.renameTo(dest)) {
            AddonPack.deleteTree(staged.dir);
            throw new Exception("could not save the add-on");
        }
        catalogs.remove(staged.id);
        new File(dataDir(c, staged.id), "catalog.json").delete();
        AddonPack done = AddonPack.read(dest);
        if (enabled(c, done.id)) start(done);
        version++;
        return done;
    }

    static synchronized void uninstall(Context c, String id) {
        AddonEngine e = engines.remove(id);
        if (e != null) e.stop();
        catalogs.remove(id);
        AddonPack.deleteTree(new File(dir(c), id));
        AddonPack.deleteTree(dataDir(c, id));
        prefs(c).edit().remove("on_" + id).apply();
        version++;
    }

    static File dataDir(Context c, String id) {
        return new File(new File(c.getFilesDir(), "addon-data"), id);
    }

    // ------------------------------------------------------------------ profiles and questions

    static Map<String, Object> profile(Context c, Profiles.Profile p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id);
        m.put("name", p.name);
        m.put("current", p.id.equals(Profiles.current(c).id));
        return m;
    }

    /** Home switched to another profile: add-ons that keep one sign-in per profile follow it. */
    static void profileChanged(Context c) {
        Map<String, Object> m = profile(c, Profiles.current(c));
        for (AddonEngine e : running()) e.fire("profile", m);
        changed();
    }

    /** The screen in front, for an add-on's question. */
    static volatile java.lang.ref.WeakReference<android.app.Activity> front = new java.lang.ref.WeakReference<>(null);

    static void watchScreens(android.app.Application a) {
        a.registerActivityLifecycleCallbacks(new android.app.Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(android.app.Activity x) { front = new java.lang.ref.WeakReference<>(x); }
            @Override public void onActivityPaused(android.app.Activity x) { if (front.get() == x) front = new java.lang.ref.WeakReference<>(null); }
            @Override public void onActivityCreated(android.app.Activity x, android.os.Bundle b) { }
            @Override public void onActivityStarted(android.app.Activity x) { }
            @Override public void onActivityStopped(android.app.Activity x) { }
            @Override public void onActivitySaveInstanceState(android.app.Activity x, android.os.Bundle b) { }
            @Override public void onActivityDestroyed(android.app.Activity x) { }
        });
    }

    /**
     * korie.ask{title=, message=, choices={...}, input="text"|"password", value=}: a system dialog
     * (the kind Settings uses, which works with a remote and by touch). Returns the number of the
     * chosen entry, the typed text, true for a plain message, or nil when it was cancelled or no
     * screen of Korie is in front. Must not be called on the UI thread.
     */
    static Object ask(AddonEngine e, Map<String, Object> q) {
        final Object[] answer = {null};
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        ui.post(() -> {
            android.app.Activity a = front.get();
            if (a == null || a.isFinishing()) {
                done.countDown();
                return;
            }
            android.app.AlertDialog.Builder b = Clicks.dialog(a).setTitle(AddonLua.str(q.get("title"), e.pack.name));
            String message = AddonLua.str(q.get("message"), "");
            List<Object> choices = AddonLua.list(q.get("choices"));
            String input = AddonLua.str(q.get("input"), "");
            if (!choices.isEmpty()) {
                String[] labels = new String[choices.size()];
                for (int i = 0; i < labels.length; i++) labels[i] = AddonLua.str(choices.get(i), "");
                if (message.isEmpty()) {
                    b.setItems(labels, (d, w) -> answer[0] = (double) (w + 1));
                } else {  // a message and a list don't fit one dialog: up to three choices become its buttons
                    b.setMessage(message);
                    b.setPositiveButton(labels[0], (d, w) -> answer[0] = 1d);
                    if (labels.length > 1) b.setNegativeButton(labels[1], (d, w) -> answer[0] = 2d);
                    if (labels.length > 2) b.setNeutralButton(labels[2], (d, w) -> answer[0] = 3d);
                }
            } else if (!input.isEmpty()) {
                android.widget.EditText in = new android.widget.EditText(a);
                in.setSingleLine(true);
                if (input.equals("password")) in.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
                else in.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
                in.setText(AddonLua.str(q.get("value"), ""));
                if (!message.isEmpty()) b.setMessage(message);
                android.widget.FrameLayout box = new android.widget.FrameLayout(a);  // the field lines up with the dialog's text
                int pad = Ui.px(a, 20);
                box.setPadding(pad, 0, pad, 0);
                box.addView(in);
                b.setView(box);
                b.setPositiveButton("OK", (d, w) -> answer[0] = in.getText().toString());
                b.setNegativeButton("Cancel", null);
            } else {
                b.setMessage(message);
                b.setPositiveButton("OK", (d, w) -> answer[0] = Boolean.TRUE);
            }
            try {
                android.app.AlertDialog d = b.create();
                d.setOnDismissListener(x -> done.countDown());
                d.show();
            } catch (Exception ex) {
                done.countDown();
            }
        });
        try {
            while (!done.await(1, java.util.concurrent.TimeUnit.SECONDS)) if (!e.running) return null;
        } catch (InterruptedException ex) {
            return null;
        }
        return answer[0];
    }

    /** Home sets this: something the carousel is made from changed (an add-on started, its list arrived, the profile switched). */
    static volatile Runnable onChanged;

    static void changed() {
        version++;
        ui.post(() -> {
            Runnable r = onChanged;
            if (r != null) r.run();
        });
    }

    static void toast(String s) {
        if (app != null) ui.post(() -> Toast.makeText(app, s, Toast.LENGTH_LONG).show());
    }

    static String appVersion(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    static Object device(Context c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tv", c.getPackageManager().hasSystemFeature("android.software.leanback"));
        m.put("touch", c.getPackageManager().hasSystemFeature("android.hardware.touchscreen"));
        m.put("android", (double) Build.VERSION.SDK_INT);
        m.put("model", Build.MODEL);
        m.put("language", java.util.Locale.getDefault().toLanguageTag());
        m.put("korie", appVersion(c));
        return m;
    }

    // ------------------------------------------------------------------ catalogs (saved lists)

    /** Loads an add-on's saved list, and fetches a fresh one when there is none or it is old. Not on the UI thread. */
    static void loadCatalog(AddonEngine e, boolean force) {
        File f = new File(dataDir(e.app, e.pack.id), "catalog.json");
        if (!catalogs.containsKey(e.pack.id) && f.exists()) {
            try (InputStream in = new FileInputStream(f)) {
                catalogs.put(e.pack.id, AddonLua.list(AddonLua.parseJson(new String(AddonPack.readAll(in), StandardCharsets.UTF_8))));
                changed();
            } catch (Exception ex) {
                android.util.Log.w("KorieAddon", e.pack.id + " catalog: " + ex);
            }
        }
        boolean old = !f.exists() || System.currentTimeMillis() - f.lastModified() > CATALOG_MAX_AGE_MS;
        if (!force && !old) return;
        // The add-on may still be starting: give its main.lua a moment to register its handlers.
        for (int i = 0; i < 20 && e.running && e.error == null && !e.answers("catalog") && !e.answers("search") && !e.answers("home"); i++) {
            try {
                Thread.sleep(150);
            } catch (InterruptedException ie) {
                return;
            }
        }
        if (!e.answers("catalog")) return;
        Object r = e.request("catalog", 60000);
        if (!(r instanceof List) && !(r instanceof Map)) return;  // failed: keep showing the saved list
        List<Object> list = AddonLua.list(r);
        catalogs.put(e.pack.id, list);
        try {
            f.getParentFile().mkdirs();
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(AddonLua.toJson(list).getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ex) {
            android.util.Log.w("KorieAddon", e.pack.id + " catalog: " + ex);
        }
        changed();
    }

    // ------------------------------------------------------------------ search

    /** Titles from every add-on for this text; one title with several offers when add-ons share its key. */
    static List<Search.Title> search(Context c, String q) {
        init(c);
        String nq = Search.norm(q);
        Map<String, Search.Title> byKey = new LinkedHashMap<>();
        List<Search.Title> starts = new ArrayList<>(), rest = new ArrayList<>();
        for (AddonEngine e : running()) {
            List<Object> items;
            List<Object> cat = catalogs.get(e.pack.id);
            if (cat != null) {
                items = new ArrayList<>();
                for (Object o : cat) {
                    String t = Search.norm(AddonLua.str(AddonLua.map(o).get("title"), ""));
                    if (t.contains(nq)) items.add(o);
                }
                if (System.currentTimeMillis() - new File(dataDir(c, e.pack.id), "catalog.json").lastModified() > CATALOG_MAX_AGE_MS) {
                    io.execute(() -> loadCatalog(e, true));
                }
            } else if (e.answers("search")) {
                items = AddonLua.list(e.request("search", ASK_MS, q));
            } else {
                continue;
            }
            for (Object o : items) {
                Map<String, Object> m = AddonLua.map(o);
                String title = AddonLua.str(m.get("title"), "");
                if (title.isEmpty()) continue;
                Search.Offer of = offer(e, m);
                String key = AddonLua.str(m.get("key"), "");
                Search.Title t = key.isEmpty() ? null : byKey.get(key);
                if (t == null) {
                    t = title(m);
                    if (!key.isEmpty()) byKey.put(key, t);
                    (Search.norm(title).startsWith(nq) ? starts : rest).add(t);
                }
                t.offers.add(of);
                if (starts.size() + rest.size() >= 60) break;
            }
        }
        starts.addAll(rest);
        return starts;
    }

    // ------------------------------------------------------------------ library (browsing)

    /** Whether any add-on's saved list has a title of this type ("movie" or "tv"): Home shows its tile then. */
    static boolean hasType(String type) {
        if (typesVersion != version) {  // worked out once per change of the lists, not on every look
            boolean m = false, t = false;
            for (AddonEngine e : running()) {
                List<Object> cat = catalogs.get(e.pack.id);
                if (cat == null) continue;
                for (Object o : cat) {
                    String ty = AddonLua.str(AddonLua.map(o).get("type"), "movie");
                    if (ty.equals("radio")) continue;
                    if (ty.equals("series") || ty.equals("tv") || ty.equals("show")) t = true; else m = true;
                    if (m && t) break;
                }
            }
            hasMovies = m;
            hasSeries = t;
            typesVersion = version;
        }
        return type.equals("movie") ? hasMovies : hasSeries;
    }

    private static volatile int typesVersion = -1;
    private static volatile boolean hasMovies, hasSeries;

    /**
     * The library screen behind the Movies and Series tiles: rows of titles from the add-ons' saved
     * lists. Continue Watching (what the add-ons put on the carousel), Recently Added, everything
     * A to Z, then one row per genre. type is "movie" or "tv". Not on the UI thread.
     */
    static Map<String, List<Search.Title>> library(Context c, String type) {
        init(c);
        Map<String, List<Search.Title>> rows = new LinkedHashMap<>();
        // Continue Watching and Next Up, as the add-ons answer for the carousel.
        List<Search.Title> cont = new ArrayList<>();
        for (AddonEngine e : running()) {
            if (!e.answers("home")) continue;
            for (Object o : AddonLua.list(e.request("home", ASK_MS))) {
                Map<String, Object> m = AddonLua.map(o);
                Search.Title t = title(m);
                if (!t.type.equals(type) || t.title.isEmpty()) continue;
                if (t.poster.isEmpty()) t.poster = t.backdrop;
                String ep = AddonLua.str(m.get("episode"), "");
                if (!ep.isEmpty()) t.year = ep;  // shown after the name: "Breaking Bad · S1 E2 · ..."
                t.offers.add(offer(e, m));
                cont.add(t);
            }
        }
        if (!cont.isEmpty()) rows.put("Continue Watching", cont);
        // Every title of this type, one per key across add-ons.
        Map<String, Search.Title> byKey = new LinkedHashMap<>();
        List<Search.Title> all = new ArrayList<>();
        for (AddonEngine e : running()) {
            List<Object> cat = catalogs.get(e.pack.id);
            if (cat == null) continue;
            for (Object o : cat) {
                Map<String, Object> m = AddonLua.map(o);
                Search.Title t = title(m);
                if (!t.type.equals(type) || t.title.isEmpty()) continue;
                String key = AddonLua.str(m.get("key"), "");
                Search.Title have = key.isEmpty() ? null : byKey.get(key);
                if (have == null) {
                    if (!key.isEmpty()) byKey.put(key, t);
                    all.add(t);
                    have = t;
                } else if (t.added.compareTo(have.added) > 0) {
                    have.added = t.added;
                }
                have.offers.add(offer(e, m));
            }
        }
        if (all.isEmpty()) return rows;
        List<Search.Title> recent = new ArrayList<>();
        for (Search.Title t : all) if (!t.added.isEmpty()) recent.add(t);
        java.util.Collections.sort(recent, (x, y) -> y.added.compareTo(x.added));
        if (!recent.isEmpty()) rows.put("Recently Added", new ArrayList<>(recent.subList(0, Math.min(30, recent.size()))));
        java.util.Collections.sort(all, (x, y) -> x.title.compareToIgnoreCase(y.title));
        rows.put(type.equals("movie") ? "All Movies" : "All Series", all);
        Map<String, List<Search.Title>> genres = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (Search.Title t : all) {
            for (String g : t.genres.split(",")) {
                g = g.trim();
                if (g.isEmpty()) continue;
                List<Search.Title> l = genres.get(g);
                if (l == null) genres.put(g, l = new ArrayList<>());
                l.add(t);
            }
        }
        // A genre is worth a row when it has a few titles and is not simply the whole library again.
        for (Map.Entry<String, List<Search.Title>> g : genres.entrySet()) {
            int n = g.getValue().size();
            if (n >= Math.min(3, all.size()) && (n < all.size() || genres.size() == 1)) rows.put(g.getKey(), g.getValue());
        }
        return rows;
    }

    static Search.Title title(Map<String, Object> m) {
        Search.Title t = new Search.Title();
        t.title = AddonLua.str(m.get("title"), "");
        String type = AddonLua.str(m.get("type"), "movie");
        t.type = type.equals("series") || type.equals("tv") || type.equals("show") ? "tv" : type.equals("radio") ? "radio" : "movie";
        t.year = AddonLua.str(m.get("year"), "");
        if (t.year.endsWith(".0")) t.year = t.year.substring(0, t.year.length() - 2);
        t.overview = AddonLua.str(m.get("overview"), "");
        t.genres = AddonLua.str(m.get("genres"), "");
        t.poster = AddonLua.str(m.get("poster"), "");
        t.backdrop = AddonLua.str(m.get("backdrop"), "");
        t.rating = AddonLua.num(m.get("rating"), 0);
        t.added = AddonLua.str(m.get("added"), "");
        return t;
    }

    static Search.Offer offer(AddonEngine e, Map<String, Object> item) {
        Search.Offer o = new Search.Offer();
        o.addon = e.pack.id;
        o.service = e.pack.name;
        o.item = item;
        File icon = e.pack.icon == null || e.pack.icon.isEmpty() ? null : new File(e.pack.dir, e.pack.icon);
        if (icon != null && icon.exists()) o.icon = icon.getAbsolutePath();
        return o;
    }

    // ------------------------------------------------------------------ a title's page

    static final class Button {
        String id = "play", label = "Play", sub = "";
    }

    static final class Season {
        String id = "", name = "";
    }

    static final class Episode {
        String id = "", title = "", thumb = "", overview = "";
        float progress = -1f;
        Map<String, Object> item;
    }

    static final class Detail {
        final List<Button> buttons = new ArrayList<>();
        final List<Season> seasons = new ArrayList<>();
        /** Where a series page opens: the season and episode you are on (the add-on's "focus"), or "". */
        String focusSeason = "", focusEpisode = "";
    }

    /** What an add-on offers for a title: its buttons and, for a series, its seasons. Not on the UI thread. */
    static Detail detail(Search.Offer o) {
        Detail d = new Detail();
        AddonEngine e = engine(o.addon);
        Map<String, Object> r = e != null && e.answers("detail") ? AddonLua.map(e.request("detail", ASK_MS, o.item)) : new LinkedHashMap<>();
        for (Object b : AddonLua.list(r.get("buttons"))) {
            Map<String, Object> m = AddonLua.map(b);
            Button x = new Button();
            x.id = AddonLua.str(m.get("id"), "play");
            x.label = AddonLua.str(m.get("label"), "Play");
            x.sub = AddonLua.str(m.get("sub"), "");
            d.buttons.add(x);
        }
        for (Object s : AddonLua.list(r.get("seasons"))) {
            Map<String, Object> m = AddonLua.map(s);
            Season x = new Season();
            x.id = AddonLua.str(m.get("id"), "");
            if (x.id.endsWith(".0")) x.id = x.id.substring(0, x.id.length() - 2);
            x.name = AddonLua.str(m.get("name"), "Season " + x.id);
            d.seasons.add(x);
        }
        Map<String, Object> f = AddonLua.map(r.get("focus"));
        d.focusSeason = AddonLua.str(f.get("season"), "");
        d.focusEpisode = AddonLua.str(f.get("episode"), "");
        if (d.buttons.isEmpty() && d.seasons.isEmpty()) d.buttons.add(new Button());
        return d;
    }

    static List<Episode> episodes(Search.Offer o, String seasonId) {
        List<Episode> out = new ArrayList<>();
        AddonEngine e = engine(o.addon);
        if (e == null || !e.answers("episodes")) return out;
        for (Object x : AddonLua.list(e.request("episodes", ASK_MS, o.item, seasonId))) {
            Map<String, Object> m = AddonLua.map(x);
            Episode ep = new Episode();
            ep.title = AddonLua.str(m.get("title"), "");
            ep.thumb = AddonLua.str(m.get("thumb"), "");
            ep.overview = AddonLua.str(m.get("overview"), "");
            ep.progress = (float) AddonLua.num(m.get("progress"), -1);
            ep.id = AddonLua.str(m.get("id"), "");
            ep.item = m;
            out.add(ep);
        }
        return out;
    }

    /** A button or an episode was chosen: the add-on does what it does (korie.play, korie.open…). */
    static void act(String addon, Map<String, Object> item, String buttonId) {
        AddonEngine e = engine(addon);
        if (e == null || !e.running) {
            toast("That add-on is not running");
            return;
        }
        e.fire("action", item, buttonId);
    }

    // ------------------------------------------------------------------ carousel

    static boolean hasHome() {
        for (AddonEngine e : running()) if (e.answers("home")) return true;
        return false;
    }

    /** Titles the add-ons want on the carousel. Not on the UI thread. */
    static List<Suggestions.Item> home(Context c) {
        init(c);
        List<Suggestions.Item> out = new ArrayList<>();
        for (AddonEngine e : running()) {
            if (!e.answers("home")) continue;
            int n = 0;
            for (Object o : AddonLua.list(e.request("home", ASK_MS))) {
                Map<String, Object> m = AddonLua.map(o);
                Suggestions.Item it = new Suggestions.Item();
                it.title = AddonLua.str(m.get("title"), "");
                it.backdrop = AddonLua.str(m.get("backdrop"), "");
                if (it.title.isEmpty() || it.backdrop.isEmpty()) continue;  // the carousel is artwork
                String type = AddonLua.str(m.get("type"), "movie");
                it.type = type.equals("movie") ? "movie" : "tv";
                it.overview = AddonLua.str(m.get("overview"), "");
                it.year = AddonLua.str(m.get("year"), "");
                if (it.year.endsWith(".0")) it.year = it.year.substring(0, it.year.length() - 2);
                it.genres = AddonLua.str(m.get("genres"), "");
                it.rating = AddonLua.num(m.get("rating"), 0);
                it.progress = (float) AddonLua.num(m.get("progress"), -1);  // 0..1: shown as Resume with a bar
                it.remainingMin = (int) AddonLua.num(m.get("remaining"), -1);  // minutes left
                it.addon = e.pack.id;
                it.addonItem = m;
                out.add(it);
                if (++n >= 8) break;
            }
        }
        return out;
    }

    /**
     * Recommendations: a pick of films and series (with artwork) from the lists the add-ons have saved
     * on the device. The pick is the same for one seed and changes with it, so the carousel rotates
     * through what the add-ons have. types: "movie", "tv" or anything else for both.
     */
    static List<Suggestions.Item> recommend(Context c, String types, long seed, int max) {
        init(c);
        List<List<Suggestions.Item>> pools = new ArrayList<>();
        for (AddonEngine e : running()) {
            List<Object> cat = catalogs.get(e.pack.id);
            if (cat == null) continue;
            List<Suggestions.Item> pool = new ArrayList<>();
            for (Object o : cat) {
                Map<String, Object> m = AddonLua.map(o);
                String type = title(m).type;
                if (type.equals("radio") || (types.equals("movie") && !type.equals("movie")) || (types.equals("tv") && !type.equals("tv"))) continue;
                Suggestions.Item it = new Suggestions.Item();
                it.title = AddonLua.str(m.get("title"), "");
                it.backdrop = AddonLua.str(m.get("backdrop"), "");
                if (it.title.isEmpty() || it.backdrop.isEmpty()) continue;  // the carousel is artwork
                it.type = type;
                it.overview = AddonLua.str(m.get("overview"), "");
                it.year = AddonLua.str(m.get("year"), "");
                if (it.year.endsWith(".0")) it.year = it.year.substring(0, it.year.length() - 2);
                it.genres = AddonLua.str(m.get("genres"), "");
                it.rating = AddonLua.num(m.get("rating"), 0);
                it.addon = e.pack.id;
                it.addonItem = m;
                it.key = "rec:" + e.pack.id + ":" + it.title;
                pool.add(it);
            }
            if (!pool.isEmpty()) pools.add(pool);
        }
        java.util.Random rnd = new java.util.Random(seed);
        for (List<Suggestions.Item> pool : pools) java.util.Collections.shuffle(pool, rnd);
        java.util.Collections.shuffle(pools, rnd);
        // One from each add-on in turn, so a big library doesn't crowd out a small one.
        List<Suggestions.Item> out = new ArrayList<>();
        for (int round = 0; out.size() < max; round++) {
            boolean any = false;
            for (List<Suggestions.Item> pool : pools) {
                if (round < pool.size() && out.size() < max) {
                    out.add(pool.get(round));
                    any = true;
                }
            }
            if (!any) break;
        }
        return out;
    }

    /** OK on an add-on's carousel title: its first button (Resume or Play). */
    /** A carousel title as a title page: OK on the carousel opens its page, as Jellyfin's own apps do. */
    static Search.Title homeTitle(Suggestions.Item it) {
        Search.Title t = title(it.addonItem);
        if (t.backdrop.isEmpty()) t.backdrop = it.backdrop;
        AddonEngine e = engine(it.addon);
        if (e != null) t.offers.add(offer(e, it.addonItem));
        return t;
    }

    /** Home sets this: an add-on has heard that something stopped or ended (its server knows now). */
    static volatile Runnable onPlaybackDone;

    static void playbackDone() {
        ui.post(() -> {
            Runnable r = onPlaybackDone;
            if (r != null) r.run();
        });
    }

    static void openHome(Suggestions.Item it) {
        io.execute(() -> {
            Search.Offer o = new Search.Offer();
            o.addon = it.addon;
            o.item = it.addonItem;
            Detail d = detail(o);
            if (!d.buttons.isEmpty()) act(it.addon, it.addonItem, d.buttons.get(0).id);
            else toast("Find " + it.title + " in Search to pick an episode");
        });
    }
}
