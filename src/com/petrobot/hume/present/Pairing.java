package com.petrobot.hume.present;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.UUID;

/**
 * Browser pairing (port of PairingManager.kt): a 6-digit PIN shown on the TV is exchanged once
 * for a bearer token the browser keeps. The PIN changes each time the launcher process starts.
 */
final class Pairing {
    private final SharedPreferences prefs;
    final String pin;

    Pairing(Context c) {
        prefs = c.getApplicationContext().getSharedPreferences("present_pairing", Context.MODE_PRIVATE);
        pin = String.format(Locale.US, "%06d", new SecureRandom().nextInt(1_000_000));
    }

    /** Returns a new token when the PIN matches, else null. */
    String pair(String candidate) {
        if (candidate == null || !candidate.trim().equals(pin)) return null;
        String token = UUID.randomUUID().toString() + UUID.randomUUID().toString();
        prefs.edit().putString("admin_token", token).apply();
        return token;
    }

    boolean valid(String token) {
        String expected = prefs.getString("admin_token", null);
        if (token == null || token.isEmpty() || expected == null) return false;
        // Constant-time comparison (AuthTokens.kt).
        return MessageDigest.isEqual(token.getBytes(), expected.getBytes());
    }
}
