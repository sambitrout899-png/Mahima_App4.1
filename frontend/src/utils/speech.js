export async function optionalImportModule(specifier) {
  const importer = new Function("specifier", "return import(specifier)");
  return importer(specifier);
}

export function cleanSpeechText(text = "") {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_#>`~|]/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSpeechText(text = "", maxLength = 220) {
  const clean = cleanSpeechText(text);
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const chunks = [];
  let current = "";

  sentences.forEach((sentence) => {
    const next = sentence.trim();
    if (!next) return;

    if ((current + " " + next).trim().length <= maxLength) {
      current = (current + " " + next).trim();
      return;
    }

    if (current) chunks.push(current);
    if (next.length <= maxLength) {
      current = next;
      return;
    }

    for (let i = 0; i < next.length; i += maxLength) {
      chunks.push(next.slice(i, i + maxLength));
    }
    current = "";
  });

  if (current) chunks.push(current);
  return chunks;
}

export function speakText(text, options = {}) {
  if (typeof window === "undefined") return false;

  const nativeTts = window.Capacitor?.Plugins?.TextToSpeech;
  if (nativeTts?.speak && window.Capacitor?.isNativePlatform?.()) {
    const chunks = splitSpeechText(text, options.maxLength || 220);
    if (!chunks.length) return false;

    let cancelled = false;
    options.onStart?.();

    (async () => {
      try {
        const languages = [options.lang, ...(options.fallbackLangs || [])].filter(Boolean);
        for (const chunk of chunks) {
          if (cancelled) break;
          let spoken = false;
          let lastError;
          for (const lang of languages.length ? languages : ["en-IN"]) {
            try {
              await nativeTts.speak({ text: chunk, lang, rate: options.rate ?? 0.9, pitch: options.pitch ?? 1, volume: 1, category: "playback" });
              spoken = true;
              break;
            } catch (error) { lastError = error; }
          }
          if (!spoken) throw lastError || new Error("No compatible text-to-speech language is installed.");
        }
        options.onEnd?.();
      } catch {
        options.onError?.();
        options.onEnd?.();
      }
    })();

    return true;
  }

  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return false;

  const chunks = splitSpeechText(text, options.maxLength || 220);
  if (!chunks.length) return false;

  let index = 0;
  let stopped = false;
  let resumeTimer = null;
  const requestedLanguages = [options.lang, ...(options.fallbackLangs || [])].filter(Boolean);

  const findVoice = () => {
    if (options.voice) return options.voice;
    const voices = synth.getVoices?.() || [];
    const normalized = requestedLanguages.map(lang => lang.toLowerCase());
    for (const lang of normalized) {
      const exact = voices.find(voice => voice.lang?.toLowerCase() === lang);
      if (exact) return exact;
      const base = lang.split("-")[0];
      const related = voices.find(voice => voice.lang?.toLowerCase().split("-")[0] === base);
      if (related) return related;
    }
    // Some engines expose Punjabi only in the voice name, often without a
    // reliable locale tag.
    return voices.find(voice => /punjabi|ਪੰਜਾਬੀ|ਪੰਜਾਬੀ/i.test(voice.name || "")) || null;
  };

  const finish = () => {
    if (resumeTimer) {
      window.clearInterval(resumeTimer);
      resumeTimer = null;
    }
    if (!stopped) options.onEnd?.();
  };

  const playNext = () => {
    if (stopped) return;
    if (index >= chunks.length) {
      finish();
      return;
    }

    const utterance = new Utterance(chunks[index]);
    index += 1;

    const selectedVoice = findVoice();
    utterance.lang = selectedVoice?.lang || requestedLanguages[0] || "en-IN";
    utterance.rate = options.rate ?? 0.9;
    utterance.pitch = options.pitch ?? 0.95;
    utterance.volume = 1;
    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.onend = () => {
      window.setTimeout(playNext, 80);
    };
    utterance.onerror = () => {
      stopped = true;
      if (resumeTimer) {
        window.clearInterval(resumeTimer);
        resumeTimer = null;
      }
      options.onError?.();
      options.onEnd?.();
    };

    try {
      synth.resume?.();
      synth.speak(utterance);
      window.setTimeout(() => synth.resume?.(), 120);
    } catch {
      stopped = true;
      if (resumeTimer) {
        window.clearInterval(resumeTimer);
        resumeTimer = null;
      }
      options.onError?.();
      options.onEnd?.();
    }
  };

  synth.cancel();
  synth.resume?.();
  options.onStart?.();
  resumeTimer = window.setInterval(() => {
    try { synth.resume?.(); } catch {}
  }, 250);
  window.setTimeout(playNext, 40);
  return true;
}
