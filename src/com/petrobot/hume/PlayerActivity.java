package com.petrobot.hume;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Korie's video player. The picture and the whole control bar (play/pause, seeking, subtitles,
 * audio tracks) are Media3's own PlayerView, which already works with a remote and by touch.
 *
 * What is added follows Jellyfin's own Android TV app (jellyfin-androidtv):
 * - Back while the controls show only hides them; Back again leaves.
 * - Intro, recap, credits and previews: when playing reaches one, a "Skip" button shows for 8
 *   seconds, bottom right, hidden while the controls show. It never takes the focus: while it
 *   shows, OK presses it (a tap does, on a touch screen). Seeking into the middle of one shows nothing.
 * - When an episode ends and there is a next one: the Next Up screen, with Cancel and Watch Now,
 *   counting down 7 seconds (when the add-on allows it to start by itself). Moving to Cancel stops
 *   the count. Those two are plain Android buttons; moving between them is Android's own.
 * - Progress is told to the add-on every 3 seconds while playing.
 */
public final class PlayerActivity extends Activity {
    /** The request to play; set by AddonEngine.play just before the activity starts (or is told to take a new one). */
    static Playback.Request next;
    /** The player on screen, so a new request (the next episode) can take it over without a new screen. */
    static PlayerActivity open;

    static final long REPORT_MS = 3000;       // as Jellyfin's app
    long skipShowMs = 8000;                   // as Jellyfin's app ("ask to skip" hides after 8 s)
    static final long SKIP_MIN_MS = 3000;     // shorter parts get no button (as Jellyfin's app)
    long countdownMs = 7000;                  // as Jellyfin's app (Next Up timeout)
    static final long NEXT_WAIT_MS = 20000;   // how long to wait for the add-on to start the next one

    Playback.Request req;
    ExoPlayer player;
    PlayerView view;
    FrameLayout root;
    float u;
    final Handler handler = new Handler(Looper.getMainLooper());
    boolean ended, reported, waitingNext, controls;

    // Skip
    TextView skip;
    Playback.Segment skipFor;
    long skipSince, lastPos = -1;

    // Next Up
    FrameLayout nextUp;
    TextView watchNow;
    long countdownStart;
    boolean counting;

    final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            if (player.isPlaying()) Playback.report(req, "playing", player.getCurrentPosition(), player.getDuration());
            handler.postDelayed(this, REPORT_MS);
        }
    };

    final Runnable watch = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            updateSkip();
            handler.postDelayed(this, 250);
        }
    };

    final Runnable countdown = new Runnable() {
        @Override public void run() {
            if (!counting || watchNow == null) return;
            float f = Math.min(1f, (System.currentTimeMillis() - countdownStart) / (float) countdownMs);
            watchNow.getBackground().setLevel((int) (f * 10000));
            if (f >= 1f) {
                counting = false;
                goNext();
            } else {
                handler.postDelayed(this, 50);
            }
        }
    };

    final Runnable giveUpNext = () -> {
        if (waitingNext) finish();
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (next == null) {
            finish();
            return;
        }
        Playback.stopAudio();  // a film takes over from the radio
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        view = new PlayerView(this);
        view.setBackgroundColor(0xFF000000);
        // How long the controls stay after the last key or touch ("controls_ms" exists for testing on slow emulators).
        // ("skip_ms" and "countdown_ms" likewise, for the Skip button and the Next Up count.)
        android.content.SharedPreferences pprefs = getSharedPreferences("player", MODE_PRIVATE);
        view.setControllerShowTimeoutMs(pprefs.getInt("controls_ms", 5000));
        skipShowMs = pprefs.getInt("skip_ms", 8000);
        countdownMs = pprefs.getInt("countdown_ms", 7000);
        view.setShowSubtitleButton(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        // When Media3's controls appear, start on Play/Pause (a focus hint; moving between the
        // controls is all Media3's own).
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            controls = visibility == View.VISIBLE;
            updateSkip();
            if (!controls) return;
            View pp = view.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            if (pp != null) pp.requestFocus();
        });
        root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // Sizes follow the screen: one unit is 1/960 of a 16:9 picture's width.
        u = Math.min(Ui.screen(this).x, Ui.screen(this).y * 16 / 9f) / 960f;
        skip = new TextView(this);
        skip.setTextColor(0xFF000000);
        skip.setTextSize(TypedValue.COMPLEX_UNIT_PX, 15 * u);
        skip.setTypeface(Ui.font(this, "semibold"));
        skip.setPadding((int) (20 * u), (int) (10 * u), (int) (20 * u), (int) (10 * u));
        skip.setBackground(round(0xF2FFFFFF, 40 * u));
        skip.setVisibility(View.GONE);
        skip.setFocusable(false);
        skip.setOnClickListener(v -> pressSkip());
        FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        slp.rightMargin = (int) (36 * u) + Ui.cutout(getWindowManager().getDefaultDisplay())[2];
        slp.bottomMargin = (int) (48 * u);
        root.addView(skip, slp);
        setContentView(root);
        Ui.fullscreen(this);
        open = this;
        start();
    }

    /** A new request while the player is open: the next episode takes over this screen. */
    void takeOver() {
        if (next == null) return;
        stopCurrent();
        start();
    }

    /** Starts what is in {@link #next}. */
    void start() {
        req = next;
        next = null;
        ended = reported = waitingNext = false;
        skipFor = null;
        lastPos = -1;
        handler.removeCallbacks(giveUpNext);
        hideNextUp();
        skip.setVisibility(View.GONE);
        player = Playback.build(this, req);
        view.setPlayer(player);
        view.setUseController(true);
        final ExoPlayer mine = player;
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !ended && player == mine) {
                    ended = true;
                    report("ended", mine.getDuration());
                    if (!req.next.isEmpty()) showNextUp();
                    else finish();
                }
            }

            @Override public void onPlayerError(PlaybackException e) {
                // After leaving (or while handing over to the next one) a slow shutdown can report an error: not the film's fault.
                if (player != mine || isFinishing() || waitingNext) return;
                Addons.toast((req.title.isEmpty() ? "That" : req.title) + " can’t be played: " + Playback.message(e));
                finish();
            }
        });
        player.prepare();
        player.play();
        view.requestFocus();
        handler.removeCallbacks(tick);
        handler.removeCallbacks(watch);
        handler.postDelayed(tick, REPORT_MS);
        handler.postDelayed(watch, 250);
    }

    /** Tells the add-on how this one ended, once. */
    void report(String state, long positionMs) {
        if (reported || player == null) return;
        reported = true;
        Playback.report(req, state, positionMs, player.getDuration());
    }

    void stopCurrent() {
        handler.removeCallbacks(tick);
        handler.removeCallbacks(watch);
        if (player != null) {
            ExoPlayer p = player;
            player = null;  // first, so nothing it says while shutting down is taken as this film's error
            report2(p);
            view.setPlayer(null);
            p.release();
        }
    }

    private void report2(ExoPlayer p) {
        if (reported) return;
        reported = true;
        Playback.report(req, "stopped", p.getCurrentPosition(), p.getDuration());
    }

    // ---------------------------------------------------------------- skip

    /**
     * A part starts when playing goes over its beginning (a jump of under 3 s from the last look,
     * so a seek into the middle of it doesn't count; a part at 0 counts when playing from the start).
     */
    void updateSkip() {
        if (player == null || skip == null) return;
        long pos = player.getCurrentPosition();
        if (player.isPlaying() || lastPos < 0) {
            for (Playback.Segment s : req.segments) {
                long st = (long) (s.start * 1000), en = (long) (s.end * 1000);
                if (en - st < SKIP_MIN_MS) continue;
                boolean crossed = lastPos >= 0 ? lastPos < Math.max(1, st) && pos >= Math.max(1, st) && pos - lastPos < 3000
                        : pos <= Math.max(st, 1) + 3000 && pos >= st && pos < en;
                if (crossed && skipFor != s) {
                    skipFor = s;
                    skipSince = System.currentTimeMillis();
                }
            }
            lastPos = pos;
        }
        Playback.Segment s = skipFor;
        boolean show = s != null && !controlsUp() && nextUp == null
                && System.currentTimeMillis() - skipSince < skipShowMs
                && pos <= (long) (s.end * 1000) - 1000;
        if (s != null && !show && System.currentTimeMillis() - skipSince >= skipShowMs) skipFor = null;
        if (show) {
            String label = s.type.equals("intro") ? "Skip Intro" : s.type.equals("recap") ? "Skip Recap"
                    : s.type.equals("credits") ? "Skip Credits" : s.type.equals("preview") ? "Skip Preview" : "Skip";
            if (!label.contentEquals(skip.getText())) skip.setText(label);
        }
        skip.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    void pressSkip() {
        Playback.Segment s = skipFor;
        if (s == null || player == null) return;
        skipFor = null;
        skip.setVisibility(View.GONE);
        long to = (long) (s.end * 1000);
        long dur = player.getDuration();
        if (dur > 0 && to >= dur - 1000) {
            // Credits that run to the end: done with this one (Next Up, or back to the page).
            player.seekTo(Math.max(0, dur - 1));
        } else {
            player.seekTo(to);
        }
    }

    // ---------------------------------------------------------------- Next Up

    void showNextUp() {
        if (nextUp != null) return;
        skip.setVisibility(View.GONE);
        view.hideController();
        view.setUseController(false);
        nextUp = new FrameLayout(this);
        nextUp.setBackgroundColor(0xE6000000);
        nextUp.setClickable(true);
        int pad = (int) (48 * u);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.BOTTOM);
        col.setPadding(pad + Ui.cutout(getWindowManager().getDefaultDisplay())[0], pad, pad, pad);
        if (!req.nextImage.isEmpty()) {
            ImageView img = new ImageView(this);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            img.setBackground(round(0x26FFFFFF, 6 * u));
            img.setClipToOutline(true);
            col.addView(img, new LinearLayout.LayoutParams((int) (320 * u), (int) (180 * u)));
            loadImage(img, req.nextImage);
        }
        TextView label = text("NEXT UP", 12, 0.6f, "semibold");
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(-2, -2);
        llp.topMargin = (int) (20 * u);
        col.addView(label, llp);
        TextView title = text(req.next, 28, 1f, "display");
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(title, new LinearLayout.LayoutParams((int) (560 * u), -2));
        String series = !req.nextSeries.isEmpty() ? req.nextSeries : req.title;
        if (!series.isEmpty()) col.addView(text(series, 15, 0.7f, "medium"), new LinearLayout.LayoutParams(-2, -2));
        if (!req.nextOverview.isEmpty()) {
            TextView ov = text(req.nextOverview, 14, 0.7f, "regular");
            ov.setMaxLines(3);
            ov.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams((int) (560 * u), -2);
            olp.topMargin = (int) (8 * u);
            col.addView(ov, olp);
        }
        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        TextView cancel = button("Cancel", false);
        cancel.setOnClickListener(v -> finish());
        watchNow = button("Watch Now", true);
        watchNow.setOnClickListener(v -> goNext());
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, -2);
        blp.rightMargin = (int) (12 * u);
        buttons.addView(cancel, blp);
        buttons.addView(watchNow, new LinearLayout.LayoutParams(-2, -2));
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-2, -2);
        rlp.topMargin = (int) (24 * u);
        col.addView(buttons, rlp);
        nextUp.addView(col, new FrameLayout.LayoutParams(-1, -1));
        root.addView(nextUp, new FrameLayout.LayoutParams(-1, -1));
        watchNow.requestFocus();
        // Moving away from Watch Now stops the count (as Jellyfin's app).
        watchNow.setOnFocusChangeListener((v, has) -> {
            if (!has && counting) {
                counting = false;
                watchNow.getBackground().setLevel(0);
            }
        });
        if (req.autoNext) {
            counting = true;
            countdownStart = System.currentTimeMillis();
            handler.post(countdown);
        }
    }

    void hideNextUp() {
        counting = false;
        handler.removeCallbacks(countdown);
        if (nextUp != null) root.removeView(nextUp);
        nextUp = null;
        watchNow = null;
    }

    /** Hands over to the add-on, which starts what comes next in this same screen. */
    void goNext() {
        if (waitingNext) return;
        counting = false;
        AddonEngine e = Addons.engine(req.addon);
        if (e == null || !e.answers("next")) {
            finish();
            return;
        }
        waitingNext = true;
        if (player != null && !ended) report("stopped", player.getCurrentPosition());
        if (watchNow != null) watchNow.setText("Loading…");
        e.fire("next", req.ref);
        handler.postDelayed(giveUpNext, NEXT_WAIT_MS);
    }

    // ---------------------------------------------------------------- keys

    /**
     * Media3's view takes the arrows, OK and the media keys. Back hides the controls when they
     * show, and leaves otherwise. While the Skip button shows (and the controls do not), OK
     * presses it. The Next Up screen is ordinary Android buttons.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        int k = ev.getKeyCode();
        boolean up = ev.getAction() == KeyEvent.ACTION_UP;
        boolean back = k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE || k == KeyEvent.KEYCODE_BUTTON_B;
        if (nextUp != null) {
            if (back) {
                if (up) finish();
                return true;
            }
            return super.dispatchKeyEvent(ev);
        }
        if (back && controlsUp()) {
            if (up) view.hideController();
            return true;
        }
        boolean ok = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (ok && !controlsUp() && skip.getVisibility() == View.VISIBLE) {
            if (up) pressSkip();
            return true;
        }
        if (waitingNext && !back) return true;
        if (view != null && !back && view.dispatchKeyEvent(ev)) return true;
        return super.dispatchKeyEvent(ev);
    }

    /**
     * Leaving with Back: tell the add-on now, not in onStop. Android brings the page under the
     * player back before it stops this screen; the add-on hears "stopped" first only if it is said here.
     */
    @Override
    protected void onPause() {
        super.onPause();
        if (isFinishing() && player != null) {
            handler.removeCallbacks(giveUpNext);
            player.pause();
            report(ended ? "ended" : "stopped", player.getCurrentPosition());  // freeing the player waits for onStop
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Leaving the player (Back, Home, another app) stops the film where it is.
        handler.removeCallbacks(giveUpNext);
        hideNextUp();
        stopCurrent();
        if (!isFinishing()) finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (open == this) open = null;
    }

    // ---------------------------------------------------------------- small helpers

    /** Whether Media3's controls are on screen, asked of the view itself (it doesn't report the show at playback start). */
    boolean controlsUp() {
        return view != null && view.isControllerFullyVisible();
    }

    GradientDrawable round(int color, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius);
        return g;
    }

    TextView text(String s, float size, float alpha, String weight) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(0xFFFFFFFF);
        t.setAlpha(alpha);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, size * u);
        t.setTypeface(Ui.font(this, weight));
        return t;
    }

    /** A pill button: white with black text when focused, glass otherwise; the main one fills up as it counts down. */
    TextView button(String label, boolean main) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_PX, 16 * u);
        b.setTypeface(Ui.font(this, "semibold"));
        b.setPadding((int) (28 * u), (int) (12 * u), (int) (28 * u), (int) (12 * u));
        b.setFocusable(true);
        b.setClickable(true);
        b.setTextColor(new ColorStateList(new int[][]{{android.R.attr.state_focused}, {}}, new int[]{0xFF000000, 0xFFFFFFFF}));
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[]{android.R.attr.state_focused}, round(0xFFFFFFFF, 40 * u));
        bg.addState(new int[]{}, round(0x40FFFFFF, 40 * u));
        if (main) {
            // The count: a darker fill growing from the left under the label (level 0..10000).
            GradientDrawable fill = round(0x33000000, 40 * u);
            Drawable[] layers = {bg, new ClipDrawable(fill, Gravity.START, ClipDrawable.HORIZONTAL)};
            LayerDrawable ld = new LayerDrawable(layers) {
                @Override protected boolean onLevelChange(int level) {
                    return getDrawable(1).setLevel(level);
                }
            };
            b.setBackground(ld);
        } else {
            b.setBackground(bg);
        }
        return b;
    }

    void loadImage(ImageView into, String url) {
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
                h.setConnectTimeout(8000);
                h.setReadTimeout(15000);
                Bitmap bmp;
                try (InputStream in = h.getInputStream()) {
                    bmp = BitmapFactory.decodeStream(in);
                } finally {
                    h.disconnect();
                }
                if (bmp != null) runOnUiThread(() -> into.setImageBitmap(bmp));
            } catch (Exception ignored) {
            }
        }, "korie-nextup-image").start();
    }
}
