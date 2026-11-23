package com.petrobot.hume;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Korie add-ons: one add-on as it sits on disk, a folder holding addon.json, main.lua and
 * whatever else it brought (pictures, more Lua files).
 *
 * An add-on travels as a .korie file, which is that folder zipped. Plain Java, no Android.
 */
public final class AddonPack {

    /** What an add-on may ask to use. Anything it does not list in "uses" is refused when it tries. */
    public static final String USE_INTERNET = "internet", USE_FILES = "files", USE_APPS = "apps", USE_LOOK = "look";
    public static final List<String> KNOWN_USES = Arrays.asList(USE_INTERNET, USE_FILES, USE_APPS, USE_LOOK);

    /** Upper limits for an add-on package, so a broken or hostile file cannot fill the device. */
    static final long MAX_UNPACKED = 64L * 1024 * 1024;
    static final int MAX_FILES = 2000;

    public final File dir;
    public final String id, name, version, author, description, main, icon;
    public final List<String> uses = new ArrayList<>();
    /** Settings the add-on declares: each a map with key, title, type (toggle | text | choice), default, choices. */
    public final List<Map<String, Object>> settings = new ArrayList<>();

    private AddonPack(File dir, Map<String, Object> m) {
        this.dir = dir;
        id = AddonLua.str(m.get("id"), "");
        name = AddonLua.str(m.get("name"), id);
        version = AddonLua.str(m.get("version"), "1.0");
        author = AddonLua.str(m.get("author"), "");
        description = AddonLua.str(m.get("description"), "");
        main = AddonLua.str(m.get("main"), "main.lua");
        icon = AddonLua.str(m.get("icon"), "");
        for (Object u : AddonLua.list(m.get("uses"))) {
            String s = AddonLua.str(u, "");
            if (KNOWN_USES.contains(s) && !uses.contains(s)) uses.add(s);
        }
        for (Object o : AddonLua.list(m.get("settings"))) {
            Map<String, Object> def = AddonLua.map(o);
            if (!AddonLua.str(def.get("key"), "").isEmpty()) settings.add(def);
        }
    }

    public boolean uses(String what) {
        return uses.contains(what);
    }

    /** Letters, digits, dot, dash and underscore; it becomes a folder name. */
    public static boolean validId(String id) {
        return id != null && id.matches("[a-z0-9][a-z0-9._-]{1,62}");
    }

    /** Reads the add-on in this folder. Throws with a sentence a person can act on. */
    public static AddonPack read(File dir) throws IOException {
        File mf = new File(dir, "addon.json");
        if (!mf.isFile()) throw new IOException("addon.json is missing");
        Object parsed;
        try {
            parsed = AddonLua.parseJson(new String(readAll(new FileInputStream(mf)), "UTF-8"));
        } catch (RuntimeException e) {
            throw new IOException("addon.json is not valid JSON (" + e.getMessage() + ")");
        }
        if (!(parsed instanceof Map)) throw new IOException("addon.json must be a JSON object");
        AddonPack p = new AddonPack(dir, AddonLua.map(parsed));
        if (!validId(p.id)) {
            throw new IOException("addon.json needs an \"id\" made of lowercase letters, digits, dots or dashes");
        }
        File main = AddonLua.inside(dir, p.main);
        if (main == null || !main.isFile()) throw new IOException(p.main + " is missing");
        return p;
    }

    /**
     * Unpacks a .korie file into a fresh folder and returns the add-on read from it. The zip may
     * hold the files directly or inside one top folder. Nothing may unpack outside the folder.
     */
    public static AddonPack unpack(InputStream korieFile, File into) throws IOException {
        if (into.exists()) deleteTree(into);
        if (!into.mkdirs()) throw new IOException("cannot create " + into);
        long total = 0;
        int files = 0;
        byte[] buf = new byte[16384];
        try (ZipInputStream zip = new ZipInputStream(korieFile)) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                File out = AddonLua.inside(into, e.getName().replace('\\', '/'));
                if (out == null || out.equals(into)) throw new IOException("the package has a file path that leaves its folder");
                if (++files > MAX_FILES) throw new IOException("the package has too many files");
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_UNPACKED) throw new IOException("the package is too large");
                        os.write(buf, 0, n);
                    }
                }
            }
        }
        if (files == 0) throw new IOException("this is not an add-on package (it is empty or not a zip file)");
        File root = into;
        if (!new File(into, "addon.json").isFile()) {
            File[] kids = into.listFiles();
            if (kids != null && kids.length == 1 && kids[0].isDirectory() && new File(kids[0], "addon.json").isFile()) {
                // One top folder: lift its contents up so the add-on always sits directly in its folder.
                File inner = kids[0];
                File tmp = new File(into.getParentFile(), into.getName() + ".lift");
                deleteTree(tmp);
                if (!inner.renameTo(tmp) || !into.delete() || !tmp.renameTo(into)) {
                    throw new IOException("cannot unpack the package");
                }
            }
        }
        return read(root);
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** Removes a folder Korie made for an add-on, with everything in it. */
    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    /** True when version a is newer than b ("1.10" is newer than "1.9"). */
    public static boolean newer(String a, String b) {
        String[] x = a == null ? new String[0] : a.split("[.\\-]"), y = b == null ? new String[0] : b.split("[.\\-]");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? intOr0(x[i]) : 0, q = i < y.length ? intOr0(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int intOr0(String s) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
