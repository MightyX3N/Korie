package com.petrobot.hume;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Point;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.osmdroid.config.Configuration;
import org.osmdroid.config.IConfigurationProvider;
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy;
import org.osmdroid.tileprovider.tilesource.XYTileSource;
import org.osmdroid.util.GeoPoint;
import org.osmdroid.views.CustomZoomButtonsController;
import org.osmdroid.views.MapView;
import org.osmdroid.views.overlay.Overlay;

import java.io.File;

/**
 * The map that can take the carousel's place behind the dock (Settings → Top Shelf → Map): a
 * dark OpenStreetMap view centred on where the device is, with the destination marked while a
 * {@link Route} is running. It is a backdrop: it takes no touches or keys itself — Home decides
 * what a tap on the shelf does.
 *
 * The map is drawn by osmdroid (Apache-2.0). Tiles come from tile.openstreetmap.org under its tile
 * usage policy: only the tiles on screen are requested, they are kept in the app's own cache and
 * reused on later visits (so the last area is there before the internet is), nothing is fetched
 * ahead, the app names itself in the User-Agent and the attribution stays on screen.
 */
final class MapShelf {
    static final String OFF = "off", ALWAYS = "always", ROUTE = "route";
    static final String ATTRIBUTION = "© OpenStreetMap contributors";
    /** Tiles: the public OpenStreetMap server, or another server set for testing / self-hosting. */
    static final String TILES = "https://tile.openstreetmap.org/";

    static String mode(Context c) {
        return Profiles.homePrefs(c).getString("map_mode", OFF);
    }

    static void setMode(Context c, String mode) {
        Profiles.homePrefs(c).edit().putString("map_mode", mode).apply();
    }

    static String modeName(String mode) {
        return ALWAYS.equals(mode) ? "Always" : ROUTE.equals(mode) ? "During a route" : "Off";
    }

    /** Whether Home should show the map right now. */
    static boolean wanted(Context c) {
        String m = mode(c);
        return ALWAYS.equals(m) || (ROUTE.equals(m) && Route.active(c));
    }

    final Context ctx;
    final FrameLayout view;
    final MapView map;
    final Handler handler = new Handler(Looper.getMainLooper());
    final SharedPreferences store;
    /** Small blurred copy of the map for the glass dock; null until the map has drawn. */
    Bitmap blur;
    Runnable onBlur, onArrived;
    GeoPoint here;
    boolean running;
    LocationManager lm;

    MapShelf(Context c, int screenW, int screenH, int shelfH, float unit) {
        ctx = c;
        store = c.getSharedPreferences("map", Context.MODE_PRIVATE);
        IConfigurationProvider cfg = Configuration.getInstance();
        String version = "";
        try {
            version = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            // the app's own package is always there
        }
        cfg.setUserAgentValue(c.getPackageName() + "/" + version + " (Android launcher)");
        File base = new File(c.getFilesDir(), "map");
        cfg.setOsmdroidBasePath(base);
        cfg.setOsmdroidTileCache(new File(base, "tiles"));
        cfg.setTileFileSystemCacheMaxBytes(160L * 1024 * 1024);
        cfg.setTileFileSystemCacheTrimBytes(120L * 1024 * 1024);
        cfg.setTileDownloadThreads((short) 2);

        map = new MapView(c);
        String url = store.getString("tiles", TILES);
        map.setTileSource(new XYTileSource("OpenStreetMap", 0, 19, 256, ".png", new String[]{url}, ATTRIBUTION,
                new TileSourcePolicy(2, TileSourcePolicy.FLAG_NO_BULK | TileSourcePolicy.FLAG_NO_PREVENTIVE
                        | TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL | TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED)));
        map.setMultiTouchControls(false);
        map.setFlingEnabled(false);
        map.getZoomController().setVisibility(CustomZoomButtonsController.Visibility.NEVER);
        map.setTilesScaledToDpi(true);
        map.setHorizontalMapRepetitionEnabled(false);
        map.setVerticalMapRepetitionEnabled(false);
        map.setFocusable(false);
        map.setClickable(false);
        // Dark map: lightness inverted with the hues kept (water stays blue, parks green) and a
        // small lift, so Home's white text and glass sit on it as they do on artwork.
        ColorMatrix dark = new ColorMatrix(new float[]{
                0.342f, -0.998f, -0.194f, 0, 246.75f,
                -0.508f, -0.148f, -0.194f, 0, 246.75f,
                -0.508f, -0.998f, 0.656f, 0, 246.75f,
                0, 0, 0, 1, 0});
        map.getOverlayManager().getTilesOverlay().setColorFilter(new ColorMatrixColorFilter(dark));
        map.getOverlayManager().getTilesOverlay().setLoadingBackgroundColor(0xFFF2EFE9);  // drawn through the dark filter too: comes out dark
        map.getOverlayManager().getTilesOverlay().setLoadingLineColor(0x00000000);
        // The position sits in the middle of the part of the map the dock leaves visible.
        map.setMapCenterOffset(0, -(screenH - shelfH) / 2);
        map.getOverlays().add(new Marks(unit));

        view = new FrameLayout(c) {
            @Override public boolean dispatchTouchEvent(android.view.MotionEvent ev) { return false; }
        };
        view.setBackgroundColor(0xFF15181E);
        view.addView(map, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Shade at the top and bottom so the status row and the dock read over the map.
        View shade = new View(c);
        shade.setBackground(new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x66000000, 0x00000000, 0x00000000, 0x80000000}));
        view.addView(shade, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        TextView credit = new TextView(c);
        credit.setText(ATTRIBUTION);
        credit.setTextColor(0xCCFFFFFF);
        credit.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 10 * unit);
        credit.setTypeface(Ui.font(c, "regular"));
        credit.setShadowLayer(3 * unit, 0, 0, 0xFF000000);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        clp.leftMargin = (int) (24 * unit);
        clp.topMargin = (int) (14 * unit);
        view.addView(credit, clp);
        view.setAlpha(0f);

        float lat = store.getFloat("lat", Float.NaN), lon = store.getFloat("lon", Float.NaN);
        if (!Float.isNaN(lat)) {
            here = new GeoPoint(lat, lon);
            map.getController().setZoom(15.0);
            map.getController().setCenter(here);
        } else {
            map.getController().setZoom(4.0);  // no position yet: Europe, until the first fix
            map.getController().setCenter(new GeoPoint(54.0, 10.0));
        }
    }

    /** Home is on screen: draw tiles and follow the position. */
    void start() {
        if (running) return;
        running = true;
        map.onResume();
        listen();
        handler.postDelayed(snap, 1500);
    }

    void stop() {
        if (!running) return;
        running = false;
        map.onPause();
        handler.removeCallbacks(snap);
        if (lm != null) lm.removeUpdates(listener);
    }

    void destroy() {
        stop();
        map.onDetach();
    }

    /** (Re)subscribes to the position; called again once the permission is granted. */
    void listen() {
        if (!running || ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        try {
            lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            Location best = null;
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                if (LocationManager.GPS_PROVIDER.equals(p) || LocationManager.NETWORK_PROVIDER.equals(p)) {
                    lm.requestLocationUpdates(p, 4000L, 8f, listener, Looper.getMainLooper());
                }
            }
            if (best != null) moveTo(best);
        } catch (SecurityException | IllegalArgumentException e) {
            android.util.Log.w("TvHome", "map position: " + e);
        }
    }

    final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location l) { moveTo(l); }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
    };

    void moveTo(Location l) {
        boolean first = here == null;
        here = new GeoPoint(l.getLatitude(), l.getLongitude());
        store.edit().putFloat("lat", (float) here.getLatitude()).putFloat("lon", (float) here.getLongitude()).apply();
        if (first) map.getController().setZoom(15.0);
        map.getController().setCenter(here);
        map.invalidate();
        if (Route.arrived(ctx, here.getLatitude(), here.getLongitude()) && onArrived != null) onArrived.run();
        handler.removeCallbacks(snap);
        handler.postDelayed(snap, 2500);
    }

    /** Refreshes the glass dock's backdrop from what the map shows now (tiles arrive over time). */
    final Runnable snap = new Runnable() {
        @Override public void run() {
            if (!running || view.getWidth() == 0) return;
            try {
                int w = 320, h = Math.max(1, 320 * view.getHeight() / view.getWidth());
                Bitmap small = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(small);
                c.scale(w / (float) view.getWidth(), h / (float) view.getHeight());
                view.draw(c);
                blur = Ui.glassBackdrop(small, 160, 90);
                if (onBlur != null) onBlur.run();
            } catch (RuntimeException e) {
                android.util.Log.w("TvHome", "map backdrop: " + e);
            }
            handler.postDelayed(this, 20000);
        }
    };

    /** A tap on the map: the device's maps app, at the destination while a route runs, else here. */
    boolean open() {
        double[] dest = Route.destination(ctx);
        Uri uri;
        if (dest != null) {
            uri = Uri.parse("geo:0,0?q=" + dest[0] + "," + dest[1] + "(" + Uri.encode(Route.name(ctx)) + ")");
        } else if (here != null) {
            uri = Uri.parse("geo:" + here.getLatitude() + "," + here.getLongitude() + "?z=15");
        } else {
            uri = Uri.parse("geo:0,0");
        }
        try {
            ctx.startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception e) {
            return false;  // no maps app installed
        }
    }

    /** Where you are (blue dot) and, during a route, where you are going (white ring). */
    final class Marks extends Overlay {
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        final float unit;
        final Point pt = new Point();

        Marks(float unit) {
            this.unit = unit;
            ring.setStyle(Paint.Style.STROKE);
        }

        @Override public void draw(Canvas c, MapView mv, boolean shadow) {
            if (shadow) return;
            double[] dest = Route.destination(ctx);
            if (dest != null) {
                mv.getProjection().toPixels(new GeoPoint(dest[0], dest[1]), pt);
                fill.setColor(0xFFFF453A);
                c.drawCircle(pt.x, pt.y, 7 * unit, fill);
                ring.setColor(0xFFFFFFFF);
                ring.setStrokeWidth(2.5f * unit);
                c.drawCircle(pt.x, pt.y, 7 * unit, ring);
            }
            if (here != null) {
                mv.getProjection().toPixels(here, pt);
                fill.setColor(0x330A84FF);
                c.drawCircle(pt.x, pt.y, 20 * unit, fill);
                fill.setColor(0xFF0A84FF);
                c.drawCircle(pt.x, pt.y, 7 * unit, fill);
                ring.setColor(0xFFFFFFFF);
                ring.setStrokeWidth(2.5f * unit);
                c.drawCircle(pt.x, pt.y, 7 * unit, ring);
            }
        }
    }
}
