package com.petrobot.hume;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Korie's own player (AndroidX Media3 / ExoPlayer), used by add-ons through korie.play. Video
 * opens PlayerActivity; sound alone (radio, music) plays here in the background and shows as the
 * now-playing pill on Home. While something plays, and when it stops or ends, the add-on that
 * started it is told the position: korie.on("playback", function(ref, info) … end).
 */
final class Playback {
    /** What an add-on asked to play. */
    static final class Request {
        String url = "", title = "", subtitle = "", mime = "", addon = "";
        double start;
        boolean audio;
        Object ref;
        Map<String, String> headers = new LinkedHashMap<>();
    }

    static Request request(String addon, Map<String, Object> m) {
        Request r = new Request();
        r.addon = addon;
        r.url = AddonLua.str(m.get("url"), "");
        r.title = AddonLua.str(m.get("title"), "");
        r.subtitle = AddonLua.str(m.get("subtitle"), "");
        r.mime = AddonLua.str(m.get("mime"), "");
        r.start = AddonLua.num(m.get("start"), 0);
        r.audio = AddonLua.bool(m.get("audio"), false);
        r.ref = m.get("ref");
        for (Map.Entry<String, Object> h : AddonLua.map(m.get("headers")).entrySet()) r.headers.put(h.getKey(), AddonLua.str(h.getValue(), ""));
        return r;
    }

    static ExoPlayer build(Context c, Request r) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("Korie/" + Addons.appVersion(c)).setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(r.headers);
        ExoPlayer p = new ExoPlayer.Builder(c)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(c, http))).build();
        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(r.url))
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(r.title).build());
        if (!r.mime.isEmpty()) item.setMimeType(r.mime);
        p.setMediaItem(item.build(), (long) (r.start * 1000));
        p.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder()
                .setUsage(androidx.media3.common.C.USAGE_MEDIA)
                .setContentType(r.audio ? androidx.media3.common.C.AUDIO_CONTENT_TYPE_MUSIC : androidx.media3.common.C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        return p;
    }

    /** Tells the add-on where playback is: state is "playing", "paused", "stopped" or "ended". */
    static void report(Request r, String state, long positionMs, long durationMs) {
        AddonEngine e = Addons.engine(r.addon);
        if (e == null) return;
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("state", state);
        info.put("position", positionMs / 1000.0);
        info.put("duration", durationMs <= 0 ? 0.0 : durationMs / 1000.0);
        e.fire("playback", r.ref, info);
    }

    static String message(PlaybackException e) {
        Throwable c = e.getCause();
        return c == null ? e.getErrorCodeName() : AddonEngine.message(c);
    }

    // ------------------------------------------------------------------ sound in the background

    static final Handler ui = new Handler(Looper.getMainLooper());
    static ExoPlayer audio;
    static Request audioRequest;
    static Runnable onAudioChanged;

    static final Runnable audioTick = new Runnable() {
        @Override public void run() {
            if (audio == null) return;
            if (audio.isPlaying()) report(audioRequest, "playing", audio.getCurrentPosition(), audio.getDuration());
            ui.postDelayed(this, 10000);
        }
    };

    /** UI thread. Starts sound-only playback, replacing whatever was playing. */
    static void playAudio(Context c, Request r) {
        stopAudio();
        audioRequest = r;
        audio = build(c.getApplicationContext(), r);
        audio.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean playing) {
                changed();
            }

            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && audio != null) {
                    report(audioRequest, "ended", audio.getCurrentPosition(), audio.getDuration());
                    stopAudioQuietly();
                }
                changed();
            }

            @Override public void onPlayerError(PlaybackException e) {
                Addons.toast((r.title.isEmpty() ? "That" : r.title) + " can’t be played: " + message(e));
                stopAudioQuietly();
                changed();
            }
        });
        audio.prepare();
        audio.play();
        ui.removeCallbacks(audioTick);
        ui.postDelayed(audioTick, 10000);
        changed();
    }

    static boolean hasAudio() {
        return audio != null;
    }

    static boolean audioPlaying() {
        return audio != null && audio.getPlayWhenReady() && audio.getPlaybackState() != Player.STATE_ENDED;
    }

    static void toggleAudio() {
        if (audio == null) return;
        if (audio.getPlayWhenReady()) {
            audio.pause();
            report(audioRequest, "paused", audio.getCurrentPosition(), audio.getDuration());
        } else {
            audio.play();
        }
        changed();
    }

    /** UI thread. Stops the sound and tells the add-on. */
    static void stopAudio() {
        if (audio == null) return;
        report(audioRequest, "stopped", audio.getCurrentPosition(), audio.getDuration());
        stopAudioQuietly();
        changed();
    }

    static void stopAudioQuietly() {
        ui.removeCallbacks(audioTick);
        if (audio != null) audio.release();
        audio = null;
    }

    static void changed() {
        if (onAudioChanged != null) ui.post(onAudioChanged);
    }
}
