using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace Korie.Jellyfin.Addons;

/// <summary>An add-on's addon.json.</summary>
public sealed class Manifest
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Version { get; init; } = "0.0.0";
    public string Author { get; init; } = "";
    public string Description { get; init; } = "";
    public string Main { get; init; } = "main.lua";
    public string[] Permissions { get; init; } = [];
    public string[] Hosts { get; init; } = [];
    public bool HostsFromSettings { get; init; }
    public bool Games { get; init; }
    public JsonArray Settings { get; init; } = [];
    public string Dir { get; init; } = "";

    public static Manifest? Read(string dir)
    {
        try
        {
            var j = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "addon.json")))!.AsObject();
            string S(string k, string d = "") => j[k]?.GetValueKind() == JsonValueKind.String ? j[k]!.GetValue<string>() : d;
            string[] L(string k) => j[k] is JsonArray a ? a.Where(x => x?.GetValueKind() == JsonValueKind.String).Select(x => x!.GetValue<string>().ToLowerInvariant()).ToArray() : [];
            var id = S("id");
            if (id.Length == 0 || id != Path.GetFileName(dir))
            {
                return null;
            }

            return new Manifest
            {
                Id = id, Name = S("name", id), Version = S("version", "0.0.0"), Author = S("author"), Description = S("description"),
                Main = S("main", "main.lua"), Permissions = L("permissions"), Hosts = L("hosts"),
                HostsFromSettings = j["hosts_from_settings"]?.GetValueKind() == JsonValueKind.True,
                Games = j["games"]?.GetValueKind() == JsonValueKind.True,
                Settings = j["settings"] as JsonArray is { } s ? (JsonArray)s.DeepClone() : [], Dir = dir,
            };
        }
        catch (Exception e) when (e is IOException or JsonException or InvalidOperationException)
        {
            return null;
        }
    }
}

/// <summary>What an admin decided about an add-on: on or off, internet allowed, its settings.</summary>
public sealed class AddonState
{
    public bool Enabled { get; set; }
    public bool Internet { get; set; }
    public Dictionary<string, JsonNode?> Settings { get; set; } = [];
}

/// <summary>
/// The installed add-ons: loads them, keeps their settings, and runs their functions,
/// following their fetch requests ("fetch this, then call me back") to the answer.
/// </summary>
public sealed class AddonManager
{
    private const int MaxSteps = 24;
    private static readonly HttpClient Http = MakeClient();

    private readonly ILogger<AddonManager> _log;
    private readonly ConcurrentDictionary<string, Sandbox> _running = new();
    private readonly ConcurrentDictionary<string, List<string>> _logs = new();
    private readonly ConcurrentDictionary<string, (DateTime Until, string Text)> _fetchCache = new();
    private readonly object _stateLock = new();
    private Dictionary<string, AddonState> _state;

    public AddonManager(ILogger<AddonManager> log)
    {
        _log = log;
        Directory.CreateDirectory(Paths.Addons);
        _state = LoadState();
        Scan();
    }

    public event Action? Changed;

    public IReadOnlyDictionary<string, Manifest> Manifests { get; private set; } = new Dictionary<string, Manifest>();

    private static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Korie/0.1 (Jellyfin plugin)");
        return c;
    }

    /// <summary>Reads the add-ons folder again; add-ons whose files changed restart.</summary>
    public void Scan()
    {
        var found = new Dictionary<string, Manifest>();
        foreach (var dir in Directory.EnumerateDirectories(Paths.Addons))
        {
            if (Path.GetFileName(dir).StartsWith('.'))
            {
                continue;
            }

            var m = Manifest.Read(dir);
            if (m is not null)
            {
                found[m.Id] = m;
            }
        }

        foreach (var id in _running.Keys)
        {
            if (!found.TryGetValue(id, out var m) || !Manifests.TryGetValue(id, out var old) || old.Version != m.Version)
            {
                _running.TryRemove(id, out _);
            }
        }

        Manifests = found;
        Changed?.Invoke();
    }

    // --- state ---------------------------------------------------------------------------

    private static Dictionary<string, AddonState> LoadState()
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, AddonState>>(File.ReadAllText(Paths.State)) ?? [];
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            return [];
        }
    }

    private void SaveState()
    {
        Directory.CreateDirectory(Paths.Data);
        var tmp = Paths.State + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_state));
        File.Move(tmp, Paths.State, true);
    }

    public AddonState StateOf(string id)
    {
        lock (_stateLock)
        {
            return _state.TryGetValue(id, out var s) ? s : new AddonState();
        }
    }

    public bool IsOn(string id) => Manifests.ContainsKey(id) && StateOf(id).Enabled;

    /// <summary>Turns an add-on on. One that fetches from the internet needs internet = true (an admin said yes).</summary>
    public string Enable(string id, bool internet)
    {
        if (!Manifests.TryGetValue(id, out var m))
        {
            return "There's no such add-on.";
        }

        if (m.Permissions.Contains("internet") && !internet && !StateOf(id).Internet)
        {
            return "needs_internet";
        }

        lock (_stateLock)
        {
            var s = _state.TryGetValue(id, out var x) ? x : _state[id] = new AddonState();
            s.Enabled = true;
            s.Internet |= internet;
            SaveState();
        }

        Changed?.Invoke();
        return "";
    }

    public void Disable(string id)
    {
        lock (_stateLock)
        {
            if (_state.TryGetValue(id, out var s))
            {
                s.Enabled = false;
                SaveState();
            }
        }

        _running.TryRemove(id, out _);
        Changed?.Invoke();
    }

    public void Forget(string id)
    {
        lock (_stateLock)
        {
            _state.Remove(id);
            SaveState();
        }

        _running.TryRemove(id, out _);
    }

    public JsonObject SettingsOf(string id)
    {
        var o = new JsonObject();
        if (!Manifests.TryGetValue(id, out var m))
        {
            return o;
        }

        var saved = StateOf(id).Settings;
        foreach (var s in m.Settings.OfType<JsonObject>())
        {
            var key = s["key"]?.ToString() ?? "";
            if (key.Length == 0)
            {
                continue;
            }

            o[key] = saved.TryGetValue(key, out var v) && v is not null ? v.DeepClone()
                : s["default"]?.DeepClone() ?? (s["type"]?.ToString() == "list" ? new JsonArray() : JsonValue.Create(""));
        }

        return o;
    }

    public bool SetSetting(string id, string key, JsonNode? value)
    {
        if (!Manifests.TryGetValue(id, out var m))
        {
            return false;
        }

        var def = m.Settings.OfType<JsonObject>().FirstOrDefault(s => s["key"]?.ToString() == key);
        if (def is null)
        {
            return false;
        }

        var isList = def["type"]?.ToString() == "list";
        var ok = isList ? value is JsonArray a && a.All(x => x?.GetValueKind() == JsonValueKind.String) : value?.GetValueKind() == JsonValueKind.String;
        if (!ok)
        {
            return false;
        }

        lock (_stateLock)
        {
            var s = _state.TryGetValue(id, out var x) ? x : _state[id] = new AddonState();
            s.Settings[key] = value!.DeepClone();
            SaveState();
        }

        _running.TryRemove(id, out _);
        Changed?.Invoke();
        return true;
    }

    public JsonObject Ctx(string id) => new()
    {
        ["now"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        ["language"] = "da",
        ["settings"] = SettingsOf(id),
    };

    // --- what an add-on may fetch -------------------------------------------------------------

    private static string HostOf(string url) => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host.ToLowerInvariant() : "";

    private static bool HostMatches(string h, IEnumerable<string> patterns) =>
        patterns.Any(p => p == h || (p.StartsWith("*.", StringComparison.Ordinal) && (h.EndsWith(p[1..], StringComparison.Ordinal) || h == p[2..])));

    /// <summary>Hosts of the addresses an admin typed into the add-on's settings (never passwords).</summary>
    private List<string> SettingsHosts(Manifest m)
    {
        var vals = SettingsOf(m.Id);
        var hosts = new List<string>();
        foreach (var s in m.Settings.OfType<JsonObject>())
        {
            if (s["type"]?.ToString() == "password")
            {
                continue;
            }

            var v = vals[s["key"]?.ToString() ?? ""];
            var raws = v is JsonArray a ? a.Select(x => x?.ToString() ?? "") : [v?.ToString() ?? ""];
            foreach (var raw in raws)
            {
                var addr = Regex.Replace(raw.Trim(), "^stremio://", "https://");
                if (!addr.Contains("://", StringComparison.Ordinal) && !addr.Contains(' ', StringComparison.Ordinal) && Regex.IsMatch(addr, "[.:]"))
                {
                    addr = "http://" + addr;
                }

                var h = HostOf(addr);
                if (h.Length > 0)
                {
                    hosts.Add(h);
                }
            }
        }

        return hosts;
    }

    public bool MayFetch(string id, string url)
    {
        if (!Manifests.TryGetValue(id, out var m) || !m.Permissions.Contains("internet") || !StateOf(id).Internet)
        {
            return false;
        }

        var h = HostOf(url);
        if (url.StartsWith("https://", StringComparison.Ordinal) && HostMatches(h, m.Hosts))
        {
            return true;
        }

        // an admin typed these addresses: a server at home often has no https
        return m.HostsFromSettings && Regex.IsMatch(url, "^https?://") && HostMatches(h, SettingsHosts(m));
    }

    // --- running -------------------------------------------------------------------------------

    public void Log(string id, string msg)
    {
        var l = _logs.GetOrAdd(id, _ => []);
        lock (l)
        {
            l.Add(DateTime.Now.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + " " + msg);
            if (l.Count > 200)
            {
                l.RemoveRange(0, l.Count - 200);
            }
        }
    }

    public string[] LogOf(string id)
    {
        if (!_logs.TryGetValue(id, out var l))
        {
            return [];
        }

        lock (l)
        {
            return [.. l];
        }
    }

    private Sandbox? SandboxOf(string id)
    {
        if (_running.TryGetValue(id, out var r))
        {
            return r;
        }

        if (!Manifests.TryGetValue(id, out var m) || !StateOf(id).Enabled)
        {
            return null;
        }

        try
        {
            var sb = Sandbox.Load(id, File.ReadAllText(Path.Combine(m.Dir, m.Main)), msg => Log(id, msg));
            _running[id] = sb;
            _log.LogInformation("Korie: loaded add-on {Id} {Version}", id, m.Version);
            return sb;
        }
        catch (Exception e) when (e is IOException or AddonException or InvalidOperationException or MoonSharp.Interpreter.InterpreterException)
        {
            Log(id, "failed to load: " + e.Message);
            _log.LogWarning("Korie: add-on {Id} failed to load: {Message}", id, e.Message);
            return null;
        }
    }

    public bool Has(string id, string fn) => SandboxOf(id)?.Has(fn) ?? false;

    /// <summary>Calls an add-on function and follows its fetch requests to the answer.</summary>
    public async Task<JsonNode?> Call(string id, string fn, params JsonNode?[] args)
    {
        var sb = SandboxOf(id) ?? throw new AddonException((Manifests.TryGetValue(id, out var m) ? m.Name : id) + " isn't running");
        JsonNode? res;
        try
        {
            res = await sb.Call(fn, args).ConfigureAwait(false);
        }
        catch (AddonException e)
        {
            Log(id, fn + "(): " + e.Message);
            throw;
        }

        for (var step = 0; res is JsonObject o && o["fetch"] is not null && o["next"] is not null; step++)
        {
            if (step >= MaxSteps)
            {
                throw new AddonException("the add-on asked for too many things in a row");
            }

            var many = o["fetch"] is JsonArray;
            var jobs = many ? o["fetch"]!.AsArray().ToList() : [o["fetch"]];
            var failed = "";
            var answers = await Task.WhenAll(jobs.Select(async j =>
            {
                var job = j is JsonObject jo ? jo : new JsonObject { ["url"] = j?.DeepClone() };
                var url = job["url"]?.ToString() ?? "";
                if (!MayFetch(id, url))
                {
                    failed = failed.Length > 0 ? failed : "not allowed to fetch from " + (HostOf(url) is { Length: > 0 } h ? h : url);
                    Log(id, "blocked: " + url);
                    return null;
                }

                var (ok, status, text) = await Fetch(url, job["method"] ?? o["method"], o["headers"] as JsonObject, job["headers"] as JsonObject, job["body"] ?? o["body"],
                    (int)(LuaJson.Num(job["cache"]) ?? LuaJson.Num(o["cache"]) ?? 0)).ConfigureAwait(false);
                if (!ok)
                {
                    Log(id, "couldn't get " + url + " (" + (status == 0 ? text : status.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ")");
                    failed = failed.Length > 0 ? failed : status is 401 or 403
                        ? HostOf(url) + " says the user name or password is wrong (" + status + ")"
                        : "couldn't get " + HostOf(url) + " (" + (status == 0 ? text : status.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ")";
                    return null;
                }

                if ((job["as"] ?? o["as"])?.ToString() == "text")
                {
                    return JsonValue.Create(text);
                }

                try
                {
                    return JsonNode.Parse(text);
                }
                catch (JsonException)
                {
                    failed = failed.Length > 0 ? failed : HostOf(url) + " didn't answer with JSON";
                    return null;
                }
            })).ConfigureAwait(false);
            if (!many && answers[0] is null)
            {
                throw new AddonException(failed);
            }

            var next = o["next"]!.ToString();
            try
            {
                res = await sb.Call(next, many ? new JsonArray(answers.Select(a => a?.DeepClone()).ToArray()) : answers[0], o["state"]?.DeepClone()).ConfigureAwait(false);
            }
            catch (AddonException e)
            {
                Log(id, next + "(): " + e.Message);
                throw;
            }
        }

        return res;
    }

    private async Task<(bool Ok, int Status, string Text)> Fetch(string url, JsonNode? method, JsonObject? headers, JsonObject? jobHeaders, JsonNode? body, int cacheSeconds)
    {
        var verb = method?.ToString() is { Length: > 0 } mv ? mv.ToUpperInvariant() : "GET";
        var key = verb + " " + url + " " + headers?.ToJsonString() + jobHeaders?.ToJsonString() + body?.ToJsonString();
        if (cacheSeconds > 0 && _fetchCache.TryGetValue(key, out var hit) && hit.Until > DateTime.UtcNow)
        {
            return (true, 200, hit.Text);
        }

        using var req = new HttpRequestMessage(new HttpMethod(verb), url);
        foreach (var h in new[] { headers, jobHeaders })
        {
            foreach (var (k, v) in h ?? [])
            {
                if (v is not null && !k.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    req.Headers.TryAddWithoutValidation(k, v.ToString());
                }
            }
        }

        if (body is not null)
        {
            var isText = body.GetValueKind() == JsonValueKind.String;
            var type = (jobHeaders?["Content-Type"] ?? headers?["Content-Type"])?.ToString() ?? (isText ? "text/plain" : "application/json");
            req.Content = new StringContent(isText ? body.GetValue<string>() : body.ToJsonString(), Encoding.UTF8);
            req.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
        }

        try
        {
            using var r = await Http.SendAsync(req).ConfigureAwait(false);
            var text = await r.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!r.IsSuccessStatusCode)
            {
                return (false, (int)r.StatusCode, text);
            }

            if (cacheSeconds > 0)
            {
                _fetchCache[key] = (DateTime.UtcNow.AddSeconds(cacheSeconds), text);
            }

            return (true, (int)r.StatusCode, text);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return (false, 0, e is TaskCanceledException ? "no answer in time" : e.Message);
        }
    }
}
