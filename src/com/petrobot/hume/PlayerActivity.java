package com.petrobot.hume;

import android.app.Activity;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Korie's video player. The picture and the whole control bar (play/pause, seeking, subtitles,
 * audio tracks) are Media3's own PlayerView, which already works with a remote and by touch —
 * nothing here handles selection.
 *
 * On top of it sits one button, bottom right, when the add-on said there is something to skip or
 * something next: "Skip Intro", "Skip Recap" or "Next Episode". It is never focused: while it is
 * showing and Media3's controls are not, OK presses it (and a tap does, on a touch screen).
 */
public final class PlayerActivity extends Activity {
    /** The request to play; set by AddonEngine.play just before the activity starts (or is told to take a new one). */
    static Playback.Request next;

    static final long LAST_MS = 30000;       // "Next Episode" in the last 30 s when the add-on gave no credits part
    static final long NEXT_WAIT_MS = 20000;  // how long to wait for the add-on to start the next one

    Playback.Request req;
    ExoPlayer player;
    PlayerView view;
    TextView offer;
    Runnable offerAction;
    Playback.Segment offerFor;
    boolean offerNextShown;
    long offerSince;
    final Handler handler = new Handler(Looper.getMainLooper());
    boolean ended, reported, waitingNext, controls;

    final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            if (player.isPlaying()) Playback.report(req, "playing", player.getCurrentPosition(), player.getDuration());
            handler.postDelayed(this, 10000);
        }
    };

    final Runnable watch = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            updateOffer();
            handler.postDelayed(this, 500);
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
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        view = new PlayerView(this);
        view.setBackgroundColor(0xFF000000);
        // How long the controls stay after the last key or touch ("controls_ms" exists for testing on slow emulators).
        view.setControllerShowTimeoutMs(getSharedPreferences("player", MODE_PRIVATE).getInt("controls_ms", 5000));
        view.setShowSubtitleButton(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        // When Media3's controls appear, start on Play/Pause (a focus hint; moving between the
        // controls is all Media3's own).
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            controls = visibility == View.VISIBLE;
            if (!controls) return;
            View pp = view.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            if (pp != null) pp.requestFocus();
        });
        root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // The skip / next button. Sizes follow the screen (a 16:9 TV at 1080p gives 18 px per unit).
        float u = Math.min(Ui.screen(this).x, Ui.screen(this).y * 16 / 9f) / 960f;
        offer = new TextView(this);
        offer.setTextColor(0xFF000000);
        offer.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 15 * u);
        offer.setTypeface(Ui.font(this, "semibold"));
        offer.setPadding((int) (20 * u), (int) (10 * u), (int) (20 * u), (int) (10 * u));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF2FFFFFF);
        bg.setCornerRadius(40 * u);
        offer.setBackground(bg);
        offer.setVisibility(View.GONE);
        offer.setFocusable(false);
        offer.setOnClickListener(v -> pressOffer());
        FrameLayout.LayoutParams olp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        olp.rightMargin = (int) (36 * u) + Ui.cutout(getWindowManager().getDefaultDisplay())[2];
        olp.bottomMargin = (int) (96 * u);
        root.addView(offer, olp);
        setContentView(root);
        Ui.fullscreen(this);
        open = this;
        start();
    }

    /** The player on screen, so a new request (the next episode) can take it over without a new screen. */
    static PlayerActivity open;

    /** A new request while the player is open: the next episode takes over this screen. */
    void takeOver() {
        if (next == null) return;
        stopCurrent();
        start();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (open == this) open = null;
    }

    /** Starts what is in {@link #next}. */
    void start() {
        req = next;
        next = null;
        ended = reported = waitingNext = false;
        offerFor = null;
        offerNextShown = false;
        handler.removeCallbacks(giveUpNext);
        hideOffer();
        player = Playback.build(this, req);
        view.setPlayer(player);
        final ExoPlayer mine = player;
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !ended && player == mine) {
                    ended = true;
                    report("ended", mine.getDuration());
                    if (!req.next.isEmpty() && req.autoNext) goNext();
                    else finish();
                }
            }

            @Override public void onPlayerError(PlaybackException e) {
                if (player != mine) return;
                Addons.toast((req.title.isEmpty() ? "That" : req.title) + " can\u2019t be played: " + Playback.message(e));
                finish();
            }
        });
        player.prepare();
        player.play();
        view.requestFocus();
        handler.removeCallbacks(tick);
        handler.removeCallbacks(watch);
        handler.postDelayed(tick, 10000);
        handler.postDelayed(watch, 500);
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
            report("stopped", player.getCurrentPosition());
            view.setPlayer(null);
            player.release();
            player = null;
        }
    }

    // ---------------------------------------------------------------- skip and next

    /** Twice a second: is the picture inside a part that can be skipped, or near the end with something next? */
    void updateOffer() {
        if (waitingNext) return;
        long pos = player.getCurrentPosition(), dur = player.getDuration();
        Playback.Segment in = null;
        boolean credits = false;
        for (Playback.Segment s : req.segments) {
            if (s.type.equals("credits")) credits = true;
            if (pos >= s.start * 1000 && pos < s.end * 1000 - 1000) in = s;
        }
        boolean hasNext = !req.next.isEmpty();
        boolean nextNow = hasNext && (in != null && in.type.equals("credits")
                || !credits && dur > 4 * LAST_MS && pos >= dur - LAST_MS);
        if (in != null && in.type.equals("credits")) in = null;  // credits are only a cue for Next Episode
        if (in != null) {
            if (offerFor != in) {
                offerFor = in;
                offerSince = System.currentTimeMillis();
            }
            final Playback.Segment seg = in;
            showOffer(in.type.equals("recap") ? "Skip Recap" : in.type.equals("intro") ? "Skip Intro" : "Skip", () -> {
                if (player != null) player.seekTo((long) (seg.end * 1000));
                hideOffer();
            });
        } else if (nextNow) {
            if (!offerNextShown) {
                offerNextShown = true;
                offerFor = null;
                offerSince = System.currentTimeMillis();
            }
            showOffer("Next Episode  \u25B6", this::goNext);
        } else {
            offerFor = null;
            offerNextShown = false;
            hideOffer();
        }
    }

    /** Shown for the whole part (the whole intro, all of the credits), as on the big streaming services. */
    void showOffer(String label, Runnable action) {
        offerAction = action;
        if (!label.contentEquals(offer.getText())) offer.setText(label);
        offer.setVisibility(View.VISIBLE);
    }

    void hideOffer() {
        offerAction = null;
        if (offer != null) offer.setVisibility(View.GONE);
    }

    void pressOffer() {
        Runnable r = offerAction;
        if (r != null) r.run();
    }

    /** Hands over to the add-on, which starts what comes next in this same screen. */
    void goNext() {
        if (waitingNext || player == null) return;
        waitingNext = true;
        report(ended ? "ended" : "stopped", player.getCurrentPosition());
        player.pause();
        offerAction = null;
        offer.setText("Loading the next episode\u2026");
        offer.setVisibility(View.VISIBLE);
        AddonEngine e = Addons.engine(req.addon);
        if (e == null || !e.answers("next")) {
            finish();
            return;
        }
        e.fire("next", req.ref);
        handler.postDelayed(giveUpNext, NEXT_WAIT_MS);
    }

    /**
     * Media3's view shows its controls and takes the arrows, OK and the media keys; Back leaves.
     * The one exception: while the skip / next button shows and the controls do not, OK presses it.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        int k = ev.getKeyCode();
        boolean ok = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (ok && offerAction != null && !controls && offer.getVisibility() == View.VISIBLE) {
            if (ev.getAction() == KeyEvent.ACTION_UP) pressOffer();
            return true;
        }
        if (waitingNext && k != KeyEvent.KEYCODE_BACK) return true;
        if (view != null && k != KeyEvent.KEYCODE_BACK && view.dispatchKeyEvent(ev)) return true;
        return super.dispatchKeyEvent(ev);
    }

    /**
     * Leaving with Back: stop now, not in onStop. Android brings Home back to the front before it
     * stops this screen, and the title page under it asks the add-on for the new progress at that
     * moment; the add-on hears "stopped" first only if it is said here.
     */
    @Override
    protected void onPause() {
        super.onPause();
        if (isFinishing() && player != null) {
            handler.removeCallbacks(giveUpNext);
            player.pause();
            report("stopped", player.getCurrentPosition());  // only the report here; freeing the player waits for onStop
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Leaving the player (Back, Home, another app) stops the film where it is.
        handler.removeCallbacks(giveUpNext);
        stopCurrent();
        if (!isFinishing()) finish();
    }
}
