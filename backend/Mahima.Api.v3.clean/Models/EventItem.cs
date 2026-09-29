using System;

namespace Mahima.Api.v3.clean.Models
{
    /// <summary>Public/private church event — RSVP, capacity, calendar. See event_rsvps for signups.</summary>
    public class EventItem
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Category { get; set; }
        public string? Location { get; set; }
        public string? CoverImageUrl { get; set; }
        public DateTime StartAtUtc { get; set; }
        public DateTime? EndAtUtc { get; set; }
        public bool IsPublic { get; set; } = true;
        public bool RequiresRsvp { get; set; } = false;
        public int? Capacity { get; set; }
        public string Status { get; set; } = "scheduled";
        public Guid? CreatedByUserId { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }

    public class EventRsvp
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public long EventId { get; set; }
        public Guid? UserId { get; set; }
        public string? GuestName { get; set; }
        public string? GuestContact { get; set; }
        public int PartySize { get; set; } = 1;
        public string Status { get; set; } = "confirmed";
        public DateTime CreatedAtUtc { get; set; }
    }

    /// <summary>A file (image, video, document, etc.) attached to an event - the actual
    /// bytes live wherever UploadsController stored them; this just records the link.</summary>
    public class EventAttachment
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public long EventId { get; set; }
        public string FileName { get; set; } = "";
        public string FileUrl { get; set; } = "";
        public string ContentType { get; set; } = "";
        public long? FileSizeBytes { get; set; }
        public Guid? UploadedByUserId { get; set; }
        public DateTime CreatedAtUtc { get; set; }
    }
}
