using System.Text.RegularExpressions;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Controller.Resolvers;
using MediaBrowser.Model.IO;

namespace Korie.Jellyfin.Library;

/// <summary>
/// One film in several files ("CD 1.avi", "CD 2.avi", "Film - Part 2.mkv"): one film with the other files
/// as its parts. Jellyfin's own stacking needs a film name before "cd1"; this doesn't.
/// </summary>
public partial class PartsResolver : IItemResolver, IMultiItemResolver
{
    public ResolverPriority Priority => ResolverPriority.Plugin;

    public BaseItem? ResolvePath(ItemResolveArgs args) => null;

    [GeneratedRegex(@"^(?<stem>.*?)[\s._-]*(?:cd|dvd|part|pt|disc|disk)[\s._-]*(?<n>\d{1,2})(?<rest>.*)$", RegexOptions.IgnoreCase)]
    private static partial Regex Part();

    private static readonly HashSet<string> Video = new(StringComparer.OrdinalIgnoreCase)
        { ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts", ".webm", ".mpg", ".mpeg", ".vob", ".flv" };

    public MultiItemResolverResult ResolveMultiple(Folder parent, List<FileSystemMetadata> files, CollectionType? collectionType, IDirectoryService directoryService)
    {
        var result = new MultiItemResolverResult();
        if (collectionType != CollectionType.movies) return result;
        var groups = files.Where(f => !f.IsDirectory && Video.Contains(Path.GetExtension(f.Name)))
            .Select(f => (File: f, M: Part().Match(Path.GetFileNameWithoutExtension(f.Name))))
            .Where(x => x.M.Success)
            .GroupBy(x => (x.M.Groups["stem"].Value.Trim().ToLowerInvariant(), x.M.Groups["rest"].Value.ToLowerInvariant(), Path.GetExtension(x.File.Name).ToLowerInvariant()))
            .Where(g => g.Count() > 1)
            .ToList();
        if (groups.Count == 0) return result;
        var used = new HashSet<string>();
        foreach (var g in groups)
        {
            var parts = g.OrderBy(x => int.Parse(x.M.Groups["n"].Value)).Select(x => x.File).ToList();
            var stem = g.First().M.Groups["stem"].Value.Trim(' ', '-', '_', '.');
            result.Items.Add(new Movie
            {
                Path = parts[0].FullName,
                AdditionalParts = parts.Skip(1).Select(p => p.FullName).ToArray(),
                // no name before "CD 1": the folder's name is the film's
                Name = stem.Length > 0 ? stem : Path.GetFileName(Path.GetDirectoryName(parts[0].FullName)) ?? parts[0].Name,
            });
            foreach (var p in parts) used.Add(p.FullName);
        }
        result.ExtraFiles.AddRange(files.Where(f => !used.Contains(f.FullName)));
        return result;
    }
}
