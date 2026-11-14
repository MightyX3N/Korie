using System.Text.Json.Nodes;
using Korie.Jellyfin.Addons;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Korie.Jellyfin.Api;

/// <summary>Korie's add-ons, Store and repositories, for the Korie page in Jellyfin's dashboard. Admins only.</summary>
[ApiController]
[Route("Korie")]
[Authorize(Policy = "RequiresElevation")]
public class KorieController(AddonManager addons, Browse browse, Store store) : ControllerBase
{
    /// <summary>Add-ons that were channels when Jellyfin started: others need a restart to show up.</summary>
    internal static HashSet<string> ChannelsAtStart { get; } = [];

    [HttpGet("Addons")]
    public async Task<ActionResult<JsonObject>> Installed()
    {
        var (entries, _) = await store.Index().ConfigureAwait(false);
        var list = new JsonArray();
        foreach (var m in addons.Manifests.Values.OrderBy(m => m.Name, StringComparer.OrdinalIgnoreCase))
        {
            var st = addons.StateOf(m.Id);
            var e = entries.FirstOrDefault(x => x["id"]!.ToString() == m.Id);
            var values = addons.SettingsOf(m.Id);
            // passwords never leave the server: only whether one is set
            foreach (var s in m.Settings.OfType<JsonObject>().Where(s => s["type"]?.ToString() == "password"))
            {
                var key = s["key"]!.ToString();
                values[key] = values[key]?.ToString() is { Length: > 0 } ? "••••••••" : "";
            }

            list.Add(new JsonObject
            {
                ["id"] = m.Id, ["name"] = m.Name, ["version"] = m.Version, ["author"] = m.Author, ["description"] = m.Description,
                ["enabled"] = st.Enabled, ["internet"] = st.Internet, ["needsInternet"] = m.Permissions.Contains("internet"),
                ["hosts"] = new JsonArray(m.Hosts.Select(h => (JsonNode?)JsonValue.Create(h)).ToArray()),
                ["settings"] = m.Settings.DeepClone(), ["values"] = values,
                ["update"] = e is not null && Store.Newer(e["version"]?.ToString() ?? "", m.Version) ? e["version"]!.ToString() : null,
                ["restartNeeded"] = !ChannelsAtStart.Contains(m.Id),
                ["log"] = new JsonArray(addons.LogOf(m.Id).TakeLast(30).Select(l => (JsonNode?)JsonValue.Create(l)).ToArray()),
            });
        }

        return new JsonObject { ["addons"] = list };
    }

    [HttpGet("Store")]
    public async Task<ActionResult<JsonObject>> StoreList([FromQuery] bool refresh = false)
    {
        var (entries, errors) = await store.Index(refresh).ConfigureAwait(false);
        var list = new JsonArray();
        foreach (var e in entries)
        {
            var copy = (JsonObject)e.DeepClone();
            copy.Remove("files");
            var id = e["id"]!.ToString();
            copy["installed"] = addons.Manifests.TryGetValue(id, out var m) ? m.Version : null;
            list.Add(copy);
        }

        return new JsonObject
        {
            ["addons"] = list,
            ["errors"] = new JsonArray(errors.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()),
            ["repositories"] = new JsonArray(Store.Repositories.Select(r => (JsonNode?)JsonValue.Create(r)).ToArray()),
        };
    }

    [HttpPost("Store/{id}/Install")]
    public async Task<ActionResult<JsonObject>> Install(string id)
    {
        var err = await store.Install(id).ConfigureAwait(false);
        return new JsonObject { ["ok"] = err.Length == 0, ["error"] = err, ["restartNeeded"] = !ChannelsAtStart.Contains(id) };
    }

    [HttpPost("Addons/{id}/Remove")]
    public ActionResult<JsonObject> Remove(string id)
    {
        store.Uninstall(id);
        return new JsonObject { ["ok"] = true };
    }

    [HttpPost("Addons/{id}/Enable")]
    public ActionResult<JsonObject> Enable(string id, [FromQuery] bool internet = false)
    {
        var err = addons.Enable(id, internet);
        if (err.Length == 0)
        {
            _ = browse.Refresh(id, true);
        }

        return new JsonObject { ["ok"] = err.Length == 0, ["error"] = err };
    }

    [HttpPost("Addons/{id}/Disable")]
    public ActionResult<JsonObject> Disable(string id)
    {
        addons.Disable(id);
        return new JsonObject { ["ok"] = true };
    }

    [HttpPost("Addons/{id}/Settings")]
    public ActionResult<JsonObject> Setting(string id, [FromBody] JsonObject body)
    {
        var ok = addons.SetSetting(id, body["key"]?.ToString() ?? "", body["value"]?.DeepClone());
        if (ok)
        {
            browse.Forget(id);
            _ = browse.Refresh(id, true);
        }

        return new JsonObject { ["ok"] = ok, ["error"] = ok ? "" : "That setting can't take that value." };
    }

    [HttpPost("Addons/{id}/Refresh")]
    public async Task<ActionResult<JsonObject>> Refresh(string id)
    {
        await browse.Refresh(id, true).ConfigureAwait(false);
        var (_, error) = await browse.SectionsOf(id).ConfigureAwait(false);
        return new JsonObject { ["ok"] = error.Length == 0, ["error"] = error };
    }

    [HttpPost("Repositories")]
    public async Task<ActionResult<JsonObject>> SetRepositories([FromBody] JsonObject body)
    {
        var plugin = Plugin.Instance!;
        var list = (body["repositories"] as JsonArray ?? [])
            .Select(x => x?.ToString().Trim() ?? "")
            .Where(x => Uri.TryCreate(x, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http"))
            .Distinct().ToArray();
        plugin.Configuration.Repositories = list.Length > 0 ? list : [Paths.DefaultStore];
        plugin.SaveConfiguration();
        await store.Index(true).ConfigureAwait(false);
        return new JsonObject { ["ok"] = true };
    }
}
