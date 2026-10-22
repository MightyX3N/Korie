package com.petrobot.hume;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * First-time setup, in the style of Apple TV's own setup: one question per page, a large title
 * and a short line of help at the top, choices as a centred list (white when focused), OK moves
 * on and Back goes back. Pages: Welcome (in many languages), your profile, look, top shelf, weather, presentation,
 * home screen & permissions, done. Shown once; Settings \u2192 Home \u2192 Run Setup Again repeats it.
 */
public class SetupActivity extends Activity {
    static final String K_DONE = "setup_done";

    FrameLayout root;
    ImageView backdrop;
    LinearLayout page;
    int index = 0;
    final Handler handler = new Handler(Looper.getMainLooper());

    interface Step {
        void build();
    }

    final List<Step> steps = new ArrayList<>();

    static boolean done(Activity a) {
        return a.getSharedPreferences("setup", MODE_PRIVATE).getBoolean(K_DONE, false);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        backdrop = new ImageView(this);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        backdrop.setAlpha(0f);
        root.addView(backdrop, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        View dim = new View(this);
        dim.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0x99000000, 0x66000000, 0xB3000000}));
        root.addView(dim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.setClipChildren(false);
        page.setClipToPadding(false);
        FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        page.setPadding(0, u(70), 0, u(40));
        root.addView(page, plp);
        setContentView(root);

        steps.add(this::hello);
        steps.add(this::profile);
        steps.add(this::look);
        steps.add(this::shelf);
        steps.add(this::weather);
        steps.add(this::presentation);
        steps.add(this::homeAndPermissions);
        steps.add(this::finish_);
        show(getIntent().getIntExtra("step", 0), 0);  // adb: --ei step N opens a page directly
    }

    int u(float v) {
        return Ui.px(this, v);
    }

    // ---------------------------------------------------------------- navigation

    void show(int i, int dir) {
        handler.removeCallbacksAndMessages(null);
        index = Math.max(0, Math.min(i, steps.size() - 1));
        page.animate().cancel();
        page.removeAllViews();
        steps.get(index).build();
        page.setAlpha(0f);
        page.setTranslationX(u(30) * dir);
        page.animate().alpha(1f).translationX(0).setDuration(320).start();
    }

    void next() {
        show(index + 1, 1);
    }

    @Override
    public void onBackPressed() {
        if (index > 0) show(index - 1, -1);
        // The first page has nowhere to go back to: setup stays until it is finished.
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        if (index == 6) show(6, 0);  // refresh the ticks
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (index == 6) show(6, 0);
    }

    // ---------------------------------------------------------------- building blocks

    TextView title(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Ui.font(this, "display"));
        t.setLetterSpacing(-0.02f);
        Ui.textSize(t, 34);
        t.setGravity(Gravity.CENTER);
        page.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return t;
    }

    TextView subtitle(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(0xB3FFFFFF);
        t.setTypeface(Ui.font(this, "regular"));
        Ui.textSize(t, 14);
        t.setGravity(Gravity.CENTER);
        t.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(u(520), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = u(10);
        lp.bottomMargin = u(26);
        page.addView(t, lp);
        return t;
    }

    LinearLayout list() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setClipChildren(false);
        l.setClipToPadding(false);
        page.addView(l, new LinearLayout.LayoutParams(u(440), ViewGroup.LayoutParams.WRAP_CONTENT));
        return l;
    }

    /** A choice row: title, optional detail and a tick; white with dark text when focused. */
    View option(LinearLayout list, String label, String detail, boolean checked, Runnable action) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setFocusable(true);
        r.setClickable(true);
        r.setPadding(u(18), u(8), u(16), u(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(u(12));
        bg.setColor(0x26FFFFFF);
        r.setBackground(bg);
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView l = new TextView(this);
        l.setText(label);
        l.setTextColor(Color.WHITE);
        l.setTypeface(Ui.font(this, "medium"));
        Ui.textSize(l, 15);
        texts.addView(l);
        TextView d = null;
        if (detail != null && !detail.isEmpty()) {
            d = new TextView(this);
            d.setText(detail);
            d.setTextColor(0x99FFFFFF);
            d.setTypeface(Ui.font(this, "regular"));
            Ui.textSize(d, 12);
            d.setSingleLine(true);
            d.setEllipsize(TextUtils.TruncateAt.END);
            texts.addView(d);
        }
        r.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView tick = new TextView(this);
        tick.setText(checked ? "\u2713" : "");
        tick.setTextColor(0xFF30D158);
        tick.setTypeface(Ui.font(this, "semibold"));
        Ui.textSize(tick, 17);
        r.addView(tick);
        TextView dRef = d;
        r.setOnFocusChangeListener((v, has) -> {
            bg.setColor(has ? 0xF2FFFFFF : 0x26FFFFFF);
            l.setTextColor(has ? 0xFF111114 : Color.WHITE);
            if (dRef != null) dRef.setTextColor(has ? 0x99111114 : 0x99FFFFFF);
            tick.setTextColor(has ? 0xFF1E9E48 : 0xFF30D158);
            v.animate().scaleX(has ? 1.04f : 1f).scaleY(has ? 1.04f : 1f).setDuration(180).start();
        });
        r.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                d == null ? u(46) : u(56));
        lp.bottomMargin = u(8);
        list.addView(r, lp);
        if (list.getChildCount() == 1) r.requestFocus();
        return r;
    }

    void dots() {
        LinearLayout d = new LinearLayout(this);
        d.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 1; i < steps.size() - 1; i++) {
            View dot = new View(this);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(i == index ? Color.WHITE : 0x59FFFFFF);
            dot.setBackground(g);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(u(6), u(6));
            lp.leftMargin = lp.rightMargin = u(4);
            d.addView(dot, lp);
        }
        View spacer = new View(this);
        page.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));
        page.addView(d, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    void setBackdrop(String style) {
        Bitmap b = MainActivity.makeWallpaperBase(style);
        backdrop.setImageDrawable(new BitmapDrawable(getResources(), b));
        backdrop.animate().alpha(1f).setDuration(300).start();
    }

    // ---------------------------------------------------------------- pages

    /** Welcome, then Get Started. */
    void hello() {
        backdrop.animate().alpha(0f).setDuration(300).start();
        View top = new View(this);
        page.addView(top, new LinearLayout.LayoutParams(1, 0, 1f));
        TextView hi = title("Welcome");
        Ui.textSize(hi, 64);
        hi.setAlpha(0f);
        hi.setTranslationY(u(12));
        hi.animate().alpha(1f).translationY(0).setDuration(700).start();
        // "Welcome" in Indian and world languages, fading from one to the next.
        String[] words = {"Welcome", "\u0938\u094d\u0935\u093e\u0917\u0924 \u0939\u0948", "\u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae", "\u0bb5\u0bb0\u0bb5\u0bc7\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bcb\u0bae\u0bcd", "\u0c38\u0c4d\u0c35\u0c3e\u0c17\u0c24\u0c02", "\u0938\u094d\u0935\u093e\u0917\u0924 \u0906\u0939\u0947", "\u0ab8\u0acd\u0ab5\u0abe\u0a97\u0aa4 \u0a9b\u0ac7", "\u0cb8\u0ccd\u0cb5\u0cbe\u0c97\u0ca4", "\u0d38\u0d4d\u0d35\u0d3e\u0d17\u0d24\u0d02", "\u0a1c\u0a40 \u0a06\u0a07\u0a06\u0a02 \u0a28\u0a42\u0a70", "Bienvenue", "Bienvenido", "Willkommen", "\u3088\u3046\u3053\u305d", "Benvenuto", "Bem-vindo", "\u6b22\u8fce"};
        int[] k = {0};
        Runnable[] cycle = new Runnable[1];
        cycle[0] = () -> {
            k[0] = (k[0] + 1) % words.length;
            hi.animate().alpha(0f).setDuration(350).withEndAction(() -> {
                hi.setText(words[k[0]]);
                hi.animate().alpha(1f).setDuration(450).start();
            }).start();
            handler.postDelayed(cycle[0], 2200);
        };
        handler.postDelayed(cycle[0], 2400);
        TextView s = subtitle("Let\u2019s set up Hume Launcher.");
        Ui.textSize(s, 17);
        LinearLayout l = list();
        option(l, "Get Started", null, false, this::next);
        View mid = new View(this);
        page.addView(mid, new LinearLayout.LayoutParams(1, 0, 1f));
        TextView by = new TextView(this);
        by.setText("by Petrobot");
        by.setTextColor(0x80FFFFFF);
        by.setTypeface(Ui.font(this, "regular"));
        Ui.textSize(by, 13);
        page.addView(by);
    }

    void profile() {
        title("Who's watching?");
        subtitle("Choose a name and an avatar. You can add up to three people later from the avatar on Home.");
        Profiles.Profile p = Profiles.current(this);
        LinearLayout l = list();
        option(l, "Name", p.name, false, () -> {
            EditText in = new EditText(this);
            in.setSingleLine(true);
            in.setText(p.name);
            in.setSelection(in.getText().length());
            int pad = u(14);
            FrameLayout box = new FrameLayout(this);
            box.setPadding(pad, pad / 2, pad, 0);
            box.addView(in);
            new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle("Your name").setView(box)
                    .setPositiveButton("OK", (d, w) -> {
                        String n = in.getText().toString().trim();
                        if (!n.isEmpty()) {
                            p.name = n;
                            Profiles.update(this, p);
                        }
                        show(index, 0);
                    }).setNegativeButton("Cancel", null).show();
            in.requestFocus();
        });
        // Avatar: a row of emoji, the current one ringed.
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setClipChildren(false);
        List<String> choices = new ArrayList<>(Profiles.freeEmojis(this, p.id));
        if (!choices.contains(p.emoji)) choices.add(0, p.emoji);
        for (int i = 0; i < Math.min(8, choices.size()); i++) {
            String e = choices.get(i);
            TextView t = new TextView(this);
            t.setText(e);
            Ui.textSize(t, 26);
            t.setGravity(Gravity.CENTER);
            t.setFocusable(true);
            t.setClickable(true);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(e.equals(p.emoji) ? 0x59FFFFFF : 0x1FFFFFFF);
            t.setBackground(g);
            t.setOnFocusChangeListener((v, has) -> v.animate().scaleX(has ? 1.2f : 1f).scaleY(has ? 1.2f : 1f).setDuration(160).start());
            t.setOnClickListener(v -> {
                p.emoji = e;
                Profiles.update(this, p);
                show(index, 0);
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(u(46), u(46));
            lp.leftMargin = lp.rightMargin = u(5);
            row.addView(t, lp);
        }
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rlp.topMargin = u(6);
        rlp.bottomMargin = u(14);
        page.addView(row, rlp);
        LinearLayout l2 = list();
        option(l2, "Continue", null, false, this::next);
        dots();
    }

    /** Backgrounds preview live behind the page as you move through them. */
    void look() {
        title("Choose a look");
        subtitle("The background behind your apps. Move through the list to preview it.");
        String cur = Profiles.homePrefs(this).getString("wallpaper", "aurora");
        setBackdrop(cur);
        LinearLayout l = list();
        for (int i = 0; i < MainActivity.WALL_KEYS.length; i++) {
            String key = MainActivity.WALL_KEYS[i];
            View r = option(l, MainActivity.WALL_NAMES[i], null, key.equals(cur), () -> {
                Profiles.homePrefs(this).edit().putString("wallpaper", key).apply();
                next();
            });
            View.OnFocusChangeListener base = r.getOnFocusChangeListener();
            r.setOnFocusChangeListener((v, has) -> {
                base.onFocusChange(v, has);
                if (has) setBackdrop(key);
            });
            if (key.equals(cur)) r.requestFocus();
        }
        dots();
    }

    void shelf() {
        backdrop.animate().alpha(0.5f).setDuration(300).start();
        title("Top of the Home Screen");
        subtitle("Full-screen artwork behind your apps. Choose what it shows.");
        String cur = Suggestions.shelf(this);
        LinearLayout l = list();
        String[][] opts = {
                {Suggestions.SHELF_BOTH, "Recommendations & News", "Popular titles on your services, mixed with the news"},
                {Suggestions.SHELF_RECS, "Recommendations", "Popular movies and series on your streaming services"},
                {Suggestions.SHELF_NEWS, "News", "India, your city and the world, from Indian newsrooms"},
                {Suggestions.SHELF_NONE, "Nothing", "Just your background"}};
        for (String[] o : opts) {
            View r = option(l, o[1], o[2], o[0].equals(cur), () -> {
                Suggestions.prefs(this).edit().putString(Suggestions.K_SHELF, o[0]).apply();
                Suggestions.changed(this);
                next();
            });
            if (o[0].equals(cur)) r.requestFocus();
        }
        dots();
    }

    void weather() {
        title("Weather");
        subtitle("A small weather card in the top-left corner of Home, with a 5-day forecast.");
        LinearLayout l = list();
        String city = Weather.place(this);
        option(l, "Use My Location", city.isEmpty() ? "Found from your internet connection" : "Looks like " + city,
                Weather.enabled(this) && !Weather.manual(this), () -> {
                    Weather.prefs(this).edit().putBoolean(Weather.K_ENABLED, true).apply();
                    Weather.setPlace(this, null);
                    next();
                });
        option(l, "Choose a City\u2026", Weather.manual(this) ? Weather.place(this) : "Search by name", Weather.manual(this), () -> {
            Weather.prefs(this).edit().putBoolean(Weather.K_ENABLED, true).apply();
            Intent i = new Intent(this, SettingsActivity.class).putExtra("page", SettingsActivity.WEATHER);
            startActivity(i);
        });
        option(l, "Don't Show Weather", null, !Weather.enabled(this), () -> {
            Weather.prefs(this).edit().putBoolean(Weather.K_ENABLED, false).apply();
            Weather.changed(this);
            next();
        });
        if (city.isEmpty()) Weather.refresh(this, true, () -> {
            if (index == 4) show(4, 0);  // show the detected city
        });
        dots();
    }

    void presentation() {
        ImageView icon = new ImageView(this);
        icon.setImageBitmap(com.petrobot.hume.present.PresentIcon.banner(u(130) * 2, u(78) * 2));
        icon.setClipToOutline(true);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(u(10));
        icon.setBackground(shape);
        LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(u(130), u(78));
        ilp.bottomMargin = u(14);
        page.addView(icon, ilp);
        title("Presentation");
        subtitle("Show images, videos and webpages on this TV, sent from any phone or computer on the same Wi-Fi.");
        boolean on = com.petrobot.hume.present.Presenter.enabled(this),
                boot = com.petrobot.hume.present.Presenter.startOnBoot(this);
        LinearLayout l = list();
        option(l, "Turn On", "Add a Presentation card to Home", on && !boot, () -> {
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_ENABLED, true);
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_BOOT, false);
            next();
        });
        option(l, "Turn On and Start with the TV", "For screens used as signage", on && boot, () -> {
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_ENABLED, true);
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_BOOT, true);
            next();
        });
        option(l, "Not Now", "You can turn it on in Settings", !on, () -> {
            com.petrobot.hume.present.Presenter.set(this, com.petrobot.hume.present.Presenter.KEY_ENABLED, false);
            next();
        });
        dots();
    }

    void homeAndPermissions() {
        title("Finish Setting Up");
        subtitle("Hume works best as the home screen. Allow these once; anything this TV doesn't support is skipped.");
        LinearLayout l = list();
        boolean home = Perms.isDefaultHome(this);
        option(l, "Make Hume the Home Screen", home ? "The Home button opens Hume" : "Choose Hume when asked", home,
                () -> Perms.requestDefaultHome(this));
        if (!Perms.hasLocation(this)) {
            option(l, "Show the Wi-Fi Name", "In Control Center (needs location access)", false,
                    () -> Perms.requestLocation(this));
        }
        if (Perms.listenerSupported(this) && !Perms.hasListener(this)) {
            option(l, "Continue Watching", "Remember what you play in each app", false, () -> Perms.requestListener(this));
        }
        if (Perms.adminSupported(this) && !Perms.hasAdmin(this)) {
            option(l, "Power Off & Sleep Timer", "Let Hume turn the screen off", false, () -> Perms.requestAdmin(this));
        }
        option(l, "Continue", null, false, this::next);
        dots();
    }

    void finish_() {
        backdrop.animate().alpha(0f).setDuration(300).start();
        View top = new View(this);
        page.addView(top, new LinearLayout.LayoutParams(1, 0, 1f));
        TextView check = new TextView(this);
        check.setText("\u2713");
        check.setTextColor(Color.WHITE);
        check.setGravity(Gravity.CENTER);
        Ui.textSize(check, 30);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(0xFF30D158);
        check.setBackground(g);
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(u(64), u(64));
        clp.bottomMargin = u(18);
        page.addView(check, clp);
        title("You're All Set");
        subtitle("Change any of this later in Settings, from the gear in Control Center.");
        LinearLayout l = list();
        option(l, "Go to Home Screen", null, false, () -> {
            getSharedPreferences("setup", MODE_PRIVATE).edit().putBoolean(K_DONE, true).apply();
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        });
        View bottom = new View(this);
        page.addView(bottom, new LinearLayout.LayoutParams(1, 0, 1.4f));
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
