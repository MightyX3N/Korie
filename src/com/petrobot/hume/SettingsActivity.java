package com.petrobot.hume;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * tvOS-style settings, opened from the profile capsule: title on the left, a list of rows on the
 * right. Covers the suggestions carousel (source, on/off, movies/series, services, languages,
 * auto-advance, TMDB token), home background and layout, and a shortcut to the TV's own settings.
 *
 * A TMDB token can also be supplied over adb:
 *   adb shell am start -n com.petrobot.hume/.SettingsActivity --es tmdb_token &lt;token&gt;
 */
public class SettingsActivity extends Activity {

    LinearLayout list;
    final List<Runnable> refreshers = new ArrayList<>();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        String token = getIntent().getStringExtra("tmdb_token");
        if (token != null && !token.trim().isEmpty()) {
            Suggestions.prefs(this).edit().putString(Suggestions.K_TOKEN, token.trim()).apply();
            Suggestions.changed(this);
            Toast.makeText(this, "TMDB connected", Toast.LENGTH_SHORT).show();
        }
        build();
    }

    void build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0B10);

        LinearLayout split = new LinearLayout(this);
        split.setOrientation(LinearLayout.HORIZONTAL);
        root.addView(split, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Left: app icon over a large title, vertically centred (tvOS settings layout).
        LinearLayout left = new LinearLayout(this);
        left.setOrientation(LinearLayout.VERTICAL);
        left.setGravity(Gravity.CENTER);
        // Petrobot's mark on a white 5:3 tile, the same shape and radius as the Home cards.
        FrameLayout icon = new FrameLayout(this);
        GradientDrawable plate = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFFFFFFFF, 0xFFE9EAEE});
        plate.setCornerRadius(Ui.px(this, 12));
        icon.setBackground(plate);
        icon.setElevation(Ui.px(this, 8));
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.petrobot_mark);
        mark.setScaleType(ImageView.ScaleType.FIT_CENTER);
        icon.addView(mark, new FrameLayout.LayoutParams(Ui.px(this, 58), Ui.px(this, 58), Gravity.CENTER));
        left.addView(icon, new LinearLayout.LayoutParams(Ui.px(this, 150), Ui.px(this, 90)));

        TextView title = new TextView(this);
        title.setText("Settings");
        title.setTextColor(Color.WHITE);
        title.setTypeface(Ui.font(this, "display"));
        title.setLetterSpacing(-0.02f);
        Ui.textSize(title, 34);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tlp.topMargin = Ui.px(this, 22);
        left.addView(title, tlp);

        TextView by = new TextView(this);
        by.setText("Hume Launcher by Petrobot");
        by.setTextColor(0x8CFFFFFF);
        by.setTypeface(Ui.font(this, "regular"));
        Ui.textSize(by, 13);
        left.addView(by);
        split.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        ScrollView sv = new ScrollView(this);
        sv.setVerticalScrollBarEnabled(false);
        sv.setClipToPadding(false);
        sv.setPadding(0, Ui.px(this, 40), Ui.px(this, 44), Ui.px(this, 40));
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setClipChildren(false);
        list.setClipToPadding(false);
        list.setPadding(Ui.px(this, 12), 0, Ui.px(this, 12), 0);
        sv.setClipChildren(false);
        sv.addView(list);
        split.addView(sv, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1.25f));

        section("Profiles");
        row("Current profile", () -> Profiles.current(this).name, () -> {
            startActivity(new Intent(this, MainActivity.class).putExtra("pick_profile", true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        row("Show profiles on wake", () -> Profiles.askOnWake(this) ? "On" : "Off",
                () -> Profiles.setAskOnWake(this, !Profiles.askOnWake(this)));

        section("Presentation");
        row("Presentation mode", () -> com.petrobot.hume.present.Presenter.enabled(this) ? "On" : "Off", () -> {
            boolean on = !com.petrobot.hume.present.Presenter.enabled(this);
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_ENABLED, on);
            if (on) Toast.makeText(this, "Presentation is on. Send content from a browser.", Toast.LENGTH_LONG).show();
        });
        row("Start on boot", () -> com.petrobot.hume.present.Presenter.startOnBoot(this) ? "On" : "Off", () ->
                com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_BOOT,
                        !com.petrobot.hume.present.Presenter.startOnBoot(this)));
        row("Keep screen awake", () -> com.petrobot.hume.present.Presenter.keepAwake(this) ? "On" : "Off", () ->
                com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_AWAKE,
                        !com.petrobot.hume.present.Presenter.keepAwake(this)));
        row("Show code when starting", () -> com.petrobot.hume.present.Presenter.showInfoOnStart(this) ? "On" : "Off", () ->
                com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_INFO,
                        !com.petrobot.hume.present.Presenter.showInfoOnStart(this)));
        row("Address & pairing code", () -> com.petrobot.hume.present.Presenter.enabled(this)
                ? com.petrobot.hume.present.Presenter.address().replace("http://", "") : "Turn on first", this::showPresentInfo);
        row("Start presentation now", () -> "", () -> {
            if (!com.petrobot.hume.present.Presenter.enabled(this)) {
                com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_ENABLED, true);
            }
            com.petrobot.hume.present.Presenter.open(this);
        });

        section("Weather");
        row("Show weather", () -> Weather.enabled(this) ? "On" : "Off", () -> {
            Weather.prefs(this).edit().putBoolean(Weather.K_ENABLED, !Weather.enabled(this)).apply();
            Weather.changed(this);
        });
        row("Location", () -> Weather.manual(this) ? Weather.place(this)
                : Weather.place(this).isEmpty() ? "Automatic" : "Automatic \u00b7 " + Weather.place(this), this::chooseLocation);
        row("Source", () -> Weather.sourceName(Weather.source(this)), () -> {
            String[] keys = Weather.SOURCES;
            String[] names = {"Open-Meteo", "MET Norway (Yr)", "wttr.in  (3 days)"};
            int sel = java.util.Arrays.asList(keys).indexOf(Weather.source(this));
            dialog("Weather source").setMessage(null).setSingleChoiceItems(names, Math.max(0, sel), (d, w) -> {
                Weather.prefs(this).edit().putString(Weather.K_SOURCE, keys[w]).apply();
                Weather.changed(this);
                refreshAll();
                d.dismiss();
                Toast.makeText(this, "If it can't be reached, the other sources are used.", Toast.LENGTH_LONG).show();
            }).show();
        });
        row("Update every", () -> Weather.refreshMinutes(this) + " minutes", () -> {
            int[] mins = Weather.REFRESH_CHOICES;
            String[] names = new String[mins.length];
            int sel = 1;
            for (int i = 0; i < mins.length; i++) {
                names[i] = mins[i] + " minutes" + (mins[i] == 15 ? "  (default)" : "");
                if (mins[i] == Weather.refreshMinutes(this)) sel = i;
            }
            dialog("Update weather every").setSingleChoiceItems(names, sel, (d, w) -> {
                Weather.prefs(this).edit().putInt(Weather.K_REFRESH, mins[w]).apply();
                refreshAll();
                d.dismiss();
            }).show();
        });
        row("Temperature", () -> {
            String u = Weather.prefs(this).getString(Weather.K_UNITS, "auto");
            return u.equals("c") ? "Celsius" : u.equals("f") ? "Fahrenheit" : "Automatic";
        }, () -> {
            String[] keys = {"auto", "c", "f"};
            String[] names = {"Automatic", "Celsius (\u00b0C)", "Fahrenheit (\u00b0F)"};
            String cur = Weather.prefs(this).getString(Weather.K_UNITS, "auto");
            int sel = cur.equals("c") ? 1 : cur.equals("f") ? 2 : 0;
            dialog("Temperature").setSingleChoiceItems(names, sel, (d, w) -> {
                Weather.prefs(this).edit().putString(Weather.K_UNITS, keys[w]).apply();
                Weather.changed(this);
                refreshAll();
                d.dismiss();
            }).show();
        });

        section("Suggestions");
        row("Show suggestions", () -> Suggestions.enabled(this) ? "On" : "Off", () -> {
            Suggestions.prefs(this).edit().putBoolean(Suggestions.K_ENABLED, !Suggestions.enabled(this)).apply();
            Suggestions.changed(this);
        });
        row("Source", () -> Suggestions.source(this).equals(Suggestions.SRC_TMDB) ? "TMDB" : "JustWatch", this::chooseSource);
        row("Content", () -> {
            String t = Suggestions.types(this);
            return t.equals("movie") ? "Movies" : t.equals("tv") ? "TV Series" : "Movies & Series";
        }, this::chooseTypes);
        row("Streaming services", () -> {
            int n = Suggestions.providers(this).size();
            return n == Suggestions.PROVIDERS.size() ? "All" : n + " selected";
        }, this::chooseProviders);
        row("Languages", () -> {
            Set<String> l = Suggestions.languages(this);
            if (l.isEmpty()) return "Any";
            List<String> names = new ArrayList<>();
            for (int i = 0; i < Suggestions.LANG_CODES.length; i++) {
                if (l.contains(Suggestions.LANG_CODES[i])) names.add(Suggestions.LANG_NAMES[i]);
            }
            return names.size() > 2 ? names.size() + " languages" : String.join(", ", names);
        }, this::chooseLanguages);
        row("Auto-advance", () -> {
            int s = Suggestions.advanceSeconds(this);
            return s == 0 ? "Off" : "Every " + s + " s";
        }, this::chooseAdvance);
        row("Refresh now", () -> "", () -> {
            Suggestions.changed(this);
            Toast.makeText(this, "Suggestions will refresh on Home", Toast.LENGTH_SHORT).show();
        });
        row("TMDB token", () -> Suggestions.hasToken(this) ? "Connected" : "Not set", this::enterToken);

        section("Continue Watching");
        row("Access", () -> MediaWatchService.granted(this) ? "On" : "Off", () -> {
            if (MediaWatchService.granted(this)) return;
            Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            if (i.resolveActivity(getPackageManager()) != null && Suggestions.start(this, i)) return;
            dialog("Turn on Continue Watching")
                    .setMessage("Hume Launcher learns what you watch from the media info apps share while playing. "
                            + "This TV has no on-screen switch for it, so enable it once from a computer:\n\n"
                            + "adb shell cmd notification allow_listener com.petrobot.hume/com.petrobot.hume.MediaWatchService")
                    .setPositiveButton("OK", null).show();
        });
        row("Clear history", () -> "", () -> {
            MediaWatchService.Store.clear(this);
            Toast.makeText(this, "Continue Watching cleared", Toast.LENGTH_SHORT).show();
        });

        section("Home");
        row("Background", () -> {
            String k = Profiles.homePrefs(this).getString("wallpaper", "aurora");
            int i = java.util.Arrays.asList(MainActivity.WALL_KEYS).indexOf(k);
            return MainActivity.WALL_NAMES[Math.max(0, i)];
        }, () -> {
            String k = Profiles.homePrefs(this).getString("wallpaper", "aurora");
            int cur = Math.max(0, java.util.Arrays.asList(MainActivity.WALL_KEYS).indexOf(k));
            dialog("Background").setSingleChoiceItems(MainActivity.WALL_NAMES, cur, (d, w) -> {
                Profiles.homePrefs(this).edit().putString("wallpaper", MainActivity.WALL_KEYS[w]).apply();
                refreshAll();
                d.dismiss();
            }).show();
        });
        row("Reset app layout", () -> "", () -> {
            Profiles.homePrefs(this).edit().remove("order").apply();
            Toast.makeText(this, "Layout reset", Toast.LENGTH_SHORT).show();
        });

        section("System");
        row("TV settings", () -> "", () -> Suggestions.start(this, new Intent(Settings.ACTION_SETTINGS)));
        row("About", () -> "Petrobot \u00b7 Version " + version(), () -> { });

        setContentView(root);
        if (list.getChildCount() > 1) list.getChildAt(1).requestFocus();
    }

    String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    void section(String name) {
        TextView t = new TextView(this);
        t.setText(name.toUpperCase());
        t.setTextColor(0x8CFFFFFF);
        t.setTypeface(Ui.font(this, "medium"));
        t.setLetterSpacing(0.06f);
        Ui.textSize(t, 11);
        t.setPadding(Ui.px(this, 14), Ui.px(this, 18), 0, Ui.px(this, 6));
        list.addView(t);
    }

    interface Value {
        String get();
    }

    /** A settings row: label left, current value right; focus lifts it onto a light plate. */
    void row(String label, Value value, Runnable action) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setFocusable(true);
        r.setClickable(true);
        int padH = Ui.px(this, 16);
        r.setPadding(padH, 0, padH, 0);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(Ui.px(this, 10));
        bg.setColor(0x14FFFFFF);
        r.setBackground(bg);

        TextView l = new TextView(this);
        l.setText(label);
        l.setTextColor(Color.WHITE);
        l.setTypeface(Ui.font(this, "medium"));
        Ui.textSize(l, 15);
        r.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView v = new TextView(this);
        v.setTextColor(0x99FFFFFF);
        v.setTypeface(Ui.font(this, "regular"));
        Ui.textSize(v, 15);
        r.addView(v);
        Runnable refresh = () -> v.setText(value.get());
        refresh.run();
        refreshers.add(refresh);

        r.setOnFocusChangeListener((view, has) -> {
            bg.setColor(has ? 0xF2FFFFFF : 0x14FFFFFF);
            l.setTextColor(has ? 0xFF111114 : Color.WHITE);
            v.setTextColor(has ? 0x99111114 : 0x99FFFFFF);
            view.animate().withLayer().scaleX(has ? 1.03f : 1f).scaleY(has ? 1.03f : 1f).setDuration(180).start();
        });
        r.setOnClickListener(view -> {
            action.run();
            for (Runnable x : refreshers) x.run();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.px(this, 40));
        lp.bottomMargin = Ui.px(this, 6);
        list.addView(r, lp);
    }

    AlertDialog.Builder dialog(String title) {
        return new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert).setTitle(title);
    }

    void refreshAll() {
        for (Runnable x : refreshers) x.run();
    }

    void chooseSource() {
        String[] keys = {Suggestions.SRC_JUSTWATCH, Suggestions.SRC_TMDB};
        String[] names = {"JustWatch  (no setup needed)", "TMDB  (needs a free token)"};
        int cur = Suggestions.source(this).equals(Suggestions.SRC_TMDB) ? 1 : 0;
        dialog("Recommendation source").setSingleChoiceItems(names, cur, (d, w) -> {
            Suggestions.prefs(this).edit().putString(Suggestions.K_SOURCE, keys[w]).apply();
            Suggestions.changed(this);
            refreshAll();
            d.dismiss();
            if (w == 1 && !Suggestions.hasToken(this)) enterToken();
        }).show();
    }

    /** Token entry on the TV itself (no adb needed). Accepts the v4 read token or the short v3 API key. */
    void enterToken() {
        android.widget.EditText in = new android.widget.EditText(this);
        in.setSingleLine(true);
        in.setHint("v3 API key (32 characters) or read-access token");
        in.setText(Suggestions.prefs(this).getString(Suggestions.K_TOKEN, ""));
        in.setSelection(in.getText().length());
        in.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        int pad = Ui.px(this, 14);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(in);
        dialog("TMDB token")
                .setMessage("Get it free at themoviedb.org → Settings → API. The short \"API Key\" is easiest to type.")
                .setView(box)
                .setPositiveButton("Save", (d, w) -> {
                    Suggestions.prefs(this).edit().putString(Suggestions.K_TOKEN, in.getText().toString().trim()).apply();
                    Suggestions.changed(this);
                    refreshAll();
                })
                .setNeutralButton("Clear", (d, w) -> {
                    Suggestions.prefs(this).edit().remove(Suggestions.K_TOKEN).apply();
                    Suggestions.changed(this);
                    refreshAll();
                })
                .setNegativeButton("Cancel", null)
                .show();
        in.requestFocus();
    }

    /** Automatic (from the internet address) or a city found by name. */
    void chooseLocation() {
        String[] names = {"Automatic", "Choose City\u2026"};
        dialog("Weather location").setSingleChoiceItems(names, Weather.manual(this) ? 1 : 0, (d, w) -> {
            d.dismiss();
            if (w == 0) {
                Weather.setPlace(this, null);
                refreshAll();
            } else {
                searchCity();
            }
        }).show();
    }

    void searchCity() {
        android.widget.EditText in = new android.widget.EditText(this);
        in.setSingleLine(true);
        in.setHint("City name, e.g. Bengaluru");
        in.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        int pad = Ui.px(this, 14);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(in);
        dialog("Choose City")
                .setView(box)
                .setPositiveButton("Search", (d, w) -> {
                    String q = in.getText().toString().trim();
                    if (q.isEmpty()) return;
                    new Thread(() -> {
                        List<Weather.Place> found;
                        try {
                            found = Weather.search(q);
                        } catch (Exception e) {
                            found = null;
                        }
                        List<Weather.Place> res = found;
                        runOnUiThread(() -> showCities(q, res));
                    }).start();
                })
                .setNegativeButton("Cancel", null)
                .show();
        in.requestFocus();
    }

    void showCities(String q, List<Weather.Place> res) {
        if (isFinishing()) return;
        if (res == null) {
            Toast.makeText(this, "Couldn't search. Check the internet connection.", Toast.LENGTH_LONG).show();
            return;
        }
        if (res.isEmpty()) {
            Toast.makeText(this, "No city called \u201c" + q + "\u201d", Toast.LENGTH_LONG).show();
            return;
        }
        String[] names = new String[res.size()];
        for (int i = 0; i < names.length; i++) {
            Weather.Place pl = res.get(i);
            names[i] = pl.detail.isEmpty() ? pl.name : pl.name + "  \u00b7  " + pl.detail;
        }
        dialog("Choose City").setItems(names, (d, w) -> {
            Weather.setPlace(this, res.get(w));
            refreshAll();
        }).setNegativeButton("Cancel", null).show();
    }

    /** Address, QR and pairing code for sending content from a phone or computer. */
    void showPresentInfo() {
        if (!com.petrobot.hume.present.Presenter.enabled(this)) {
            Toast.makeText(this, "Turn on Presentation mode first", Toast.LENGTH_SHORT).show();
            return;
        }
        com.petrobot.hume.present.Presenter.ensureRunning(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Ui.px(this, 16);
        box.setPadding(pad, pad, pad, pad / 2);
        android.widget.ImageView qr = new android.widget.ImageView(this);
        qr.setImageBitmap(com.petrobot.hume.present.Presenter.qr(Ui.px(this, 110)));
        qr.setBackgroundColor(Color.WHITE);
        qr.setPadding(Ui.px(this, 6), Ui.px(this, 6), Ui.px(this, 6), Ui.px(this, 6));
        box.addView(qr, new LinearLayout.LayoutParams(Ui.px(this, 122), Ui.px(this, 122)));
        TextView info = new TextView(this);
        String pin = com.petrobot.hume.present.Presenter.pin(this);
        info.setText("Open on a phone or computer on the same Wi-Fi:\n\n"
                + com.petrobot.hume.present.Presenter.address() + "\n\nPairing code\n"
                + pin.substring(0, 3) + " " + pin.substring(3));
        info.setTextColor(Color.WHITE);
        info.setTypeface(Ui.font(this, "medium"));
        Ui.textSize(info, 14);
        info.setPadding(Ui.px(this, 18), 0, 0, 0);
        box.addView(info);
        dialog("Send to this TV").setView(box).setPositiveButton("Done", null).show();
    }

    void chooseTypes() {
        String[] keys = {"both", "movie", "tv"};
        String[] names = {"Movies & Series", "Movies", "TV Series"};
        int cur = java.util.Arrays.asList(keys).indexOf(Suggestions.types(this));
        dialog("Content").setSingleChoiceItems(names, cur, (d, w) -> {
            Suggestions.prefs(this).edit().putString(Suggestions.K_TYPES, keys[w]).apply();
            Suggestions.changed(this);
            refreshAll();
            d.dismiss();
        }).show();
    }

    void chooseProviders() {
        int n = Suggestions.PROVIDERS.size();
        String[] names = new String[n];
        boolean[] on = new boolean[n];
        Set<String> cur = Suggestions.providers(this);
        for (int i = 0; i < n; i++) {
            Suggestions.Provider p = Suggestions.PROVIDERS.get(i);
            names[i] = p.name + (Suggestions.installed(this, p.pkg) ? "" : "  (not installed)");
            on[i] = cur.contains(String.valueOf(p.id));
        }
        dialog("Streaming services").setMultiChoiceItems(names, on, (d, w, c) -> on[w] = c)
                .setPositiveButton("Done", (d, w) -> {
                    Set<String> sel = new java.util.HashSet<>();
                    for (int i = 0; i < n; i++) if (on[i]) sel.add(String.valueOf(Suggestions.PROVIDERS.get(i).id));
                    if (sel.isEmpty()) {
                        Toast.makeText(this, "Keep at least one service", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Suggestions.prefs(this).edit().putStringSet(Suggestions.K_PROVIDERS, sel).apply();
                    Suggestions.changed(this);
                    refreshAll();
                }).setNegativeButton("Cancel", null).show();
    }

    void chooseLanguages() {
        int n = Suggestions.LANG_CODES.length;
        boolean[] on = new boolean[n];
        Set<String> cur = Suggestions.languages(this);
        for (int i = 0; i < n; i++) on[i] = cur.contains(Suggestions.LANG_CODES[i]);
        dialog(Suggestions.source(this).equals(Suggestions.SRC_TMDB) ? "Languages (none = any)" : "Languages (TMDB source only)")
                .setMultiChoiceItems(Suggestions.LANG_NAMES, on, (d, w, c) -> on[w] = c)
                .setPositiveButton("Done", (d, w) -> {
                    Set<String> sel = new java.util.HashSet<>();
                    for (int i = 0; i < n; i++) if (on[i]) sel.add(Suggestions.LANG_CODES[i]);
                    Suggestions.prefs(this).edit().putStringSet(Suggestions.K_LANGS, sel).apply();
                    Suggestions.changed(this);
                    refreshAll();
                }).setNegativeButton("Cancel", null).show();
    }

    void chooseAdvance() {
        int[] secs = {0, 6, 8, 12};
        String[] names = {"Off", "Every 6 s", "Every 8 s", "Every 12 s"};
        int cur = 0;
        for (int i = 0; i < secs.length; i++) if (secs[i] == Suggestions.advanceSeconds(this)) cur = i;
        dialog("Auto-advance").setSingleChoiceItems(names, cur, (d, w) -> {
            Suggestions.prefs(this).edit().putInt(Suggestions.K_ADVANCE, secs[w]).apply();
            refreshAll();
            d.dismiss();
        }).show();
    }
}
