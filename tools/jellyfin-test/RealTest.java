import com.petrobot.hume.AddonLua;
import com.petrobot.hume.AddonPack;
import org.luaj.vm2.LuaValue;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Runs the Jellyfin add-on's Lua outside Android against a REAL Jellyfin server: real HTTP, real
 * UDP discovery, scripted answers for the questions it asks on screen.
 *
 *     bash tools/jellyfin-test/run.sh <user> <password> [server address]
 */
public class RealTest {
    static int checks, failed;
    static void ok(boolean c, String what) { checks++; System.out.println((c ? "ok    " : "FAIL  ") + what); if (!c) failed++; }

    static final class Host implements AddonLua.Host {
        final Map<String, LuaValue> on = new HashMap<>();
        final Map<Object, Object> store = new HashMap<>(), settings = new HashMap<>();
        final Deque<Object> answers = new ArrayDeque<>();
        final List<String> asked = new ArrayList<>(), toasts = new ArrayList<>();
        final List<Map<String, Object>> plays = new ArrayList<>();
        final List<Map<String, Object>> profiles = new ArrayList<>();
        String profile = "p1";
        Host() { addProfile("Me"); }
        Map<String, Object> addProfile(String name) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", "p" + (profiles.size() + 1)); p.put("name", name);
            profiles.add(p);
            return p;
        }
        Map<String, Object> current() { for (Map<String, Object> p : profiles) if (profile.equals(p.get("id"))) return p; return profiles.get(0); }
        public Object call(String name, Object[] a) throws Exception {
            switch (name) {
                case "on": on.put((String) a[0], AddonLua.fn(a[1])); return null;
                case "log": System.out.println("      log: " + AddonLua.toJson(Arrays.asList(a))); return null;
                case "toast": toasts.add(String.valueOf(a[0])); System.out.println("      toast: " + a[0]); return null;
                case "store.get": return store.containsKey(a[0]) ? store.get(a[0]) : (a.length > 1 ? a[1] : null);
                case "store.set": store.put(a[0], a[1]); return null;
                case "store.remove": store.remove(a[0]); return null;
                case "setting": return settings.get(a[0]);
                case "set_setting": settings.put(a[0], a[1]); return null;
                case "refresh": return null;
                case "timer": return 1d;
                case "device": { Map<String, Object> d = new LinkedHashMap<>(); d.put("model", "RealTest"); d.put("korie", "test"); return d; }
                case "profile": return current();
                case "profiles.list": return new ArrayList<Object>(profiles);
                case "profiles.add": return addProfile(String.valueOf(a[0]));
                case "ask": {
                    Map<String, Object> q = AddonLua.map(a[0]);
                    Object ans = answers.poll();
                    asked.add(AddonLua.str(q.get("title"), "") + " | " + AddonLua.str(q.get("message"), "") + " | " + AddonLua.toJson(q.get("choices")));
                    System.out.println("      ask: " + asked.get(asked.size() - 1).replace("\n", " ") + "  ->  " + ans);
                    return ans;
                }
                case "play": plays.add(AddonLua.map(a[0])); return null;
                case "net.broadcast": return broadcast((int) AddonLua.num(a[0], 0), AddonLua.str(a[1], ""), AddonLua.num(a[2], 2));
                case "http.request": return http(AddonLua.map(a[0]));
                default: return null;
            }
        }
        Object broadcast(int port, String message, double seconds) throws Exception {
            List<Object> out = new ArrayList<>();
            try (java.net.DatagramSocket s = new java.net.DatagramSocket()) {
                s.setBroadcast(true);
                byte[] data = message.getBytes(StandardCharsets.UTF_8);
                for (String to : new String[]{"255.255.255.255", "127.0.0.1"}) {
                    try { s.send(new java.net.DatagramPacket(data, data.length, java.net.InetAddress.getByName(to), port)); } catch (Exception ignored) { }
                }
                long end = System.currentTimeMillis() + (long) (seconds * 1000);
                byte[] buf = new byte[8192];
                while (System.currentTimeMillis() < end) {
                    s.setSoTimeout((int) Math.max(1, end - System.currentTimeMillis()));
                    java.net.DatagramPacket p = new java.net.DatagramPacket(buf, buf.length);
                    try { s.receive(p); } catch (java.net.SocketTimeoutException e) { break; }
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("address", p.getAddress().getHostAddress());
                    m.put("text", new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                    out.add(m);
                }
            }
            return out;
        }
        static Object http(Map<String, Object> o) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(AddonLua.str(o.get("url"), "")).openConnection(java.net.Proxy.NO_PROXY);
                c.setConnectTimeout(8000); c.setReadTimeout(20000);
                String method = AddonLua.str(o.get("method"), "GET");
                c.setRequestMethod(method);
                for (Map.Entry<String, Object> h : AddonLua.map(o.get("headers")).entrySet()) c.setRequestProperty(h.getKey(), AddonLua.str(h.getValue(), ""));
                Object body = o.get("body");
                if (body != null) {
                    c.setDoOutput(true);
                    try (OutputStream os = c.getOutputStream()) { os.write(body instanceof byte[] ? (byte[]) body : AddonLua.str(body, "").getBytes(StandardCharsets.UTF_8)); }
                } else if (!method.equals("GET")) {
                    c.setDoOutput(true); c.setFixedLengthStreamingMode(0); c.getOutputStream().close();
                }
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] data = in == null ? new byte[0] : in.readAllBytes();
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("status", (double) status); r.put("ok", status >= 200 && status < 300);
                r.put("body", new String(data, StandardCharsets.UTF_8));
                if (status >= 400) System.out.println("      http " + status + " " + method + " " + o.get("url") + "  " + new String(data, StandardCharsets.UTF_8).replace("\n", " ").substring(0, Math.min(300, data.length)));
                return r;
            } catch (Exception e) {
                System.out.println("      http failed " + o.get("url") + ": " + e);
                return new Object[]{null, e.toString()};
            }
        }
    }

    static Object ask(AddonLua lua, Host h, String ev, Object... args) { return lua.callback(h.on.get(ev), args); }

    /** Fetches the start of a stream the way the player would, with the add-on's headers. */
    static String probe(Map<String, Object> play) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(AddonLua.str(play.get("url"), "")).openConnection(java.net.Proxy.NO_PROXY);
        for (Map.Entry<String, Object> x : AddonLua.map(play.get("headers")).entrySet()) c.setRequestProperty(x.getKey(), AddonLua.str(x.getValue(), ""));
        c.setRequestProperty("Range", "bytes=0-65535");
        c.setConnectTimeout(8000); c.setReadTimeout(60000);
        int status = c.getResponseCode();
        byte[] data = (status >= 400 ? c.getErrorStream() : c.getInputStream()).readNBytes(65536);
        String head = new String(data, 0, Math.min(data.length, 12), StandardCharsets.ISO_8859_1).replaceAll("[^ -~]", ".");
        return status + " " + c.getContentType() + " " + data.length + " bytes, starts \"" + head + "\"";
    }

    static Map<String, Object> info(String state, double pos, double dur) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("state", state); m.put("position", pos); m.put("duration", dur);
        return m;
    }

    public static void main(String[] x) throws Exception {
        String user = x[0], pw = x[1], address = x.length > 2 ? x[2] : null;
        Host h = new Host();
        AddonPack p = AddonPack.read(new File("addons/jellyfin"));
        Map<String, Object> ai = new LinkedHashMap<>();
        ai.put("id", p.id); ai.put("dir", p.dir.getAbsolutePath());
        AddonLua lua = new AddonLua(p.dir, h, ai);
        lua.run(new File(p.dir, p.main));

        System.out.println("== server");
        if (address == null) { h.answers.add(1d); } else { h.answers.add(2d); h.answers.add(address); }
        ask(lua, h, "button", "server");
        ok(h.store.get("server") != null, "server set: " + AddonLua.toJson(h.store.get("server")) + (address == null ? " (found on the network)" : " (typed)"));
        if (h.store.get("server") == null) { System.out.println("stopping: no server"); System.exit(1); }

        System.out.println("== sign in with a password");
        h.answers.clear();
        h.answers.add(2d); h.answers.add(user); h.answers.add(pw); h.answers.add(2d);  // password; name; password; profiles offer: not now
        ask(lua, h, "button", "account");
        Object acc = h.store.get("account:p1");
        ok(acc != null, "signed in: " + (acc == null ? "no" : AddonLua.str(AddonLua.map(acc).get("name"), "?")));
        if (acc == null) { System.out.println("stopping: not signed in"); System.exit(1); }

        System.out.println("== profiles from the server's users");
        h.answers.clear(); h.answers.add(true);
        ask(lua, h, "button", "profiles");
        ok(h.profiles.size() > 1, "profiles now: " + AddonLua.toJson(h.profiles));

        System.out.println("== library");
        List<Object> cat = AddonLua.list(ask(lua, h, "catalog"));
        ok(!cat.isEmpty(), "catalog has " + cat.size() + " titles");
        Map<String, Object> film = null, series = null;
        for (Object o : cat) {
            Map<String, Object> m = AddonLua.map(o);
            System.out.println("      " + m.get("type") + "  " + m.get("title") + "  " + m.get("year") + "  key=" + m.get("key") + "  poster=" + !AddonLua.str(m.get("poster"), "").isEmpty() + " backdrop=" + !AddonLua.str(m.get("backdrop"), "").isEmpty());
            if ("movie".equals(m.get("type")) && (film == null || "Sintel".equals(m.get("title")))) film = m;  // the 20-minute test film
            if ("series".equals(m.get("type")) && series == null) series = m;
        }
        ok(film != null, "has a film");
        ok(series != null, "has a series");
        if (film != null && !AddonLua.str(film.get("poster"), "").isEmpty()) {
            HttpURLConnection c = (HttpURLConnection) new URL(AddonLua.str(film.get("poster"), "")).openConnection(java.net.Proxy.NO_PROXY);
            ok(c.getResponseCode() == 200 && String.valueOf(c.getContentType()).startsWith("image/"), "poster loads without a sign-in: " + c.getResponseCode() + " " + c.getContentType());
        }

        if (film != null) {
            System.out.println("== film: " + film.get("title"));
            Map<String, Object> d = AddonLua.map(ask(lua, h, "detail", film));
            System.out.println("      film page before playing: " + AddonLua.toJson(d));
            ask(lua, h, "action", film, "play");
            ok(h.plays.size() == 1, "Play starts the player");
            if (!h.plays.isEmpty()) {
                Map<String, Object> pl = h.plays.get(0);
                System.out.println("      play: " + AddonLua.toJson(pl));
                String got = probe(pl);
                ok(got.startsWith("200") || got.startsWith("206"), "the stream answers: " + got);
                Object ref = pl.get("ref");
                ask(lua, h, "playback", ref, info("playing", 0, 1200));
                ask(lua, h, "playback", ref, info("playing", 300, 1200));
                ask(lua, h, "playback", ref, info("paused", 305, 1200));
                ask(lua, h, "playback", ref, info("stopped", 310, 1200));
                Thread.sleep(1500);
                Map<String, Object> d2 = AddonLua.map(ask(lua, h, "detail", film));
                List<Object> bs = AddonLua.list(d2.get("buttons"));
                ok(bs.size() == 2 && "Resume".equals(AddonLua.map(bs.get(0)).get("label")), "after stopping at 5:10 the server remembers: " + AddonLua.toJson(bs));
                List<Object> home = AddonLua.list(ask(lua, h, "home"));
                boolean inHome = false;
                for (Object o : home) { Map<String, Object> m = AddonLua.map(o); System.out.println("      home: " + m.get("title") + " remaining=" + m.get("remaining") + " progress=" + m.get("progress") + " backdrop=" + !AddonLua.str(m.get("backdrop"), "").isEmpty()); if (film.get("title").equals(m.get("title"))) inHome = true; }
                ok(inHome, "Continue Watching on the carousel has the film");
                h.plays.clear();
                ask(lua, h, "action", film, "resume");
                ok(!h.plays.isEmpty() && AddonLua.num(h.plays.get(0).get("start"), 0) > 300, "Resume starts at " + (h.plays.isEmpty() ? "?" : h.plays.get(0).get("start")) + " s");
                if (!h.plays.isEmpty()) {
                    ask(lua, h, "playback", h.plays.get(0).get("ref"), info("playing", 1190, 1200));
                    ask(lua, h, "playback", h.plays.get(0).get("ref"), info("ended", 1200, 1200));
                    Thread.sleep(1500);
                    ok(AddonLua.list(AddonLua.map(ask(lua, h, "detail", film)).get("buttons")).size() == 1, "after it ended: watched, just Play again");
                }
                h.plays.clear();
                h.settings.put("quality", "convert");
                ask(lua, h, "action", film, "play");
                if (!h.plays.isEmpty()) {
                    System.out.println("      converted: " + h.plays.get(0).get("url"));
                    String got2 = probe(h.plays.get(0));
                    ok((got2.startsWith("200") || got2.startsWith("206")) && got2.contains("#EXTM3U"), "converted stream is an HLS playlist: " + got2);
                    ask(lua, h, "playback", h.plays.get(0).get("ref"), info("stopped", 0, 1200));
                } else ok(false, "converted play did not start");
                h.settings.remove("quality");
            }
        }

        if (series != null) {
            System.out.println("== series: " + series.get("title"));
            Map<String, Object> d = AddonLua.map(ask(lua, h, "detail", series));
            System.out.println("      series page opens at: " + AddonLua.toJson(d.get("focus")));
            List<Object> seasons = AddonLua.list(d.get("seasons"));
            ok(!seasons.isEmpty(), "seasons: " + AddonLua.toJson(seasons));
            if (!seasons.isEmpty()) {
                List<Object> eps = AddonLua.list(ask(lua, h, "episodes", series, AddonLua.str(AddonLua.map(seasons.get(0)).get("id"), "")));
                ok(!eps.isEmpty(), "episodes in the first season: " + eps.size());
                for (Object o : eps) { Map<String, Object> m = AddonLua.map(o); System.out.println("      " + m.get("title") + "  thumb=" + !AddonLua.str(m.get("thumb"), "").isEmpty() + " progress=" + m.get("progress")); }
                if (!eps.isEmpty()) {
                    h.plays.clear();
                    ask(lua, h, "action", AddonLua.map(eps.get(0)), "play");
                    ok(!h.plays.isEmpty(), "an episode plays: " + (h.plays.isEmpty() ? "" : h.plays.get(0).get("title") + " / " + h.plays.get(0).get("subtitle")));
                    if (!h.plays.isEmpty() && eps.size() > 1) {
                        Map<String, Object> first = h.plays.get(0);
                        ok(first.get("next") != null, "it knows the next episode: " + AddonLua.toJson(first.get("next")) + ", starts by itself: " + first.get("autonext"));
                        Map<String, Object> nx = AddonLua.map(first.get("next"));
                        ok(!AddonLua.str(nx.get("image"), "").isEmpty() && !AddonLua.str(nx.get("series"), "").isEmpty(), "Next Up has a picture and the series name");
                        System.out.println("      parts to skip from the server: " + AddonLua.toJson(first.get("segments")));
                        ask(lua, h, "playback", first.get("ref"), info("playing", 0, 120));
                        ask(lua, h, "playback", first.get("ref"), info("ended", 120, 120));
                        h.plays.clear();
                        ask(lua, h, "next", first.get("ref"));
                        ok(!h.plays.isEmpty() && String.valueOf(h.plays.get(0).get("subtitle")).contains("E2"), "Next starts the second episode: " + (h.plays.isEmpty() ? "nothing" : h.plays.get(0).get("subtitle")));
                    }
                    if (!h.plays.isEmpty()) {
                        ask(lua, h, "playback", h.plays.get(0).get("ref"), info("playing", 0, 120));
                        ask(lua, h, "playback", h.plays.get(0).get("ref"), info("ended", 120, 120));
                        Thread.sleep(1500);
                        List<Object> home = AddonLua.list(ask(lua, h, "home"));
                        for (Object o : home) { Map<String, Object> m = AddonLua.map(o); System.out.println("      home: " + m.get("title") + " | " + m.get("overview") + " backdrop=" + !AddonLua.str(m.get("backdrop"), "").isEmpty()); }
                        ok(!home.isEmpty(), "Next Up on the carousel after finishing an episode");
                    }
                }
            }
        }

        System.out.println("== Quick Connect");
        h.answers.clear(); h.answers.add(1d); h.answers.add(2d);  // Quick Connect; then Cancel at the code
        int before = h.asked.size();
        ask(lua, h, "button", "account");
        boolean code = false;
        for (int i = before; i < h.asked.size(); i++) if (h.asked.get(i).matches("(?s).*enter this code:\\s*\\d{4,}.*")) code = true;
        ok(code, "Quick Connect shows a code from the server");

        System.out.println("== sign out");
        h.answers.clear(); h.answers.add(3d);
        ask(lua, h, "button", "account");
        ok(h.store.get("account:p1") == null, "signed out");

        System.out.println(failed == 0 ? "\nALL OK: " + checks + " checks" : "\n" + failed + " of " + checks + " FAILED");
        System.exit(failed == 0 ? 0 : 1);
    }
}
