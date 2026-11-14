using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Korie.Jellyfin;

/// <summary>Korie's settings, kept by Jellyfin.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Where add-ons come from: each address holds an index.json (the Korie Store first).</summary>
    public string[] Repositories { get; set; } = [Paths.DefaultStore];
}

/// <summary>Korie for Jellyfin: reads libraries the way they are laid out, and adds Korie's add-ons.</summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static Plugin? Instance { get; private set; }

    public Plugin(IApplicationPaths paths, IXmlSerializer xml) : base(paths, xml)
    {
        Instance = this;
    }

    public override string Name => "Korie";

    public override Guid Id => Guid.Parse("6b0b6a2e-3f0e-4c2a-9a4e-6f2b7e5d1c11");

    public override string Description => "Libraries read the way your folders are laid out, and add-ons (DRTV, Stremio, RomM ...) from the Korie Store.";

    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = "Korie",
            DisplayName = "Korie",
            EmbeddedResourcePath = GetType().Namespace + ".Web.korie.html",
            EnableInMainMenu = true,
            MenuIcon = "extension",
        },
        new PluginPageInfo { Name = "korie.js", EmbeddedResourcePath = GetType().Namespace + ".Web.korie.js" },
    ];
}

/// <summary>Where Korie keeps things: next to Jellyfin's plugins folder, so updates of the plugin keep them.</summary>
public static class Paths
{
    public const string DefaultStore = "https://raw.githubusercontent.com/MightyX3N/Korie-Store/main/";

    /// <summary>Jellyfin's data folder (the plugins folder's parent), found from where this plugin was loaded.</summary>
    public static string Data { get; } = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(typeof(Paths).Assembly.Location)!, "..", "..", "korie"));

    public static string Addons => Path.Combine(Data, "addons");

    public static string Cache => Path.Combine(Data, "cache");

    public static string State => Path.Combine(Data, "state.json");
}
