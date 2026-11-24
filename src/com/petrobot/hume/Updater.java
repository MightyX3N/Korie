package com.petrobot.hume;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Korie: updates from the Korie repository on GitHub. Once a day (and from Settings → About →
 * Update) Korie reads two small files there: update.json (the newest version of the app and where
 * its APK is, on the repository's "apk" branch) and addons/index.json (the add-on list).
 *
 * Add-ons are updated at once when the list has a newer version, as long as the new version uses
 * nothing more than the installed one; otherwise it waits for the usual install question. The app
 * itself is only offered: the user starts it in Settings, Korie downloads the APK and hands it to
 * Android's own installer, which asks before installing (Android installs it only when it is
 * signed with the same key as the installed Korie).
 */
final class Updater {
    static final String BASE = "https://raw.githubusercontent.com/MightyX3N/Korie/main/";
    static final long DAY_MS = 24L * 3600 * 1000;
    static volatile String busy = "";  // "", "Checking…" or "Downloading…"

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("update", Context.MODE_PRIVATE);
    }

    /** Where the two files are read from (the test hook can point this somewhere else). */
    static String base(Context c) {
        return prefs(c).getString("base", BASE);
    }

    static String storeUrl(Context c) {
        return base(c) + "addons/index.json";
    }

    static long installedCode(Context c) {
        try {
            android.content.pm.PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    static boolean available(Context c) {
        return prefs(c).getLong("code", 0) > installedCode(c);
    }

    /** What the Update row shows. */
    static String state(Context c) {
        if (!busy.isEmpty()) return busy;
        if (available(c)) return "Version " + prefs(c).getString("version", "") + " available";
        return prefs(c).getLong("checked", 0) == 0 ? "Check now" : "Up to date";
    }

    /** a newer than b, comparing dotted numbers ("1.10" is newer than "1.9"). */
    static boolean newer(String a, String b) {
        String[] x = a.trim().split("\\."), y = b.trim().split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            long p = part(x, i), q = part(y, i);
            if (p != q) return p > q;
        }
        return false;
    }

    private static long part(String[] v, int i) {
        try {
            return i < v.length ? Long.parseLong(v[i].replaceAll("[^0-9]", "")) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Home calls this when it comes to the front: a quiet check once a day. */
    static void auto(Context c) {
        Context app = c.getApplicationContext();
        if (!busy.isEmpty() || System.currentTimeMillis() - prefs(app).getLong("checked", 0) < DAY_MS) return;
        check(app, false, null);
    }

    /** Reads both files, updates the add-ons, remembers whether the app has an update. Runs on its own thread. */
    static void check(Context c, boolean manual, Runnable changed) {
        if (!busy.isEmpty()) return;
        busy = "Checking…";
        if (changed != null) changed.run();
        new Thread(() -> {
            StringBuilder said = new StringBuilder();
            boolean reached = false;
            try {
                Map<String, Object> m = AddonLua.map(AddonLua.parseJson(new String(fetch(c, base(c) + "update.json", 1 << 20), StandardCharsets.UTF_8)));
                long code = (long) AddonLua.num(m.get("code"), 0);
                prefs(c).edit().putLong("code", code).putString("version", AddonLua.str(m.get("version"), ""))
                        .putString("apk", AddonLua.str(m.get("apk"), "")).apply();
                reached = true;
                if (code > installedCode(c)) {
                    // Said once per version when found by the daily check; always when asked for.
                    if (manual || prefs(c).getLong("told", 0) != code) {
                        said.append("Korie ").append(prefs(c).getString("version", "")).append(" is available")
                                .append(manual ? ". Press Update again to install it." : ": Settings → About → Update");
                        prefs(c).edit().putLong("told", code).apply();
                    }
                } else if (manual) {
                    said.append("Korie is up to date");
                }
            } catch (Exception e) {
                android.util.Log.w("KorieUpdate", "app: " + e);
                if (manual) said.append("Could not check for updates: ").append(AddonEngine.message(e));
            }
            if (reached) {
                try {
                    for (String s : updateAddons(c, manual)) said.append(said.length() > 0 ? "\n" : "").append(s);
                } catch (Exception e) {
                    android.util.Log.w("KorieUpdate", "add-ons: " + e);
                }
                prefs(c).edit().putLong("checked", System.currentTimeMillis()).apply();
            }
            busy = "";
            if (said.length() > 0) Addons.toast(said.toString());
            if (changed != null) changed.run();
        }, "korie-update").start();
    }

    /** Updates every installed add-on the list has a newer version of. Returns what to tell the user. */
    static List<String> updateAddons(Context c, boolean manual) throws Exception {
        List<String> said = new ArrayList<>();
        String store = storeUrl(c);
        Object parsed = AddonLua.parseJson(new String(fetch(c, store, 1 << 20), StandardCharsets.UTF_8));
        List<Object> list = AddonLua.list(parsed instanceof Map ? AddonLua.map(parsed).get("addons") : parsed);
        for (AddonPack have : Addons.installed(c)) {
            for (Object o : list) {
                Map<String, Object> m = AddonLua.map(o);
                if (!have.id.equals(AddonLua.str(m.get("id"), "")) || !newer(AddonLua.str(m.get("version"), ""), have.version)) continue;
                String file = AddonLua.str(m.get("file"), "");
                String url = file.startsWith("http") ? file : store.substring(0, store.lastIndexOf('/') + 1) + file;
                AddonPack staged = null;
                try {
                    staged = Addons.stage(c, new ByteArrayInputStream(fetch(c, url, 32L << 20)));
                    if (!staged.id.equals(have.id) || !newer(staged.version, have.version)) {
                        Addons.discard(staged);
                    } else if (!have.uses.containsAll(staged.uses)) {
                        // It asks for more than the installed version: that needs the install question.
                        Addons.discard(staged);
                        if (manual) said.add(have.name + " " + staged.version + " asks to use more. Install it from Settings → Add-ons → From the Korie add-on list.");
                    } else {
                        AddonPack done = Addons.commit(c, staged);
                        said.add(done.name + " updated to " + done.version);
                    }
                } catch (Exception e) {
                    Addons.discard(staged);
                    android.util.Log.w("KorieUpdate", have.id + ": " + e);
                }
            }
        }
        return said;
    }

    /** OK on the Update row: install the update that was found, or look for one. */
    static void pressed(Activity a, Runnable changed) {
        Runnable onUi = () -> a.runOnUiThread(changed);
        if (!busy.isEmpty()) return;
        if (!available(a)) {
            check(a.getApplicationContext(), true, onUi);
            return;
        }
        Context c = a.getApplicationContext();
        String url = prefs(c).getString("apk", ""), version = prefs(c).getString("version", "");
        busy = "Downloading…";
        changed.run();
        Addons.toast("Downloading Korie " + version + "…");
        new Thread(() -> {
            try {
                install(c, url);
            } catch (Exception e) {
                android.util.Log.w("KorieUpdate", "install: " + e);
                Addons.toast("Could not update: " + AddonEngine.message(e));
            }
            busy = "";
            onUi.run();
        }, "korie-update").start();
    }

    /** Streams the APK into Android's installer; UpdateReceiver hears what happens next. */
    static void install(Context c, String url) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(c.getPackageName());
        // Android 12+: once Korie has updated itself one time, later updates need no question.
        if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(sp);
        PackageInstaller.Session s = pi.openSession(id);
        HttpURLConnection h = open(c, url);
        try {
            if (h.getResponseCode() != 200) throw new Exception("GitHub answered " + h.getResponseCode());
            try (InputStream in = h.getInputStream(); OutputStream out = s.openWrite("korie.apk", 0, h.getContentLength())) {
                byte[] buf = new byte[65536];
                long total = 0;
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if ((total += n) > 200L << 20) throw new Exception("the download is too big");
                }
                s.fsync(out);
            }
            Intent done = new Intent(c, UpdateReceiver.class);
            PendingIntent pend = PendingIntent.getBroadcast(c, id, done,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
            s.commit(pend.getIntentSender());
        } catch (Exception e) {
            s.abandon();
            throw e;
        } finally {
            h.disconnect();
        }
    }

    static HttpURLConnection open(Context c, String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();  // follows GitHub's redirect to the file
        h.setConnectTimeout(10000);
        h.setReadTimeout(30000);
        h.setRequestProperty("User-Agent", "Korie/" + Addons.appVersion(c));
        return h;
    }

    static byte[] fetch(Context c, String url, long cap) throws Exception {
        HttpURLConnection h = open(c, url);
        try {
            if (h.getResponseCode() != 200) throw new Exception("GitHub answered " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                return AddonEngine.readCapped(in, cap);
            }
        } finally {
            h.disconnect();
        }
    }
}
