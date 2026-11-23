package com.petrobot.hume;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.WindowManager;

import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Korie's video player. The picture and the whole control bar (play/pause, seeking, subtitles,
 * audio tracks) are Media3's own PlayerView, which already works with a remote and by touch —
 * nothing here handles selection.
 */
public final class PlayerActivity extends Activity {
    /** The request to play; set by Playback.playVideo just before the activity starts. */
    static Playback.Request next;

    Playback.Request req;
    ExoPlayer player;
    PlayerView view;
    final Handler handler = new Handler(Looper.getMainLooper());
    boolean ended;

    final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            if (player.isPlaying()) Playback.report(req, "playing", player.getCurrentPosition(), player.getDuration());
            handler.postDelayed(this, 10000);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        req = next;
        next = null;
        if (req == null) {
            finish();
            return;
        }
        Playback.stopAudio();  // a film takes over from the radio
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
            if (visibility != android.view.View.VISIBLE) return;
            android.view.View pp = view.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            if (pp != null) pp.requestFocus();
        });
        setContentView(view);
        Ui.fullscreen(this);
        player = Playback.build(this, req);
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !ended) {
                    ended = true;
                    Playback.report(req, "ended", player.getDuration(), player.getDuration());
                    finish();
                }
            }

            @Override public void onPlayerError(PlaybackException e) {
                Addons.toast((req.title.isEmpty() ? "That" : req.title) + " can’t be played: " + Playback.message(e));
                finish();
            }
        });
        player.prepare();
        player.play();
        view.requestFocus();
        handler.postDelayed(tick, 10000);
    }

    /** Media3's view shows its controls and takes the arrows, OK and the media keys; Back leaves. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        if (view != null && ev.getKeyCode() != KeyEvent.KEYCODE_BACK && view.dispatchKeyEvent(ev)) return true;
        return super.dispatchKeyEvent(ev);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Leaving the player (Back, Home, another app) stops the film where it is.
        if (player != null) {
            handler.removeCallbacks(tick);
            if (!ended) Playback.report(req, "stopped", player.getCurrentPosition(), player.getDuration());
            player.release();
            player = null;
        }
        if (!isFinishing()) finish();
    }
}
