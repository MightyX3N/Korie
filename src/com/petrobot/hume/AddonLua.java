package com.petrobot.hume;

import org.luaj.vm2.Globals;
import org.luaj.vm2.LoadState;
import org.luaj.vm2.LuaError;
import org.luaj.vm2.LuaFunction;
import org.luaj.vm2.LuaString;
import org.luaj.vm2.LuaTable;
import org.luaj.vm2.LuaValue;
import org.luaj.vm2.Varargs;
import org.luaj.vm2.compiler.LuaC;
import org.luaj.vm2.lib.BaseLib;
import org.luaj.vm2.lib.Bit32Lib;
import org.luaj.vm2.lib.CoroutineLib;
import org.luaj.vm2.lib.OsLib;
import org.luaj.vm2.lib.PackageLib;
import org.luaj.vm2.lib.ResourceFinder;
import org.luaj.vm2.lib.StringLib;
import org.luaj.vm2.lib.TableLib;
import org.luaj.vm2.lib.VarArgFunction;
import org.luaj.vm2.lib.jse.JseMathLib;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Korie add-ons: the Lua side of one add-on. Plain Java with no Android in it, so the same code
 * runs in the app and in the tests on a computer (tools/addon-test).
 *
 * An add-on's script sees the standard Lua libraries that cannot touch the device (base, string,
 * table, math, bit32, coroutine, os time/date and require for its own files) plus one table,
 * {@code korie}. Every {@code korie.*} function is handed to a {@link Host}, which is the app
 * (AddonEngine) or a fake one in the tests. There is no io library, no os.execute and no Java
 * bridge: what an add-on can do to the device is exactly what the Host offers.
 */
public final class AddonLua {

    /** The launcher's side of the conversation. */
    public interface Host {
        /**
         * Runs korie.&lt;name&gt;. Arguments arrive as Java values: String, Double, Boolean, byte[]
         * (a Lua string that is not text), List, Map&lt;String,Object&gt; and LuaFunction for callbacks.
         * The result goes back to Lua the same way. Throw to raise a Lua error with that message.
         */
        Object call(String name, Object[] args) throws Exception;
    }

    /** Every function of the korie table. A dot makes a nested table: "http.get" is korie.http.get. */
    public static final String[] API = {
        "http.get", "http.post", "http.request",
        "store.get", "store.set", "store.remove",
        "setting", "set_setting",
        "apps.list", "apps.open", "open", "play", "stop",
        "toast", "timer", "cancel", "on", "device", "log", "refresh",
        "ask", "net.broadcast", "profile", "profiles.list", "profiles.add"
    };

    public final Globals globals;
    private final Host host;

    public AddonLua(final File addonDir, Host host, Map<String, Object> addonInfo) {
        this.host = host;
        Globals g = new Globals();
        g.load(new BaseLib());
        g.load(new PackageLib());
        g.load(new Bit32Lib());
        g.load(new TableLib());
        g.load(new StringLib());
        g.load(new CoroutineLib());
        g.load(new JseMathLib());
        g.load(new OsLib());
        LoadState.install(g);
        LuaC.install(g);
        // require/dofile/loadfile only ever see files inside the add-on's own folder.
        g.finder = new ResourceFinder() {
            @Override
            public InputStream findResource(String name) {
                File f = inside(addonDir, name);
                try {
                    return f != null && f.isFile() ? new FileInputStream(f) : null;
                } catch (Exception e) {
                    return null;
                }
            }
        };
        g.get("package").set("path", "?.lua;?/init.lua");
        g.get("string").set("format", new Format());
        globals = g;

        LuaTable korie = new LuaTable();
        for (final String name : API) {
            LuaTable t = korie;
            String leaf = name;
            int dot = name.indexOf('.');
            if (dot > 0) {
                String ns = name.substring(0, dot);
                leaf = name.substring(dot + 1);
                LuaValue sub = korie.get(ns);
                if (sub.isnil()) {
                    sub = new LuaTable();
                    korie.set(ns, sub);
                }
                t = (LuaTable) sub;
            }
            t.set(leaf, new HostFunction(name));
        }
        LuaTable json = new LuaTable();
        json.set("decode", new VarArgFunction() {
            @Override
            public Varargs invoke(Varargs a) {
                try {
                    return new JsonReader(jstr(a.arg(1))).read();
                } catch (LuaError e) {
                    throw e;
                } catch (RuntimeException e) {
                    throw new LuaError("korie.json.decode: " + e.getMessage());
                }
            }
        });
        json.set("encode", new VarArgFunction() {
            @Override
            public Varargs invoke(Varargs a) {
                StringBuilder sb = new StringBuilder();
                writeJson(sb, toJava(a.arg(1)));
                return lstr(sb.toString());
            }
        });
        korie.set("json", json);
        korie.set("url_encode", new VarArgFunction() {
            @Override
            public Varargs invoke(Varargs a) {
                try {
                    return LuaValue.valueOf(java.net.URLEncoder.encode(jstr(a.arg(1)), "UTF-8").replace("+", "%20"));
                } catch (java.io.UnsupportedEncodingException e) {
                    throw new LuaError(e.getMessage());
                }
            }
        });
        korie.set("addon", toLua(addonInfo));
        g.set("korie", korie);
        g.set("print", new VarArgFunction() {
            @Override
            public Varargs invoke(Varargs a) {
                StringBuilder sb = new StringBuilder();
                for (int i = 1; i <= a.narg(); i++) {
                    if (i > 1) sb.append('\t');
                    LuaValue x = a.arg(i);
                    sb.append(x.isstring() ? jstr(x) : x.tojstring());
                }
                try {
                    AddonLua.this.host.call("log", new Object[]{sb.toString()});
                } catch (Exception ignored) {
                }
                return LuaValue.NONE;
            }
        });
    }

    /** Runs a script file of the add-on (normally main.lua). */
    public void run(File script) throws Exception {
        try (InputStream in = new FileInputStream(script)) {
            globals.load(in, "@" + script.getName(), "t", globals).call();
        }
    }

    /** Calls a callback the add-on gave us. Results are converted to Java. */
    public Object callback(LuaValue fn, Object... args) {
        if (fn == null || !fn.isfunction()) return null;
        LuaValue[] a = new LuaValue[args == null ? 0 : args.length];
        for (int i = 0; i < a.length; i++) a[i] = toLua(args[i]);
        return toJava(fn.invoke(LuaValue.varargsOf(a)).arg1());
    }

    /** A file inside root, or null if the name tries to leave it. */
    public static File inside(File root, String name) {
        if (root == null || name == null) return null;
        try {
            File f = new File(root, name).getCanonicalFile();
            String base = root.getCanonicalPath();
            String p = f.getPath();
            return p.equals(base) || p.startsWith(base + File.separator) ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    private final class HostFunction extends VarArgFunction {
        private final String fn;

        HostFunction(String fn) {
            this.fn = fn;
        }

        @Override
        public Varargs invoke(Varargs a) {
            Object[] args = new Object[a.narg()];
            for (int i = 0; i < args.length; i++) args[i] = toJava(a.arg(i + 1));
            try {
                Object r = host.call(fn, args);
                if (r instanceof Object[]) {
                    Object[] many = (Object[]) r;
                    LuaValue[] out = new LuaValue[many.length];
                    for (int i = 0; i < out.length; i++) out[i] = toLua(many[i]);
                    return LuaValue.varargsOf(out);
                }
                return toLua(r);
            } catch (LuaError e) {
                throw e;
            } catch (Exception e) {
                String m = e.getMessage();
                throw new LuaError("korie." + fn + ": " + (m == null ? e.getClass().getSimpleName() : m));
            }
        }
    }

    // ------------------------------------------------------------------ Lua <-> Java values

    public static Object toJava(LuaValue v) {
        if (v == null || v.isnil()) return null;
        if (v.isboolean()) return v.toboolean();
        if (v.type() == LuaValue.TNUMBER) return v.todouble();
        if (v.type() == LuaValue.TSTRING) {
            byte[] b = bytes(v);
            String text = utf8(b);
            return text != null ? text : b;
        }
        if (v.isfunction()) return v;
        if (v.istable()) {
            LuaTable t = v.checktable();
            int n = t.length();
            boolean arrayOnly = n > 0;
            if (arrayOnly) {
                int keys = 0;
                LuaValue k = LuaValue.NIL;
                while (true) {
                    Varargs nx = t.next(k);
                    k = nx.arg1();
                    if (k.isnil()) break;
                    keys++;
                }
                arrayOnly = keys == n;
            }
            if (arrayOnly) {
                List<Object> list = new ArrayList<>(n);
                for (int i = 1; i <= n; i++) list.add(toJava(t.get(i)));
                return list;
            }
            Map<String, Object> map = new LinkedHashMap<>();
            for (int i = 1; i <= n; i++) map.put(String.valueOf(i), toJava(t.get(i)));
            LuaValue k = LuaValue.NIL;
            while (true) {
                Varargs nx = t.next(k);
                k = nx.arg1();
                if (k.isnil()) break;
                if (k.isint() && k.toint() >= 1 && k.toint() <= n) continue;
                map.put(k.type() == LuaValue.TSTRING ? jstr(k) : k.tojstring(), toJava(nx.arg(2)));
            }
            return map;
        }
        return v.tojstring();
    }

    @SuppressWarnings("unchecked")
    public static LuaValue toLua(Object o) {
        if (o == null) return LuaValue.NIL;
        if (o instanceof LuaValue) return (LuaValue) o;
        if (o instanceof String) return lstr((String) o);
        if (o instanceof Boolean) return LuaValue.valueOf((Boolean) o);
        if (o instanceof Integer || o instanceof Long || o instanceof Short || o instanceof Byte) {
            long l = ((Number) o).longValue();
            return l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE ? LuaValue.valueOf((int) l) : LuaValue.valueOf((double) l);
        }
        if (o instanceof Number) return LuaValue.valueOf(((Number) o).doubleValue());
        if (o instanceof byte[]) return LuaString.valueOf((byte[]) o);
        if (o instanceof List) {
            LuaTable t = new LuaTable();
            int i = 1;
            for (Object x : (List<Object>) o) t.set(i++, toLua(x));
            return t;
        }
        if (o instanceof Map) {
            LuaTable t = new LuaTable();
            for (Map.Entry<Object, Object> e : ((Map<Object, Object>) o).entrySet()) {
                t.set(String.valueOf(e.getKey()), toLua(e.getValue()));
            }
            return t;
        }
        return LuaValue.valueOf(String.valueOf(o));
    }

    // The interpreter's own text conversion only understands characters up to three bytes long,
    // which mangles emoji. These go through real UTF-8 in both directions.

    static byte[] bytes(LuaValue v) {
        LuaString s = v.checkstring();
        byte[] b = new byte[s.m_length];
        s.copyInto(0, b, 0, b.length);
        return b;
    }

    /** The text these bytes spell, or null when they are not text (a picture, a zip). */
    static String utf8(byte[] b) {
        try {
            return java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(b)).toString();
        } catch (java.nio.charset.CharacterCodingException e) {
            return null;
        }
    }

    static LuaValue lstr(String s) {
        return LuaString.valueOf(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    static String jstr(LuaValue v) {
        byte[] b = bytes(v);
        String text = utf8(b);
        return text != null ? text : v.tojstring();
    }

    // ------------------------------------------------------------------ helpers for reading arguments

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<String, Object>();
    }

    /** A list argument. An empty Lua table arrives as an empty map; that is an empty list too. */
    @SuppressWarnings("unchecked")
    public static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : new ArrayList<Object>();
    }

    public static String str(Object o, String fallback) {
        if (o == null) return fallback;
        if (o instanceof String) return (String) o;
        if (o instanceof Double) {
            double d = (Double) o;
            return d == Math.rint(d) && Math.abs(d) < 1e15 ? String.valueOf((long) d) : String.valueOf(d);
        }
        if (o instanceof Boolean) return String.valueOf(o);
        return fallback;
    }

    public static double num(Object o, double fallback) {
        if (o instanceof Number) return ((Number) o).doubleValue();
        if (o instanceof String) {
            try {
                return Double.parseDouble((String) o);
            } catch (NumberFormatException ignored) {
            }
        }
        return fallback;
    }

    public static boolean bool(Object o, boolean fallback) {
        return o instanceof Boolean ? (Boolean) o : fallback;
    }

    public static LuaValue fn(Object o) {
        return o instanceof LuaFunction ? (LuaValue) o : null;
    }

    // ------------------------------------------------------------------ JSON

    /** JSON text to Java values (Map, List, String, Double, Boolean). Throws on bad JSON. */
    public static Object parseJson(String text) {
        return toJava(new JsonReader(text).read());
    }

    public static String toJson(Object o) {
        StringBuilder sb = new StringBuilder();
        writeJson(sb, o);
        return sb.toString();
    }

    public static void writeJson(StringBuilder sb, Object o) {
        if (o == null || o instanceof LuaFunction) {
            sb.append("null");
        } else if (o instanceof String) {
            quote(sb, (String) o);
        } else if (o instanceof Boolean) {
            sb.append(o);
        } else if (o instanceof Number) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append((long) d);
            else sb.append(d);
        } else if (o instanceof List) {
            sb.append('[');
            boolean first = true;
            for (Object x : (List<?>) o) {
                if (!first) sb.append(',');
                first = false;
                writeJson(sb, x);
            }
            sb.append(']');
        } else if (o instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (e.getValue() instanceof LuaFunction) continue;
                if (!first) sb.append(',');
                first = false;
                quote(sb, String.valueOf(e.getKey()));
                sb.append(':');
                writeJson(sb, e.getValue());
            }
            sb.append('}');
        } else {
            quote(sb, String.valueOf(o));
        }
    }

    private static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    /** JSON text to Lua values. JSON null becomes nil, so a null field is simply absent. */
    private static final class JsonReader {
        private final String s;
        private int i;

        JsonReader(String s) {
            this.s = s;
        }

        LuaValue read() {
            LuaValue v = value();
            ws();
            if (i < s.length()) throw new LuaError("korie.json.decode: unexpected text at position " + i);
            return v;
        }

        private void ws() {
            while (i < s.length() && s.charAt(i) <= ' ') i++;
        }

        private LuaValue value() {
            ws();
            if (i >= s.length()) throw new LuaError("korie.json.decode: text ended early");
            char c = s.charAt(i);
            if (c == '{') {
                i++;
                LuaTable t = new LuaTable();
                ws();
                if (i < s.length() && s.charAt(i) == '}') {
                    i++;
                    return t;
                }
                while (true) {
                    ws();
                    if (i >= s.length() || s.charAt(i) != '"') throw new LuaError("korie.json.decode: expected a name at position " + i);
                    String k = string();
                    ws();
                    expect(':');
                    t.set(lstr(k), value());
                    ws();
                    if (i < s.length() && s.charAt(i) == ',') {
                        i++;
                        continue;
                    }
                    expect('}');
                    return t;
                }
            }
            if (c == '[') {
                i++;
                LuaTable t = new LuaTable();
                ws();
                if (i < s.length() && s.charAt(i) == ']') {
                    i++;
                    return t;
                }
                int n = 1;
                while (true) {
                    t.set(n++, value());
                    ws();
                    if (i < s.length() && s.charAt(i) == ',') {
                        i++;
                        continue;
                    }
                    expect(']');
                    return t;
                }
            }
            if (c == '"') return lstr(string());
            if (s.startsWith("true", i)) {
                i += 4;
                return LuaValue.TRUE;
            }
            if (s.startsWith("false", i)) {
                i += 5;
                return LuaValue.FALSE;
            }
            if (s.startsWith("null", i)) {
                i += 4;
                return LuaValue.NIL;
            }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            if (st == i) throw new LuaError("korie.json.decode: unexpected '" + c + "' at position " + i);
            double d = Double.parseDouble(s.substring(st, i));
            return d == Math.rint(d) && Math.abs(d) <= Integer.MAX_VALUE ? LuaValue.valueOf((int) d) : LuaValue.valueOf(d);
        }

        private void expect(char c) {
            if (i >= s.length() || s.charAt(i) != c) throw new LuaError("korie.json.decode: expected '" + c + "' at position " + i);
            i++;
        }

        private String string() {
            i++;
            StringBuilder sb = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i++);
                if (c == '"') return sb.toString();
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                if (i >= s.length()) break;
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'r': sb.append('\r'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new LuaError("korie.json.decode: bad \\u escape");
                        sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                        break;
                    default: sb.append(e);
                }
            }
            throw new LuaError("korie.json.decode: a string never ends");
        }
    }

    // ------------------------------------------------------------------ string.format

    /**
     * string.format that honours width and precision. The interpreter's own version prints
     * numbers unformatted for %f and %g, so "%.1f" would give 3.14159 instead of 3.1.
     */
    private static final class Format extends VarArgFunction {
        @Override
        public Varargs invoke(Varargs a) {
            String f = jstr(a.arg(1));
            StringBuilder out = new StringBuilder();
            int arg = 2;
            for (int i = 0; i < f.length(); i++) {
                char c = f.charAt(i);
                if (c != '%') {
                    out.append(c);
                    continue;
                }
                if (++i >= f.length()) throw new LuaError("invalid format (ends with '%')");
                if (f.charAt(i) == '%') {
                    out.append('%');
                    continue;
                }
                int st = i;
                while (i < f.length() && "-+ #0".indexOf(f.charAt(i)) >= 0) i++;
                while (i < f.length() && Character.isDigit(f.charAt(i))) i++;
                if (i < f.length() && f.charAt(i) == '.') {
                    i++;
                    while (i < f.length() && Character.isDigit(f.charAt(i))) i++;
                }
                if (i >= f.length()) throw new LuaError("invalid format");
                String spec = f.substring(st, i);
                char conv = f.charAt(i);
                LuaValue v = a.arg(arg++);
                switch (conv) {
                    case 'd':
                    case 'i':
                        out.append(String.format(Locale.ROOT, "%" + spec.replace("#", "") + "d", (long) v.checkdouble()));
                        break;
                    case 'u':
                        out.append(String.format(Locale.ROOT, "%" + spec.replace("#", "") + "d", Math.abs((long) v.checkdouble())));
                        break;
                    case 'x':
                    case 'X':
                    case 'o':
                        out.append(String.format(Locale.ROOT, "%" + spec.replace("+", "").replace(" ", "") + conv, (long) v.checkdouble()));
                        break;
                    case 'c':
                        out.append((char) v.checkint());
                        break;
                    case 'f':
                    case 'e':
                    case 'E':
                    case 'g':
                    case 'G':
                        out.append(String.format(Locale.ROOT, "%" + spec + conv, v.checkdouble()));
                        break;
                    case 's':
                        int flagsEnd = 0;
                        while (flagsEnd < spec.length() && "-+ #0".indexOf(spec.charAt(flagsEnd)) >= 0) flagsEnd++;
                        out.append(String.format(Locale.ROOT, "%" + (spec.substring(0, flagsEnd).indexOf('-') >= 0 ? "-" : "") + spec.substring(flagsEnd) + "s",
                                v.isnil() ? "nil" : v.isstring() ? jstr(v) : v.tojstring()));
                        break;
                    case 'q':
                        out.append('"').append(jstr(v).replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")).append('"');
                        break;
                    default:
                        throw new LuaError("invalid option '%" + conv + "' to 'format'");
                }
            }
            return lstr(out.toString());
        }
    }
}
