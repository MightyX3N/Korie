package com.petrobot.hume;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Korie: Settings → Add-ons, built from the Settings rows and system dialogs that already work with
 * a remote and by touch. Lists the installed add-ons (on/off, remove) and installs new ones from
 * the Download folder or from the add-on list in the Korie repository. Nothing is installed
 * without the question that says what the add-on is and what it uses.
 */
final class AddonUi {
    /** The add-on list (tools/pack-addons.py writes it): {addons: [{id, name, version, description, file}]} — file is relative to this address or a full URL. */
    static final String STORE = "https://raw.githubusercontent.com/MightyX3N/Korie/main/addons/index.json";

    interface Source {
        InputStream open() throws Exception;
    }

    static void page(SettingsActivity a) {
        List<AddonPack> packs = Addons.installed(a);
        for (AddonPack p : packs) {
            a.row(p.name, () -> {
                AddonEngine e = Addons.engine(p.id);
                return !Addons.enabled(a, p.id) ? "Off" : e != null && e.error != null ? "Error" : "On";
            }, () -> manage(a, p));
        }
        if (!packs.isEmpty()) a.section("Install");
        a.row("From the Download folder", () -> "", () -> fromDownloads(a));
        a.row("From the Korie add-on list", () -> "", () -> fromStore(a));
    }

    /** One add-on: on/off, remove, and its own settings (addon.json "settings": toggle, choice or text). */
    static void manage(SettingsActivity a, AddonPack p) {
        boolean on = Addons.enabled(a, p.id);
        AddonEngine e = Addons.engine(p.id);
        List<String> items = new ArrayList<>();
        items.add(on ? "Turn Off" : "Turn On");
        items.add("Remove");
        for (Map<String, Object> def : p.settings) {
            String shown = shown(a, p, def);
            items.add(AddonLua.str(def.get("title"), AddonLua.str(def.get("key"), "")) + (shown.isEmpty() ? "" : ":  " + shown));
        }
        items.add("Version " + p.version + (p.author.isEmpty() ? "" : "  \u00b7  " + p.author)
                + (e != null && e.error != null ? "\nError: " + e.error : ""));
        a.dialog(p.name).setItems(items.toArray(new String[0]), (d, w) -> {
            if (w == 0) {
                Addons.setEnabled(a, p.id, !on);
            } else if (w == 1) {
                Addons.uninstall(a, p.id);
            } else if (w - 2 < p.settings.size()) {
                change(a, p, p.settings.get(w - 2));
                return;
            }
            a.showAndFocus(SettingsActivity.ADDONS, w == 1 ? "From the Download folder" : p.name);
        }).show();
    }

    static Object value(SettingsActivity a, AddonPack p, Map<String, Object> def) {
        String raw = AddonEngine.settingsPrefs(a, p.id).getString(AddonLua.str(def.get("key"), ""), null);
        if (raw == null) return def.get("default");
        try {
            return AddonLua.parseJson(raw);
        } catch (RuntimeException e) {
            return def.get("default");
        }
    }

    /** {value, label} pairs of a choice setting; options are strings or {value=, label=} tables. */
    static List<String[]> options(Map<String, Object> def) {
        List<String[]> out = new ArrayList<>();
        for (Object o : AddonLua.list(def.get("options"))) {
            if (o instanceof Map) {
                String v = AddonLua.str(AddonLua.map(o).get("value"), "");
                out.add(new String[]{v, AddonLua.str(AddonLua.map(o).get("label"), v)});
            } else {
                String v = AddonLua.str(o, "");
                out.add(new String[]{v, v});
            }
        }
        return out;
    }

    static String shown(SettingsActivity a, AddonPack p, Map<String, Object> def) {
        Object v = value(a, p, def);
        String type = AddonLua.str(def.get("type"), "text");
        if (type.equals("toggle")) return AddonLua.bool(v, false) ? "On" : "Off";
        if (type.equals("action")) return AddonLua.str(v, "");  // what the add-on last put there with korie.set_setting
        String s = AddonLua.str(v, "");
        if (type.equals("choice")) {
            for (String[] o : options(def)) if (o[0].equals(s)) return o[1];
            return s.isEmpty() ? "Automatic" : s;
        }
        return s.isEmpty() ? "Not set" : s;
    }

    static void save(SettingsActivity a, AddonPack p, Map<String, Object> def, Object v) {
        String key = AddonLua.str(def.get("key"), "");
        AddonEngine e = Addons.engine(p.id);
        if (e != null) e.setSetting(key, v);  // saves, and tells the running add-on
        else AddonEngine.settingsPrefs(a, p.id).edit().putString(key, AddonLua.toJson(v)).apply();
        manage(a, p);
    }

    static void change(SettingsActivity a, AddonPack p, Map<String, Object> def) {
        String type = AddonLua.str(def.get("type"), "text");
        String title = AddonLua.str(def.get("title"), AddonLua.str(def.get("key"), ""));
        if (type.equals("action")) {  // a button: the add-on takes it from here (korie.ask for questions)
            AddonEngine e = Addons.engine(p.id);
            if (e == null || !e.running) Addons.toast("Turn " + p.name + " on first");
            else e.fire("button", AddonLua.str(def.get("key"), ""));
        } else if (type.equals("toggle")) {
            save(a, p, def, !AddonLua.bool(value(a, p, def), false));
        } else if (type.equals("choice")) {
            List<String[]> opts = options(def);
            String cur = AddonLua.str(value(a, p, def), "");
            String[] labels = new String[opts.size()];
            int at = -1;
            for (int i = 0; i < labels.length; i++) {
                labels[i] = opts.get(i)[1];
                if (opts.get(i)[0].equals(cur)) at = i;
            }
            a.dialog(title).setSingleChoiceItems(labels, at, (d, w) -> {
                d.dismiss();
                save(a, p, def, opts.get(w)[0]);
            }).setOnCancelListener(d -> manage(a, p)).show();
        } else {
            android.widget.EditText in = new android.widget.EditText(a);
            in.setSingleLine(true);
            in.setText(AddonLua.str(value(a, p, def), ""));
            a.dialog(title).setView(in)
                    .setPositiveButton("Save", (d, w) -> save(a, p, def, in.getText().toString().trim()))
                    .setNegativeButton("Cancel", (d, w) -> manage(a, p)).show();
        }
    }

    /** Reads the package, asks, installs. Used by Settings and by "open with Korie". */
    static void install(Activity a, Source src, Runnable after) {
        new Thread(() -> {
            AddonPack staged;
            try {
                staged = Addons.stage(a, src.open());
            } catch (Exception e) {
                Addons.toast("That is not a Korie add-on: " + AddonEngine.message(e));
                a.runOnUiThread(after);
                return;
            }
            a.runOnUiThread(() -> {
                if (a.isFinishing()) {
                    Addons.discard(staged);
                    return;
                }
                StringBuilder m = new StringBuilder();
                if (!staged.description.isEmpty()) m.append(staged.description).append("\n\n");
                m.append("Version ").append(staged.version);
                if (!staged.author.isEmpty()) m.append("  ·  ").append(staged.author);
                List<String> uses = new ArrayList<>();
                if (staged.uses(AddonPack.USE_INTERNET)) uses.add("the internet");
                if (staged.uses(AddonPack.USE_APPS)) uses.add("opening apps and links");
                m.append("\n\nIt can use: ").append(uses.isEmpty() ? "nothing outside Korie" : String.join(", ", uses)).append('.');
                Clicks.dialog(a).setTitle("Install " + staged.name + "?").setMessage(m.toString())
                        .setPositiveButton("Install", (d, w) -> {
                            try {
                                AddonPack done = Addons.commit(a, staged);
                                Addons.toast(done.name + " installed");
                            } catch (Exception e) {
                                Addons.toast("Could not install: " + AddonEngine.message(e));
                            }
                            after.run();
                        })
                        .setNegativeButton("Cancel", (d, w) -> {
                            Addons.discard(staged);
                            after.run();
                        })
                        .setOnCancelListener(d -> {
                            Addons.discard(staged);
                            after.run();
                        }).show();
            });
        }, "addon-install").start();
    }

    // ------------------------------------------------------------------ Download folder

    static boolean canReadDownloads(Activity a) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return a.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    static void fromDownloads(SettingsActivity a) {
        if (!canReadDownloads(a)) {
            if (Build.VERSION.SDK_INT < 30) {
                a.requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE}, 77);
                return;
            }
            Clicks.dialog(a).setTitle("Allow access to files")
                    .setMessage("To find add-on files in the Download folder, allow Korie to access files on the next screen, then come back.\n\n"
                            + "Or open the .korie file from a file manager and choose Korie.")
                    .setPositiveButton("Continue", (d, w) -> {
                        try {
                            a.startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + a.getPackageName())));
                        } catch (Exception e) {
                            try {
                                a.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                            } catch (Exception e2) {
                                Addons.toast("This device has no screen for that. Open the .korie file from a file manager instead.");
                            }
                        }
                    }).setNegativeButton("Cancel", null).show();
            return;
        }
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File[] all = dir.listFiles();
        List<File> files = new ArrayList<>();
        if (all != null) for (File f : all) if (f.isFile() && f.getName().toLowerCase().endsWith(".korie")) files.add(f);
        if (files.isEmpty()) {
            Clicks.dialog(a).setTitle("No add-on files").setMessage("There are no .korie files in " + dir.getAbsolutePath() + ".")
                    .setPositiveButton("OK", null).show();
            return;
        }
        String[] names = new String[files.size()];
        for (int i = 0; i < names.length; i++) names[i] = files.get(i).getName();
        a.dialog("Download folder").setItems(names, (d, w) ->
                install(a, () -> new FileInputStream(files.get(w)), () -> a.showAndFocus(SettingsActivity.ADDONS, "From the Download folder"))).show();
    }

    // ------------------------------------------------------------------ add-on list (repository)

    static byte[] fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "Korie/" + Addons.appVersion(Addons.app));
        try {
            if (c.getResponseCode() != 200) throw new Exception("the add-on list answered " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                return AddonEngine.readCapped(in, 32L * 1024 * 1024);
            }
        } finally {
            c.disconnect();
        }
    }

    static void fromStore(SettingsActivity a) {
        Addons.toast("Getting the add-on list…");
        new Thread(() -> {
            List<Object> list;
            try {
                Object parsed = AddonLua.parseJson(new String(fetch(Updater.storeUrl(a)), StandardCharsets.UTF_8));
                list = AddonLua.list(parsed instanceof Map ? AddonLua.map(parsed).get("addons") : parsed);
            } catch (Exception e) {
                Addons.toast("Could not get the add-on list: " + AddonEngine.message(e));
                return;
            }
            a.runOnUiThread(() -> {
                if (a.isFinishing()) return;
                if (list.isEmpty()) {
                    Clicks.dialog(a).setTitle("Add-on list").setMessage("The list has no add-ons yet.").setPositiveButton("OK", null).show();
                    return;
                }
                String[] names = new String[list.size()];
                for (int i = 0; i < names.length; i++) {
                    Map<String, Object> m = AddonLua.map(list.get(i));
                    names[i] = AddonLua.str(m.get("name"), "?") + "   " + AddonLua.str(m.get("version"), "");
                }
                a.dialog("Add-on list").setItems(names, (d, w) -> {
                    String file = AddonLua.str(AddonLua.map(list.get(w)).get("file"), "");
                    String url = file.startsWith("http") ? file : Updater.storeUrl(a).substring(0, Updater.storeUrl(a).lastIndexOf('/') + 1) + file;
                    install(a, () -> new ByteArrayInputStream(fetch(url)), () -> a.showAndFocus(SettingsActivity.ADDONS, "From the Korie add-on list"));
                }).show();
            });
        }, "addon-list").start();
    }
}
