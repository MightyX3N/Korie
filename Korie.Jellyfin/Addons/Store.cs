using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace Korie.Jellyfin.Addons;

/// <summary>
/// Add-ons from repositories: each repository is an address with an index.json listing its add-ons,
/// their files and each file's sha256 (the Korie Store's format). Installing downloads the files
/// into Korie's add-ons folder, checking every one.
/// </summary>
public sealed class Store(AddonManager addons, Browse browse, ILogger<Store> log)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly SemaphoreSlim _busy = new(1, 1);
    private (DateTime At, List<JsonObject> Entries, List<string> Errors) _index = (DateTime.MinValue, [], []);

    public static string[] Repositories => Plugin.Instance?.Configuration.Repositories is { Length: > 0 } r ? r : [Paths.DefaultStore];

    private static string Base(string repo) => repo.EndsWith('/') ? repo : repo + "/";

    /// <summary>Every repository's add-ons (kept for 5 minutes), each marked with the repository it came from.</summary>
    public async Task<(List<JsonObject> Entries, List<string> Errors)> Index(bool force = false)
    {
        if (!force && DateTime.UtcNow - _index.At < TimeSpan.FromMinutes(5))
        {
            return (_index.Entries, _index.Errors);
        }

        var entries = new List<JsonObject>();
        var errors = new List<string>();
        foreach (var repo in Repositories)
        {
            try
            {
                var text = await Http.GetStringAsync(Base(repo) + "index.json?t=" + DateTime.UtcNow.Ticks / TimeSpan.FromMinutes(5).Ticks).ConfigureAwait(false);
                var list = JsonNode.Parse(text)?["addons"] as JsonArray ?? throw new JsonException("no add-on list");
                foreach (var e in list.OfType<JsonObject>())
                {
                    if (e["id"]?.GetValueKind() == JsonValueKind.String && e["files"] is JsonArray && entries.All(x => x["id"]!.ToString() != e["id"]!.ToString()))
                    {
                        var copy = (JsonObject)e.DeepClone();
                        copy["repository"] = Base(repo);
                        entries.Add(copy);
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                errors.Add("Couldn't read " + repo + " (" + ex.Message + ")");
            }
        }

        _index = (DateTime.UtcNow, entries, errors);
        return (entries, errors);
    }

    public static bool Newer(string a, string b)
    {
        var pa = a.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var pb = b.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        for (var i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            var x = i < pa.Length ? pa[i] : 0;
            var y = i < pb.Length ? pb[i] : 0;
            if (x != y)
            {
                return x > y;
            }
        }

        return false;
    }

    /// <summary>Installs (or updates) an add-on; "" when it went well, otherwise why not.</summary>
    public async Task<string> Install(string id)
    {
        var (entries, _) = await Index().ConfigureAwait(false);
        var e = entries.FirstOrDefault(x => x["id"]!.ToString() == id);
        if (e is null)
        {
            return "No repository has this add-on.";
        }

        await _busy.WaitAsync().ConfigureAwait(false);
        var tmp = Path.Combine(Paths.Addons, ".download-" + id);
        try
        {
            if (Directory.Exists(tmp))
            {
                Directory.Delete(tmp, true);
            }

            Directory.CreateDirectory(tmp);
            var root = e["repository"]!.ToString() + (e["path"]?.ToString() is { Length: > 0 } p ? p : "addons/" + id) + "/";
            foreach (var f in e["files"]!.AsArray().OfType<JsonObject>())
            {
                var name = f["name"]?.ToString() ?? "";
                if (name.Length == 0 || name.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(name) || name.Contains('\\', StringComparison.Ordinal))
                {
                    return "The repository lists a file Korie won't write (" + name + ").";
                }

                var bytes = await Http.GetByteArrayAsync(root + string.Join('/', name.Split('/').Select(Uri.EscapeDataString))).ConfigureAwait(false);
                var sha = System.Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                if (sha != f["sha256"]?.ToString())
                {
                    return name + " isn't what the repository says it is (checksum differs).";
                }

                var target = Path.Combine(tmp, name);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await File.WriteAllBytesAsync(target, bytes).ConfigureAwait(false);
            }

            var json = Path.Combine(tmp, "addon.json");
            if (!File.Exists(json) || JsonNode.Parse(await File.ReadAllTextAsync(json).ConfigureAwait(false))?["id"]?.ToString() != id)
            {
                return "The add-on's addon.json is missing or names another add-on.";
            }

            var dest = Path.Combine(Paths.Addons, id);
            if (Directory.Exists(dest))
            {
                Directory.Delete(dest, true);
            }

            Directory.Move(tmp, dest);
            addons.Scan();
            browse.Forget(id);
            log.LogInformation("Korie: installed {Id} {Version}", id, e["version"]);
            return "";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return "Couldn't download the add-on (" + ex.Message + ").";
        }
        finally
        {
            if (Directory.Exists(tmp))
            {
                Directory.Delete(tmp, true);
            }

            _busy.Release();
        }
    }

    public void Uninstall(string id)
    {
        var dir = Path.Combine(Paths.Addons, id);
        if (addons.Manifests.ContainsKey(id) && Directory.Exists(dir))
        {
            Directory.Delete(dir, true);
        }

        addons.Forget(id);
        addons.Scan();
        browse.Forget(id);
    }
}
