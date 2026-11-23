package com.petrobot.hume;

import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;

/**
 * Touch on Home's top shelf, for touch screens (car boxes, tablets): swipe sideways to browse the
 * carousel, tap to open, hold for options. Android's own GestureDetector recognises the gestures;
 * the remote's key handling is separate and unchanged.
 */
final class HomeTouch {
    static void attach(MainActivity a, View shelf) {
        GestureDetector gd = new GestureDetector(a, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override public boolean onSingleTapUp(MotionEvent e) {
                a.shelfTapped();
                return true;
            }

            @Override public void onLongPress(MotionEvent e) {
                a.shelfHeld();
            }

            @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) {
                if (e1 == null || e2 == null) return false;
                float dx = e2.getX() - e1.getX(), dy = e2.getY() - e1.getY();
                if (Math.abs(dx) < a.dp(48) || Math.abs(dx) < Math.abs(dy) * 1.5f) return false;
                a.shelfSwiped(dx < 0 ? 1 : -1);
                return true;
            }
        });
        shelf.setOnTouchListener((v, ev) -> gd.onTouchEvent(ev));
    }
}
