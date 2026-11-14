using Korie.Jellyfin.Addons;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Channels;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Korie.Jellyfin;

/// <summary>Tells Jellyfin about Korie's parts. Each installed add-on is a channel (installing one needs a restart of Jellyfin, like a plugin).</summary>
public class Services : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<AddonManager>();
        serviceCollection.AddSingleton<Browse>();
        serviceCollection.AddSingleton<Store>();
        serviceCollection.AddHostedService<Refresher>();
        Directory.CreateDirectory(Paths.Addons);
        foreach (var dir in Directory.EnumerateDirectories(Paths.Addons))
        {
            var m = Manifest.Read(dir);
            if (m is not null)
            {
                Api.KorieController.ChannelsAtStart.Add(m.Id);
                serviceCollection.AddSingleton<IChannel>(sp => new AddonChannel(m.Id, sp.GetRequiredService<AddonManager>(), sp.GetRequiredService<Browse>()));
            }
        }
    }
}

/// <summary>Asks every add-on for fresh rows when Jellyfin starts and every half hour after, so nobody waits for one.</summary>
public sealed class Refresher(AddonManager addons, Browse browse, ILogger<Refresher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken).ConfigureAwait(false);
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var id in addons.Manifests.Keys.Where(addons.IsOn))
            {
                try
                {
                    await browse.Refresh(id).ConfigureAwait(false);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning(e, "Korie: refreshing {Id} failed", id);
                }
            }

            browse.SaveItems();
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken).ConfigureAwait(false);
        }
    }
}
