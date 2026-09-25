using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services.Ai
{
    /// <summary>
    /// Provider-agnostic Large Language Model abstraction.
    ///
    /// The AI Counseller no longer talks to OpenAI directly. It talks to an
    /// ILlmProvider. The concrete provider is selected by configuration, so the
    /// exact same pastor logic can run on:
    ///   - a fully self-hosted local model (Ollama / LM Studio / vLLM),
    ///   - a low-cost hosted endpoint (Groq, Together, OpenRouter),
    ///   - Azure OpenAI, or
    ///   - OpenAI itself.
    /// All of those speak the OpenAI-compatible Chat Completions protocol, which
    /// OpenAiCompatibleLlmProvider implements.
    /// </summary>
    public interface ILlmProvider
    {
        /// <summary>Human-readable provider id, e.g. "openai-compatible".</summary>
        string Name { get; }

        /// <summary>True when the provider has enough configuration to be called.</summary>
        bool IsConfigured { get; }

        /// <summary>Run a text chat completion.</summary>
        Task<LlmResult> CompleteAsync(LlmRequest request, CancellationToken ct = default);

        /// <summary>
        /// Run a vision chat completion (image + text). Providers backed by a
        /// non-vision model should return LlmResult.Unavailable.
        /// </summary>
        Task<LlmResult> CompleteVisionAsync(LlmVisionRequest request, CancellationToken ct = default);
    }

    /// <summary>One turn in a conversation.</summary>
    public sealed class LlmMessage
    {
        /// <summary>"system", "user" or "assistant".</summary>
        public string Role { get; set; } = "user";
        public string Content { get; set; } = string.Empty;

        public LlmMessage() { }
        public LlmMessage(string role, string content)
        {
            Role = role;
            Content = content;
        }

        public static LlmMessage System(string c)    => new("system", c);
        public static LlmMessage User(string c)      => new("user", c);
        public static LlmMessage Assistant(string c) => new("assistant", c);
    }

    /// <summary>A text chat completion request.</summary>
    public sealed class LlmRequest
    {
        public List<LlmMessage> Messages { get; set; } = new();

        /// <summary>0.0 = deterministic, 1.0 = creative. Pastor default ~0.6.</summary>
        public double Temperature { get; set; } = 0.6;

        /// <summary>Upper bound on generated tokens.</summary>
        public int MaxTokens { get; set; } = 700;

        /// <summary>Optional model override; null = use the configured default.</summary>
        public string? ModelOverride { get; set; }
    }

    /// <summary>A vision (image + text) chat completion request.</summary>
    public sealed class LlmVisionRequest
    {
        public string SystemPrompt { get; set; } = string.Empty;
        public string UserText { get; set; } = string.Empty;

        /// <summary>A data: URL — data:image/jpeg;base64,... or a public https image URL.</summary>
        public string ImageUrl { get; set; } = string.Empty;

        public double Temperature { get; set; } = 0.6;
        public int MaxTokens { get; set; } = 700;
        public string? ModelOverride { get; set; }
    }

    /// <summary>The outcome of an LLM call.</summary>
    public sealed class LlmResult
    {
        public bool Success { get; set; }
        public string? Text { get; set; }
        public string? Error { get; set; }
        public string Provider { get; set; } = string.Empty;
        public string Model { get; set; } = string.Empty;

        public static LlmResult Ok(string text, string provider, string model) => new()
        {
            Success = true, Text = text, Provider = provider, Model = model
        };

        public static LlmResult Fail(string error, string provider) => new()
        {
            Success = false, Error = error, Provider = provider
        };

        /// <summary>Used when a provider cannot service a request type (e.g. vision on a text-only model).</summary>
        public static LlmResult Unavailable(string provider) => new()
        {
            Success = false, Error = "capability-unavailable", Provider = provider
        };
    }
}

