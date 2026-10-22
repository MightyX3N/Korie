package com.petrobot.hume;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

/**
 * Apple TV-style navigation sounds: a soft click when focus moves, a fuller click on select and a
 * low one on Back. The sounds are CC0 clips from Freesound (assets/sounds/LICENSE.txt), trimmed and levelled,
 * played through a SoundPool so playback is instant. Settings -> Home -> Navigation sounds.
 */
final class Clicks {
    private static SoundPool pool;
    private static int move, select, back;
    private static int ready;

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
        pool.setOnLoadCompleteListener((p, id, status) -> {
            if (status == 0) ready++;
        });
        try {
            move = pool.load(c.getAssets().openFd("sounds/nav_move.wav"), 1);
            select = pool.load(c.getAssets().openFd("sounds/nav_select.wav"), 1);
            back = pool.load(c.getAssets().openFd("sounds/nav_back.wav"), 1);
        } catch (Exception ignored) {
            // no sounds
        }
    }

    private static void play(Context c, int id, float vol) {
        if (pool != null && ready >= 3 && enabled(c)) pool.play(id, vol, vol, 0, 0, 1f);
    }

    /** Focus moved. */
    static void move(Context c) {
        play(c, move, 0.35f);
    }

    /** Something was chosen. */
    static void select(Context c) {
        play(c, select, 0.45f);
    }

    /** Back. */
    static void back(Context c) {
        play(c, back, 0.4f);
    }
}
