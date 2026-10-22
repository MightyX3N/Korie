package com.petrobot.hume;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Apple TV-style navigation sounds: a soft tick when focus moves and a deeper tock on select.
 * Both are synthesised once (a short tone with a fast exponential decay) into the app's cache and
 * played through a SoundPool, so there is no audio asset and playback is instant.
 * Settings -> Home -> Navigation sounds turns them off.
 */
final class Clicks {
    private static SoundPool pool;
    private static int tick, tock;
    private static boolean loaded;

    private Clicks() {
    }

    static boolean enabled(Context c) {
        return c.getSharedPreferences("sounds", Context.MODE_PRIVATE).getBoolean("nav_sounds", true);
    }

    static void setEnabled(Context c, boolean on) {
        c.getSharedPreferences("sounds", Context.MODE_PRIVATE).edit().putBoolean("nav_sounds", on).apply();
    }

    static synchronized void init(Context ctx) {
        if (pool != null) return;
        Context c = ctx.getApplicationContext();
        pool = new SoundPool.Builder().setMaxStreams(3).setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
        pool.setOnLoadCompleteListener((p, id, status) -> loaded = status == 0);
        try {
            tick = pool.load(write(c, "tick.wav", 2400, 0.018, 0.0035, 0.55), 1);
            tock = pool.load(write(c, "tock.wav", 1250, 0.032, 0.0065, 0.7), 1);
        } catch (IOException ignored) {
            // no sounds
        }
    }

    /** Focus moved. */
    static void move(Context c) {
        if (pool != null && loaded && enabled(c)) pool.play(tick, 0.22f, 0.22f, 0, 0, 1f);
    }

    /** Something was chosen. */
    static void select(Context c) {
        if (pool != null && loaded && enabled(c)) pool.play(tock, 0.3f, 0.3f, 0, 0, 1f);
    }

    /** A 16-bit mono 44.1 kHz WAV: sine at {@code freq} with a short attack and exponential decay. */
    private static String write(Context c, String name, double freq, double seconds, double tau, double level)
            throws IOException {
        File f = new File(c.getCacheDir(), name);
        if (f.exists() && f.length() > 44) return f.getPath();
        int rate = 44100, n = (int) (rate * seconds);
        ByteBuffer b = ByteBuffer.allocate(44 + n * 2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()).putInt(36 + n * 2).put("WAVE".getBytes()).put("fmt ".getBytes())
                .putInt(16).putShort((short) 1).putShort((short) 1).putInt(rate).putInt(rate * 2)
                .putShort((short) 2).putShort((short) 16).put("data".getBytes()).putInt(n * 2);
        for (int i = 0; i < n; i++) {
            double t = i / (double) rate;
            double attack = Math.min(1, t / 0.0008);
            double v = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / tau) * attack * level
                    + Math.sin(2 * Math.PI * freq * 2.01 * t) * Math.exp(-t / (tau * 0.5)) * attack * level * 0.25;
            b.putShort((short) Math.max(-32767, Math.min(32767, v * 32767)));
        }
        try (FileOutputStream o = new FileOutputStream(f)) {
            o.write(b.array());
        }
        return f.getPath();
    }
}
