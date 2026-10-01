using System;
using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Mahima.Api.v3.clean.Services
{
    public enum TenantAppBuildStage
    {
        Queued,
        FetchingBranding,
        DownloadingLogo,
        GeneratingIcons,
        BuildingWebBundle,
        AssemblingApk,
        Ready,
        Publishing,
        Published,
        Failed,
    }

    public class TenantAppBuildState
    {
        public Guid TenantId { get; init; }
        public string Slug { get; init; } = "";
        public TenantAppBuildStage Stage { get; init; }
        public string? Message { get; init; }
        public string? ErrorMessage { get; init; }
        public string? Version { get; init; }
        public string? Build { get; init; }
        public DateTime UpdatedAtUtc { get; init; }
    }

    public class TenantAppBuildJob
    {
        public Guid TenantId { get; init; }
        public string Slug { get; init; } = "";
        public string Version { get; init; } = "";
        public Guid? RequestedByUserId { get; init; }
    }

    // Singleton: holds the one-at-a-time build channel (see TenantAppBuildWorker)
    // and an in-memory status board the controller polls from. Status is
    // intentionally ephemeral - lost on restart, which just means "click
    // Generate again" for whatever was mid-build, an acceptable tradeoff for how
    // infrequently this runs.
    public class TenantAppBuildQueue
    {
        private readonly Channel<TenantAppBuildJob> _channel = Channel.CreateUnbounded<TenantAppBuildJob>();
        private readonly ConcurrentDictionary<Guid, TenantAppBuildState> _status = new();

        public ChannelReader<TenantAppBuildJob> Reader => _channel.Reader;

        public static bool IsActive(TenantAppBuildStage stage) => stage is
            TenantAppBuildStage.Queued or
            TenantAppBuildStage.FetchingBranding or
            TenantAppBuildStage.DownloadingLogo or
            TenantAppBuildStage.GeneratingIcons or
            TenantAppBuildStage.BuildingWebBundle or
            TenantAppBuildStage.AssemblingApk or
            TenantAppBuildStage.Publishing;

        public TenantAppBuildState? GetStatus(Guid tenantId) =>
            _status.TryGetValue(tenantId, out var state) ? state : null;

        // Returns (accepted:false, currentState) if a build/publish is already
        // active for this tenant instead of enqueuing a second one.
        public (bool accepted, TenantAppBuildState state) EnqueueGenerate(
            Guid tenantId, string slug, string version, Guid? requestedByUserId)
        {
            if (_status.TryGetValue(tenantId, out var existing) && IsActive(existing.Stage))
                return (false, existing);

            var state = new TenantAppBuildState
            {
                TenantId = tenantId,
                Slug = slug,
                Stage = TenantAppBuildStage.Queued,
                Message = "Queued",
                Version = version,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            _status[tenantId] = state;
            _channel.Writer.TryWrite(new TenantAppBuildJob
            {
                TenantId = tenantId,
                Slug = slug,
                Version = version,
                RequestedByUserId = requestedByUserId,
            });
            return (true, state);
        }

        public void UpdateStage(
            Guid tenantId, string slug, TenantAppBuildStage stage,
            string? message = null, string? errorMessage = null, string? version = null, string? build = null)
        {
            _status.AddOrUpdate(
                tenantId,
                _ => new TenantAppBuildState
                {
                    TenantId = tenantId,
                    Slug = slug,
                    Stage = stage,
                    Message = message,
                    ErrorMessage = errorMessage,
                    Version = version,
                    Build = build,
                    UpdatedAtUtc = DateTime.UtcNow,
                },
                (_, prev) => new TenantAppBuildState
                {
                    TenantId = tenantId,
                    Slug = slug,
                    Stage = stage,
                    Message = message ?? prev.Message,
                    ErrorMessage = errorMessage,
                    Version = version ?? prev.Version,
                    Build = build ?? prev.Build,
                    UpdatedAtUtc = DateTime.UtcNow,
                });
        }
    }
}
