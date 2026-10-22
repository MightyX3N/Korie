package com.custom.tvhome;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.ActivityOptions;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Resources;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.RenderEffect;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** tvOS-style home screen: blurred backdrop, top shelf title, rounded app tile grid. */
public class MainActivity extends Activity {

    static final int COLS = 6;
    static final String SETTINGS_KEY = "special:settings";
    static final String FOLDER_KEY = "special:folder";
    static final String PREF_ORDER = "order";
    static final String PREF_HIDDEN = "hidden";
    static final String TV_SETTINGS = "com.android.tv.settings";

    /** Packages placed first (in this order) until the user rearranges the grid. */
    static final List<String> DEFAULT_ORDER = Arrays.asList(
            "com.netflix.ninja",
            "com.amazon.amazonvideo.livingroom",
            "org.smarttube.stable",
            "in.startv.hotstar",
            "com.apple.atve.androidtv.appletv",
            "com.spotify.tv.android",
            "com.mitv.tvhome.mitvplus",
            "com.google.android.youtube.tv",
            "org.videolan.vlc",
            "io.github.jqssun.airplay");

    static final PathInterpolator EASE = new PathInterpolator(0.2f, 0f, 0f, 1f);
    /** tvOS focused icon is ~1.2x its resting size (303x183 vs 248x148 px in Apple's reference). */
    static final float FOCUS_SCALE = 1.2f;
    /** Focus lift with a slight spring, like tvOS. */
    static final android.view.animation.OvershootInterpolator LIFT =
            new android.view.animation.OvershootInterpolator(1.3f);

    static class AppEntry {
        String key, pkg, label;
        Drawable banner, icon;
        Intent launch;
        int color;
        boolean system;
    }

    /** Scroll position is driven by focus changes, not by ScrollView's own key handling. */
    static class ShelfScrollView extends ScrollView {
        ShelfScrollView(Context c) { super(c); }
        @Override protected int computeScrollDeltaToGetChildRectOnScreen(Rect r) { return 0; }
        @Override public boolean executeKeyEvent(KeyEvent e) { return false; }
    }

    SharedPreferences prefs;
    final Map<String, AppEntry> all = new LinkedHashMap<>();
    /** Visible home apps, in user order. */
    final List<AppEntry> apps = new ArrayList<>();
    /** Apps the user hid; reachable through the "More Apps" folder tile. */
    final List<AppEntry> hiddenApps = new ArrayList<>();
    /** What the grid currently shows: home apps (+ folder tile) or the folder's contents. */
    final List<AppEntry> shown = new ArrayList<>();
    final List<View> tiles = new ArrayList<>();
    final Handler handler = new Handler(Looper.getMainLooper());

    FrameLayout root;
    ImageView wallView;
    /** Top shelf carousel: two crossfading backdrops + info panel. */
    ImageView heroBack, heroFront;
    View heroScrim;
    FrameLayout shelfView;
    LinearLayout heroInfo, heroDots;
    ImageView heroLogo;
    TextView heroTitle, heroMeta, heroOverview;
    /** tvOS-style capsule button: glass when idle, solid white with dark text when focused. */
    LinearLayout heroButton;
    TextView heroBtnText;
    ImageView heroBtnIcon;
    ImageView heroProvider;
    GradientDrawable heroBtnBg;
    List<Suggestions.Item> heroItems = new ArrayList<>();
    int heroIndex;
    boolean heroShown;          // carousel currently forms the background
    int heroVersion = -1;       // Suggestions.version() the items were loaded for
    String wallStyle;
    /** What Liquid Glass samples: a blurred copy of the wallpaper or of the carousel artwork. */
    Bitmap wallBlur, heroBlur, glassBg;
    final LiquidGlass.Backdrop glassSource = () -> glassBg;
    View dockRow;
    boolean returningFromSettings;
    final java.util.concurrent.ExecutorService io = java.util.concurrent.Executors.newSingleThreadExecutor();
    final Runnable heroAdvance = () -> heroStep(1, false);
    ShelfScrollView scroll;
    LinearLayout content;
    LinearLayout clockBox;
    LinearLayout titleBox;
    View chevron;
    TextView shelfTitle, shelfHint;
    float unit = 2f;
    int screenW, screenH, tileW, tileH, gap, side, shelfH, labelH, radius, dockPadV, dockInset, dockOuter;
    int focusedIndex = 0;
    int moveIndex = -1;
    boolean folderMode;
    boolean resumed;
    ObjectAnimator wiggle;
    AppEntry shelfEntry;
    BroadcastReceiver pkgReceiver;

    /** Full-screen card that zooms out of a tile when an app is launched. */
    View launchOverlay;
    View launchTile;

    final Runnable shelfUpdate = () -> {
        if (focusedIndex >= 0 && focusedIndex < shown.size()) updateShelf(shown.get(focusedIndex));
    };
    final Runnable reloadRun = () -> reload(currentKey());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("home", MODE_PRIVATE);

        android.graphics.Point size = Ui.screen(this);
        screenW = size.x;
        screenH = size.y;
        unit = Ui.unit(this);
        // Measured from Apple's tvOS 26 Home Screen (1920x1080): dock 48 px from the screen edges,
        // 42 px inner padding, 248x148 px icons (5:3, the 800x480 HIG icon), 51 px between icons.
        dockOuter = dp(24);
        dockInset = dp(21);
        side = dockOuter + dockInset;  // grid rows line up with the dock icons (>= 80 pt safe area)
        gap = dp(25);
        tileW = (screenW - 2 * side - (COLS - 1) * gap) / COLS;
        tileH = tileW * 3 / 5;
        labelH = dp(30);
        radius = Math.round(tileW * 0.071f);  // Apple's tvOS 26 card corner: ~7% of card width
        shelfH = (int) (screenH * 0.73f);    // dock top sits ~73% down the screen
        dockPadV = dp(20);

        buildChrome();
        loadApps();
        buildGrid();
        focusIndex(0);
        registerPackageReceiver();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Home pressed while already on the home screen: jump back to the top of the home grid.
        if (moveIndex >= 0) endMove();
        if (folderMode) {
            folderMode = false;
            launchTile = null;
            buildGrid();
            shelfEntry = null;
            scroll.scrollTo(0, 0);
            focusIndex(0);
        } else if (launchOverlay == null) {
            closeMenu();
            goTop();
        }
    }

    /** A different display, resolution or density: rebuild so every size is recomputed. */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c);
        android.graphics.Point size = Ui.screen(this);
        if (size.x != screenW || size.y != screenH || Ui.unit(this) != unit) recreate();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        String ws = getSharedPreferences("home", MODE_PRIVATE).getString("wallpaper", "aurora");
        if (!ws.equals(wallStyle)) {
            wallStyle = ws;
            setWallpaper(ws);
        }
        if (returningFromSettings && !folderMode && launchOverlay == null && moveIndex < 0) reload(currentKey());
        returningFromSettings = false;
        loadHero();
        if (launchOverlay != null) finishLaunchReturn();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        handler.removeCallbacks(heroAdvance);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (pkgReceiver != null) unregisterReceiver(pkgReceiver);
        handler.removeCallbacksAndMessages(null);
    }

    // ---------------------------------------------------------------- layout

    void buildChrome() {
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0B0F);

        // One ambient wallpaper for every app. It is drawn tiny and upscaled, so it is already
        // soft; a slow drift keeps it alive without a per-frame blur on this weak GPU.
        wallView = new ImageView(this);
        wallView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        wallStyle = getSharedPreferences("home", MODE_PRIVATE).getString("wallpaper", "aurora");
        setWallpaper(wallStyle);
        root.addView(wallView, match());

        heroBack = heroLayer();
        heroFront = heroLayer();
        root.addView(heroBack, match());
        root.addView(heroFront, match());

        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x14000000, 0x40000000, 0xB3000000}));
        root.addView(shade, match());

        // Left-side scrim so the carousel's title and text stay legible over any artwork.
        heroScrim = new View(this);
        heroScrim.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xCC000000, 0x66000000, 0x00000000}));
        heroScrim.setAlpha(0f);
        root.addView(heroScrim, new FrameLayout.LayoutParams(screenW * 3 / 4, ViewGroup.LayoutParams.MATCH_PARENT));

        scroll = new ShelfScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setFillViewport(true);
        scroll.setOnScrollChangeListener((v, x, y, ox, oy) -> {
            if (launchOverlay == null && !clockBox.isFocused()) clockBox.setAlpha(clockAlpha());
            if (dockRow != null) dockRow.invalidate();
        });

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setClipChildren(false);
        content.setClipToPadding(false);
        content.setPadding(0, 0, 0, dp(80));
        scroll.addView(content, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, match());

        // Top shelf: header shown only inside the More Apps folder.
        FrameLayout shelf = new FrameLayout(this);
        shelfView = shelf;
        buildHeroInfo(shelf);
        titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.setPadding(side, 0, side, dp(26));
        shelfTitle = text(46, Ui.font(this, "display"), 1f);
        shelfTitle.setSingleLine(true);
        shelfTitle.setEllipsize(TextUtils.TruncateAt.END);
        shelfHint = text(15, Ui.font(this, "regular"), 0.6f);
        titleBox.addView(shelfTitle);
        titleBox.addView(shelfHint);
        shelf.addView(titleBox, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        // Wide, thin chevron above the dock, as on tvOS.
        int cw = dp(30), ch = dp(9);
        Bitmap cb = Bitmap.createBitmap(cw, ch, Bitmap.Config.ARGB_8888);
        Paint cp = new Paint(Paint.ANTI_ALIAS_FLAG);
        cp.setColor(0xCCFFFFFF);
        cp.setStyle(Paint.Style.STROKE);
        cp.setStrokeWidth(dp(2));
        cp.setStrokeCap(Paint.Cap.ROUND);
        cp.setStrokeJoin(Paint.Join.ROUND);
        android.graphics.Path cpath = new android.graphics.Path();
        float pad = dp(2);
        cpath.moveTo(pad, ch - pad);
        cpath.lineTo(cw / 2f, pad);
        cpath.lineTo(cw - pad, ch - pad);
        new Canvas(cb).drawPath(cpath, cp);
        ImageView chevronView = new ImageView(this);
        chevronView.setImageBitmap(cb);
        chevron = chevronView;
        FrameLayout.LayoutParams chp = new FrameLayout.LayoutParams(cw, ch,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        chp.bottomMargin = dp(14);
        shelf.addView(chevron, chp);
        content.addView(shelf, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, shelfH));

        // tvOS 26 status capsule (per Apple's reference): dark-tinted glass, time with AM/PM,
        // then the profile avatar on the right filling the capsule height.
        int pillH = dp(28);
        clockBox = new LinearLayout(this);
        clockBox.setOrientation(LinearLayout.HORIZONTAL);
        clockBox.setGravity(Gravity.CENTER_VERTICAL);
        clockBox.setPadding(dp(13), 0, dp(2), 0);
        LiquidGlass pillGlass = new LiquidGlass(pillH / 2f, 0x1F000000, glassSource, screenW, screenH, unit);
        pillGlass.rimStrength = 0.6f;
        pillGlass.lens = dp(5);
        clockBox.setBackground(pillGlass);
        TextClock time = new TextClock(this);
        Ui.textSize(time, 13);
        time.setTypeface(Ui.font(this, "regular"));
        time.setLetterSpacing(0.01f);
        time.setTextColor(0xF2FFFFFF);
        time.setFormat12Hour("h:mm a");
        time.setFormat24Hour("H:mm");
        time.setAllCaps(true);
        clockBox.addView(time);
        int av = pillH - dp(4);
        ImageView avatar = new ImageView(this);
        avatar.setImageBitmap(avatarBitmap(av));
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(av, av);
        alp.leftMargin = dp(9);
        clockBox.addView(avatar, alp);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, pillH, Gravity.TOP | Gravity.END);
        clp.topMargin = dp(26);
        clp.rightMargin = dockOuter;
        root.addView(clockBox, clp);
        clockBox.setFocusable(true);
        clockBox.setClickable(true);
        clockBox.setOnFocusChangeListener((v, has) -> {
            v.animate().scaleX(has ? 1.12f : 1f).scaleY(has ? 1.12f : 1f).setDuration(200).setInterpolator(LIFT).start();
            v.setAlpha(1f);
            ((LiquidGlass) v.getBackground()).setLit(has);
        });
        clockBox.setOnClickListener(v -> {
            returningFromSettings = true;
            startActivity(new Intent(this, SettingsActivity.class));
        });

        setContentView(root);
    }

    void buildGrid() {
        stopWiggle();
        shown.clear();
        if (folderMode) {
            shown.addAll(hiddenApps);
        } else {
            shown.addAll(apps);
            if (!hiddenApps.isEmpty()) shown.add(folderEntry());
        }
        // Like tvOS, the home grid has no big title; only the folder gets a header.
        titleBox.setVisibility(folderMode ? View.VISIBLE : View.GONE);
        chevron.setVisibility(folderMode ? View.GONE : View.VISIBLE);
        shelfTitle.setText("More Apps");
        shelfHint.setText("Back to return   ·   Hold OK for options");

        // Removing the focused card would make Android hand focus to the first card (and scroll
        // to the top); block that while rebuilding — callers focus the right card afterwards.
        content.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        while (content.getChildCount() > 1) content.removeViewAt(1);
        tiles.clear();
        LinearLayout row = null;
        for (int i = 0; i < shown.size(); i++) {
            if (i % COLS == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setClipChildren(false);
                row.setClipToPadding(false);
                row.setPadding(side, 0, side, 0);
                LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rlp.bottomMargin = gap / 2;
                if (i == 0 && hasDock()) {
                    // tvOS 26 dock: the top row sits on one frosted glass panel.
                    row.setPadding(dockInset, dockPadV, dockInset, dockPadV);
                    rlp.leftMargin = side - dockInset;
                    rlp.rightMargin = side - dockInset;
                    rlp.bottomMargin = dockGapBelow();
                    row.setBackground(dockBackground());
                    dockRow = row;
                }
                content.addView(row, rlp);
            }
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(tileW, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (i % COLS != 0) lp.leftMargin = gap;
            row.addView(makeCell(shown.get(i), i, i < COLS && hasDock()), lp);
        }
        content.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
    }

    View makeCell(AppEntry a, int index, boolean inDock) {
        LinearLayout cell = new LinearLayout(this);
        cell.setOrientation(LinearLayout.VERTICAL);
        cell.setClipChildren(false);

        FrameLayout tile = new FrameLayout(this);
        tile.setFocusable(true);
        tile.setClickable(true);
        tile.setLongClickable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(radius);
        bg.setColor(a.banner != null ? 0xFF1C1C1E : a.color);
        tile.setBackground(bg);
        tile.setOutlineProvider(roundedOutline(new float[]{radius}));
        tile.setClipToOutline(true);
        tile.setElevation(dp(3));

        ImageView iv = new ImageView(this);
        if (a.banner != null) {
            iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
            iv.setImageDrawable(a.banner);
            tile.addView(iv, match());
        } else {
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            iv.setImageDrawable(a.icon);
            int s = tileH * 55 / 100;
            tile.addView(iv, new FrameLayout.LayoutParams(s, s, Gravity.CENTER));
        }

        // tvOS focus has no outline ring: a soft top sheen plus a one-shot glare sweep instead.
        View topSheen = new View(this);
        topSheen.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x1AFFFFFF, 0x00FFFFFF}));
        topSheen.setAlpha(0f);
        tile.addView(topSheen, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, tileH / 2, Gravity.TOP));
        View glare = new View(this);
        glare.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0x00FFFFFF, 0x1AFFFFFF, 0x00FFFFFF}));
        glare.setRotation(18f);
        glare.setAlpha(0f);
        tile.addView(glare, new FrameLayout.LayoutParams(tileW * 45 / 100, tileH * 2, Gravity.CENTER_VERTICAL));

        TextView label = text(15, Ui.font(this, "medium"), 0f);
        label.setText(a.label);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setGravity(Gravity.CENTER);

        cell.addView(tile, new LinearLayout.LayoutParams(tileW, tileH));
        if (!inDock) cell.addView(label, new LinearLayout.LayoutParams(tileW, labelH));

        tile.setOnFocusChangeListener((v, has) -> {
            if (has) {
                cell.setTranslationZ(dp(10));
                if (moveIndex >= 0) {
                    // Rebuilt while moving: appear already lifted, or every step would "pop".
                    v.setScaleX(FOCUS_SCALE);
                    v.setScaleY(FOCUS_SCALE);
                    v.setTranslationZ(dp(18));
                    label.setAlpha(1f);
                    label.setTranslationY(tileH * (FOCUS_SCALE - 1f) / 2f);
                } else {
                    v.animate().withLayer().scaleX(FOCUS_SCALE).scaleY(FOCUS_SCALE).translationZ(dp(18)).setDuration(260)
                            .setInterpolator(LIFT).start();
                    label.animate().alpha(1f).translationY(tileH * (FOCUS_SCALE - 1f) / 2f).setDuration(200).start();
                    // Liquid-glass illumination: a glare sweeps across once, then rests and
                    // drifts with the card's gentle sway (HIG: "gently sways while the surface
                    // illuminates").
                    glare.animate().cancel();
                    glare.setTranslationX(-tileW * 0.7f);
                    glare.setAlpha(1f);
                    glare.animate().translationX(tileW * 1.1f).alpha(0f).setStartDelay(60).setDuration(700)
                            .setInterpolator(EASE).start();
                }
                topSheen.animate().alpha(1f).setDuration(200).start();
                onTileFocused(index);
            } else {
                cell.setTranslationZ(0);
                stopSway(v);
                v.animate().withLayer().scaleX(1f).scaleY(1f).translationZ(0).setDuration(180).setInterpolator(EASE).start();
                label.animate().alpha(0f).translationY(0).setDuration(120).start();
                topSheen.animate().alpha(0f).setDuration(160).start();
                glare.animate().cancel();
                glare.setAlpha(0f);
            }
            v.invalidate();
        });
        tile.setCameraDistance(9000 * unit);
        tile.setOnClickListener(v -> {
            if (moveIndex >= 0 || launchOverlay != null) return;
            // Pressed state (HIG): the card dips instantly, then the action runs.
            stopSway(v);
            v.animate().scaleX(FOCUS_SCALE * 0.92f).scaleY(FOCUS_SCALE * 0.92f).setDuration(90)
                    .setInterpolator(EASE).withEndAction(() -> {
                        v.animate().scaleX(FOCUS_SCALE).scaleY(FOCUS_SCALE).setDuration(140).setInterpolator(LIFT).start();
                        if (FOLDER_KEY.equals(a.key)) enterFolder();
                        else launchAnimated(v, a);
                    }).start();
        });
        tile.setOnLongClickListener(v -> {
            if (moveIndex < 0 && !FOLDER_KEY.equals(a.key)) showOptions(index);
            return true;
        });
        tiles.add(tile);
        return cell;
    }

    /** tvOS-style ambient colour field: soft glows of indigo, teal, magenta and amber on navy. */
    void setWallpaper(String style) {
        Bitmap wp = makeWallpaper(style);
        wallView.setImageBitmap(wp);
        wallBlur = Ui.blur(wp, 192, 108, 3, 2);
        if (!heroShown || heroBlur == null) glassBg = wallBlur;
        invalidateGlass();
    }

    void invalidateGlass() {
        if (dockRow != null) dockRow.invalidate();
        if (clockBox != null) clockBox.invalidate();
        if (menuLayer != null && menuLayer.getChildCount() > 0) menuLayer.getChildAt(0).invalidate();
    }

    static final String[] WALL_KEYS = {"aurora", "midnight", "sunset", "ocean", "graphite"};
    static final String[] WALL_NAMES = {"Aurora", "Midnight", "Sunset", "Ocean", "Graphite"};

    Bitmap makeWallpaper(String style) {
        int w = 192, h = 108;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        int base;
        int[] colors;
        switch (style) {
            case "midnight":
                base = 0xFF04060F;
                colors = new int[]{0xFF1B2A6B, 0xFF0F3D63, 0xFF2B1B5E, 0xFF14254F, 0xFF22306E};
                break;
            case "sunset":
                base = 0xFF140812;
                colors = new int[]{0xFFB0412E, 0xFF8E2C6E, 0xFFD08A2E, 0xFF6B2A8E, 0xFFC0563A};
                break;
            case "ocean":
                base = 0xFF031418;
                colors = new int[]{0xFF0C6E86, 0xFF0B8C76, 0xFF1A4FA0, 0xFF0E5E6E, 0xFF2A7FB0};
                break;
            case "graphite":
                base = 0xFF0C0C0E;
                colors = new int[]{0xFF3A3A42, 0xFF2A2C34, 0xFF4A4A52, 0xFF26262C, 0xFF34363E};
                break;
            default:
                base = 0xFF080C1E;
                colors = new int[]{0xFF4B2DB0, 0xFF0B7F8C, 0xFFB02F6E, 0xFFC27A2C, 0xFF2150C0};
        }
        c.drawColor(base);
        float[][] blobs = {      // centre x, centre y, radius (fractions of width)
                {0.14f, 0.18f, 0.62f},
                {0.88f, 0.22f, 0.50f},
                {0.72f, 0.92f, 0.55f},
                {0.20f, 0.95f, 0.42f},
                {0.50f, 0.45f, 0.38f}};
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        for (int i = 0; i < colors.length; i++) {
            int col = colors[i];
            p.setShader(new RadialGradient(blobs[i][0] * w, blobs[i][1] * h, blobs[i][2] * w,
                    new int[]{col & 0xD9FFFFFF, col & 0x59FFFFFF, col & 0x00FFFFFF},
                    new float[]{0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, w, h, p);
        }
        return b;
    }

    void startWallpaperDrift() {
        ObjectAnimator dx = ObjectAnimator.ofFloat(wallView, View.TRANSLATION_X, -dp(60), dp(60));
        dx.setDuration(38000);
        ObjectAnimator dy = ObjectAnimator.ofFloat(wallView, View.TRANSLATION_Y, dp(30), -dp(30));
        dy.setDuration(29000);
        for (ObjectAnimator an : new ObjectAnimator[]{dx, dy}) {
            an.setRepeatCount(ValueAnimator.INFINITE);
            an.setRepeatMode(ValueAnimator.REVERSE);
            an.setInterpolator(new PathInterpolator(0.45f, 0f, 0.55f, 1f));
            an.start();
        }
    }

    /** Round profile avatar: indigo-to-pink gradient with a person glyph. */
    Bitmap avatarBitmap(int size) {
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setShader(new LinearGradient(0, 0, 0, size, 0xFFA8A8B0, 0xFF838389, Shader.TileMode.CLAMP));
        float r = size / 2f;
        c.drawCircle(r, r, r, p);
        p.setShader(null);
        p.setColor(0xF2FFFFFF);
        c.drawCircle(r, size * 0.40f, size * 0.17f, p);
        c.save();
        android.graphics.Path clip = new android.graphics.Path();
        clip.addCircle(r, r, r, android.graphics.Path.Direction.CW);
        c.clipPath(clip);
        c.drawOval(size * 0.20f, size * 0.64f, size * 0.80f, size * 1.10f, p);
        c.restore();
        return b;
    }

    /** System/utility apps that get a drawn tvOS-style card instead of their Android art. */
    static final Set<String> TVOS_CARD_PKGS = new HashSet<>(Arrays.asList(
            TV_SETTINGS, "com.android.vending", "com.mitv.dream"));

    /**
     * tvOS-style card: soft vertical gradient with a top sheen and the app's glyph centred.
     * Settings gets the silver card with a drawn gear, like tvOS.
     */
    Bitmap tvosCard(AppEntry e) {
        int w = 640, h = 360;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        boolean settings = TV_SETTINGS.equals(e.pkg);
        int top, bottom;
        if (settings) {                                  // tvOS Settings: silver
            top = 0xFFE9E9EE;
            bottom = 0xFFAFAFB8;
        } else if ("com.android.vending".equals(e.pkg)) { // tvOS App Store-style blue
            top = 0xFF1FA2FF;
            bottom = 0xFF0A55E6;
        } else {                                         // vivid gradient in the app's own hue
            float[] hsv = new float[3];
            Color.colorToHSV(e.color, hsv);
            float sat = hsv[1] < 0.15f ? 0.12f : 0.7f;   // greys stay neutral
            top = Color.HSVToColor(new float[]{hsv[0], sat * 0.85f, 0.92f});
            bottom = Color.HSVToColor(new float[]{(hsv[0] + 8f) % 360f, Math.min(1f, sat * 1.15f), sat < 0.2f ? 0.42f : 0.68f});
        }
        p.setShader(new LinearGradient(0, 0, 0, h, top, bottom, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(null);

        if (settings) {
            drawGear(c, w / 2f, h / 2f, h * 0.27f, 0xFF4A4A52, 0xFFD2D2D9);
            return b;
        }
        Bitmap glyph = whiteGlyph(e, (int) (h * 0.5f));
        if (glyph != null) {
            // Soft drop shadow under the glyph, like tvOS system icons.
            Paint sp = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            sp.setColorFilter(new android.graphics.PorterDuffColorFilter(0x38000000, android.graphics.PorterDuff.Mode.SRC_IN));
            sp.setMaskFilter(new android.graphics.BlurMaskFilter(h * 0.025f, android.graphics.BlurMaskFilter.Blur.NORMAL));
            float x = (w - glyph.getWidth()) / 2f, y = (h - glyph.getHeight()) / 2f;
            c.drawBitmap(glyph.extractAlpha(), x, y + h * 0.015f, sp);
            c.drawBitmap(glyph, x, y, new Paint(Paint.FILTER_BITMAP_FLAG));
        } else if (e.icon != null) {
            int sz = (int) (h * 0.46f);
            Rect old = e.icon.copyBounds();
            e.icon.setBounds((w - sz) / 2, (h - sz) / 2, (w + sz) / 2, (h + sz) / 2);
            e.icon.draw(c);
            e.icon.setBounds(old);
        }
        return b;
    }

    /**
     * The app's glyph as a flat white shape (tvOS system-icon style): uses the adaptive icon's
     * foreground layer when there is one. Returns null for full-bleed artwork that can't be
     * reduced to a glyph, so it is shown as-is instead of becoming a white blob.
     */
    Bitmap whiteGlyph(AppEntry e, int size) {
        if (e.icon == null) return null;
        Drawable d = e.icon;
        float zoom = 1f;
        if (d instanceof android.graphics.drawable.AdaptiveIconDrawable) {
            Drawable fg = ((android.graphics.drawable.AdaptiveIconDrawable) d).getForeground();
            if (fg != null) {
                d = fg;
                zoom = 1.5f;  // adaptive foregrounds keep the glyph in the centre 2/3
            }
        }
        int big = Math.round(size * zoom);
        Bitmap full = Bitmap.createBitmap(big, big, Bitmap.Config.ARGB_8888);
        Rect old = d.copyBounds();
        d.setBounds(0, 0, big, big);
        d.draw(new Canvas(full));
        d.setBounds(old);
        Bitmap g = Bitmap.createBitmap(full, (big - size) / 2, (big - size) / 2, size, size);
        int[] px = new int[size * size];
        g.getPixels(px, 0, size, 0, 0, size, size);
        int solid = 0;
        for (int v : px) if (Color.alpha(v) > 128) solid++;
        if (solid > px.length * 0.6f || solid < px.length * 0.02f) return null;
        for (int i = 0; i < px.length; i++) px[i] = (Color.alpha(px[i]) << 24) | 0xFFFFFF;
        Bitmap out = Bitmap.createBitmap(px, size, size, Bitmap.Config.ARGB_8888);
        if (g != full) g.recycle();
        full.recycle();
        return out;
    }

    /** tvOS Settings-style gear: toothed ring with a hollow centre. */
    static void drawGear(Canvas c, float cx, float cy, float r, int color, int holeColor) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        int teeth = 12;
        float tw = r * 0.30f, th = r * 0.30f;
        for (int i = 0; i < teeth; i++) {
            c.save();
            c.rotate(i * 360f / teeth, cx, cy);
            c.drawRoundRect(cx - tw / 2, cy - r - th * 0.55f, cx + tw / 2, cy - r + th, tw * 0.25f, tw * 0.25f, p);
            c.restore();
        }
        c.drawCircle(cx, cy, r, p);
        p.setColor(holeColor);
        c.drawCircle(cx, cy, r * 0.42f, p);
        p.setColor(color);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(r * 0.08f);
        c.drawCircle(cx, cy, r * 0.62f, p);
    }

    boolean hasDock() {
        return !folderMode;
    }

    int dockGapBelow() {
        return dp(20);
    }

    /** Frosted glass dock (tvOS 26): big radius, dark-tinted translucent fill, sheen and rim. */
    Drawable dockBackground() {
        // Apple's dock corner is ~2x the card corner (36 px vs ~18 px at 1080p).
        LiquidGlass g = new LiquidGlass(radius * 2f, 0x0FFFFFFF, glassSource, screenW, screenH, unit);
        g.lens = dp(12);
        return g;
    }

    Bitmap grainBitmap;

    /** Fine monochrome noise, tiled over glass to give it a frosted texture. */
    Bitmap grain() {
        if (grainBitmap != null) return grainBitmap;
        int n = 96;
        int[] px = new int[n * n];
        java.util.Random rnd = new java.util.Random(7);
        for (int i = 0; i < px.length; i++) {
            int a = rnd.nextInt(14);
            px[i] = rnd.nextBoolean() ? Color.argb(a, 255, 255, 255) : Color.argb(a, 0, 0, 0);
        }
        grainBitmap = Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888);
        return grainBitmap;
    }

    /**
     * Liquid Glass (iOS/tvOS 26), drawn from what is actually behind the surface: a blurred,
     * colour-boosted copy of the backdrop aligned to the surface's screen position; a band along
     * the edges that magnifies it (lensing, like thick glass); a light tint; and a specular rim
     * that is bright top-left and softer bottom-right. No grain.
     */
    static class LiquidGlass extends Drawable {
        interface Backdrop {
            Bitmap get();
        }

        final float r, density;
        final Backdrop backdrop;
        final int screenW, screenH;
        int tint;
        final int baseTint;
        float lens;
        float rimStrength = 1f;
        final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint rim = new Paint(Paint.ANTI_ALIAS_FLAG);
        final android.graphics.RectF box = new android.graphics.RectF(), dst = new android.graphics.RectF();
        final android.graphics.Path clip = new android.graphics.Path(), ring = new android.graphics.Path(),
                ringOuter = new android.graphics.Path();
        final int[] loc = new int[2];

        LiquidGlass(float r, int tint, Backdrop backdrop, int screenW, int screenH, float density) {
            this.r = r;
            this.tint = tint;
            this.baseTint = tint;
            this.backdrop = backdrop;
            this.screenW = screenW;
            this.screenH = screenH;
            this.density = density;
            android.graphics.ColorMatrix cm = new android.graphics.ColorMatrix();
            cm.setSaturation(1.6f);
            cm.postConcat(new android.graphics.ColorMatrix(new float[]{
                    1.05f, 0, 0, 0, 14,
                    0, 1.05f, 0, 0, 14,
                    0, 0, 1.05f, 0, 14,
                    0, 0, 0, 1, 0}));
            bg.setColorFilter(new android.graphics.ColorMatrixColorFilter(cm));
            fill.setColor(tint);
            rim.setStyle(Paint.Style.STROKE);
            rim.setStrokeWidth(1.1f * density);
        }

        void setLit(boolean lit) {
            fill.setColor(lit ? 0x52FFFFFF : baseTint);
            invalidateSelf();
        }

        int rimA(int a) {
            return (Math.round(a * rimStrength) << 24) | 0xFFFFFF;
        }

        @Override protected void onBoundsChange(Rect b) {
            box.set(b);
            clip.reset();
            clip.addRoundRect(box, r, r, android.graphics.Path.Direction.CW);
            ring.reset();
            ring.setFillType(android.graphics.Path.FillType.EVEN_ODD);
            ring.addRoundRect(box, r, r, android.graphics.Path.Direction.CW);
            float l = Math.min(lens, Math.min(box.width(), box.height()) / 3f);
            ring.addRoundRect(box.left + l, box.top + l, box.right - l, box.bottom - l,
                    Math.max(0, r - l), Math.max(0, r - l), android.graphics.Path.Direction.CW);
            float l2 = l * 0.5f;
            ringOuter.reset();
            ringOuter.setFillType(android.graphics.Path.FillType.EVEN_ODD);
            ringOuter.addRoundRect(box, r, r, android.graphics.Path.Direction.CW);
            ringOuter.addRoundRect(box.left + l2, box.top + l2, box.right - l2, box.bottom - l2,
                    Math.max(0, r - l2), Math.max(0, r - l2), android.graphics.Path.Direction.CW);
            float h = box.height();
            glow.setShader(new LinearGradient(0, box.top, 0, box.top + h * 0.5f,
                    0x1FFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
            rim.setShader(new LinearGradient(box.left, box.top, box.right, box.bottom,
                    new int[]{rimA(0xD9), rimA(0x40), rimA(0x14), rimA(0x26), rimA(0x8C)},
                    new float[]{0f, 0.22f, 0.5f, 0.78f, 1f}, Shader.TileMode.CLAMP));
        }

        // Cache: the glass body (backdrop, lensing, tint, glow) is rendered off-screen at half
        // resolution and only rebuilt when what's behind it changes; each frame is then a single
        // bitmap draw plus the crisp rim. Keeps this weak GPU at 60 fps.
        Bitmap cache, cacheBg;
        int cacheX = Integer.MIN_VALUE, cacheY, cacheW, cacheH, cacheFill;
        final Paint blit = new Paint(Paint.FILTER_BITMAP_FLAG);

        @Override public void draw(Canvas c) {
            Bitmap b = backdrop.get();
            Object cb = getCallback();
            if (cb instanceof View) ((View) cb).getLocationOnScreen(loc);
            int w = Math.max(1, Math.round(box.width() / 2f)), h = Math.max(1, Math.round(box.height() / 2f));
            if (cache == null || b != cacheBg || loc[0] != cacheX || loc[1] != cacheY
                    || w != cacheW || h != cacheH || fill.getColor() != cacheFill) {
                if (cache == null || cache.getWidth() != w || cache.getHeight() != h) {
                    cache = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                } else {
                    cache.eraseColor(0);
                }
                Canvas k = new Canvas(cache);
                k.scale(w / box.width(), h / box.height());
                k.translate(-box.left, -box.top);
                renderBody(k, b);
                cacheBg = b;
                cacheX = loc[0];
                cacheY = loc[1];
                cacheW = w;
                cacheH = h;
                cacheFill = fill.getColor();
            }
            c.drawBitmap(cache, null, box, blit);
            float in = rim.getStrokeWidth() / 2f;
            c.drawRoundRect(box.left + in, box.top + in, box.right - in, box.bottom - in, r - in, r - in, rim);
        }

        void renderBody(Canvas c, Bitmap b) {
            c.save();
            c.clipPath(clip);
            if (b != null) {
                dst.set(box.left - loc[0], box.top - loc[1], box.left - loc[0] + screenW, box.top - loc[1] + screenH);
                c.drawBitmap(b, null, dst, bg);
                if (lens > 0) {
                    // Two softer steps instead of one hard band, so the bend has no visible seam.
                    c.save();
                    c.clipPath(ring);
                    c.scale(1.035f, 1.035f, box.centerX(), box.centerY());
                    bg.setAlpha(150);
                    c.drawBitmap(b, null, dst, bg);
                    c.restore();
                    c.save();
                    c.clipPath(ringOuter);
                    c.scale(1.06f, 1.06f, box.centerX(), box.centerY());
                    c.drawBitmap(b, null, dst, bg);
                    c.restore();
                    bg.setAlpha(255);
                }
            }
            c.drawRect(box, fill);
            c.drawRect(box, glow);
            c.restore();
        }

        @Override public void setAlpha(int a) { }
        @Override public void setColorFilter(android.graphics.ColorFilter cf) { }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
    }

    /**
     * Frosted Liquid Glass surface: tinted luminosity lift, fine frost grain, a soft inner glow
     * at the top, gentle shade at the bottom, and a rim that catches light on the top edge and
     * fades down the sides (no uniform outline).
     */
    static class FrostedGlass extends Drawable {
        final float r, density;
        final int tint;
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint grainPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint rim = new Paint(Paint.ANTI_ALIAS_FLAG);
        final android.graphics.RectF box = new android.graphics.RectF();
        final android.graphics.Path clip = new android.graphics.Path();
        /** 1 = full light-catching rim (dock); lower for small controls like the capsule. */
        float rimStrength = 1f;

        FrostedGlass(float r, int tint, Bitmap grain, float density) {
            this.r = r;
            this.tint = tint;
            this.density = density;
            fill.setColor(tint);
            grainPaint.setShader(new android.graphics.BitmapShader(grain, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT));
            rim.setStyle(Paint.Style.STROKE);
            rim.setStrokeWidth(1.2f * density);
        }

        @Override protected void onBoundsChange(Rect b) {
            box.set(b);
            clip.reset();
            clip.addRoundRect(box, r, r, android.graphics.Path.Direction.CW);
            float h = box.height();
            glow.setShader(new LinearGradient(0, box.top, 0, box.top + h * 0.45f,
                    0x24FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
            shade.setShader(new LinearGradient(0, box.bottom - h * 0.4f, 0, box.bottom,
                    0x00000000, 0x1F000000, Shader.TileMode.CLAMP));
            rim.setShader(new LinearGradient(0, box.top, 0, box.bottom,
                    new int[]{rimA(0x8C), rimA(0x26), rimA(0x0D), rimA(0x1F)},
                    new float[]{0f, 0.25f, 0.75f, 1f}, Shader.TileMode.CLAMP));
        }

        int rimA(int a) {
            return (Math.round(a * rimStrength) << 24) | 0xFFFFFF;
        }

        @Override public void draw(Canvas c) {
            c.save();
            c.clipPath(clip);
            c.drawRect(box, fill);
            c.drawRect(box, grainPaint);
            c.drawRect(box, glow);
            c.drawRect(box, shade);
            c.restore();
            float inset = rim.getStrokeWidth() / 2f;
            c.drawRoundRect(box.left + inset, box.top + inset, box.right - inset, box.bottom - inset,
                    r - inset, r - inset, rim);
        }

        /** Focused: brighter glass (tvOS lifts and lightens focused glass controls). */
        void setLit(boolean lit) {
            fill.setColor(lit ? 0x59FFFFFF : tint);
            invalidateSelf();
        }

        @Override public void setAlpha(int a) { }
        @Override public void setColorFilter(android.graphics.ColorFilter cf) { }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }

        @Override public boolean getPadding(Rect padding) {
            padding.set(0, 0, 0, 0);
            return false;
        }
    }

    /** Liquid-glass surface: translucent fill, top sheen and a bright hairline rim. */
    LayerDrawable glassBackground(GradientDrawable fill) {
        fill.setCornerRadius(radius);
        fill.setColor(0x26FFFFFF);
        GradientDrawable sheen = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x38FFFFFF, 0x08FFFFFF, 0x00FFFFFF});
        sheen.setCornerRadius(radius);
        GradientDrawable rim = new GradientDrawable();
        rim.setCornerRadius(radius);
        rim.setColor(Color.TRANSPARENT);
        rim.setStroke(Math.max(1, dp(1)), 0x66FFFFFF);
        return new LayerDrawable(new Drawable[]{fill, sheen, rim});
    }

    /** Outline whose corner radius can be changed while animating (radius[0]). */
    ViewOutlineProvider roundedOutline(float[] r) {
        return new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) {
                o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), r[0]);
            }
        };
    }

    // ---------------------------------------------------------------- suggestions carousel

    ImageView heroLayer() {
        ImageView v = new ImageView(this);
        v.setScaleType(ImageView.ScaleType.CENTER_CROP);
        v.setAlpha(0f);
        return v;
    }

    /** Title logo (or title), meta line, overview, "Open in …" capsule and page dots, bottom-left of the shelf. */
    void buildHeroInfo(FrameLayout shelf) {
        heroInfo = new LinearLayout(this);
        heroInfo.setOrientation(LinearLayout.VERTICAL);
        heroInfo.setClipChildren(false);
        heroInfo.setClipToPadding(false);
        heroInfo.setAlpha(0f);
        heroProvider = new ImageView(this);
        heroProvider.setScaleType(ImageView.ScaleType.CENTER_CROP);
        heroProvider.setOutlineProvider(roundedOutline(new float[]{dp(7)}));
        heroProvider.setClipToOutline(true);
        heroProvider.setElevation(dp(2));
        LinearLayout.LayoutParams pvlp = new LinearLayout.LayoutParams(dp(30), dp(30));
        pvlp.bottomMargin = dp(12);
        heroInfo.addView(heroProvider, pvlp);
        heroLogo = new ImageView(this);
        heroLogo.setAdjustViewBounds(true);
        heroLogo.setScaleType(ImageView.ScaleType.FIT_START);
        heroLogo.setMaxWidth(dp(260));
        heroLogo.setMaxHeight(dp(90));
        heroInfo.addView(heroLogo, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        heroTitle = text(36, Ui.font(this, "display"), 1f);
        heroTitle.setLetterSpacing(-0.02f);
        heroTitle.setIncludeFontPadding(false);
        heroTitle.setMaxLines(2);
        heroTitle.setEllipsize(TextUtils.TruncateAt.END);
        heroInfo.addView(heroTitle, new LinearLayout.LayoutParams(dp(420), ViewGroup.LayoutParams.WRAP_CONTENT));
        heroMeta = text(12.5f, Ui.font(this, "medium"), 0.8f);
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mlp.topMargin = dp(10);
        heroInfo.addView(heroMeta, mlp);
        heroOverview = text(12.5f, Ui.font(this, "regular"), 0.8f);
        heroOverview.setMaxLines(2);
        heroOverview.setEllipsize(TextUtils.TruncateAt.END);
        heroOverview.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams(dp(380), ViewGroup.LayoutParams.WRAP_CONTENT);
        olp.topMargin = dp(6);
        heroInfo.addView(heroOverview, olp);
        heroButton = new LinearLayout(this);
        heroButton.setOrientation(LinearLayout.HORIZONTAL);
        heroButton.setGravity(Gravity.CENTER_VERTICAL);
        heroButton.setPadding(dp(18), 0, dp(20), 0);
        heroBtnBg = new GradientDrawable();
        heroBtnBg.setCornerRadius(dp(16));
        heroBtnBg.setColor(0x47FFFFFF);
        heroButton.setBackground(heroBtnBg);
        heroBtnText = text(13, Ui.font(this, "semibold"), 1f);
        heroBtnText.setShadowLayer(0, 0, 0, 0);
        heroButton.addView(heroBtnText);
        heroBtnIcon = new ImageView(this);
        heroBtnIcon.setScaleType(ImageView.ScaleType.CENTER_CROP);
        heroBtnIcon.setOutlineProvider(roundedOutline(new float[]{dp(5)}));
        heroBtnIcon.setClipToOutline(true);
        LinearLayout.LayoutParams iclp = new LinearLayout.LayoutParams(dp(22), dp(22));
        iclp.leftMargin = dp(9);
        heroButton.addView(heroBtnIcon, iclp);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(32));
        blp.topMargin = dp(14);
        heroInfo.addView(heroButton, blp);
        // Overview and button only show while the carousel itself is focused (tvOS).
        heroOverview.setAlpha(0f);
        heroButton.setAlpha(0f);
        heroOverview.setVisibility(View.GONE);
        heroButton.setVisibility(View.GONE);
        FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.START);
        int room = dp(12);
        heroInfo.setPadding(room, room, room, room);
        ilp.leftMargin = side - room;
        ilp.bottomMargin = dp(40) - room;
        root.addView(heroInfo, ilp);
        heroInfo.setTranslationY(heroInfoRestY());

        heroDots = new LinearLayout(this);
        heroDots.setOrientation(LinearLayout.HORIZONTAL);
        heroDots.setAlpha(0f);
        FrameLayout.LayoutParams dlp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        dlp.bottomMargin = dp(22);
        root.addView(heroDots, dlp);
        heroDots.setTranslationY(heroDotsRestY());

        // The shelf itself is the carousel's focus target (UP from the dock).
        shelf.setFocusable(false);
        shelf.setOnFocusChangeListener((v, has) -> heroFocused(has));
    }

    /** Info block sits just above the dock while a dock app is focused... */
    float heroInfoRestY() {
        return -(screenH - shelfH) + dp(40) - dp(36);
    }

    /** ...and the page dots sit centred between the info and the dock. */
    float heroDotsRestY() {
        return -(screenH - shelfH) + dp(22) - dp(12);
    }

    /** Loads cached suggestions at once and refreshes them in the background when stale or reconfigured. */
    void loadHero() {
        if (!Suggestions.enabled(this) || !Suggestions.ready(this)) {
            heroItems = new ArrayList<>();
            shelfView.setFocusable(false);
            setHeroShown(false);
            return;
        }
        int v = Suggestions.version(this);
        boolean reconfigured = v != heroVersion;
        heroVersion = v;
        io.execute(() -> {
            List<Suggestions.Item> items = Suggestions.cached(this, true);
            if (items != null && (reconfigured || heroItems.isEmpty())) {
                List<Suggestions.Item> c0 = items;
                handler.post(() -> setHeroItems(c0));
            }
            if (Suggestions.cached(this, false) == null) {
                try {
                    List<Suggestions.Item> fresh = Suggestions.fetch(this);
                    handler.post(() -> setHeroItems(fresh));
                } catch (Exception e) {
                    android.util.Log.w("TvHome", "suggestions: " + e);
                }
            }
        });
    }

    void setHeroItems(List<Suggestions.Item> items) {
        // Keep the carousel where it was when the list is refreshed (same title -> same position).
        String curTitle = heroItems.isEmpty() ? null : heroItems.get(Math.min(heroIndex, heroItems.size() - 1)).title;
        boolean same = curTitle != null && heroFront.getDrawable() != null;
        if (items.size() > 10) items = new ArrayList<>(items.subList(0, 10));
        heroItems = items;
        int keep = 0;
        for (int i = 0; curTitle != null && i < items.size(); i++) if (items.get(i).title.equals(curTitle)) keep = i;
        heroIndex = keep;
        shelfView.setFocusable(!items.isEmpty());
        heroDots.removeAllViews();
        for (int i = 0; i < items.size() && items.size() > 1; i++) {
            View d = new View(this);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(Color.WHITE);
            d.setBackground(g);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(5), dp(5));
            lp.rightMargin = dp(5);
            heroDots.addView(d, lp);
        }
        if (items.isEmpty()) {
            setHeroShown(false);
            return;
        }
        View f = getCurrentFocus();
        int i = tiles.indexOf(f);
        boolean dock = f == shelfView || (hasDock() && i >= 0 && i < COLS);
        setHeroShown(dock);
        if (!(same && items.get(keep).title.equals(curTitle))) showHero(keep, 0);
        else for (int j = 0; j < heroDots.getChildCount(); j++) heroDots.getChildAt(j).setAlpha(j == keep ? 1f : 0.35f);
        List<Suggestions.Item> pre = items;
        io.execute(() -> {
            for (Suggestions.Item it : pre) {
                Suggestions.image(this, it.backdrop, "w1280", 64);  // downloads to disk; tiny decode
                Suggestions.logoFor(this, it);
            }
        });
    }

    /** Carousel vs launcher background: crossfade between them. */
    void setHeroShown(boolean show) {
        show = show && !heroItems.isEmpty() && !folderMode;
        if (show == heroShown) return;
        heroShown = show;
        glassBg = show && heroBlur != null ? heroBlur : wallBlur;
        invalidateGlass();
        float a = show ? 1f : 0f;
        heroFront.animate().alpha(a).setDuration(450).start();
        heroScrim.animate().alpha(a).setDuration(450).start();
        heroInfo.animate().alpha(a).setDuration(350).start();
        heroDots.animate().alpha(a).setDuration(350).start();
        chevron.animate().alpha(1f - a).setDuration(350).start();
        heroBack.animate().alpha(0f).setDuration(450).start();
        handler.removeCallbacks(heroAdvance);
        if (show) scheduleAdvance();
    }

    void scheduleAdvance() {
        handler.removeCallbacks(heroAdvance);
        int sec = Suggestions.advanceSeconds(this);
        if (sec > 0 && heroShown && resumed) handler.postDelayed(heroAdvance, sec * 1000L);
    }

    void heroStep(int dir, boolean user) {
        if (heroItems.size() < 2) return;
        showHero((heroIndex + dir + heroItems.size()) % heroItems.size(), dir);
        if (!user || !shelfView.hasFocus()) scheduleAdvance();
    }

    /** dir: +1 next, -1 previous, 0 first show (no slide). */
    void showHero(int index, int dir) {
        heroIndex = index;
        Suggestions.Item it = heroItems.get(index);
        for (int i = 0; i < heroDots.getChildCount(); i++) {
            heroDots.getChildAt(i).animate().alpha(i == index ? 1f : 0.35f).setDuration(250).start();
        }
        int want = index;
        io.execute(() -> {
            Bitmap bd = Suggestions.image(this, it.backdrop, "w1280", Math.min(1280, screenW));
            Bitmap bdBlur = Ui.blur(bd, 160, 90, 3, 3);
            String logoPath = Suggestions.logoFor(this, it);
            Bitmap logo = logoPath.isEmpty() ? null : Suggestions.image(this, logoPath, "w500", 500);
            handler.post(() -> {
                if (heroIndex != want || heroItems.isEmpty()) return;
                applyHeroInfo(it, logo, dir);
                if (bd != null) crossfadeHero(bd, dir);
                if (bdBlur != null) {
                    heroBlur = bdBlur;
                    if (heroShown) {
                        glassBg = heroBlur;
                        invalidateGlass();
                    }
                }
            });
        });
    }

    /** Title/meta/overview for an item, applied in the same frame as its artwork. */
    void applyHeroInfo(Suggestions.Item it, Bitmap logo, int dir) {
        heroTitle.setText(it.title);
        heroTitle.setVisibility(View.VISIBLE);
        heroLogo.setImageDrawable(null);
        heroLogo.setVisibility(View.GONE);
        List<String> meta = new ArrayList<>();
        if (!it.year.isEmpty()) meta.add(it.year);
        meta.add(it.type.equals("tv") ? "Series" : "Movie");
        if (!it.genres.isEmpty()) meta.add(it.genres);
        if (it.rating > 0) meta.add(String.format(java.util.Locale.US, "\u2605 %.1f", it.rating));
        heroMeta.setText(String.join("  \u00B7  ", meta));
        heroOverview.setText(it.overview);
        Suggestions.Provider p = it.provider();
        heroBtnText.setText(p != null && !Suggestions.installed(this, p.pkg) ? "Get" : "\u25B6  Open");
        int icon = p == null ? 0 : getResources().getIdentifier("provider_" + p.jwShort, "drawable", getPackageName());
        heroProvider.setImageResource(icon);
        heroProvider.setVisibility(icon == 0 ? View.GONE : View.VISIBLE);
        heroBtnIcon.setVisibility(View.GONE);
        if (logo != null) {
            heroLogo.setImageBitmap(logo);
            heroLogo.setVisibility(View.VISIBLE);
            heroTitle.setVisibility(View.GONE);
        }
        if (heroShown && dir != 0) {
            // Text glides in from the side you pressed, like the artwork.
            heroInfo.animate().cancel();
            heroInfo.setAlpha(0f);
            heroInfo.setTranslationX(dp(28) * dir);
            heroInfo.animate().alpha(1f).translationX(0).setDuration(520).setInterpolator(EASE).start();
        }
    }

    /**
     * Artwork transition (tvOS carousel): the new image slides in from the side you pressed and
     * fades up over the old one, which drifts the other way and fades out.
     */
    void crossfadeHero(Bitmap bd, int dir) {
        ImageView next = heroBack;
        heroBack = heroFront;
        heroFront = next;
        ImageView old = heroBack;
        next.animate().cancel();
        next.setImageBitmap(bd);
        float target = heroShown ? 1f : 0f;
        if (dir == 0 || !heroShown) {
            next.setTranslationX(0);
            next.setAlpha(target);
            old.setAlpha(0f);
            return;
        }
        next.setTranslationX(screenW * 0.12f * dir);
        next.setAlpha(0f);
        next.animate().withLayer().translationX(0).alpha(1f).setDuration(650).setInterpolator(EASE).start();
        old.animate().cancel();
        old.animate().withLayer().translationX(-screenW * 0.06f * dir).alpha(0f).setDuration(650)
                .setInterpolator(EASE).withEndAction(() -> old.setTranslationX(0)).start();
    }

    /** Carousel focused: the dock slides away and the artwork takes the whole screen (tvOS Top Shelf). */
    boolean heroRequested;

    void heroFocused(boolean has) {
        if (has && !heroRequested) {
            // Android parked focus here on its own (startup/rebuild): hand it back to the dock.
            handler.post(() -> focusIndex(Math.min(focusedIndex, Math.max(0, tiles.size() - 1))));
            return;
        }
        if (!has) heroRequested = false;
        if (has) {
            setHeroShown(true);
            heroButton.animate().scaleX(1.08f).scaleY(1.08f).setDuration(240).setInterpolator(LIFT).start();
            heroButton.setElevation(dp(10));
            heroBtnBg.setColor(0xFFFFFFFF);
            heroBtnText.setTextColor(0xFF111114);
            scroll.smoothScrollTo(0, 0);
            scroll.animate().translationY(screenH - shelfH + dp(30)).setDuration(500).setInterpolator(EASE)
                    .setUpdateListener(an -> invalidateGlass()).start();
            heroInfo.animate().translationY(0).setDuration(500).setInterpolator(EASE).start();
            heroDots.animate().translationY(0).setDuration(500).setInterpolator(EASE).start();
            heroOverview.setVisibility(View.VISIBLE);
            heroButton.setVisibility(View.VISIBLE);
            heroOverview.animate().alpha(0.85f).setDuration(400).setStartDelay(120).start();
            heroButton.animate().alpha(1f).setDuration(400).setStartDelay(120).start();
            handler.removeCallbacks(heroAdvance);
        } else {
            heroButton.animate().scaleX(1f).scaleY(1f).setDuration(180).start();
            heroButton.setElevation(0);
            heroBtnBg.setColor(0x47FFFFFF);
            heroBtnText.setTextColor(Color.WHITE);
            scroll.animate().translationY(0).setDuration(450).setInterpolator(EASE)
                    .setUpdateListener(an -> invalidateGlass()).start();
            heroInfo.animate().translationY(heroInfoRestY()).setDuration(450).setInterpolator(EASE).start();
            heroDots.animate().translationY(heroDotsRestY()).setDuration(450).setInterpolator(EASE).start();
            heroOverview.animate().alpha(0f).setDuration(160).setStartDelay(0)
                    .withEndAction(() -> heroOverview.setVisibility(View.GONE)).start();
            heroButton.animate().alpha(0f).setDuration(160).setStartDelay(0)
                    .withEndAction(() -> heroButton.setVisibility(View.GONE)).start();
            scheduleAdvance();
        }
    }

    /** Carousel and capsule navigation: LEFT/RIGHT browse, OK opens, UP/DOWN move between capsule, carousel and dock. */
    boolean heroKeys(KeyEvent ev) {
        if (moveIndex >= 0) return false;
        int k = ev.getKeyCode();
        boolean down = ev.getAction() == KeyEvent.ACTION_DOWN;
        View f = getCurrentFocus();
        boolean heroActive = shelfView.isFocusable() && !folderMode;
        if (f == shelfView) {
            switch (k) {
                case KeyEvent.KEYCODE_DPAD_LEFT: if (down) heroStep(-1, true); return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT: if (down) heroStep(1, true); return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (!down && !heroItems.isEmpty()) Suggestions.open(this, heroItems.get(heroIndex));
                    return true;
                case KeyEvent.KEYCODE_DPAD_UP: if (down) clockBox.requestFocus(); return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                case KeyEvent.KEYCODE_BACK:
                    if (down) focusIndex(Math.min(focusedIndex, COLS - 1));
                    return true;
                default: return false;
            }
        }
        if (f == clockBox) {
            if (k == KeyEvent.KEYCODE_DPAD_DOWN || k == KeyEvent.KEYCODE_BACK) {
                if (down) {
                    if (heroActive) {
                    heroRequested = true;
                    shelfView.requestFocus();
                }
                    else focusIndex(Math.min(focusedIndex, COLS - 1));
                }
                return true;
            }
            return k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_DPAD_UP;
        }
        int i = tiles.indexOf(f);
        if (i >= 0 && ((k == KeyEvent.KEYCODE_DPAD_RIGHT && (i % COLS == COLS - 1 || i == tiles.size() - 1))
                || (k == KeyEvent.KEYCODE_DPAD_LEFT && i % COLS == 0))) {
            return true;
        }
        if (k == KeyEvent.KEYCODE_DPAD_UP && i >= 0 && i < COLS && (hasDock() || i < COLS)) {
            if (down) {
                if (heroActive) {
                    heroRequested = true;
                    shelfView.requestFocus();
                }
                else clockBox.requestFocus();
            }
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- focus sway

    ValueAnimator sway;
    View swayView;

    /** Slow elliptical tilt of the focused card with the highlight drifting against it. */
    void startSway(View v, View glare) {
        if (moveIndex >= 0 || !v.hasFocus() && !v.isFocused()) return;
        stopSway(swayView);
        swayView = v;
        sway = ValueAnimator.ofFloat(0f, (float) (2 * Math.PI));
        sway.setDuration(5200);
        sway.setRepeatCount(ValueAnimator.INFINITE);
        sway.setInterpolator(new android.view.animation.LinearInterpolator());
        sway.addUpdateListener(an -> {
            float t = (float) an.getAnimatedValue();
            float sin = (float) Math.sin(t), cos = (float) Math.cos(t);
            v.setRotationY(2.2f * sin);
            v.setRotationX(-1.4f * cos);
        });
        sway.start();
    }

    void stopSway(View v) {
        if (sway != null && (v == null || v == swayView)) {
            sway.cancel();
            sway = null;
            if (swayView != null) {
                swayView.animate().rotationX(0).rotationY(0).setDuration(160).start();
            }
            swayView = null;
        }
    }

    // ---------------------------------------------------------------- launch animation

    /**
     * tvOS-style launch: a full-screen card in the app's colour grows out of the tile while the
     * grid recedes; the app is started near the end of the zoom and cross-fades in.
     */
    void launchAnimated(View tile, AppEntry a) {
        if (launchOverlay != null) return;

        int[] loc = new int[2];
        tile.getLocationInWindow(loc);
        int[] rootLoc = new int[2];
        root.getLocationInWindow(rootLoc);
        float vx = loc[0] - rootLoc[0];
        float vy = loc[1] - rootLoc[1];
        float sx0 = tile.getWidth() * tile.getScaleX() / root.getWidth();
        float sy0 = tile.getHeight() * tile.getScaleY() / root.getHeight();

        // The card exactly as it looks on screen right now (scaled by focus/press).
        RectF card = new RectF(vx, vy, vx + tile.getWidth() * tile.getScaleX(),
                vy + tile.getHeight() * tile.getScaleY());
        int startColor = a.banner != null ? edgeColor(a) : a.color;
        int endColor = launchBackground(a, startColor);
        LaunchCard art = new LaunchCard(card, radius * tile.getScaleX(),
                a.banner != null ? bannerArt(a) : null, copyOf(a.icon), startColor,
                // Icon apps fill with a flat colour, so they can hand off to the app's own colour.
                a.banner == null && colorDistance(startColor, endColor) > 12 ? endColor : startColor);
        View ov = new View(this);
        ov.setBackground(art);
        ov.setElevation(dp(24));
        root.addView(ov, new FrameLayout.LayoutParams(root.getWidth(), root.getHeight()));
        launchOverlay = ov;
        launchTile = tile;
        tile.setAlpha(0f);

        ValueAnimator zoom = ValueAnimator.ofFloat(0f, 1f);
        zoom.setDuration(480);
        zoom.setInterpolator(EASE);
        zoom.addUpdateListener(an -> art.setProgress((float) an.getAnimatedValue()));
        zoom.start();

        scroll.animate().scaleX(0.9f).scaleY(0.9f).alpha(0f).setDuration(420).setInterpolator(EASE).start();
        clockBox.animate().alpha(0f).setDuration(250).start();

        handler.postDelayed(() -> {
            try {
                Bundle opts = ActivityOptions.makeCustomAnimation(
                        this, R.anim.app_enter, R.anim.home_hold).toBundle();
                startActivity(a.launch, opts);
            } catch (ActivityNotFoundException | SecurityException e) {
                toast("Can't open " + a.label);
                finishLaunchReturn();
            }
        }, 380);
    }

    /** Coming back to Home after a launch: the card fades away and the grid zooms back in. */
    void finishLaunchReturn() {
        View ov = launchOverlay;
        View tile = launchTile;
        launchOverlay = null;
        launchTile = null;
        if (ov == null) return;
        handler.removeCallbacksAndMessages(null);

        scroll.setScaleX(1.06f);
        scroll.setScaleY(1.06f);
        scroll.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(420).setInterpolator(EASE).start();
        clockBox.animate().alpha(clockAlpha()).setDuration(420).start();
        if (tile != null) tile.animate().alpha(1f).setDuration(300).start();
        ov.animate().alpha(0f).scaleX(0.96f).scaleY(0.96f).setDuration(300)
                .setListener(new AnimatorListenerAdapter() {
                    @Override public void onAnimationEnd(Animator animation) {
                        root.removeView(ov);
                    }
                }).start();
        if (tile != null) tile.requestFocus();
    }

    /**
     * The colour the app paints first: its Android 12 splash background, else its window
     * background. Ending the zoom on this colour makes the handoff to the app seamless.
     */
    int launchBackground(AppEntry a, int fallback) {
        ComponentName cn = a.launch.getComponent();
        if (cn == null) return fallback;
        try {
            ActivityInfo ai = getPackageManager().getActivityInfo(cn, 0);
            Context pc = createPackageContext(cn.getPackageName(), 0);
            Resources.Theme theme = pc.getResources().newTheme();
            theme.applyStyle(ai.getThemeResource(), true);
            int[] attrs = Build.VERSION.SDK_INT >= 31
                    ? new int[]{android.R.attr.windowSplashScreenBackground, android.R.attr.windowBackground}
                    : new int[]{android.R.attr.windowBackground};
            TypedArray ta = theme.obtainStyledAttributes(attrs);
            try {
                for (int i = 0; i < attrs.length; i++) {
                    TypedValue v = ta.peekValue(i);
                    if (v == null) continue;
                    int color = 0;
                    if (v.type >= TypedValue.TYPE_FIRST_COLOR_INT && v.type <= TypedValue.TYPE_LAST_COLOR_INT) {
                        color = v.data;
                    } else {
                        Drawable d = ta.getDrawable(i);
                        if (d instanceof ColorDrawable) color = ((ColorDrawable) d).getColor();
                    }
                    if (Color.alpha(color) > 200) return color | 0xFF000000;
                }
            } finally {
                ta.recycle();
            }
        } catch (Exception e) {
            // Theme unreadable: keep the banner colour.
        }
        return fallback;
    }

    static int colorDistance(int x, int y) {
        return Math.abs(Color.red(x) - Color.red(y)) + Math.abs(Color.green(x) - Color.green(y))
                + Math.abs(Color.blue(x) - Color.blue(y));
    }

    static int blendArgb(int x, int y, float t) {
        return Color.argb(
                (int) (Color.alpha(x) + (Color.alpha(y) - Color.alpha(x)) * t),
                (int) (Color.red(x) + (Color.red(y) - Color.red(x)) * t),
                (int) (Color.green(x) + (Color.green(y) - Color.green(x)) * t),
                (int) (Color.blue(x) + (Color.blue(y) - Color.blue(x)) * t));
    }

    static int blend(int x, int y, float t) {
        return Color.rgb(
                (int) (Color.red(x) + (Color.red(y) - Color.red(x)) * t),
                (int) (Color.green(x) + (Color.green(y) - Color.green(x)) * t),
                (int) (Color.blue(x) + (Color.blue(y) - Color.blue(x)) * t));
    }

    /** Colour along the banner's edges, so the zoomed card blends with the banner art. */
    int edgeColor(AppEntry a) {
        Bitmap b = backdropSharp(a, 96, 54);
        int w = b.getWidth() - 3, h = b.getHeight() - 3;
        int[] px = {b.getPixel(2, 2), b.getPixel(w, 2), b.getPixel(2, h), b.getPixel(w, h),
                b.getPixel(w / 2, 2), b.getPixel(w / 2, h)};
        int r = 0, g = 0, bl = 0;
        for (int p : px) {
            r += Color.red(p);
            g += Color.green(p);
            bl += Color.blue(p);
        }
        b.recycle();
        return Color.rgb(r / px.length, g / px.length, bl / px.length);
    }

    /** Banner rendered sharp, minus a hairline border so anti-aliased edges don't get extended. */
    Bitmap bannerArt(AppEntry a) {
        int w = 640, h = 360, in = 3;
        Bitmap full = backdropSharp(a, w, h);
        Bitmap art = Bitmap.createBitmap(full, in, in, w - 2 * in, h - 2 * in);
        if (art != full) full.recycle();
        return art;
    }

    /**
     * The launch card, drawn in one pass so nothing distorts: a rounded rect that grows from the
     * card's on-screen rect to full screen while its corners flatten. Banner apps draw the banner
     * centre-cropped exactly like the card, with its edge pixels clamped outward, so the whole
     * screen continues the card's own background; the logo settles at ~42% of the screen.
     */
    static class LaunchCard extends Drawable {
        final RectF card;
        final float r0;
        final Bitmap art;
        final Drawable icon;
        final int color0, color1;
        final Paint artPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        final android.graphics.Matrix m = new android.graphics.Matrix();
        final android.graphics.Path clip = new android.graphics.Path();
        final RectF o = new RectF(), br = new RectF();
        float f;

        LaunchCard(RectF card, float r0, Bitmap art, Drawable icon, int color0, int color1) {
            this.card = card;
            this.r0 = r0;
            this.art = art;
            this.icon = icon;
            this.color0 = color0;
            this.color1 = color1;
            if (art != null) {
                artPaint.setShader(new android.graphics.BitmapShader(art, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            }
        }

        void setProgress(float f) {
            this.f = f;
            invalidateSelf();
        }

        static float lerp(float a, float b, float t) {
            return a + (b - a) * t;
        }

        @Override public void draw(Canvas c) {
            Rect b = getBounds();
            float W = b.width(), H = b.height();
            o.set(lerp(card.left, 0, f), lerp(card.top, 0, f), lerp(card.right, W, f), lerp(card.bottom, H, f));
            float rad = r0 * (1f - f);
            clip.reset();
            clip.addRoundRect(o, rad, rad, android.graphics.Path.Direction.CW);
            c.save();
            c.clipPath(clip);
            if (art != null) {
                // Banner rect: starts as the card itself, ends centred at 42% of the screen.
                float bw = lerp(card.width(), W * 0.42f, f), bh = lerp(card.height(), H * 0.42f, f);
                br.set(o.centerX() - bw / 2, o.centerY() - bh / 2, o.centerX() + bw / 2, o.centerY() + bh / 2);
                float scale = Math.max(br.width() / art.getWidth(), br.height() / art.getHeight());
                m.setScale(scale, scale);
                m.postTranslate(br.centerX() - art.getWidth() * scale / 2, br.centerY() - art.getHeight() * scale / 2);
                artPaint.getShader().setLocalMatrix(m);
                c.drawRect(o, artPaint);
            } else {
                float t = Math.max(0f, Math.min(1f, (f - 0.55f) / 0.45f));
                fill.setColor(blend(color0, color1, t));
                c.drawRect(o, fill);
                if (icon != null) {
                    float s = lerp(card.height() * 0.55f, H * 0.27f, f);
                    Rect old = icon.copyBounds();
                    icon.setBounds((int) (o.centerX() - s / 2), (int) (o.centerY() - s / 2),
                            (int) (o.centerX() + s / 2), (int) (o.centerY() + s / 2));
                    icon.draw(c);
                    icon.setBounds(old);
                }
            }
            c.restore();
        }

        @Override public void setAlpha(int a) { }
        @Override public void setColorFilter(android.graphics.ColorFilter cf) { }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
    }

    Drawable copyOf(Drawable d) {
        Drawable.ConstantState cs = d.getConstantState();
        return cs != null ? cs.newDrawable(getResources()).mutate() : d;
    }

    float clockAlpha() {
        return Math.max(0f, 1f - scroll.getScrollY() / (shelfH * 0.4f));
    }

    // ---------------------------------------------------------------- focus & shelf

    void onTileFocused(int index) {
        focusedIndex = index;
        boolean dock = hasDock() && index < COLS;
        setHeroShown(dock && !heroItems.isEmpty());
        scrollToRow(index / COLS);
        handler.removeCallbacks(shelfUpdate);
        handler.postDelayed(shelfUpdate, 90);
    }

    /**
     * Row tops come from the fixed grid geometry rather than getTop(), so this also works right
     * after buildGrid() (e.g. while moving a card), before the new rows have been laid out.
     */
    void scrollToRow(int row) {
        int rowH = tileH + labelH + gap / 2;
        int rowTop = !hasDock() ? shelfH + row * rowH
                : row == 0 ? shelfH
                : shelfH + tileH + 2 * dockPadV + dockGapBelow() + (row - 1) * rowH;
        int target = row == 0 ? 0 : rowTop - (int) (screenH * 0.30f);
        scroll.smoothScrollTo(0, Math.max(0, target));
    }

    void updateShelf(AppEntry a) {
        shelfEntry = a;
    }

    void focusIndex(int i) {
        if (tiles.isEmpty()) return;
        i = Math.max(0, Math.min(i, tiles.size() - 1));
        tiles.get(i).requestFocus();
        focusedIndex = i;
        updateShelf(shown.get(i));
        int row = i / COLS;
        scroll.post(() -> scrollToRow(row));
    }

    void goTop() {
        scroll.smoothScrollTo(0, 0);
        focusIndex(0);
    }

    String currentKey() {
        return focusedIndex >= 0 && focusedIndex < shown.size() ? shown.get(focusedIndex).key : null;
    }

    int indexOfKey(String key) {
        for (int j = 0; j < shown.size(); j++) if (shown.get(j).key.equals(key)) return j;
        return -1;
    }

    // ---------------------------------------------------------------- folder of hidden apps

    AppEntry folderEntry() {
        AppEntry f = new AppEntry();
        f.key = FOLDER_KEY;
        f.label = "More Apps";
        f.color = 0xFF3A3A3C;
        f.banner = new BitmapDrawable(getResources(), folderArt());
        f.icon = f.banner;
        return f;
    }

    /** Folder card: dark glass gradient, 3x3 app-grid glyph, title and hidden-app count. */
    Bitmap folderArt() {
        int w = 640, h = 360;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        // tvOS system-icon style: a vivid vertical gradient, white glyph, no words.
        p.setShader(new LinearGradient(0, 0, 0, h, 0xFF6E7BF2, 0xFF3A3FC8, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, p);
        p.setShader(null);

        int cell = 46, gapPx = 18, grid = cell * 3 + gapPx * 2;
        float gx = (w - grid) / 2f, gy = (h - grid) / 2f;
        Paint sh = new Paint(Paint.ANTI_ALIAS_FLAG);
        sh.setColor(0x33000000);
        sh.setMaskFilter(new android.graphics.BlurMaskFilter(10, android.graphics.BlurMaskFilter.Blur.NORMAL));
        p.setColor(Color.WHITE);
        for (int i = 0; i < 9; i++) {
            float x = gx + (i % 3) * (cell + gapPx), y = gy + (i / 3) * (cell + gapPx);
            c.drawRoundRect(x, y + 5, x + cell, y + cell + 5, 13, 13, sh);
            c.drawRoundRect(x, y, x + cell, y + cell, 13, 13, p);
        }
        return b;
    }

    Bitmap backdropSharp(AppEntry e, int w, int h) {
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawColor(e.banner != null ? 0xFF1C1C1E : e.color);
        Drawable d = e.banner != null ? e.banner : e.icon;
        if (d != null) {
            Rect old = d.copyBounds();
            if (e.banner != null) {
                d.setBounds(0, 0, w, h);
            } else {
                int s = h * 6 / 10;
                d.setBounds((w - s) / 2, (h - s) / 2, (w + s) / 2, (h + s) / 2);
            }
            d.draw(c);
            d.setBounds(old);
        }
        return b;
    }

    void enterFolder() {
        if (hiddenApps.isEmpty()) return;
        animateGridSwap(() -> {
            folderMode = true;
            setHeroShown(false);
            buildGrid();
            shelfEntry = null;
            scroll.scrollTo(0, 0);
            focusIndex(0);
        });
    }

    void exitFolder() {
        animateGridSwap(() -> {
            folderMode = false;
            buildGrid();
            shelfEntry = null;
            int i = indexOfKey(FOLDER_KEY);
            focusIndex(i >= 0 ? i : 0);
        });
    }

    /** Quick zoom-through between home and folder, so it reads as "opening" the folder. */
    void animateGridSwap(Runnable swap) {
        scroll.animate().alpha(0f).scaleX(0.94f).scaleY(0.94f).setDuration(140).setInterpolator(EASE)
                .withEndAction(() -> {
                    swap.run();
                    scroll.setScaleX(1.04f);
                    scroll.setScaleY(1.04f);
                    scroll.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(EASE)
                            .withEndAction(null).start();
                }).start();
    }

    // ---------------------------------------------------------------- keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        if (launchOverlay != null) return true;
        if (menuLayer != null) {
            int mk = ev.getKeyCode();
            if (mk == KeyEvent.KEYCODE_BACK || mk == KeyEvent.KEYCODE_MENU || mk == KeyEvent.KEYCODE_ESCAPE) {
                if (ev.getAction() == KeyEvent.ACTION_UP) closeMenu();
                return true;
            }
            return super.dispatchKeyEvent(ev);
        }
        if (heroKeys(ev)) return true;
        int k = ev.getKeyCode();
        boolean down = ev.getAction() == KeyEvent.ACTION_DOWN;

        if (moveIndex >= 0) {
            switch (k) {
                case KeyEvent.KEYCODE_DPAD_LEFT:   if (down) moveTo(moveIndex - 1); return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:  if (down) moveTo(moveIndex + 1); return true;
                case KeyEvent.KEYCODE_DPAD_UP:     if (down) moveTo(moveIndex - COLS); return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:   if (down) moveTo(moveIndex + COLS); return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                case KeyEvent.KEYCODE_BACK:
                case KeyEvent.KEYCODE_ESCAPE:      if (down) endMove(); return true;
                default: return super.dispatchKeyEvent(ev);
            }
        }
        if (k == KeyEvent.KEYCODE_MENU) {
            if (!down) {
                int i = tiles.indexOf(getCurrentFocus());
                if (i >= 0 && !FOLDER_KEY.equals(shown.get(i).key)) showOptions(i);
            }
            return true;
        }
        if (k == KeyEvent.KEYCODE_BACK) {
            if (!down) {
                if (folderMode) exitFolder();
                else goTop();
            }
            return true;
        }
        return super.dispatchKeyEvent(ev);
    }

    // ---------------------------------------------------------------- apps

    void loadApps() {
        all.clear();
        apps.clear();
        hiddenApps.clear();
        PackageManager pm = getPackageManager();
        Set<String> pkgs = new HashSet<>();
        addResolved(pm, Intent.CATEGORY_LEANBACK_LAUNCHER, pkgs, true);
        addResolved(pm, Intent.CATEGORY_LAUNCHER, pkgs, false);
        if (!pkgs.contains(TV_SETTINGS)) addSettingsEntry(pm);
        for (AppEntry e : all.values()) {
            if (e.banner == null || TVOS_CARD_PKGS.contains(e.pkg)) {
                e.banner = new BitmapDrawable(getResources(), tvosCard(e));
            }
        }

        Set<String> hidden = prefs.getStringSet(PREF_HIDDEN, Collections.emptySet());
        Map<String, AppEntry> pool = new LinkedHashMap<>();
        for (AppEntry e : all.values()) {
            if (hidden.contains(e.key)) hiddenApps.add(e);
            else pool.put(e.key, e);
        }
        Collections.sort(hiddenApps, (x, y) -> x.label.compareToIgnoreCase(y.label));

        for (String key : prefs.getString(PREF_ORDER, "").split(",")) {
            AppEntry e = pool.remove(key);
            if (e != null) apps.add(e);
        }
        List<AppEntry> rest = new ArrayList<>(pool.values());
        Collections.sort(rest, (x, y) -> {
            int px = priority(x), py = priority(y);
            return px != py ? Integer.compare(px, py) : x.label.compareToIgnoreCase(y.label);
        });
        apps.addAll(rest);
    }

    /** Fallback Settings tile for TVs whose settings app has no launcher entry. */
    void addSettingsEntry(PackageManager pm) {
        AppEntry s = new AppEntry();
        s.key = SETTINGS_KEY;
        s.pkg = TV_SETTINGS;
        s.label = "Settings";
        s.system = true;
        s.launch = new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            s.banner = pm.getApplicationBanner(s.pkg);
            s.icon = pm.getApplicationIcon(s.pkg);
        } catch (PackageManager.NameNotFoundException e) {
            s.icon = getDrawable(android.R.drawable.ic_menu_preferences);
        }
        s.color = 0xFF3A3A3C;
        all.put(s.key, s);
    }

    int priority(AppEntry e) {
        if (isSettings(e)) return 2000;
        int i = DEFAULT_ORDER.indexOf(e.pkg);
        return i >= 0 ? i : 1000;
    }

    boolean isSettings(AppEntry e) {
        return SETTINGS_KEY.equals(e.key) || TV_SETTINGS.equals(e.pkg);
    }

    void addResolved(PackageManager pm, String category, Set<String> pkgs, boolean leanback) {
        Intent q = new Intent(Intent.ACTION_MAIN).addCategory(category);
        for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
            ActivityInfo ai = ri.activityInfo;
            if (ai.packageName.equals(getPackageName()) || pkgs.contains(ai.packageName)) continue;
            AppEntry e = new AppEntry();
            ComponentName cn = new ComponentName(ai.packageName, ai.name);
            e.pkg = ai.packageName;
            e.key = cn.flattenToShortString();
            e.label = ri.loadLabel(pm).toString();
            e.banner = leanback ? ai.loadBanner(pm) : null;
            e.icon = ri.loadIcon(pm);
            e.color = tintFrom(e.icon);
            e.system = (ai.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            e.launch = new Intent(Intent.ACTION_MAIN).addCategory(category).setComponent(cn)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            all.put(e.key, e);
            pkgs.add(e.pkg);
        }
    }

    /** Average colour of the icon, darkened so white logos stay readable on top of it. */
    int tintFrom(Drawable d) {
        if (d == null) return 0xFF2C2C2E;
        Bitmap b = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888);
        Rect old = d.copyBounds();
        d.setBounds(0, 0, 16, 16);
        d.draw(new Canvas(b));
        d.setBounds(old);
        long r = 0, g = 0, bl = 0, n = 0;
        for (int x = 0; x < 16; x++) {
            for (int y = 0; y < 16; y++) {
                int p = b.getPixel(x, y);
                if (Color.alpha(p) < 128) continue;
                r += Color.red(p);
                g += Color.green(p);
                bl += Color.blue(p);
                n++;
            }
        }
        b.recycle();
        if (n == 0) return 0xFF2C2C2E;
        float[] hsv = new float[3];
        Color.RGBToHSV((int) (r / n), (int) (g / n), (int) (bl / n), hsv);
        hsv[1] = Math.min(hsv[1], 0.8f);
        hsv[2] = Math.min(hsv[2], 0.5f);
        return Color.HSVToColor(hsv);
    }

    void reload(String focusKey) {
        loadApps();
        if (folderMode && hiddenApps.isEmpty()) folderMode = false;
        buildGrid();
        shelfEntry = null;
        int i = focusKey == null ? -1 : indexOfKey(focusKey);
        focusIndex(i >= 0 ? i : Math.min(focusedIndex, shown.size() - 1));
    }

    void saveOrder() {
        StringBuilder sb = new StringBuilder();
        for (AppEntry e : apps) {
            if (sb.length() > 0) sb.append(',');
            sb.append(e.key);
        }
        prefs.edit().putString(PREF_ORDER, sb.toString()).apply();
    }

    void setHidden(AppEntry a, boolean hide) {
        Set<String> hidden = new HashSet<>(prefs.getStringSet(PREF_HIDDEN, Collections.emptySet()));
        if (hide) hidden.add(a.key);
        else hidden.remove(a.key);
        prefs.edit().putStringSet(PREF_HIDDEN, hidden).apply();
        int i = focusedIndex;
        loadApps();
        if (folderMode && hiddenApps.isEmpty()) folderMode = false;
        buildGrid();
        shelfEntry = null;
        focusIndex(Math.min(i, shown.size() - 1));
        toast(hide ? a.label + " moved to More Apps" : a.label + " is back on Home");
    }

    void registerPackageReceiver() {
        pkgReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                handler.removeCallbacks(reloadRun);
                handler.postDelayed(reloadRun, 600);
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addAction(Intent.ACTION_PACKAGE_REPLACED);
        f.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(pkgReceiver, f, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(pkgReceiver, f);
        }
    }

    // ---------------------------------------------------------------- options

    void showOptions(int index) {
        AppEntry a = shown.get(index);
        View tile = tiles.get(index);
        List<String> labels = new ArrayList<>();
        List<Runnable> actions = new ArrayList<>();
        labels.add("Open");
        actions.add(() -> launchAnimated(tile, a));
        if (folderMode) {
            labels.add("Show on Home Screen");
            actions.add(() -> setHidden(a, false));
        } else {
            labels.add("Move");
            actions.add(() -> startMove(index));
            if (!isSettings(a)) {
                labels.add("Hide");
                actions.add(() -> setHidden(a, true));
            }
        }
        if (!isSettings(a)) {
            labels.add("App Info");
            actions.add(() -> startSafe(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + a.pkg))));
            if (!a.system) {
                labels.add("Uninstall");
                actions.add(() -> startSafe(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + a.pkg))));
            }
        }
        if (!folderMode) {
            labels.add("Reset Layout");
            actions.add(() -> {
                prefs.edit().remove(PREF_ORDER).apply();
                reload(a.key);
            });
        }
        showMenu(tile, a.label, labels, actions, labels.indexOf("Uninstall"));
    }

    // ---------------------------------------------------------------- tvOS context menu

    FrameLayout menuLayer;
    View menuReturnFocus;

    /**
     * tvOS-style context menu: a dark Liquid Glass panel beside the focused card, title on top,
     * rows below; the focused row becomes a white pill with dark text. Back closes it.
     */
    void showMenu(View anchor, String title, List<String> labels, List<Runnable> actions, int destructive) {
        closeMenu();
        menuReturnFocus = anchor;
        stopSway(null);
        menuLayer = new FrameLayout(this);
        menuLayer.setBackgroundColor(0x00000000);
        menuLayer.setClickable(true);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(8), dp(12), dp(8), dp(8));
        // "Regular" Liquid Glass: heavier dimming so the menu text stays legible over anything.
        LiquidGlass glass = new LiquidGlass(dp(20), 0xB81A1A20, glassSource, screenW, screenH, unit);
        glass.lens = dp(8);
        panel.setBackground(glass);
        panel.setElevation(dp(30));
        panel.setClipChildren(false);
        panel.setClipToPadding(false);

        TextView head = text(11, Ui.font(this, "semibold"), 0.55f);
        head.setText(title);
        head.setShadowLayer(0, 0, 0, 0);
        head.setPadding(dp(12), 0, dp(12), dp(8));
        head.setSingleLine(true);
        head.setEllipsize(TextUtils.TruncateAt.END);
        panel.addView(head);

        List<View> rows = new ArrayList<>();
        for (int i = 0; i < labels.size(); i++) {
            int idx = i;
            TextView row = text(14, Ui.font(this, "medium"), 1f);
            row.setText(labels.get(i));
            row.setShadowLayer(0, 0, 0, 0);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(12), 0, dp(12), 0);
            row.setFocusable(true);
            row.setClickable(true);
            int base = i == destructive ? 0xFFFF6B5E : Color.WHITE;
            row.setTextColor(base);
            GradientDrawable pill = new GradientDrawable();
            pill.setCornerRadius(dp(12));
            pill.setColor(Color.TRANSPARENT);
            row.setBackground(pill);
            row.setOnFocusChangeListener((v, has) -> {
                pill.setColor(has ? 0xFFFFFFFF : Color.TRANSPARENT);
                row.setTextColor(has ? (idx == destructive ? 0xFFD7372A : 0xFF111114) : base);
                v.animate().scaleX(has ? 1.04f : 1f).scaleY(has ? 1.04f : 1f).setDuration(160).setInterpolator(LIFT).start();
            });
            row.setOnClickListener(v -> {
                closeMenu();
                actions.get(idx).run();
            });
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34));
            rlp.topMargin = dp(2);
            panel.addView(row, rlp);
            rows.add(row);
        }
        // Wrap focus top <-> bottom and keep it inside the menu.
        for (int i = 0; i < rows.size(); i++) {
            View r = rows.get(i);
            r.setId(View.generateViewId());
        }
        for (int i = 0; i < rows.size(); i++) {
            View r = rows.get(i);
            r.setNextFocusUpId(rows.get((i - 1 + rows.size()) % rows.size()).getId());
            r.setNextFocusDownId(rows.get((i + 1) % rows.size()).getId());
            r.setNextFocusLeftId(r.getId());
            r.setNextFocusRightId(r.getId());
        }

        int w = dp(220);
        int[] loc = new int[2];
        anchor.getLocationInWindow(loc);
        float aw = anchor.getWidth() * anchor.getScaleX(), ah = anchor.getHeight() * anchor.getScaleY();
        int x = (int) (loc[0] + aw + dp(18));
        if (x + w > screenW - dp(24)) x = (int) (loc[0] - w - dp(18));
        x = Math.max(dp(24), x);
        panel.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.UNSPECIFIED);
        int h = panel.getMeasuredHeight();
        int y = (int) (loc[1] + ah / 2 - h / 2f);
        y = Math.max(dp(24), Math.min(y, screenH - h - dp(24)));
        FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT);
        plp.leftMargin = x;
        plp.topMargin = y;
        menuLayer.addView(panel, plp);
        root.addView(menuLayer, match());

        // Pop in from the card's side.
        panel.setPivotX(x > loc[0] ? 0 : w);
        panel.setPivotY(h / 2f);
        panel.setAlpha(0f);
        panel.setScaleX(0.9f);
        panel.setScaleY(0.9f);
        panel.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(LIFT).start();
        menuLayer.animate().setDuration(220).start();
        menuLayer.setBackgroundColor(0x59000000);
        if (!rows.isEmpty()) rows.get(0).requestFocus();
    }

    void closeMenu() {
        if (menuLayer == null) return;
        FrameLayout m = menuLayer;
        menuLayer = null;
        m.animate().alpha(0f).setDuration(150).withEndAction(() -> root.removeView(m)).start();
        if (menuReturnFocus != null && menuReturnFocus.isAttachedToWindow()) menuReturnFocus.requestFocus();
        menuReturnFocus = null;
    }

    void startSafe(Intent i) {
        try {
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            toast("Not available on this TV");
        }
    }

    // ---------------------------------------------------------------- move mode

    void startMove(int index) {
        stopSway(null);
        moveIndex = index;
        focusIndex(index);
        startWiggle(tiles.get(index));
        toast("Use arrows to move · OK when done");
    }

    void moveTo(int to) {
        int last = apps.size() - 1;  // the folder tile always stays at the end
        if (to > last && moveIndex / COLS < last / COLS) to = last;
        if (to < 0 || to > last || to == moveIndex) return;
        Map<String, int[]> before = tilePositions();
        AppEntry e = apps.remove(moveIndex);
        apps.add(to, e);
        moveIndex = to;
        saveOrder();
        buildGrid();
        focusIndex(to);
        startWiggle(tiles.get(to));
        slideFrom(before);
    }

    /** Window position of every visible card, keyed by app, for the move animation. */
    Map<String, int[]> tilePositions() {
        Map<String, int[]> m = new LinkedHashMap<>();
        for (int i = 0; i < tiles.size(); i++) {
            int[] loc = new int[2];
            tiles.get(i).getLocationInWindow(loc);
            m.put(shown.get(i).key, loc);
        }
        return m;
    }

    /**
     * tvOS-style reflow: after the grid is rebuilt in its new order, every card starts at its old
     * on-screen position and glides to its new slot, so neighbours visibly make room.
     */
    void slideFrom(Map<String, int[]> before) {
        content.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
            @Override public boolean onPreDraw() {
                content.getViewTreeObserver().removeOnPreDrawListener(this);
                for (int i = 0; i < tiles.size(); i++) {
                    int[] old = before.get(shown.get(i).key);
                    if (old == null) continue;
                    View t = tiles.get(i);
                    int[] now = new int[2];
                    t.getLocationInWindow(now);
                    float dx = old[0] - now[0], dy = old[1] - now[1];
                    if (dx == 0 && dy == 0) continue;
                    if (Math.abs(dy) > tileH / 2f && Math.abs(dx) > tileW * 1.5f) {
                        // Wrapped to another row (end of a row): a slide would streak across the
                        // whole screen, so settle into the new slot instead, as tvOS does.
                        View cell = (View) t.getParent();
                        cell.setAlpha(0f);
                        cell.setScaleX(0.86f);
                        cell.setScaleY(0.86f);
                        cell.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(240).setInterpolator(EASE).start();
                        continue;
                    }
                    t.setTranslationX(dx);
                    t.setTranslationY(dy);
                    t.animate().translationX(0).translationY(0).setDuration(260).setInterpolator(EASE).start();
                }
                return true;
            }
        });
    }

    void endMove() {
        stopWiggle();
        moveIndex = -1;
    }

    void startWiggle(View v) {
        stopWiggle();
        wiggle = ObjectAnimator.ofFloat(v, View.ROTATION, -1.5f, 1.5f);
        wiggle.setDuration(130);
        wiggle.setRepeatCount(ValueAnimator.INFINITE);
        wiggle.setRepeatMode(ValueAnimator.REVERSE);
        wiggle.start();
    }

    void stopWiggle() {
        if (wiggle != null) {
            wiggle.cancel();
            Object t = wiggle.getTarget();
            if (t instanceof View) ((View) t).setRotation(0);
            wiggle = null;
        }
    }

    // ---------------------------------------------------------------- helpers

    TextView text(float sp, Typeface tf, float alpha) {
        TextView t = new TextView(this);
        Ui.textSize(t, sp);
        t.setTypeface(tf);
        t.setTextColor(Color.WHITE);
        t.setAlpha(alpha);
        t.setShadowLayer(10, 0, 2, 0x99000000);
        return t;
    }

    FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    /** Design units (1/960 of the screen width), so layout follows the display's resolution. */
    int dp(float v) {
        return Math.round(v * unit);
    }

    void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }
}
