package com.petrobot.hume;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.Uri;

import java.util.ArrayList;
import java.util.List;

/**
 * TV inputs (HDMI, AV, component, tuner) from Android's TV input framework, and switching to
 * one the way the stock launcher does: VIEW the input's passthrough "channel" so the TV app
 * shows it. Boxes without inputs (e.g. a Mi Box) report none, and the Inputs card and button hide.
 */
final class Inputs {
    static final String K_CARD = "inputs_card", K_BUTTON = "inputs_button";

    private Inputs() {
    }

    static final class Input {
        String id, label;
        int type;
        boolean passthrough, disconnected;
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("inputs", Context.MODE_PRIVATE);
    }

    static boolean showCard(Context c) {
        return prefs(c).getBoolean(K_CARD, true);
    }

    static boolean showButton(Context c) {
        return prefs(c).getBoolean(K_BUTTON, true);
    }

    /** Hardware inputs in a natural order: HDMI first, then AV and the rest, tuner last. */
    static List<Input> list(Context c) {
        List<Input> out = new ArrayList<>();
        TvInputManager tm;
        try {
            tm = (TvInputManager) c.getSystemService(Context.TV_INPUT_SERVICE);
        } catch (Exception e) {
            return out;
        }
        if (tm == null) return out;
        List<TvInputInfo> infos;
        try {
            infos = tm.getTvInputList();
        } catch (Exception e) {
            return out;
        }
        for (TvInputInfo info : infos) {
            try {
                if (info.isHidden(c) || info.getParentId() != null) continue;
                if (!info.isPassthroughInput() && info.getType() != TvInputInfo.TYPE_TUNER) continue;
                Input in = new Input();
                in.id = info.getId();
                in.type = info.getType();
                in.passthrough = info.isPassthroughInput();
                CharSequence custom = info.loadCustomLabel(c), label = info.loadLabel(c);
                in.label = custom != null && custom.length() > 0 ? custom.toString() : label != null ? tidy(label.toString(), in.type) : "Input";
                in.disconnected = tm.getInputState(in.id) == TvInputManager.INPUT_STATE_DISCONNECTED;
                out.add(in);
            } catch (Exception ignored) {
                // skip inputs that can't be read
            }
        }
        out.sort((a, b) -> Integer.compare(rank(a), rank(b)) != 0 ? Integer.compare(rank(a), rank(b))
                : a.label.compareToIgnoreCase(b.label));
        return out;
    }

    private static int rank(Input in) {
        switch (in.type) {
            case TvInputInfo.TYPE_HDMI: return 0;
            case TvInputInfo.TYPE_DISPLAY_PORT: return 1;
            case TvInputInfo.TYPE_COMPONENT: return 2;
            case TvInputInfo.TYPE_COMPOSITE: return 3;
            case TvInputInfo.TYPE_TUNER: return 9;
            default: return 5;
        }
    }

    /** "HDMI1" -> "HDMI 1", "AV1" -> "AV 1"; tuners read "TV". */
    private static String tidy(String s, int type) {
        if (type == TvInputInfo.TYPE_TUNER && (s.toUpperCase().contains("TV") || s.isEmpty())) return "TV";
        return s.replaceAll("^([A-Za-z]+)(\\d+)$", "$1 $2");
    }

    /** Glyph name for an input type. */
    static String glyph(Input in) {
        return in.type == TvInputInfo.TYPE_TUNER ? "antenna" : "input";
    }

    /** Switches the TV to the input. Returns false when no app can show it. */
    static boolean open(Context c, Input in) {
        Uri uri = in.passthrough ? TvContract.buildChannelUriForPassthroughInput(in.id) : TvContract.buildChannelsUriForInput(in.id);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, in.passthrough ? TvContract.Channels.CONTENT_ITEM_TYPE : TvContract.Channels.CONTENT_TYPE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                c.startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (Exception e2) {
                return false;
            }
        }
    }
}
