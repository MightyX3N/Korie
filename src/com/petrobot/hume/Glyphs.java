package com.petrobot.hume;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/** SF Symbols–style line glyphs for Control Center, drawn in code (no image assets). */
final class Glyphs {
    private Glyphs() { }

    static Bitmap get(String name, int s, int color) {
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(s * 0.085f);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        float m = s / 2f;
        RectF r = new RectF();
        Path path = new Path();
        switch (name) {
            case "power":
                r.set(s * 0.18f, s * 0.2f, s * 0.82f, s * 0.84f);
                c.drawArc(r, -60, 300, false, p);
                c.drawLine(m, s * 0.1f, m, s * 0.48f, p);
                break;
            case "wifi":
                for (int i = 0; i < 3; i++) {
                    float rad = s * (0.16f + 0.15f * i);
                    r.set(m - rad, s * 0.78f - rad, m + rad, s * 0.78f + rad);
                    c.drawArc(r, -135, 90, false, p);
                }
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(m, s * 0.78f, s * 0.06f, p);
                break;
            case "moon":
                p.setStyle(Paint.Style.FILL);
                path.addCircle(m, m, s * 0.34f, Path.Direction.CW);
                Path cut = new Path();
                cut.addCircle(m + s * 0.2f, m - s * 0.14f, s * 0.3f, Path.Direction.CW);
                path.op(cut, Path.Op.DIFFERENCE);
                c.drawPath(path, p);
                break;
            case "audio":
                for (int i = 0; i < 2; i++) {
                    float rad = s * (0.2f + 0.16f * i);
                    r.set(m - rad, s * 0.5f - rad, m + rad, s * 0.5f + rad);
                    c.drawArc(r, 140, 260, false, p);
                }
                p.setStyle(Paint.Style.FILL);
                path.moveTo(m, s * 0.52f);
                path.lineTo(m + s * 0.2f, s * 0.86f);
                path.lineTo(m - s * 0.2f, s * 0.86f);
                path.close();
                c.drawPath(path, p);
                break;
            case "timer":
                c.drawCircle(m, m, s * 0.34f, p);
                c.drawLine(m, m, m - s * 0.12f, m - s * 0.14f, p);
                c.drawLine(m, s * 0.16f, m, s * 0.24f, p);
                break;
            case "gamepad":
                r.set(s * 0.08f, s * 0.3f, s * 0.92f, s * 0.74f);
                p.setStyle(Paint.Style.FILL);
                c.drawRoundRect(r, s * 0.2f, s * 0.2f, p);
                p.setColor(0xFF000000);
                p.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR));
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(s * 0.06f);
                c.drawLine(s * 0.24f, m + s * 0.02f, s * 0.38f, m + s * 0.02f, p);
                c.drawLine(s * 0.31f, m - s * 0.05f, s * 0.31f, m + s * 0.09f, p);
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(s * 0.66f, m - s * 0.03f, s * 0.035f, p);
                c.drawCircle(s * 0.74f, m + s * 0.06f, s * 0.035f, p);
                p.setXfermode(null);
                break;
            case "accessibility":
                c.drawCircle(m, m, s * 0.38f, p);
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(m, s * 0.3f, s * 0.05f, p);
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(s * 0.06f);
                c.drawLine(s * 0.32f, s * 0.42f, s * 0.68f, s * 0.42f, p);
                c.drawLine(m, s * 0.42f, m, s * 0.58f, p);
                c.drawLine(m, s * 0.58f, s * 0.4f, s * 0.74f, p);
                c.drawLine(m, s * 0.58f, s * 0.6f, s * 0.74f, p);
                break;
            case "gear":
                p.setStyle(Paint.Style.FILL);
                MainActivity.drawGear(c, m, m, s * 0.3f, color, 0x00000000);
                Paint hole = new Paint(Paint.ANTI_ALIAS_FLAG);
                hole.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR));
                c.drawCircle(m, m, s * 0.13f, hole);
                break;
            case "search":
                c.drawCircle(s * 0.44f, s * 0.44f, s * 0.24f, p);
                c.drawLine(s * 0.62f, s * 0.62f, s * 0.82f, s * 0.82f, p);
                break;
            case "controls":  // Control Center glyph: two toggles
                p.setStrokeWidth(s * 0.07f);
                r.set(s * 0.14f, s * 0.2f, s * 0.86f, s * 0.44f);
                c.drawRoundRect(r, s * 0.12f, s * 0.12f, p);
                c.drawCircle(s * 0.66f, s * 0.32f, s * 0.05f, p);
                p.setStyle(Paint.Style.FILL);
                r.set(s * 0.14f, s * 0.56f, s * 0.86f, s * 0.8f);
                c.drawRoundRect(r, s * 0.12f, s * 0.12f, p);
                Paint knob = new Paint(Paint.ANTI_ALIAS_FLAG);
                knob.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR));
                c.drawCircle(s * 0.34f, s * 0.68f, s * 0.07f, knob);
                break;
            default:
                break;
        }
        return b;
    }
}
