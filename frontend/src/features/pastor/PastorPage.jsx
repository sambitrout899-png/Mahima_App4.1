import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  Languages,
  Loader2,
  MessageCircle,
  Mic,
  Mic2,
  MicOff,
  PauseCircle,
  Send,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { apiFetch } from "../../utils/fetch-auth-shim";
import { optionalImportModule, speakText } from "../../utils/speech";
import PastorCharacter from "../../components/PastorCharacter";

const pastorModes = {
  en: {
    language: "en",
    persona: "english-evangelist",
    title: "English Pastor",
    voiceLabel: "English pastoral voice",
    placeholder: "Ask for prayer, guidance, a Bible verse, or daily direction...",
    greeting:
      "Jai Masih. I am here to listen, encourage you from Scripture, and help you take the next faithful step.",
    prompts: [
      "Give me today's spiritual guidance",
      "Pray for my family",
      "Help me with fear and worry",
      "Give me a Bible verse for strength",
    ],
  },
  hi: {
    language: "hi",
    persona: "hindi-evangelist",
    title: "Hindi Pastor",
    voiceLabel: "Hindi pastoral guide voice",
    placeholder: "प्रार्थना, मार्गदर्शन, बाइबल वचन या आज की दिशा पूछें...",
    greeting:
      "Jai Masih. मैं आपकी बात सुनने, वचन से उत्साह देने, और अगला सही कदम समझने में मदद करूंगा।",
    prompts: [
      "आज के लिए आत्मिक मार्गदर्शन दीजिए",
      "मेरे परिवार के लिए प्रार्थना कीजिए",
      "डर और चिंता में मेरी मदद कीजिए",
      "शक्ति के लिए बाइबल वचन दीजिए",
    ],
  },
};

const avatarStates = {
  idle: "Ready",
  thinking: "Praying",
  speaking: "Speaking",
};

async function nativeSpeechToText(lang) {
  const [{ Capacitor }, { SpeechRecognition }] = await Promise.all([
    optionalImportModule("@capacitor/core"),
    optionalImportModule("@capacitor-community/speech-recognition"),
  ]);

  if (!Capacitor.isNativePlatform()) return "";

  const available = await SpeechRecognition.available();
  if (available && available.available === false) {
    throw new Error("Speech recognition is not available on this device.");
  }

  await SpeechRecognition.requestPermissions();
  const result = await SpeechRecognition.start({
    language: lang,
    maxResults: 1,
    partialResults: false,
    popup: false,
  });

  return result?.matches?.[0] || "";
}

function pickVoice(voices, mode) {
  const langPrefix = mode === "hi" ? "hi" : "en";
  const matching = voices.filter((voice) => voice.lang?.toLowerCase().startsWith(langPrefix));
  if (matching.length === 0) return null;

  const preferred = matching.find((voice) =>
    mode === "hi"
      ? /hindi|india|hi-in/i.test(`${voice.name} ${voice.lang}`)
      : /english|india|united states|great britain|en-/i.test(`${voice.name} ${voice.lang}`)
  );

  return preferred || matching[0];
}

export default function PastorPage() {
  const [mode, setMode] = useState("en");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [conversation, setConversation] = useState([]);
  const [sendToJaiMasih, setSendToJaiMasih] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [agentOpen, setAgentOpen] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const active = pastorModes[mode];
  const selectedVoice = useMemo(() => pickVoice(voices, mode), [voices, mode]);
  const nativeSpeechSupported =
    typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
  const speechRecognitionSupported =
    typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const speechInputSupported = nativeSpeechSupported || speechRecognitionSupported;
  const avatarState = loading ? "thinking" : speaking || listening ? "speaking" : "idle";

  useEffect(() => {
    const loadVoices = () => {
      if (!("speechSynthesis" in window)) return;
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      stopListening();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  function stopVoice() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }

  function startListening() {
    if (loading) return;

    stopVoice();
    stopListening();
    setListening(true);

    nativeSpeechToText(mode === "hi" ? "hi-IN" : "en-IN")
      .then((spoken) => {
        if (!spoken) return false;
        setQuestion(spoken);
        ask(spoken);
        return true;
      })
      .catch(() => false)
      .then((handledByNative) => {
        if (handledByNative) return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          setListening(false);
          return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = mode === "hi" ? "hi-IN" : "en-IN";
        recognition.continuous = false;
        recognition.interimResults = true;

        let finalText = "";
        recognition.onresult = (event) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const transcript = event.results[i][0]?.transcript || "";
            if (event.results[i].isFinal) finalText += transcript;
            else interim += transcript;
          }

          const text = `${finalText} ${interim}`.trim();
          if (text) setQuestion(text);
        };

        recognition.onerror = () => setListening(false);
        recognition.onend = () => {
          setListening(false);
          const spoken = finalText.trim();
          if (spoken) ask(spoken);
        };

        recognitionRef.current = recognition;
        recognition.start();
      });

    return;
  }

  function speak(text = answer) {
    if (!voiceEnabled || !text) return;

    stopVoice();
    const started = speakText(text, {
      lang: mode === "hi" ? "hi-IN" : "en-IN",
      rate: mode === "hi" ? 0.92 : 0.88,
      pitch: mode === "hi" ? 0.98 : 0.86,
      voice: selectedVoice,
      maxLength: 180,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });

    if (!started) setSpeaking(false);
  }

  async function ask(value = question) {
    const q = value.trim();
    if (!q) return;

    stopListening();
    stopVoice();
    setLoading(true);
    setNotice("");
    setAgentOpen(true);
    setConversation((items) => [...items, { role: "user", text: q }]);

    try {
      const data = await apiFetch("/pastorbot/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          sendToJaiMasih,
          language: active.language,
          persona: active.persona,
          conversation: conversation.slice(-12).map((item) => ({
            role: item.role,
            text: item.text,
          })),
        }),
      });

      const reply = data?.answer || "";
      setAnswer(reply);
      setQuestion("");
      setConversation((items) => [...items, { role: "pastor", text: reply }]);
      setNotice(sendToJaiMasih ? "Pastor message was also sent to Jai Masih." : "");
      if (voiceEnabled && reply) {
        window.setTimeout(() => speak(reply), 160);
      }
    } catch (err) {
      const message = err.message || "Pastor bot could not reply.";
      setNotice(message);
      setConversation((items) => [...items, { role: "pastor", text: message, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode) {
    stopListening();
    stopVoice();
    setMode(nextMode);
    setAnswer("");
    setQuestion("");
    setNotice("");
    setConversation([]);
  }

  return (
    <div className="min-h-screen bg-[#f6f1e8] px-4 py-6 text-slate-950 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[420px_1fr]">
        <section className="rounded-[28px] border border-amber-200 bg-white p-5 shadow-sm">
          <div className="overflow-hidden rounded-[24px] bg-slate-950 text-white">
            <div className="relative grid place-items-center px-6 py-10 text-center">
              <div className={`pastor-avatar pastor-avatar-${avatarState}`}>
                <div className="pastor-halo" />
                <div className="pastor-face">
                  <PastorCharacter className="h-full w-full" />
                </div>
                <div className="pastor-pulse" />
              </div>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase text-emerald-100">
                <Sparkles className="h-4 w-4" />
                {avatarStates[avatarState]}
              </div>
              <h1 className="mt-4 text-4xl font-black">AI Counseller</h1>
              <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-300">
                A guided pastoral assistant for prayer, Scripture, family encouragement, and daily direction.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(pastorModes).map(([key, item]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                className={`flex min-w-0 w-full flex-col items-stretch overflow-visible whitespace-normal rounded-2xl border px-4 py-4 text-left transition ${
                  mode === key
                    ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                    : "border-amber-200 bg-white text-slate-700 hover:bg-amber-50"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-sm font-black">
                  <Languages className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{item.title}</span>
                </div>
                <div className="mt-1 whitespace-normal break-words text-xs font-semibold leading-5 text-slate-500">{item.voiceLabel}</div>
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
            Voices are safe pastoral voice modes, not impersonations of real public figures. For a personal custom voice, upload only a consented sample and label generated audio as AI-created.
          </div>
        </section>

        <section className="rounded-[28px] border border-amber-200 bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 border-b border-amber-100 pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-800">
                <MessageCircle className="h-4 w-4" />
                {active.title}
              </div>
              <h2 className="mt-3 text-3xl font-black">Ask like ChatGPT. Receive pastoral guidance.</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                The assistant gives biblical encouragement and practical next steps. For emergencies, medical, legal, abuse, or self-harm situations, contact a real pastor or local emergency help immediately.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAgentOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-black text-white hover:bg-slate-800"
            >
              <Bot className="h-5 w-5" />
              Open Pastor Agent
            </button>
          </div>

          {notice && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
              {notice}
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {active.prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                disabled={loading}
                className="rounded-2xl border border-amber-200 bg-[#fbf8f1] px-4 py-4 text-left text-sm font-black text-slate-800 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
              >
                <BookOpen className="mb-2 h-5 w-5 text-emerald-700" />
                {prompt}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-3xl border border-amber-200 bg-[#fbf8f1] p-4">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={5}
              placeholder={active.placeholder}
              className="w-full resize-none rounded-2xl border border-amber-200 bg-white px-4 py-4 text-base font-semibold outline-none focus:border-emerald-600"
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-emerald-900">
                  <input
                    type="checkbox"
                    checked={sendToJaiMasih}
                    onChange={(e) => setSendToJaiMasih(e.target.checked)}
                    className="h-5 w-5 accent-emerald-700"
                  />
                  Share to Jai Masih
                </label>
                <label className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-800">
                  <input
                    type="checkbox"
                    checked={voiceEnabled}
                    onChange={(e) => setVoiceEnabled(e.target.checked)}
                    className="h-5 w-5 accent-emerald-700"
                  />
                  Voice reply
                </label>
              </div>

              <button
                type="button"
                onClick={listening ? stopListening : startListening}
                disabled={!speechInputSupported || loading}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-black text-white disabled:opacity-50 ${
                  listening ? "bg-red-600" : "bg-slate-950"
                }`}
              >
                {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {listening ? "Stop" : "Speak"}
              </button>

              <button
                onClick={() => ask()}
                disabled={loading || !question.trim()}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-6 py-3 font-black text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Ask Pastor
              </button>
            </div>
          </div>

          {answer && (
            <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xl font-black text-emerald-950">
                  <Mic2 className="h-6 w-6" />
                  Pastor Reply
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => speak()}
                    disabled={speaking}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-emerald-900 disabled:opacity-50"
                  >
                    <Volume2 className="h-4 w-4" />
                    Speak
                  </button>
                  <button
                    type="button"
                    onClick={stopVoice}
                    disabled={!speaking}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
                  >
                    <PauseCircle className="h-4 w-4" />
                    Pause
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-line text-lg font-medium leading-8 text-slate-800">{answer}</p>
            </section>
          )}
        </section>
      </div>

      <button
        type="button"
        onClick={() => setAgentOpen(true)}
        className="fixed bottom-5 right-5 z-40 grid h-16 w-16 place-items-center rounded-full bg-emerald-700 text-white shadow-2xl ring-4 ring-white hover:bg-emerald-800"
        aria-label="Open AI Counseller"
      >
        <PastorCharacter className="h-full w-full" />
      </button>

      {agentOpen && (
        <div className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm md:items-center md:justify-center">
          <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between gap-3 bg-slate-950 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className={`pastor-mini pastor-mini-${avatarState}`}>
                  <PastorCharacter className="h-full w-full" />
                </div>
                <div>
                  <div className="text-lg font-black">AI Counseller Agent</div>
                  <div className="text-xs font-bold text-emerald-100">{active.voiceLabel}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAgentOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
                aria-label="Close pastor agent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8f4ea] p-4">
              <div className="mb-3 max-w-[82%] rounded-3xl rounded-tl-md bg-white px-4 py-3 text-sm font-semibold leading-6 text-slate-700 shadow-sm">
                {active.greeting}
              </div>
              {conversation.map((item, index) => (
                <div
                  key={`${item.role}-${index}`}
                  className={`mb-3 flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[84%] whitespace-pre-line rounded-3xl px-4 py-3 text-sm font-semibold leading-6 shadow-sm ${
                      item.role === "user"
                        ? "rounded-tr-md bg-emerald-700 text-white"
                        : item.error
                          ? "rounded-tl-md bg-red-50 text-red-800"
                          : "rounded-tl-md bg-white text-slate-800"
                    }`}
                  >
                    {item.text}
                    {item.role === "pastor" && (
                      <button
                        type="button"
                        onClick={() => speak(item.text)}
                        className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-950"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        Read
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="mb-3 max-w-[82%] rounded-3xl rounded-tl-md bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Thinking prayerfully...
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-amber-100 bg-white p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {Object.entries(pastorModes).map(([key, item]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => switchMode(key)}
                    className={`rounded-full px-4 py-2 text-xs font-black ${
                      mode === key ? "bg-emerald-700 text-white" : "bg-amber-50 text-amber-950"
                    }`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-[auto_1fr_auto]">
                <button
                  type="button"
                  onClick={listening ? stopListening : startListening}
                  disabled={!speechInputSupported || loading}
                  className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-black text-white disabled:opacity-50 ${
                    listening ? "bg-red-600" : "bg-slate-950"
                  }`}
                >
                  {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  {listening ? "Stop" : "Speak"}
                </button>

                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                  placeholder={active.placeholder}
                  className="w-full resize-none rounded-2xl border border-amber-200 px-4 py-3 text-sm font-semibold outline-none focus:border-emerald-600"
                />
                <button
                  onClick={() => ask()}
                  disabled={loading || !question.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 font-black text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .pastor-avatar {
          position: relative;
          display: grid;
          height: 138px;
          width: 138px;
          place-items: center;
        }

        .pastor-halo {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: conic-gradient(from 180deg, #facc15, #10b981, #38bdf8, #facc15);
          opacity: 0.9;
          animation: pastor-spin 6s linear infinite;
        }

        .pastor-face {
          position: relative;
          z-index: 2;
          display: grid;
          height: 108px;
          width: 108px;
          place-items: center;
          border-radius: 999px;
          background: #ecfdf5;
          color: #065f46;
          box-shadow: inset 0 0 0 8px rgba(255,255,255,0.8), 0 18px 40px rgba(0,0,0,0.28);
        }

        .pastor-pulse {
          position: absolute;
          inset: 14px;
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,0.65);
          animation: pastor-pulse 1.8s ease-out infinite;
        }

        .pastor-avatar-thinking .pastor-face,
        .pastor-avatar-speaking .pastor-face,
        .pastor-mini-thinking,
        .pastor-mini-speaking {
          animation: pastor-breathe 1.1s ease-in-out infinite;
        }

        .pastor-mini {
          display: grid;
          height: 48px;
          width: 48px;
          place-items: center;
          border-radius: 999px;
          background: #ecfdf5;
          color: #065f46;
        }

        @keyframes pastor-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes pastor-pulse {
          0% { transform: scale(0.85); opacity: 0.8; }
          100% { transform: scale(1.25); opacity: 0; }
        }

        @keyframes pastor-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.045); }
        }
      `}</style>
    </div>
  );
}
