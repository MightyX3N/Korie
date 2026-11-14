using System.Text.RegularExpressions;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Resolvers;

namespace Korie.Jellyfin.Library;

/// <summary>
/// In a TV library, a folder that only holds other shows ("TV/Danish/Matador/Season 1") is a group,
/// not a series: it becomes a plain folder, so Jellyfin reads the shows inside it as series.
/// </summary>
public partial class GroupFolderResolver : IItemResolver
{
    public ResolverPriority Priority => ResolverPriority.Plugin;

    [GeneratedRegex(@"^(season|series|staffel|sæson|saeson|saison|sezon|temporada|s)[\s._-]*\d{1,3}(\D.*)?$|^specials?$", RegexOptions.IgnoreCase)]
    private static partial Regex SeasonDir();

    [GeneratedRegex(@"s\d{1,3}[\s._-]*e\d{1,3}|\b\d{1,2}x\d{2,3}\b|^(e|ep|episode)?[\s._-]*\d{1,3}\b", RegexOptions.IgnoreCase)]
    private static partial Regex EpisodeName();

    private static readonly HashSet<string> Video = new(StringComparer.OrdinalIgnoreCase)
        { ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts", ".webm", ".mpg", ".mpeg", ".iso", ".vob", ".flv" };

    public BaseItem? ResolvePath(ItemResolveArgs args)
    {
        if (!args.IsDirectory || args.GetCollectionType() != CollectionType.tvshows) return null;
        if (args.Parent is null || args.Parent.IsRoot || args.HasParent<Series>() || args.HasParent<Season>()) return null;
        if (LooksLikeShow(args.FileSystemChildren.Select(f => (f.Name, f.IsDirectory)))) return null;
        // a group only if some folder inside it is a show
        var hasShow = args.FileSystemChildren.Where(f => f.IsDirectory).Any(d =>
            LooksLikeShow(Entries(d.FullName)));
        if (!hasShow) return null;
        return new Folder { Path = args.Path, Name = Path.GetFileName(args.Path) };
    }

    private static IEnumerable<(string Name, bool IsDir)> Entries(string dir)
    {
        try
        {
            return new DirectoryInfo(dir).EnumerateFileSystemInfos().Select(i => (i.Name, i is DirectoryInfo)).ToList();
        }
        catch (IOException) { return []; }
        catch (UnauthorizedAccessException) { return []; }
    }

    private static bool LooksLikeShow(IEnumerable<(string Name, bool IsDir)> entries)
    {
        foreach (var (name, isDir) in entries)
        {
            if (isDir && SeasonDir().IsMatch(name)) return true;
            if (!isDir && name.Equals("tvshow.nfo", StringComparison.OrdinalIgnoreCase)) return true;
            if (!isDir && Video.Contains(Path.GetExtension(name)) && EpisodeName().IsMatch(Path.GetFileNameWithoutExtension(name))) return true;
        }
        return false;
    }
}
