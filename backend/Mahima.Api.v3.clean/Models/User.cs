using System;
using System.Collections.Generic;

namespace Mahima.Api.v3.clean.Models
{
    public class User
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid TenantId { get; set; } = Guid.Parse("00000000-0000-0000-0000-000000000001");
	public string UserCode { get; set; }
        public string? CognitoSub { get; set; }
        public string? Username { get; set; }
        public string? Email { get; set; }
        public string? Phone { get; set; }
        public string? DisplayName { get; set; }
        public string? ProfilePhotoUrl { get; set; }
        public string Role { get; set; } = "member";
        public DateTime JoinDate { get; set; } = DateTime.UtcNow;
        public DateTime? LastLogin { get; set; }

        public ICollection<TeamMember>? Teams { get; set; }

        // explicit inverse navigation for ChatMember
        public virtual ICollection<ChatMember> ChatMembers { get; set; } = new List<ChatMember>();

        // -------- NEW FIELDS --------
        // 1. Married/Unmarried/Divorced/Separated
        public string? MaritalStatus { get; set; }

        // 2. Sex: M/F/O
        public string? Sex { get; set; }

        // 3. Baptized?
        public bool? IsBaptized { get; set; }
        // 4. If baptized: where, which date
        public string? BaptismPlace { get; set; }
        public DateTime? BaptismDate { get; set; }

        // 5. Born-again
        public bool? IsBornAgain { get; set; }

        // 6. Believer
        public bool? IsBeliever { get; set; }

        // 7. Birthday + Age
        public DateTime? Birthday { get; set; }
        public int? Age { get; set; }

        // 8. Aadhaar
        public string? AadharNumber { get; set; }

        // 9. Home address
        public string? HomeAddress { get; set; }

        // 10. Current address
        public string? CurrentAddress { get; set; }

        // 11. Emergency contact
        public string? EmergencyContactPhone { get; set; }

        // 12. Pastor?
        public bool? IsPastor { get; set; }

        public bool PayrollEnabled { get; set; } = false;

        // Relative path (like "{tenantId}/AppointmentLetter_{userId}_....pdf") to the most
        // recently generated appointment letter - never a public URL. See
        // IAppointmentLetterService / UsersController's generate+download endpoints.
        public string? AppointmentLetterUrl { get; set; }
        public DateTime? AppointmentLetterGeneratedAtUtc { get; set; }

        public Tenant? Tenant { get; set; }
    }
}
