import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Camera,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
  Volume2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch } from "../../utils/fetch-auth-shim";
import { speakText } from "../../utils/speech";
import PastorCharacter from "../../components/PastorCharacter";

const modes = {
  en: {
    label: "English",
    lang: "en-IN",
    placeholder: "Tell the AI Counseller what you want help with...",
    intro: "Share a camera frame or upload an artifact. ReadMe will use AI to explain it clearly and respond to your note.",
  },
  hi: {
    label: "Hindi",
    lang: "hi-IN",
    placeholder: "AI Counseller ko batayein ki aap kis baat par salah chahte hain...",
    intro: "Camera frame aur chhota note share karein. ReadMe bina pehchan ya diagnosis ke biblical salah dega.",
  },
  pa: {
    label: "Punjabi",
    lang: "pa-IN",
    placeholder: "AI Counseller nu daso tusi kis gal te salah chaunde ho...",
    intro: "Camera frame ate chhota note share karo. ReadMe bina pehchan ya diagnosis de biblical salah devega.",
  },
};

function getCameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Please allow camera access for Mahima App and try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError") {
    return "Camera is busy in another app. Close that app and try again.";
  }
  return err?.message || "Unable to start camera.";
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function captureVideoFrame(video) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    throw new Error("The camera is still preparing a frame. Please wait a moment and try Capture again.");
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the camera snapshot.");
  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function waitForVideoFrame(video, timeoutMs = 8000) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      finish();
      resolve();
    };
    const onError = () => {
      finish();
      reject(new Error("The camera stream could not be displayed."));
    };
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("The camera took too long to become ready. Please select Start Camera again."));
    }, timeoutMs);

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
  });
}

export default function ReadMePage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraStartInFlightRef = useRef(false);

  const [mode, setMode] = useState("en");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [capturedImage, setCapturedImage] = useState("");
  const [artifact, setArtifact] = useState(null);
  const [note, setNote] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    return () => {
      cameraStartInFlightRef.current = false;
      stopStream(streamRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function startCamera() {
    if (cameraStartInFlightRef.current) return;
    cameraStartInFlightRef.current = true;
    setCameraStarting(true);
    setCameraReady(false);
    setError("");
    setCapturedImage("");
    setArtifact(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported in this browser or app webview.");
      setCameraStarting(false);
      cameraStartInFlightRef.current = false;
      return;
    }

    try {
      stopStream(streamRef.current);
      streamRef.current = null;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview is not available yet. Please try again.");
      video.srcObject = stream;
      await video.play();
      await waitForVideoFrame(video);
      setCameraReady(true);
    } catch (err) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
      setError(getCameraErrorMessage(err));
    } finally {
      cameraStartInFlightRef.current = false;
      setCameraStarting(false);
    }
  }

  function captureFrame() {
    setError("");
    if (!videoRef.current || !cameraReady) {
      setError("Select Start Camera and wait for the live preview before capturing.");
      return;
    }

    try {
      setCapturedImage(captureVideoFrame(videoRef.current));
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
    } catch (err) {
      setError(err?.message || "The camera frame could not be captured. Please try again.");
    }
  }

  function retake() {
    setCapturedImage("");
    setAnswer("");
    setSource("");
    startCamera();
  }

  function selectArtifact(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 6_000_000) {
      setError("Please choose an artifact that is 6 MB or smaller.");
      return;
    }
    const allowed = /\.(jpe?g|png|webp|pdf|docx|pptx|xlsx|csv|json|md|html?|xml|log|txt)$/i;
    if (!allowed.test(file.name)) {
      setError("Use an image, PDF, Word, PowerPoint, Excel, CSV, JSON, Markdown, HTML, XML, log, or text file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
      setCapturedImage("");
      setArtifact({ name: file.name, type: file.type, dataUrl: String(reader.result || "") });
      setAnswer(""); setSource(""); setError("");
    };
    reader.onerror = () => setError("The selected artifact could not be read.");
    reader.readAsDataURL(file);
  }

  async function analyze() {
    if (!capturedImage && !artifact) {
      setError("Capture a camera frame or upload an artifact first.");
      return;
    }
    if (!consentAccepted) {
      setError("Please accept consent before using ReadMe.");
      return;
    }

    setLoading(true);
    setError("");
    setAnswer("");
    setSource("");

    try {
      const data = await apiFetch("/pastorbot/readme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 60000,
        body: JSON.stringify({
          imageDataUrl: capturedImage,
          artifactDataUrl: artifact?.dataUrl || null,
          artifactName: artifact?.name || null,
          note,
          consentAccepted,
          language: mode,
          persona: mode === "en" ? "english-teaching-guide" : undefined,
        }),
      });

      const nextAnswer = data?.answer || "";
      setAnswer(nextAnswer);
      setSource(data?.source || "");
      if (nextAnswer) speak(nextAnswer);
    } catch (err) {
      setError(err?.body || err?.message || "ReadMe analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function speak(text = answer) {
    if (!text) return;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    const started = speakText(text, {
      lang: modes[mode].lang,
      fallbackLangs: mode === "pa" ? ["pa-PK", "hi-IN", "en-IN"] : mode === "hi" ? ["hi", "en-IN"] : ["en-US"],
      rate: mode === "en" ? 0.88 : 0.92,
      pitch: 0.96,
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });

    if (!started) setError("Voice playback is not available on this device.");
  }

  const current = modes[mode];

  return (
    <div className="readme-page min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl">
          <div className="grid gap-0 lg:grid-cols-[0.95fr_1.25fr]">
            <div className="relative min-h-[360px] overflow-hidden bg-gradient-to-br from-emerald-950 via-slate-950 to-amber-950 p-6 sm:p-8">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(250,204,21,.25),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,.22),transparent_30%)]" />
              <div className="relative z-10 flex h-full flex-col justify-between gap-8">
                <div className="flex items-center gap-4">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                    <Eye className="h-8 w-8 text-amber-200" />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.35em] text-amber-200">AI Counseller</p>
                    <h1 className="text-4xl font-black tracking-tight sm:text-5xl">ReadMe</h1>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-[170px_1fr] sm:items-center">
                  <div className="relative mx-auto h-40 w-40 rounded-[2rem] bg-white/10 p-4 ring-1 ring-white/15">
                    <PastorCharacter className="h-full w-full" />
                    <span className="absolute -bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-xs font-black text-white shadow-lg">
                      <Sparkles className="h-3.5 w-3.5" />
                      Ready
                    </span>
                  </div>
                  <div className="space-y-4">
                    <p className="max-w-xl text-lg leading-8 text-slate-100">{current.intro}</p>
                    <div className="grid gap-3 text-sm text-slate-200">
                      <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                        <span>Consent required. ReadMe uses only the camera frame or artifact you choose, plus your note.</span>
                      </div>
                      <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                        <span>It will not identify, judge, diagnose, or replace a real pastor in crisis situations.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 text-slate-950 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-2xl bg-slate-100 p-1">
                  {Object.entries(modes).map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMode(key)}
                      className={`readme-language-button rounded-xl px-4 py-2 text-sm font-black transition ${
                        mode === key ? "is-active bg-emerald-600 text-white shadow" : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {value.label}
                    </button>
                  ))}
                </div>
                {source && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-700">
                    {source === "ai" ? "AI Vision" : "Fallback"}
                  </span>
                )}
              </div>

              <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
                <section className="space-y-4">
                  <div className="readme-camera overflow-hidden rounded-3xl border border-slate-200 bg-slate-950">
                    <div className="relative aspect-video w-full">
                      <video
                        ref={videoRef}
                        className="h-full w-full object-cover"
                        playsInline
                        muted
                        autoPlay
                      />
                      {capturedImage && (
                        <img src={capturedImage} alt="Captured ReadMe frame" className="absolute inset-0 h-full w-full object-cover" />
                      )}
                      {!capturedImage && !cameraReady && (
                        <div className="readme-camera-empty absolute inset-0 grid place-items-center bg-slate-900/90 p-5 text-center text-white">
                          <div>
                            {cameraStarting ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-300" /> : <Video className="mx-auto h-9 w-9 text-amber-300" />}
                            <p className="mt-3 text-sm font-black">{cameraStarting ? "Starting camera…" : "Camera is off"}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-300">
                              {cameraStarting ? "Allow camera access if your browser asks." : "Select Start Camera to open the live preview."}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="readme-camera-status text-center text-xs font-bold" role="status" aria-live="polite">
                    {capturedImage ? "Frame captured — ready to submit." : cameraReady ? "Live camera ready — select Capture." : cameraStarting ? "Connecting to camera…" : "Camera not started."}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={startCamera}
                      disabled={cameraStarting || cameraReady}
                      className="readme-start-button inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-black text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cameraStarting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />}
                      {cameraStarting ? "Starting…" : cameraReady ? "Camera On" : "Start Camera"}
                    </button>
                    <button
                      type="button"
                      onClick={captureFrame}
                      disabled={!cameraReady || cameraStarting}
                      className="readme-capture-button inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Camera className="h-5 w-5" />
                      Capture
                    </button>
                    <button
                      type="button"
                      onClick={retake}
                      disabled={!capturedImage}
                      className="readme-retake-button inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-black text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <RefreshCw className="h-5 w-5" />
                      Retake
                    </button>
                  </div>

                  <div className="relative flex items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50 p-4">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-emerald-700"><Upload className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-emerald-950">Upload any supported artifact</div>
                      <div className="text-xs font-semibold text-emerald-800">Image, PDF, Word, PowerPoint, Excel, CSV, JSON or text · max 6 MB</div>
                    </div>
                    <label className="cursor-pointer rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">
                      Choose file
                      <input type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.xlsx,.csv,.json,.md,.html,.htm,.xml,.log,.txt" onChange={selectArtifact} />
                    </label>
                  </div>

                  {artifact && <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4"><FileText className="h-6 w-6 shrink-0 text-blue-700"/><div className="min-w-0 flex-1"><div className="truncate font-black text-blue-950">{artifact.name}</div><div className="text-xs font-semibold text-blue-700">Ready for AI explanation</div></div><button type="button" aria-label="Remove artifact" onClick={()=>setArtifact(null)} className="rounded-lg p-2 text-blue-800 hover:bg-blue-100"><X className="h-5 w-5"/></button></div>}
                </section>

                <section className="space-y-4">
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={current.placeholder}
                    rows={7}
                    className="readme-note w-full resize-none rounded-3xl border border-slate-200 bg-slate-50 p-4 text-base font-semibold text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />

                  <label className="readme-consent flex cursor-pointer items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
                    <input
                      type="checkbox"
                      checked={consentAccepted}
                      onChange={(event) => setConsentAccepted(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-emerald-600"
                    />
                    <span>I consent to share this captured frame or uploaded artifact and my note with the AI Counseller for explanation and guidance.</span>
                  </label>

                  <button
                    type="button"
                    onClick={analyze}
                    disabled={loading || (!capturedImage && !artifact) || !consentAccepted}
                    className="readme-submit-button inline-flex w-full items-center justify-center gap-3 rounded-3xl bg-emerald-600 px-5 py-4 text-lg font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    {artifact ? "Explain this artifact" : "Ask ReadMe Pastor"}
                  </button>

                  {answer && (
                    <button
                      type="button"
                      onClick={() => speak(answer)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-black text-emerald-800"
                    >
                      <Volume2 className="h-5 w-5" />
                      {speaking ? "Speaking..." : "Read Aloud"}
                    </button>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-base font-bold text-rose-700">
            {error}
          </div>
        )}

        {answer && (
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-950">Pastoral Guidance</h2>
                <p className="text-sm font-semibold text-slate-500">Generated from your consented {artifact ? "artifact" : "ReadMe"} session.</p>
              </div>
            </div>
            <div className="whitespace-pre-wrap rounded-3xl bg-slate-50 p-5 text-base font-medium leading-8 text-slate-800">
              {answer}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
