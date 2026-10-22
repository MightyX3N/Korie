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

        // Left: large title, vertically centred (tvOS settings layout).
        TextView title = new TextView(this);
        title.setText("Settings");
        title.setTextColor(Color.WHITE);
        title.setTypeface(Ui.font(this, "display"));
        title.setLetterSpacing(-0.02f);
        Ui.textSize(title, 34);
        title.setGravity(Gravity.CENTER);
        split.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

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
        row("About", () -> "Hume Launcher", () -> { });

        setContentView(root);
        if (list.getChildCount() > 1) list.getChildAt(1).requestFocus();
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
