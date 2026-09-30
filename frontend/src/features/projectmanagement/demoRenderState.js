export const DEMO_RENDERER_BUILD = "2026.09.18-cinematic-story-v7";

export function matchesDemoSettings(job, settings) {
  return Boolean(job)
    && job.language === settings.language
    && Number(job.durationSeconds) === Number(settings.durationSeconds)
    && job.voiceKey === settings.voiceKey
    && job.musicStyle === settings.musicStyle
    && Math.abs(Number(job.musicVolume) - Number(settings.musicVolume)) < 0.0001;
}

export function newDemoRenderAttempt(job, settings, voice, id) {
  return {
    ...job, ...settings, id, status: "queued",
    requestedAt: new Date().toISOString(), completedAt: null, completedAtUtc: null,
    downloadUrl: null, outputFileName: null, lastError: null,
    voiceLabel: voice.label, ttsVoice: voice.ttsVoice[settings.language] || voice.ttsVoice.en,
    ttsInstructions: demoVoiceInstructions(voice, settings.language), requireOpenAiSpeech: true,
    output: `mahima-app-demo-${settings.language}-${settings.durationSeconds}s.mp4`,
  };
}

export function demoVoiceInstructions(voice, language) {
  const gender = voice.key?.includes("female") ? "woman" : "man";
  const delivery = voice.key?.includes("gentle") ? "gentle, reassuring" : "warm, expressive";
  const tongue = language === "hi" ? "native Hindi with authentic Hindi pronunciation; no English accent or Hinglish" : language === "pa" ? "native Indian Punjabi with authentic Punjabi rhythm and pronunciation; no Hindi or English mixing" : "natural Indian English";
  return `Speak as a ${delivery} ${gender} in ${tongue}. Tell a cinematic human story with subtle emotion, varied intonation, meaningful emphasis and brief natural breaths. Read only the supplied text.`;
}
