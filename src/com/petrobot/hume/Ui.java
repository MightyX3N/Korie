package com.petrobot.hume;

import android.app.Activity;
import android.content.Context;
import android.graphics.Point;
import android.os.Build;
import android.util.TypedValue;
import android.view.Display;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * Resolution-independent sizing. The launcher is designed on a 960x540 grid (tvOS points / 2);
 * every size scales with the connected display's actual resolution, not its declared density,
 * so 720p, 1080p and 4K outputs (and any density setting) get the same proportions.
 */
public final class Ui {
    private Ui() { }

    /** Display size in pixels for the window this context is shown on. */
    static Point screen(Context c) {
        Point p = new Point();
        WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
        Display d = Build.VERSION.SDK_INT >= 30 && c instanceof Activity ? ((Activity) c).getDisplay() : wm.getDefaultDisplay();
        if (d == null) d = wm.getDefaultDisplay();
        d.getRealSize(p);
        // Korie: phones and car boxes can have a camera cutout; the layout keeps clear of it.
        int[] cut = cutout(d);
        boolean portrait = p.x < p.y;  // TVs are landscape; guard against a transient portrait report
        if (portrait) p.set(p.y - cut[1] - cut[3], p.x - cut[0] - cut[2]);
        else p.set(p.x - cut[0] - cut[2], p.y - cut[1] - cut[3]);
        return p;
    }

    /** Korie: a phone, tablet or car box — a touch screen and not a TV. */
    static boolean touchDevice(Context c) {
        android.content.pm.PackageManager pm = c.getPackageManager();
        return pm.hasSystemFeature("android.hardware.touchscreen") && !pm.hasSystemFeature("android.software.leanback");
    }

    /**
     * Korie, touch devices only: a round Back button in the top-left corner that does exactly what
     * the Back key does. It shows while `show` says there is something to go back from, and it
     * cannot take the remote's focus.
     */
    static void backButton(final Activity a, final java.util.function.BooleanSupplier show) {
        if (!touchDevice(a)) return;
        android.view.ViewGroup content = a.findViewById(android.R.id.content);
        if (content == null) return;
        final android.widget.TextView b = new android.widget.TextView(a);
        b.setText("\u2039");
        b.setTextColor(0xFFFFFFFF);
        b.setTypeface(font(a, "medium"));
        b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, px(a, 26));
        b.setGravity(android.view.Gravity.CENTER);
        b.setIncludeFontPadding(false);
        b.setPadding(0, 0, px(a, 2), px(a, 4));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        bg.setColor(0x66303036);
        bg.setStroke(Math.max(1, px(a, 0.5f)), 0x33FFFFFF);
        b.setBackground(bg);
        b.setFocusable(false);
        b.setElevation(px(a, 40));
        b.setOnClickListener(v -> {
            a.dispatchKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_BACK));
            a.dispatchKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_BACK));
        });
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(px(a, 36), px(a, 36),
                android.view.Gravity.TOP | android.view.Gravity.START);
        lp.leftMargin = px(a, 14);
        lp.topMargin = px(a, 12);
        content.addView(b, lp);
        b.setVisibility(show.getAsBoolean() ? android.view.View.VISIBLE : android.view.View.INVISIBLE);
        content.getViewTreeObserver().addOnPreDrawListener(() -> {
            int want = show.getAsBoolean() ? android.view.View.VISIBLE : android.view.View.INVISIBLE;
            if (b.getVisibility() != want) b.setVisibility(want);
            return true;
        });
    }

    /** {left, top, right, bottom} the display's cutout takes, in pixels (zeros on TVs and before Android 10). */
    static int[] cutout(Display d) {
        if (Build.VERSION.SDK_INT >= 29 && d != null) {
            android.view.DisplayCutout dc = d.getCutout();
            if (dc != null) return new int[]{dc.getSafeInsetLeft(), dc.getSafeInsetTop(), dc.getSafeInsetRight(), dc.getSafeInsetBottom()};
        }
        return new int[4];
    }

    /**
     * Korie: the window covers the whole display on any device — status and navigation bars hidden
     * (a swipe from the edge shows them for a moment), content kept clear of a camera cutout. On a
     * TV there is nothing to hide and this changes nothing.
     */
    static void fullscreen(Activity a) {
        android.view.Window w = a.getWindow();
        // Android 11+: the window covers every cutout and the padding below keeps content clear of
        // them. Android 9-10: only short-edge cutouts can be covered; the system itself keeps the
        // window off a long-edge one, so only left/right are padded here.
        boolean all = Build.VERSION.SDK_INT >= 30;
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = all ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        final android.view.View decor = w.getDecorView();
        final int flags = android.view.View.SYSTEM_UI_FLAG_FULLSCREEN | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        decor.setSystemUiVisibility(flags);
        decor.getViewTreeObserver().addOnWindowFocusChangeListener(has -> {
            if (has) decor.setSystemUiVisibility(flags);
        });
        Display d = Build.VERSION.SDK_INT >= 30 ? a.getDisplay() : a.getWindowManager().getDefaultDisplay();
        int[] cut = cutout(d);
        android.view.View content = a.findViewById(android.R.id.content);
        if (content != null) content.setPadding(cut[0], all ? cut[1] : 0, cut[2], all ? cut[3] : 0);
    }

    /** Pixels per design unit (1 unit = 1/960 of the screen width, capped by height for odd aspect ratios). */
    static float unit(Context c) {
        Point p = screen(c);
        return Math.min(p.x / 960f, p.y / 540f);
    }

    public static int px(Context c, float units) {
        return Math.round(units * unit(c));
    }

    private static final java.util.Map<String, android.graphics.Typeface> FONTS = new java.util.HashMap<>();

    /**
     * Inter (OFL, bundled): the closest open font to Apple's SF. "display" is Inter Display Bold for
     * large titles; "regular", "medium", "semibold" for UI and body text.
     */
    public static android.graphics.Typeface font(Context c, String weight) {
        android.graphics.Typeface t = FONTS.get(weight);
        if (t == null) {
            String file = weight.equals("display") ? "InterDisplay-Bold" : weight.equals("medium") ? "Inter-Medium"
                    : weight.equals("semibold") ? "Inter-SemiBold" : "Inter-Regular";
            try {
                t = android.graphics.Typeface.createFromAsset(c.getAssets(), "fonts/" + file + ".ttf");
            } catch (RuntimeException e) {
                t = android.graphics.Typeface.DEFAULT;
            }
            FONTS.put(weight, t);
        }
        return t;
    }

    /**
     * Small, heavily blurred copy of an image (box blur, several passes). Used as the backdrop
     * that Liquid Glass surfaces sample; at this size it costs a few milliseconds.
     */
    static android.graphics.Bitmap blur(android.graphics.Bitmap src, int w, int h, int radius, int passes) {
        if (src == null) return null;
        android.graphics.Bitmap b = android.graphics.Bitmap.createScaledBitmap(src, w, h, true)
                .copy(android.graphics.Bitmap.Config.ARGB_8888, true);
        int[] px = new int[w * h], tmp = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        for (int p = 0; p < passes; p++) {
            boxBlur(px, tmp, w, h, radius, true);
            boxBlur(tmp, px, w, h, radius, false);
        }
        b.setPixels(px, 0, w, 0, 0, w, h);
        return b;
    }

    /** Liquid Glass backdrop: blurred image with boosted saturation and a slight lift, baked once. */
    static android.graphics.Bitmap glassBackdrop(android.graphics.Bitmap src, int w, int h) {
        android.graphics.Bitmap blurred = blur(src, w, h, 3, 3);
        if (blurred == null) return null;
        android.graphics.Bitmap out = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.ColorMatrix cm = new android.graphics.ColorMatrix();
        cm.setSaturation(1.6f);
        cm.postConcat(new android.graphics.ColorMatrix(new float[]{
                1.05f, 0, 0, 0, 14, 0, 1.05f, 0, 0, 14, 0, 0, 1.05f, 0, 14, 0, 0, 0, 1, 0}));
        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG);
        p.setColorFilter(new android.graphics.ColorMatrixColorFilter(cm));
        new android.graphics.Canvas(out).drawBitmap(blurred, 0, 0, p);
        blurred.recycle();
        return out;
    }

    private static void boxBlur(int[] in, int[] out, int w, int h, int r, boolean horizontal) {
        int len = horizontal ? w : h, lines = horizontal ? h : w;
        for (int l = 0; l < lines; l++) {
            int ra = 0, ga = 0, ba = 0, n = 0;
            for (int i = -r; i <= r; i++) {
                int k = Math.max(0, Math.min(len - 1, i));
                int c = in[horizontal ? l * w + k : k * w + l];
                ra += (c >> 16) & 0xFF; ga += (c >> 8) & 0xFF; ba += c & 0xFF; n++;
            }
            for (int i = 0; i < len; i++) {
                out[horizontal ? l * w + i : i * w + l] = 0xFF000000 | ((ra / n) << 16) | ((ga / n) << 8) | (ba / n);
                int outI = Math.max(0, Math.min(len - 1, i - r)), inI = Math.max(0, Math.min(len - 1, i + r + 1));
                int co = in[horizontal ? l * w + outI : outI * w + l], ci = in[horizontal ? l * w + inI : inI * w + l];
                ra += ((ci >> 16) & 0xFF) - ((co >> 16) & 0xFF);
                ga += ((ci >> 8) & 0xFF) - ((co >> 8) & 0xFF);
                ba += (ci & 0xFF) - (co & 0xFF);
            }
        }
    }

    /** Text sized in design units so type scales with the display like everything else. */
    public static void textSize(TextView t, float units) {
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, units * unit(t.getContext()));
    }
}
