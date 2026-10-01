using System;

namespace Mahima.Api.v3.clean.Models
{
    public class TenantLandingVersion
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid TenantId { get; set; }
        public string SnapshotJson { get; set; } = "{}";
        public DateTime PublishedAtUtc { get; set; } = DateTime.UtcNow;
        public Guid? PublishedByUserId { get; set; }

        public Tenant? Tenant { get; set; }
    }
}
