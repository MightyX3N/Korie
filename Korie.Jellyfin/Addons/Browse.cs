using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace Korie.Jellyfin.Addons;

public sealed class AItem
{
    public string Id { get; set; } = "";
    public string Source { get; set; } = "";
    public string SourceId { get; set; } = "";
    public string Kind { get; set; } = "film";
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public string Year { get; set; } = "";
    public double Runtime { get; set; }
    public string Overview { get; set; } = "";
    public string Poster { get; set; } = "";
    public string Backdrop { get; set; } = "";
    public string Thumb { get; set; } = "";
    public List<string> Genres { get; set; } = [];
    public double Rating { get; set; }
    public string Director { get; set; } = "";
    public List<string[]> Cast { get; set; } = [];
    public JsonNode? Data { get; set; }
    public string? Series { get; set; }
    public int Season { get; set; }
    public int Episode { get; set; }
    public List<ASeason>? Seasons { get; set; }
}

public sealed class ASeason
{
    public int N { get; set; }
    public string Title { get; set; } = "";
    public List<AItem> Episodes { get; set; } = [];
}

public sealed class ARow
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public List<AItem> Items { get; set; } = [];
}

public sealed class APage
{
    public DateTime At { get; set; }
    public string Title { get; set; } = "";
    public string Error { get; set; } = "";
    public List<ARow> Rows { get; set; } = [];
}

public sealed class PlayAnswer
{
    public string Url { get; set; } = "";
    public string Web { get; set; } = "";
    public bool Live { get; set; }
    public Dictionary<string, string> Headers { get; set; } = [];
    public List<(string Url, string Title, string Language, bool Default)> Subtitles { get; set; } = [];
}

/// <summary>
/// What add-ons offer: rows for Home, Films, Series and Games, channels for Live TV, pages
/// (categories), search, a series' seasons, and where something plays from.
/// Every add-on is asked for its rows when Jellyfin starts and every half hour after; the answer is
/// kept on disk, so nobody waits for an add-on when opening it. Everything an add-on returns is
/// checked here: things with the wrong shape are left out (and noted in its log).
/// </summary>
public sealed partial class Browse
{
    public static readonly string[] Sections = ["home", "films", "series", "live", "games"];
    private static readonly HashSet<string> Kinds = ["film", "series", "episode", "live", "page", "game"];
    private static readonly TimeSpan Fresh = TimeSpan.FromMinutes(30);

    private readonly AddonManager _addons;
    private readonly ILogger<Browse> _log;
    private readonly ConcurrentDictionary<string, AItem> _items = new();
    private readonly ConcurrentDictionary<string, (DateTime At, Dictionary<string, List<ARow>> Rows, string Error)> _sections = new();
    private readonly ConcurrentDictionary<string, Task> _refreshing = new();
    private readonly ConcurrentDictionary<string, APage> _pages = new();

    public Browse(AddonManager addons, ILogger<Browse> log)
    {
        _addons = addons;
        _log = log;
        Directory.CreateDirectory(Paths.Cache);
        LoadItems();
        foreach (var id in _addons.Manifests.Keys)
        {
            LoadSections(id);
        }
    }

    // --- checking what add-ons send ---------------------------------------------------------

    private static string S(JsonNode? v, int max = 2000)
    {
        var t = v?.GetValueKind() switch
        {
            JsonValueKind.String => v.GetValue<string>(),
            JsonValueKind.Number => v.ToString(),
            _ => "",
        };
        return t.Length > max ? t[..max] : t;
    }

    private static double N(JsonNode? v) =>
        LuaJson.Num(v) is { } num ? num
        : double.TryParse(S(v), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;

    /// <summary>A Lua list; an empty table or one with holes can arrive as an object.</summary>
    private static List<JsonNode?> L(JsonNode? v) => v switch
    {
        JsonArray a => [.. a],
        JsonObject o => o.Where(p => int.TryParse(p.Key, out _)).OrderBy(p => int.Parse(p.Key, System.Globalization.CultureInfo.InvariantCulture)).Select(p => p.Value).ToList(),
        _ => [],
    };

    [GeneratedRegex("^https?://")]
    private static partial Regex Web();

    private static string Url(JsonNode? v)
    {
        var x = S(v, 4000);
        return Web().IsMatch(x) ? x : "";
    }

    private AItem? Item(string aid, JsonNode? raw)
    {
        if (raw is not JsonObject r)
        {
            return null;
        }

        var sid = S(r["id"], 500);
        if (sid.Length == 0)
        {
            return null;
        }

        var kind = Kinds.Contains(S(r["kind"])) ? S(r["kind"]) : "film";
        var it = new AItem
        {
            Id = aid + "/" + sid, Source = aid, SourceId = sid, Kind = kind, Title = S(r["title"], 300) is { Length: > 0 } t ? t : "Untitled",
            Subtitle = S(r["subtitle"], 300), Year = S(r["year"], 10), Runtime = N(r["runtime"]), Overview = S(r["overview"], 5000),
            Poster = Url(r["poster"]), Backdrop = Url(r["backdrop"]), Thumb = Url(r["thumb"]) is { Length: > 0 } th ? th : Url(r["still"]),
            Genres = L(r["genres"]).Select(g => S(g, 60)).Where(g => g.Length > 0).Take(10).ToList(),
            Rating = N(r["rating"]), Director = S(r["director"], 200),
            Cast = L(r["cast"]).Select(c => c is JsonArray a ? new[] { S(a.Count > 0 ? a[0] : null, 100), S(a.Count > 1 ? a[1] : null, 100) } : new[] { S(c?["name"], 100), S(c?["role"], 100) })
                .Where(c => c[0].Length > 0).Take(12).ToList(),
            Data = r["data"]?.DeepClone(),
        };
        if (kind == "episode" && r["series"] is not null)
        {
            it.Series = aid + "/" + S(r["series"], 500);
        }

        if (_items.TryGetValue(it.Id, out var old) && old.Seasons is not null)
        {
            it.Seasons = old.Seasons; // keep what's known already
        }

        _items[it.Id] = it;
        _itemsDirty = true;
        return it;
    }

    private List<ARow> Rows(string aid, JsonNode? v, string from)
    {
        var o = new List<ARow>();
        var i = 0;
        foreach (var r in L(v))
        {
            i++;
            if (r is not JsonObject ro)
            {
                _addons.Log(aid, from + ": row " + i + " isn't a table, left out");
                continue;
            }

            var its = L(ro["items"]).Select(x => Item(aid, x)).OfType<AItem>().ToList();
            if (its.Count > 0)
            {
                o.Add(new ARow { Id = S(ro["id"]) is { Length: > 0 } id ? id : S(ro["title"]) is { Length: > 0 } tt ? tt : i.ToString(System.Globalization.CultureInfo.InvariantCulture), Title = S(ro["title"], 200), Items = its });
            }
        }

        return o;
    }

    private Dictionary<string, List<ARow>> SectionsFrom(string aid, JsonNode? res)
    {
        var o = new Dictionary<string, List<ARow>>();
        foreach (var k in Sections)
        {
            if (k == "live")
            {
                var its = L(res?["live"]).Select(x => Item(aid, x)).OfType<AItem>().ToList();
                o[k] = its.Count > 0 ? [new ARow { Id = "live", Title = _addons.Manifests.TryGetValue(aid, out var m) ? m.Name : aid, Items = its }] : [];
            }
            else
            {
                o[k] = Rows(aid, res?[k], "browse()." + k);
            }
        }

        return o;
    }

    // --- kept on disk -----------------------------------------------------------------------

    private static string File(string key) => Path.Combine(Paths.Cache, Regex.Replace(key, "[^a-zA-Z0-9._-]", "_") + ".json");

    private void LoadSections(string aid)
    {
        try
        {
            var saved = JsonNode.Parse(System.IO.File.ReadAllText(File("browse-" + aid)))!;
            var at = DateTimeOffset.FromUnixTimeMilliseconds((long)N(saved["at"])).UtcDateTime;
            _sections[aid] = (at, SectionsFrom(aid, saved["res"]), "");
        }
        catch (Exception e) when (e is IOException or JsonException or NullReferenceException)
        {
            // first time
        }
    }

    private volatile bool _itemsDirty;

    private void LoadItems()
    {
        try
        {
            var list = JsonSerializer.Deserialize<List<AItem>>(System.IO.File.ReadAllText(File("items")));
            foreach (var it in list ?? [])
            {
                _items[it.Id] = it;
            }
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            // first time
        }
    }

    /// <summary>Items are remembered, so something Jellyfin listed earlier still opens and plays after a restart.</summary>
    public void SaveItems()
    {
        if (!_itemsDirty)
        {
            return;
        }

        _itemsDirty = false;
        var tmp = File("items") + ".tmp";
        System.IO.File.WriteAllText(tmp, JsonSerializer.Serialize(_items.Values.ToList()));
        System.IO.File.Move(tmp, File("items"), true);
    }

    // --- sections --------------------------------------------------------------------------

    /// <summary>Asks the add-on for fresh rows in the background when the kept ones are old.</summary>
    public Task Refresh(string aid, bool force = false)
    {
        var have = _sections.TryGetValue(aid, out var st);
        if (!force && have && DateTime.UtcNow - st.At < Fresh)
        {
            return Task.CompletedTask;
        }

        return _refreshing.GetOrAdd(aid, key => Task.Run(async () =>
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                if (!_addons.Has(aid, "browse"))
                {
                    _sections[aid] = (DateTime.UtcNow, [], "");
                    return;
                }

                var res = await _addons.Call(aid, "browse", _addons.Ctx(aid)).ConfigureAwait(false);
                if (res is JsonObject o && o["error"] is null)
                {
                    var now = DateTime.UtcNow;
                    _sections[aid] = (now, SectionsFrom(aid, res), "");
                    System.IO.File.WriteAllText(File("browse-" + aid), new JsonObject { ["at"] = new DateTimeOffset(now).ToUnixTimeMilliseconds(), ["res"] = res.DeepClone() }.ToJsonString());
                    SaveItems();
                    _log.LogInformation("Korie: {Id} fresh rows in {Ms} ms", aid, clock.ElapsedMilliseconds);
                }
                else
                {
                    Keep(aid, S(res?["error"]) is { Length: > 0 } err ? err : "nothing came back");
                }
            }
            catch (AddonException e)
            {
                Keep(aid, e.Message);
                _log.LogWarning("Korie: {Id}: {Message}", aid, e.Message);
            }
            finally
            {
                _refreshing.TryRemove(aid, out _);
            }
        }));
    }

    private void Keep(string aid, string error) =>
        _sections[aid] = _sections.TryGetValue(aid, out var old) ? (DateTime.UtcNow, old.Rows, error) : (DateTime.UtcNow, [], error);

    /// <summary>An add-on's rows: the kept ones at once (fresh ones on the way if they're old). Waits only the very first time.</summary>
    public async Task<(Dictionary<string, List<ARow>> Rows, string Error)> SectionsOf(string aid)
    {
        var job = Refresh(aid);
        if (!_sections.ContainsKey(aid))
        {
            await job.ConfigureAwait(false);
        }

        return _sections.TryGetValue(aid, out var st) ? (st.Rows, st.Error) : ([], "");
    }

    public void Forget(string aid)
    {
        _sections.TryRemove(aid, out _);
        try
        {
            System.IO.File.Delete(File("browse-" + aid));
        }
        catch (IOException)
        {
            // none
        }
    }

    /// <summary>Changes whenever the add-on's rows do (so Jellyfin asks again exactly then).</summary>
    public string Stamp(string aid) => _sections.TryGetValue(aid, out var st) ? st.At.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture) : "none";

    public AItem? Get(string id) => _items.TryGetValue(id, out var it) ? it : null;

    private static JsonObject Ref(AItem it) => new()
    {
        ["id"] = it.SourceId, ["kind"] = it.Kind, ["title"] = it.Title, ["data"] = it.Data?.DeepClone(),
    };

    // --- pages (an add-on's categories) -----------------------------------------------------

    public async Task<APage> Page(string id)
    {
        var it = Get(id);
        if (it is null)
        {
            return new APage { Error = "This page isn't known any more. Go back and open it again." };
        }

        if (_pages.TryGetValue(id, out var p) && DateTime.UtcNow - p.At < Fresh)
        {
            return p;
        }

        try
        {
            var res = await _addons.Call(it.Source, "page", Ref(it), _addons.Ctx(it.Source)).ConfigureAwait(false);
            var fresh = new APage { At = DateTime.UtcNow, Error = S(res?["error"]), Title = S(res?["title"]) is { Length: > 0 } t ? t : it.Title, Rows = Rows(it.Source, res?["rows"], "page()") };
            _pages[id] = fresh;
            SaveItems();
            return fresh;
        }
        catch (AddonException e)
        {
            return p ?? new APage { Title = it.Title, Error = e.Message }; // old rows beat an error
        }
    }

    // --- search -----------------------------------------------------------------------------

    public async Task<List<AItem>> Search(string aid, string q)
    {
        if (!_addons.Has(aid, "search"))
        {
            return [];
        }

        var res = await _addons.Call(aid, "search", JsonValue.Create(q), _addons.Ctx(aid)).ConfigureAwait(false);
        return L(res?["items"]).Select(x => Item(aid, x)).OfType<AItem>().ToList();
    }

    // --- a series' seasons ------------------------------------------------------------------

    public async Task<AItem> Open(string id)
    {
        var it = Get(id) ?? throw new AddonException("This isn't known any more. Go back and open it again.");
        if (it.Seasons is { Count: > 0 })
        {
            return it;
        }

        var res = await _addons.Call(it.Source, "open", Ref(it), _addons.Ctx(it.Source)).ConfigureAwait(false);
        if (S(res?["error"]) is { Length: > 0 } err)
        {
            throw new AddonException(err);
        }

        if (it.Overview.Length == 0)
        {
            it.Overview = S(res?["overview"], 5000);
        }

        if (it.Poster.Length == 0)
        {
            it.Poster = Url(res?["poster"]);
        }

        if (it.Backdrop.Length == 0)
        {
            it.Backdrop = Url(res?["backdrop"]);
        }

        var i = 0;
        it.Seasons = L(res?["seasons"]).Select(sn =>
        {
            i++;
            var num = sn?["n"] is null ? i : (int)N(sn["n"]);
            var eps = L(sn?["episodes"]).Select(e =>
            {
                if (e is not JsonObject eo)
                {
                    return null;
                }

                var copy = (JsonObject)eo.DeepClone();
                copy["kind"] = "episode";
                copy["series"] = it.SourceId;
                var ep = Item(it.Source, copy);
                if (ep is not null)
                {
                    ep.Season = num;
                    ep.Episode = (int)N(eo["n"]);
                }

                return ep;
            }).OfType<AItem>().ToList();
            return new ASeason { N = num, Title = S(sn?["title"], 100), Episodes = eps };
        }).Where(x => x.Episodes.Count > 0).ToList();
        _itemsDirty = true;
        SaveItems();
        return it;
    }

    // --- where it plays from ----------------------------------------------------------------

    public async Task<PlayAnswer> Play(string id)
    {
        var it = Get(id) ?? throw new AddonException("This isn't known any more. Go back and open it again.");
        var res = await _addons.Call(it.Source, "play", Ref(it), _addons.Ctx(it.Source)).ConfigureAwait(false) as JsonObject
            ?? throw new AddonException("the add-on gave no answer");
        if (S(res["error"]) is { Length: > 0 } err)
        {
            throw new AddonException(err);
        }

        if (Url(res["web"]) is { Length: > 0 } web)
        {
            return new PlayAnswer { Web = web };
        }

        var url = Url(res["url"]);
        if (url.Length == 0)
        {
            throw new AddonException("the add-on gave no address to play");
        }

        var answer = new PlayAnswer { Url = url, Live = res["live"]?.GetValueKind() == JsonValueKind.True || it.Kind == "live" };
        foreach (var x in L(res["subtitles"]))
        {
            if (Url(x?["url"]) is { Length: > 0 } su)
            {
                answer.Subtitles.Add((su, S(x?["title"], 100), S(x?["language"], 20), x?["default"]?.GetValueKind() == JsonValueKind.True));
            }
        }

        if (res["headers"] is JsonObject h)
        {
            foreach (var (k, v) in h)
            {
                if (v?.GetValueKind() == JsonValueKind.String)
                {
                    answer.Headers[k] = v.GetValue<string>();
                }
            }
        }

        return answer;
    }
}
