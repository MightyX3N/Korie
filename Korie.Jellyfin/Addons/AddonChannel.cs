using System.Globalization;
using MediaBrowser.Controller.Channels;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Channels;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;

namespace Korie.Jellyfin.Addons;

/// <summary>
/// One add-on as a Jellyfin channel: its rows are folders, series open into seasons and episodes,
/// categories ("pages") into their own rows, and the add-on is asked where something plays from
/// only when it's played. Folder ids: "row|section|n", "page|item", "prow|item|n", "item|item", "season|item|n".
/// </summary>
public sealed class AddonChannel(string addonId, AddonManager addons, Browse browse) : IChannel, IRequiresMediaInfoCallback, IHasCacheKey
{
    private static readonly string[] Shown = ["films", "series", "home"];

    public string AddonId => addonId;

    public string Name => addons.Manifests.TryGetValue(addonId, out var m) ? m.Name : addonId;

    public string Description => addons.Manifests.TryGetValue(addonId, out var m) ? m.Description : "";

    public string DataVersion => addons.Manifests.TryGetValue(addonId, out var m) ? m.Version : "0";

    public string HomePageUrl => "";

    public ChannelParentalRating ParentalRating => ChannelParentalRating.GeneralAudience;

    public bool IsEnabledFor(string userId) => addons.IsOn(addonId);

    // changes with the add-on, its rows, and each build of this plugin
    private static readonly string Build = typeof(AddonChannel).Assembly.ManifestModule.ModuleVersionId.ToString("N")[..8];

    public string? GetCacheKey(string? userId) => Build + "|" + DataVersion + "|" + addons.IsOn(addonId) + "|" + browse.Stamp(addonId);

    public InternalChannelFeatures GetChannelFeatures() => new()
    {
        ContentTypes = [ChannelMediaContentType.Movie, ChannelMediaContentType.Episode, ChannelMediaContentType.Clip],
        MediaTypes = [ChannelMediaType.Video],
        MaxPageSize = 500,
    };

    public Task<DynamicImageResponse> GetChannelImage(ImageType type, CancellationToken cancellationToken)
    {
        var icon = addons.Manifests.TryGetValue(addonId, out var m) ? Path.Combine(m.Dir, "icon.png") : "";
        return Task.FromResult(File.Exists(icon)
            ? new DynamicImageResponse { HasImage = true, Path = icon, Protocol = MediaProtocol.File, Format = MediaBrowser.Model.Drawing.ImageFormat.Png }
            : new DynamicImageResponse { HasImage = false });
    }

    public IEnumerable<ImageType> GetSupportedChannelImages() => [ImageType.Primary];

    public async Task<ChannelItemResult> GetChannelItems(InternalChannelItemQuery query, CancellationToken cancellationToken)
    {
        var items = await Items(query.FolderId ?? "").ConfigureAwait(false);
        browse.SaveItems();
        return new ChannelItemResult { Items = items, TotalRecordCount = items.Count };
    }

    private async Task<List<ChannelItemInfo>> Items(string folder)
    {
        var parts = folder.Split('|', 3);
        try
        {
            switch (parts[0])
            {
                case "":
                    return await Root().ConfigureAwait(false);
                case "sec" when parts.Length >= 2:
                    return await SectionRows(parts[1]).ConfigureAwait(false);
                case "row" when parts.Length == 3:
                {
                    var (rows, _) = await browse.SectionsOf(addonId).ConfigureAwait(false);
                    var n = int.Parse(parts[2], CultureInfo.InvariantCulture);
                    return rows.TryGetValue(parts[1], out var list) && n < list.Count ? list[n].Items.Where(Playable).Select(Info).ToList() : [];
                }

                case "page" when parts.Length >= 2:
                {
                    var page = await browse.Page(parts[1]).ConfigureAwait(false);
                    if (page.Rows.Count == 1)
                    {
                        return page.Rows[0].Items.Where(Playable).Select(Info).ToList();
                    }

                    return page.Rows.Select((r, i) => Folder("prow|" + parts[1] + "|" + i.ToString(CultureInfo.InvariantCulture), r.Title, r.Items)).ToList();
                }

                case "prow" when parts.Length == 3:
                {
                    var page = await browse.Page(parts[1]).ConfigureAwait(false);
                    var n = int.Parse(parts[2], CultureInfo.InvariantCulture);
                    return n < page.Rows.Count ? page.Rows[n].Items.Where(Playable).Select(Info).ToList() : [];
                }

                case "item" when parts.Length >= 2:
                {
                    var series = await browse.Open(parts[1]).ConfigureAwait(false);
                    var seasons = series.Seasons ?? [];
                    if (seasons.Count == 1)
                    {
                        return seasons[0].Episodes.Select(e => EpisodeInfo(e, series)).ToList();
                    }

                    return seasons.Select(s => new ChannelItemInfo
                    {
                        Id = "season|" + series.Id + "|" + s.N.ToString(CultureInfo.InvariantCulture),
                        Name = s.Title.Length > 0 ? s.Title : "Season " + s.N.ToString(CultureInfo.InvariantCulture),
                        Type = ChannelItemType.Folder, FolderType = ChannelFolderType.Season, IndexNumber = s.N, SeriesName = series.Title,
                        ImageUrl = series.Poster.Length > 0 ? series.Poster : series.Thumb,
                    }).ToList();
                }

                case "season" when parts.Length == 3:
                {
                    var series = await browse.Open(parts[1]).ConfigureAwait(false);
                    var n = int.Parse(parts[2], CultureInfo.InvariantCulture);
                    return (series.Seasons ?? []).Where(s => s.N == n).SelectMany(s => s.Episodes).Select(e => EpisodeInfo(e, series)).ToList();
                }

                default:
                    return [];
            }
        }
        catch (AddonException e)
        {
            addons.Log(addonId, "listing " + folder + ": " + e.Message);
            return [];
        }
    }

    /// <summary>
    /// The add-on's sections: Live TV, Films and Series (Home if there's nothing else), each a folder of rows.
    /// An add-on with only one section shows its rows straight away.
    /// </summary>
    private async Task<List<ChannelItemInfo>> Root()
    {
        var (rows, _) = await browse.SectionsOf(addonId).ConfigureAwait(false);
        var o = new List<ChannelItemInfo>();
        if (rows.TryGetValue("live", out var live) && live.Count > 0)
        {
            o.Add(Folder("row|live|0", "Live TV", live[0].Items));
        }

        var sections = Shown.Where(sec => rows.TryGetValue(sec, out var l) && l.Any(r => r.Items.Any(Playable))).ToList();
        if (sections.Contains("films") || sections.Contains("series"))
        {
            sections.Remove("home"); // home rows repeat what's under Films and Series
        }

        if (sections.Count == 1 && o.Count == 0)
        {
            return await SectionRows(sections[0]).ConfigureAwait(false);
        }

        foreach (var sec in sections)
        {
            o.Add(Folder("sec|" + sec, sec switch { "films" => "Films", "series" => "Series", _ => "Featured" }, rows[sec].SelectMany(r => r.Items).ToList()));
        }

        return o;
    }

    private async Task<List<ChannelItemInfo>> SectionRows(string sec)
    {
        var (rows, _) = await browse.SectionsOf(addonId).ConfigureAwait(false);
        var list = rows.TryGetValue(sec, out var l) ? l : [];
        var o = new List<ChannelItemInfo>();
        for (var i = 0; i < list.Count; i++)
        {
            if (list[i].Items.Any(Playable))
            {
                o.Add(Folder("row|" + sec + "|" + i.ToString(CultureInfo.InvariantCulture), list[i].Title, list[i].Items));
            }
        }

        return o;
    }

    /// <summary>Games open a web page (RomM): Jellyfin can't play those, so they stay out of the channel.</summary>
    private static bool Playable(AItem it) => it.Kind != "game";

    private static ChannelItemInfo Folder(string id, string title, List<AItem> items)
    {
        var first = items.FirstOrDefault(i => i.Poster.Length > 0 || i.Thumb.Length > 0);
        return new ChannelItemInfo
        {
            Id = id, Name = title.Length > 0 ? title : "More", Type = ChannelItemType.Folder, FolderType = ChannelFolderType.Container,
            ImageUrl = first is null ? null : first.Poster.Length > 0 ? first.Poster : first.Thumb,
        };
    }

    /// <summary>An episode whose title only repeats the series' name is called by its number.</summary>
    private static ChannelItemInfo EpisodeInfo(AItem e, AItem series)
    {
        var info = Info(e);
        info.SeriesName = series.Title;
        if (e.Title.Trim().Equals(series.Title.Trim(), StringComparison.OrdinalIgnoreCase) && e.Episode > 0)
        {
            info.Name = "Episode " + e.Episode.ToString(CultureInfo.InvariantCulture);
        }

        return info;
    }

    private static ChannelItemInfo Info(AItem it)
    {
        var folder = it.Kind is "series" or "page";
        var info = new ChannelItemInfo
        {
            Id = folder ? (it.Kind == "page" ? "page|" : "item|") + it.Id : it.Id,
            Name = it.Title,
            Overview = it.Overview,
            ImageUrl = it.Kind is "episode" or "live" ? (it.Thumb.Length > 0 ? it.Thumb : it.Poster) : (it.Poster.Length > 0 ? it.Poster : it.Thumb),
            Genres = it.Genres,
            CommunityRating = it.Rating > 0 ? (float)it.Rating : null,
            ProductionYear = int.TryParse(it.Year.Length >= 4 ? it.Year[..4] : it.Year, out var y) ? y : null,
            RunTimeTicks = it.Runtime > 0 ? TimeSpan.FromMinutes(it.Runtime).Ticks : null,
            People = it.Cast.Select(c => new PersonInfo { Name = c[0], Role = c[1], Type = global::Jellyfin.Data.Enums.PersonKind.Actor })
                .Concat(it.Director.Length > 0 ? [new PersonInfo { Name = it.Director, Type = global::Jellyfin.Data.Enums.PersonKind.Director }] : []).ToList(),
        };
        if (folder)
        {
            info.Type = ChannelItemType.Folder;
            info.FolderType = it.Kind == "series" ? ChannelFolderType.Series : ChannelFolderType.Container;
            return info;
        }

        info.Type = ChannelItemType.Media;
        info.MediaType = ChannelMediaType.Video;
        info.IsLiveStream = it.Kind == "live";
        info.ContentType = it.Kind switch { "episode" => ChannelMediaContentType.Episode, "live" => ChannelMediaContentType.Clip, _ => ChannelMediaContentType.Movie };
        if (it.Kind == "episode")
        {
            info.IndexNumber = it.Episode > 0 ? it.Episode : null;
            info.ParentIndexNumber = it.Season > 0 ? it.Season : null;
        }

        return info;
    }

    /// <summary>Played: now the add-on is asked where it plays from.</summary>
    public async Task<IEnumerable<MediaSourceInfo>> GetChannelItemMediaInfo(string id, CancellationToken cancellationToken)
    {
        PlayAnswer p;
        try
        {
            p = await browse.Play(id).ConfigureAwait(false);
        }
        catch (AddonException e)
        {
            addons.Log(addonId, "play " + id + ": " + e.Message);
            throw new InvalidOperationException(Name + " couldn't start this: " + e.Message, e);
        }

        if (p.Web.Length > 0)
        {
            throw new InvalidOperationException(Name + " opens this as a web page: " + p.Web);
        }

        var path = p.Url.Split('?')[0].ToLowerInvariant();
        var container = path.EndsWith(".m3u8", StringComparison.Ordinal) ? "hls" : Path.GetExtension(path).TrimStart('.') is { Length: > 0 and < 6 } ext ? ext : null;
        var source = new MediaSourceInfo
        {
            Id = id, Path = p.Url, Protocol = MediaProtocol.Http, Container = container, Name = Name,
            IsRemote = true, IsInfiniteStream = p.Live, SupportsDirectPlay = true, SupportsDirectStream = true, SupportsTranscoding = true,
            RequiredHttpHeaders = p.Headers, SupportsProbing = true,
            MediaStreams = p.Subtitles.Select((s, i) => new MediaStream
            {
                Type = MediaStreamType.Subtitle, Index = 1000 + i, IsExternal = true, Path = s.Url, DeliveryUrl = s.Url,
                DeliveryMethod = MediaBrowser.Model.Dlna.SubtitleDeliveryMethod.External, Language = s.Language, Title = s.Title, IsDefault = s.Default,
                Codec = s.Url.Split('?')[0].EndsWith(".srt", StringComparison.OrdinalIgnoreCase) ? "srt" : "webvtt",
            }).ToList(),
        };
        return [source];
    }
}
