import com.petrobot.hume.AddonLua;
import com.petrobot.hume.AddonPack;
import org.luaj.vm2.LuaValue;

import java.io.File;
import java.util.*;

/** Runs add-ons' Lua outside Android with a fake host and checks what they answer. */
public class AddonTest {
    static int checks, failed;
    static void ok(boolean c, String what) { checks++; if (!c) { failed++; System.out.println("FAIL: " + what); } }

    static final class Fake implements AddonLua.Host {
        final Map<String, LuaValue> on = new HashMap<>();
        final List<String> calls = new ArrayList<>();
        final Map<Object, Object> store = new HashMap<>();
        final Map<Object, Object> settings = new HashMap<>();
        byte[] httpBody = new byte[0];
        boolean offline;
        public Object call(String name, Object[] a) {
            if (name.equals("on")) { on.put((String) a[0], AddonLua.fn(a[1])); return null; }
            calls.add(name + " " + AddonLua.toJson(Arrays.asList(a)));
            if ((name.equals("http.get") || name.equals("http.request")) && offline) return new Object[]{null, "no internet connection"};
            if (name.equals("http.get") || name.equals("http.request")) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("ok", true); r.put("status", 200.0); r.put("body", httpBody);
                return r;
            }
            if (name.equals("setting")) return settings.get(a[0]);
            if (name.equals("device")) { Map<String, Object> d = new LinkedHashMap<>(); d.put("language", "da-DK"); return d; }
            if (name.equals("store.get")) return store.containsKey(a[0]) ? store.get(a[0]) : (a.length > 1 ? a[1] : null);
            if (name.equals("store.set")) store.put(a[0], a[1]);
            if (name.equals("store.remove")) store.remove(a[0]);
            return null;
        }
    }

    static Object ask(AddonLua lua, Fake f, String ev, Object... args) { return lua.callback(f.on.get(ev), args); }

    static AddonLua load(String dir, Fake f) throws Exception {
        AddonPack p = AddonPack.read(new File(dir));
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("id", p.id); info.put("dir", p.dir.getAbsolutePath());
        AddonLua lua = new AddonLua(p.dir, f, info);
        lua.run(new File(p.dir, p.main));
        return lua;
    }

    public static void main(String[] x) throws Exception {
        Fake f = new Fake();
        AddonLua lua = load("addons/openfilms", f);
        List<Object> cat = AddonLua.list(ask(lua, f, "catalog"));
        ok(cat.size() == 2, "openfilms catalog has 2 films");
        Map<String, Object> sintel = AddonLua.map(cat.get(0));
        ok("Sintel".equals(sintel.get("title")) && "movie".equals(sintel.get("type")), "first is Sintel, a movie");
        Map<String, Object> d = AddonLua.map(ask(lua, f, "detail", sintel));
        ok(AddonLua.list(d.get("buttons")).size() == 1, "one Play button");
        ask(lua, f, "action", sintel, "play");
        String last = f.calls.get(f.calls.size() - 1);
        ok(last.startsWith("play ") && last.contains("Sintel.2010.1080p.mkv") && last.contains("\"ref\":\"sintel\""), "action plays the film: " + last);
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("state", "stopped"); info.put("position", 125.0); info.put("duration", 888.0);
        ask(lua, f, "playback", "sintel", info);
        Map<String, Object> d2 = AddonLua.map(ask(lua, f, "detail", sintel));
        List<Object> bs = AddonLua.list(d2.get("buttons"));
        ok(bs.size() == 2 && "Resume".equals(AddonLua.map(bs.get(0)).get("label")) && "from 2:05".equals(AddonLua.map(bs.get(0)).get("sub")), "after stopping at 2:05: Resume from 2:05, then Play from the start: " + AddonLua.toJson(bs));
        ask(lua, f, "action", sintel, "resume");
        ok(f.calls.get(f.calls.size() - 1).contains("\"start\":125"), "resume starts at 125 s: " + f.calls.get(f.calls.size() - 1));
        info.put("state", "ended");
        ask(lua, f, "playback", "sintel", info);
        ok(AddonLua.list(AddonLua.map(ask(lua, f, "detail", sintel)).get("buttons")).size() == 1, "after it ended: just Play again");

        Fake g = new Fake();
        AddonLua t = load("testdata/addons/testshow", g);
        List<Object> items = AddonLua.list(ask(t, g, "catalog"));
        ok(items.size() == 3, "testshow catalog");
        Map<String, Object> series = AddonLua.map(items.get(2));
        Map<String, Object> sd = AddonLua.map(ask(t, g, "detail", series));
        ok(AddonLua.list(sd.get("seasons")).size() == 2 && AddonLua.list(sd.get("buttons")).isEmpty(), "series: 2 seasons, no buttons");
        ok(AddonLua.list(ask(t, g, "episodes", series, "1")).size() == 8, "season 1 has 8 episodes");
        ok(AddonLua.list(ask(t, g, "episodes", series, "2")).size() == 3, "season 2 has 3 episodes");
        Map<String, Object> md = AddonLua.map(ask(t, g, "detail", AddonLua.map(items.get(0))));
        ok(AddonLua.list(md.get("buttons")).size() == 2, "movie in progress: Resume and Play");
        ok(AddonLua.list(ask(t, g, "home")).size() == 1, "home has one title");

        Fake h = new Fake();
        AddonLua two = load("testdata/addons/testtwo", h);
        ok(AddonLua.list(ask(two, h, "search", "fixt")).size() == 1, "testtwo finds the movie");
        ok(AddonLua.list(ask(two, h, "search", "zzz")).isEmpty(), "testtwo finds nothing for zzz");
        Fake rf = new Fake();
        rf.httpBody = java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("testdata/radio-dk.json"));
        AddonLua radio = load("addons/radio", rf);
        List<Object> st = AddonLua.list(ask(radio, rf, "catalog"));
        ok(st.size() == 5, "radio: 5 stations from the saved answer, got " + st.size());
        Map<String, Object> p3 = AddonLua.map(st.get(0));
        ok("DR P3".equals(p3.get("title")) && "radio".equals(p3.get("type")) && "http://live-icy.dr.dk/A/A05H.mp3".equals(p3.get("url")), "first station is DR P3 with its stream: " + AddonLua.toJson(p3));
        boolean askedDk = false;
        for (String c : rf.calls) if (c.startsWith("http.get ") && c.contains("countrycode=DK")) askedDk = true;
        ok(askedDk, "no country chosen: asks for the device's country (DK)");
        rf.calls.clear();
        ask(radio, rf, "action", p3, "play");
        ok(rf.calls.get(0).startsWith("play ") && rf.calls.get(0).contains("\"audio\":true") && rf.calls.get(0).contains("live-icy.dr.dk"), "action plays the stream as sound: " + rf.calls.get(0));
        ok(rf.store.containsKey("last"), "the station is remembered as the last one");
        rf.settings.put("country", "SE");
        rf.calls.clear();
        ask(radio, rf, "setting", "country", "SE");
        ok(rf.calls.contains("refresh []"), "changing the country refreshes the list: " + rf.calls);
        ask(radio, rf, "catalog");
        ok(rf.calls.get(rf.calls.size() - 1).contains("countrycode=SE"), "then asks for Sweden");

        rf.offline = true;
        String err = "";
        try { ask(radio, rf, "catalog"); } catch (Exception e) { err = String.valueOf(e.getMessage()); }
        ok(err.contains("no station list: no internet connection"), "offline: the catalog fails with a clear reason (the saved list is kept): " + err);
        Fake auto = new Fake();
        auto.offline = true; auto.settings.put("autostart", true); auto.store.put("last", p3);
        AddonLua r2 = load("addons/radio", auto);
        boolean timer = false;
        for (String c : auto.calls) if (c.startsWith("timer ")) timer = true;
        ok(timer, "autostart on: a timer is set at start: " + auto.calls);

        System.out.println(failed == 0 ? "OK: " + checks + " checks passed" : failed + " of " + checks + " FAILED");
        System.exit(failed == 0 ? 0 : 1);
    }
}
