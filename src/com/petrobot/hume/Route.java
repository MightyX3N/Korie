package com.petrobot.hume;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;

/**
 * The route the launcher knows about: a destination handed to the maps app from here. The launcher
 * cannot see routes started inside the maps app itself, nor a route cancelled there — so a route
 * ends when the position reaches the destination, when it is ended from Home, or after 12 hours.
 */
final class Route {
    static final float ARRIVED_METRES = 80f;
    static final long MAX_AGE_MS = 12L * 60 * 60 * 1000;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("route", Context.MODE_PRIVATE);
    }

    static void start(Context c, String name, double lat, double lon) {
        prefs(c).edit().putString("name", name == null ? "" : name).putFloat("lat", (float) lat).putFloat("lon", (float) lon)
                .putLong("since", System.currentTimeMillis()).apply();
    }

    static void end(Context c) {
        prefs(c).edit().clear().apply();
    }

    static boolean active(Context c) {
        SharedPreferences p = prefs(c);
        if (!p.contains("lat")) return false;
        if (System.currentTimeMillis() - p.getLong("since", 0) > MAX_AGE_MS) {
            end(c);
            return false;
        }
        return true;
    }

    /** {lat, lon} of the destination, or null when no route is running. */
    static double[] destination(Context c) {
        if (!active(c)) return null;
        SharedPreferences p = prefs(c);
        return new double[]{p.getFloat("lat", 0), p.getFloat("lon", 0)};
    }

    static String name(Context c) {
        String n = prefs(c).getString("name", "");
        return n.isEmpty() ? "Destination" : n;
    }

    /** Ends the route when the position is at the destination; true if it just ended. */
    static boolean arrived(Context c, double lat, double lon) {
        double[] d = destination(c);
        if (d == null) return false;
        float[] out = new float[1];
        Location.distanceBetween(lat, lon, d[0], d[1], out);
        if (out[0] > ARRIVED_METRES) return false;
        end(c);
        return true;
    }
}
