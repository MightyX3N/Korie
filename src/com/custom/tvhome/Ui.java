package com.custom.tvhome;

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
final class Ui {
    private Ui() { }

    /** Display size in pixels for the window this context is shown on. */
    static Point screen(Context c) {
        Point p = new Point();
        WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
        Display d = Build.VERSION.SDK_INT >= 30 && c instanceof Activity ? ((Activity) c).getDisplay() : wm.getDefaultDisplay();
        if (d == null) d = wm.getDefaultDisplay();
        d.getRealSize(p);
        if (p.x < p.y) p.set(p.y, p.x);  // TVs are landscape; guard against a transient portrait report
        return p;
    }

    /** Pixels per design unit (1 unit = 1/960 of the screen width, capped by height for odd aspect ratios). */
    static float unit(Context c) {
        Point p = screen(c);
        return Math.min(p.x / 960f, p.y / 540f);
    }

    static int px(Context c, float units) {
        return Math.round(units * unit(c));
    }

    private static final java.util.Map<String, android.graphics.Typeface> FONTS = new java.util.HashMap<>();

    /**
     * Inter (OFL, bundled): the closest open font to Apple's SF. "display" is Inter Display Bold for
     * large titles; "regular", "medium", "semibold" for UI and body text.
     */
    static android.graphics.Typeface font(Context c, String weight) {
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

    /** Text sized in design units so type scales with the display like everything else. */
    static void textSize(TextView t, float units) {
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, units * unit(t.getContext()));
    }
}
