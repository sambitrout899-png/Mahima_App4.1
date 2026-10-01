using System;
using System.Collections.Generic;

namespace Mahima.Api.v3.clean.Dtos
{
    public class PastorBotAskDto
    {
        public string Question { get; set; } = string.Empty;
        public bool SendToJaiMasih { get; set; }
        public string? Language { get; set; }
        public string? Persona { get; set; }
        public PastorBotMessageDto[]? Conversation { get; set; }
    }

    public class PastorBotReadMeDto
    {
        public string ImageDataUrl { get; set; } = string.Empty;
        public string? ArtifactDataUrl { get; set; }
        public string? ArtifactName { get; set; }
        public string? Note { get; set; }
        public bool ConsentAccepted { get; set; }
        public string? Language { get; set; }
        public string? Persona { get; set; }
    }

    public class PastorBotReplyDto
    {
        public string Answer { get; set; } = string.Empty;
        public string Source { get; set; } = "fallback";
        public string Language { get; set; } = "en";
        public string Persona { get; set; } = "english-evangelist";
        public Guid? ChatId { get; set; }
        public Guid? MessageId { get; set; }
        public List<MessageDto>? SharedMessages { get; set; }
    }

    public class PastorBotMessageDto
    {
        public string Role { get; set; } = "user";
        public string Text { get; set; } = string.Empty;
    }
}
