using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;

namespace Mahima.Api.v3.clean.Services
{
    public interface IPastorBotService
    {
        Task<Guid> EnsurePastorBotUserAsync(CancellationToken ct = default);
        Task<Guid> EnsurePastorBotUserAsync(Guid tenantId, CancellationToken ct = default);
        Task<Chat> EnsureJaiMasihChatAsync(CancellationToken ct = default);
        Task<Chat> EnsureJaiMasihChatAsync(Guid tenantId, CancellationToken ct = default);
        Task<MessageDto> SendJaiMasihMessageAsync(string content, CancellationToken ct = default);
        Task<MessageDto> SendJaiMasihMessageAsync(string content, Guid tenantId, CancellationToken ct = default);
        Task<PastorBotReplyDto> AskAsync(Guid userId, string question, bool sendToJaiMasih = false, string? language = null, string? persona = null, IReadOnlyList<PastorBotMessageDto>? conversation = null, CancellationToken ct = default);
        Task<PastorBotReplyDto> ReadMeAsync(Guid userId, string imageDataUrl, string? note = null, string? language = null, string? persona = null, CancellationToken ct = default);
        Task<PastorBotReplyDto> ReadArtifactAsync(Guid userId, string artifactName, string artifactText, string? note = null, string? language = null, string? persona = null, CancellationToken ct = default);
        Task<IReadOnlyList<MessageDto>> TryReplyInChatAsync(Guid chatId, Guid userId, string? userMessage, CancellationToken ct = default);
    }
}
