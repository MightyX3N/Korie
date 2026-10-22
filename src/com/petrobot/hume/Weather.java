package com.petrobot.hume;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Current weather and a 5-day forecast from Open-Meteo (free, no key). The location is found
 * from the internet address (ipapi.co, falling back to ipwho.is) unless a city is chosen in
 * Settings. The last forecast is cached so the status row shows it instantly.
 */
final class Weather {
    static final String PREFS = "weather";
    static final String K_ENABLED = "enabled", K_UNITS = "units", K_PLACE = "place", K_LAT = "lat", K_LON = "lon",
            K_MANUAL = "manual", K_CACHE = "cache", K_CACHE_AT = "cache_at", K_CACHE_KEY = "cache_key";
    static final long MAX_AGE = 30 * 60 * 1000L;

    private Weather() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) {
        return prefs(c).getBoolean(K_ENABLED, true);
    }

    /** "c" or "f"; automatic picks Fahrenheit for the US, Liberia and Myanmar. */
    static String units(Context c) {
        String u = prefs(c).getString(K_UNITS, "auto");
        if (!u.equals("auto")) return u;
        String cc = Locale.getDefault().getCountry();
        return cc.equals("US") || cc.equals("LR") || cc.equals("MM") ? "f" : "c";
    }

    static boolean manual(Context c) {
        return prefs(c).getBoolean(K_MANUAL, false);
    }

    static String place(Context c) {
        return prefs(c).getString(K_PLACE, "");
    }

    /** Settings changed: the next refresh fetches again. */
    static void changed(Context c) {
        prefs(c).edit().remove(K_CACHE_AT).apply();
    }

    // ---------------------------------------------------------------- data

    static final class Hour {
        String label;
        int temp, code;
        boolean day;
    }

    static final class Day {
        String label;
        int code, max, min, rain;
    }

    static final class Data {
        String place;
        int temp, feels, code, humidity, wind, max, min;
        boolean day;
        String unit, windUnit;
        final List<Hour> hours = new ArrayList<>();
        final List<Day> days = new ArrayList<>();
    }

    /** The cached forecast, or null. */
    static Data cached(Context c) {
        String raw = prefs(c).getString(K_CACHE, null);
        if (raw == null) return null;
        try {
            return parse(c, new JSONObject(raw), prefs(c).getString(K_PLACE, ""));
        } catch (Exception e) {
            return null;
        }
    }

    static boolean stale(Context c) {
        SharedPreferences p = prefs(c);
        return System.currentTimeMillis() - p.getLong(K_CACHE_AT, 0) > MAX_AGE
                || !key(c).equals(p.getString(K_CACHE_KEY, ""));
    }

    private static String key(Context c) {
        return units(c) + (manual(c) ? "|" + prefs(c).getFloat(K_LAT, 0) + "," + prefs(c).getFloat(K_LON, 0) : "|auto");
    }

    private static boolean busy;

    /** Fetches in the background when the cache is old; {@code done} runs on the main thread. */
    static void refresh(Context ctx, boolean force, Runnable done) {
        Context c = ctx.getApplicationContext();
        if (!enabled(c) || busy || (!force && !stale(c))) return;
        busy = true;
        Handler main = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            try {
                SharedPreferences p = prefs(c);
                double lat, lon;
                String place;
                if (manual(c)) {
                    lat = p.getFloat(K_LAT, 0);
                    lon = p.getFloat(K_LON, 0);
                    place = p.getString(K_PLACE, "");
                } else {
                    double[] ll = new double[2];
                    place = locate(ll);
                    lat = ll[0];
                    lon = ll[1];
                }
                boolean f = units(c).equals("f");
                String url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon
                        + "&current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m"
                        + "&hourly=temperature_2m,weather_code,is_day"
                        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
                        + "&timezone=auto&forecast_days=6&forecast_hours=24"
                        + (f ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "");
                JSONObject j = new JSONObject(get(url));
                parse(c, j, place);  // validate before caching
                p.edit().putString(K_CACHE, j.toString()).putString(K_PLACE, place)
                        .putLong(K_CACHE_AT, System.currentTimeMillis()).putString(K_CACHE_KEY, key(c)).apply();
            } catch (Exception ignored) {
                // Keep showing the last forecast.
            }
            main.post(() -> {
                busy = false;
                if (done != null) done.run();
            });
        }).start();
    }

    /** Approximate location from the internet address; returns the city name. */
    private static String locate(double[] out) throws Exception {
        String[] services = {"https://ipapi.co/json/", "https://ipwho.is/", "https://get.geojs.io/v1/ip/geo.json"};
        Exception last = null;
        for (String url : services) {
            try {
                JSONObject j = new JSONObject(get(url));
                if (!j.has("latitude") || j.optBoolean("error") || !j.optBoolean("success", true)) continue;
                out[0] = Double.parseDouble(j.getString("latitude"));
                out[1] = Double.parseDouble(j.getString("longitude"));
                return j.optString("city", "");
            } catch (Exception e) {
                last = e;
            }
        }
        throw last != null ? last : new Exception("No location");
    }

    static final class Place {
        String name, detail;
        double lat, lon;
    }

    /** City search for Settings (Open-Meteo geocoding). Call off the main thread. */
    static List<Place> search(String q) throws Exception {
        JSONObject j = new JSONObject(get("https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&name="
                + URLEncoder.encode(q.trim(), "UTF-8")));
        List<Place> out = new ArrayList<>();
        JSONArray a = j.optJSONArray("results");
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONObject r = a.getJSONObject(i);
            Place pl = new Place();
            pl.name = r.optString("name");
            StringBuilder d = new StringBuilder();
            for (String k : new String[]{"admin1", "country"}) {
                String v = r.optString(k, "");
                if (!v.isEmpty()) d.append(d.length() > 0 ? ", " : "").append(v);
            }
            pl.detail = d.toString();
            pl.lat = r.getDouble("latitude");
            pl.lon = r.getDouble("longitude");
            out.add(pl);
        }
        return out;
    }

    static void setPlace(Context c, Place pl) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (pl == null) e.putBoolean(K_MANUAL, false);
        else e.putBoolean(K_MANUAL, true).putString(K_PLACE, pl.name)
                .putFloat(K_LAT, (float) pl.lat).putFloat(K_LON, (float) pl.lon);
        e.remove(K_CACHE_AT).apply();
    }

    private static Data parse(Context c, JSONObject j, String place) throws Exception {
        Data d = new Data();
        d.place = place;
        JSONObject u = j.getJSONObject("current_units");
        d.unit = "\u00b0";
        d.windUnit = u.optString("wind_speed_10m", "km/h");
        JSONObject cur = j.getJSONObject("current");
        d.temp = (int) Math.round(cur.getDouble("temperature_2m"));
        d.feels = (int) Math.round(cur.getDouble("apparent_temperature"));
        d.code = cur.getInt("weather_code");
        d.day = cur.optInt("is_day", 1) == 1;
        d.humidity = cur.optInt("relative_humidity_2m");
        d.wind = (int) Math.round(cur.optDouble("wind_speed_10m", 0));

        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone(j.optString("timezone", "UTC")));
        SimpleDateFormat hourFmt = new SimpleDateFormat(android.text.format.DateFormat.is24HourFormat(c) ? "HH" : "h a", Locale.getDefault());
        hourFmt.setTimeZone(iso.getTimeZone());
        String nowIso = cur.optString("time", "");

        JSONObject h = j.getJSONObject("hourly");
        JSONArray ht = h.getJSONArray("time"), htemp = h.getJSONArray("temperature_2m"),
                hcode = h.getJSONArray("weather_code"), hday = h.getJSONArray("is_day");
        int start = 0;
        for (int i = 0; i < ht.length(); i++) {
            if (ht.getString(i).compareTo(nowIso) <= 0) start = i;
        }
        for (int i = start; i < ht.length() && d.hours.size() < 6; i++) {
            Hour hr = new Hour();
            Date t = iso.parse(ht.getString(i));
            hr.label = d.hours.isEmpty() ? "Now" : hourFmt.format(t).replace(" ", "").toUpperCase(Locale.getDefault());
            hr.temp = d.hours.isEmpty() ? d.temp : (int) Math.round(htemp.getDouble(i));
            hr.code = d.hours.isEmpty() ? d.code : hcode.getInt(i);
            hr.day = d.hours.isEmpty() ? d.day : hday.getInt(i) == 1;
            d.hours.add(hr);
        }

        JSONObject dl = j.getJSONObject("daily");
        JSONArray dt = dl.getJSONArray("time"), dcode = dl.getJSONArray("weather_code"),
                dmax = dl.getJSONArray("temperature_2m_max"), dmin = dl.getJSONArray("temperature_2m_min"),
                drain = dl.optJSONArray("precipitation_probability_max");
        SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        SimpleDateFormat dayFmt = new SimpleDateFormat("EEE", Locale.getDefault());
        String today = nowIso.length() >= 10 ? nowIso.substring(0, 10) : ymd.format(new Date());
        for (int i = 0; i < dt.length() && d.days.size() < 5; i++) {
            if (dt.getString(i).compareTo(today) < 0) continue;
            Day day = new Day();
            Calendar cal = Calendar.getInstance();
            cal.setTime(ymd.parse(dt.getString(i)));
            day.label = d.days.isEmpty() ? "Today" : dayFmt.format(cal.getTime());
            day.code = dcode.getInt(i);
            day.max = (int) Math.round(dmax.getDouble(i));
            day.min = (int) Math.round(dmin.getDouble(i));
            day.rain = drain == null || drain.isNull(i) ? 0 : drain.getInt(i);
            d.days.add(day);
        }
        if (!d.days.isEmpty()) {
            d.max = Math.max(d.days.get(0).max, d.temp);
            d.min = Math.min(d.days.get(0).min, d.temp);
        }
        return d;
    }

    /** WMO weather code -> short description, as Apple Weather words it. */
    static String describe(int code, boolean day) {
        switch (code) {
            case 0: return day ? "Sunny" : "Clear";
            case 1: return day ? "Mostly Sunny" : "Mostly Clear";
            case 2: return "Partly Cloudy";
            case 3: return "Cloudy";
            case 45: case 48: return "Foggy";
            case 51: case 53: case 55: case 56: case 57: return "Drizzle";
            case 61: case 63: case 80: case 81: return "Rain";
            case 65: case 82: return "Heavy Rain";
            case 66: case 67: return "Freezing Rain";
            case 71: case 73: case 75: case 77: case 85: case 86: return "Snow";
            case 95: case 96: case 99: return "Thunderstorms";
            default: return "";
        }
    }

    private static String get(String url) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(8000);
        con.setReadTimeout(10000);
        con.setRequestProperty("User-Agent", "HumeLauncher");
        try (InputStream in = con.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toString("UTF-8");
        } finally {
            con.disconnect();
        }
    }
}
