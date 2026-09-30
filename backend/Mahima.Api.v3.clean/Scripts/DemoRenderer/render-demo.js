const fs = require("fs/promises");
const { PRESENTATION_BUILD, presentationTiming, createPresentationAssets, framedScreenFilter, markerTime } = require("./presentation");
const { createStory, voiceDirection, shortNativeStory } = require("./story");
const fss = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const DEMO_RENDERER_BUILD = "2026.09.18-cinematic-story-v7";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function runShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function openAiRetryDelay(response, responseBody, attempt) {
  const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "");
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1000) + 250;
  const requestedDelay = String(responseBody || "").match(/try again in\s+([\d.]+)\s*(ms|s)/i);
  if (requestedDelay) {
    const value = Number.parseFloat(requestedDelay[1]);
    return Math.ceil(requestedDelay[2].toLowerCase() === "s" ? value * 1000 : value) + 350;
  }
  return Math.min(30000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 350);
}

async function fetchOpenAiWithRetry(url, options, operation, maxAttempts = 3, wait = delay) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response;
    let body;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
      // Include the response body in the timeout, not just the HTTP headers.
      body = await response.arrayBuffer();
      if (response.ok) return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      const transient = error?.name === 'AbortError' || error instanceof TypeError || ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(error?.cause?.code || error?.code);
      lastError = error?.name === 'AbortError' ? operation + ' timed out after 60 seconds' : operation + ' connection failed: ' + error.message;
      if (!transient || attempt === maxAttempts - 1) throw new Error(lastError + ' after ' + (attempt + 1) + ' attempts.');
      clearTimeout(timeout);
      console.warn(operation + ' connection interrupted; retrying ' + (attempt + 2) + '/' + maxAttempts);
      await wait(Math.min(8000, 1000 * (2 ** attempt)));
      continue;
    } finally { clearTimeout(timeout); }
    const errorBody = Buffer.from(body).toString('utf8');
    lastError = operation + ' failed: ' + response.status + ' ' + errorBody;
    if (![408, 429].includes(response.status) && response.status < 500) throw new Error(lastError);
    if (attempt < maxAttempts - 1) await wait(openAiRetryDelay(response, errorBody, attempt));
  }
  throw new Error(lastError + ' after ' + maxAttempts + ' attempts.');
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command, versionArgs = ["--version"]) {
  try {
    await run(command, versionArgs);
    return true;
  } catch {
    return false;
  }
}

function buildAppUrl(routePath, appBaseUrl) {
  const base = String(appBaseUrl || "").replace(/\/+$/, "");
  const raw = String(routePath || "/home");
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("#")) return `${base}/${raw}`;
  if (raw.startsWith("/#")) return `${base}${raw}`;
  const clean = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}/#${clean}`;
}

function sameHashRoute(currentUrl, expectedUrl) {
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    if (expected.hash) return current.hash === expected.hash;
    return current.pathname === expected.pathname;
  } catch {
    return true;
  }
}

function langVoice(lang) {
  if (lang === "hi") return "hi";
  if (lang === "pa") return "pa";
  return "en";
}

async function createSilentAudio(ffmpeg, output, seconds) {
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", String(seconds),
    "-acodec", "pcm_s16le",
    output,
  ]);
}



async function createOpenAiSpeech(text, output, voiceConfig = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("OpenAI speech skipped: OPENAI_API_KEY is not set.");
    return false;
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = voiceConfig.ttsVoice || "nova";
  const instructions = voiceConfig.ttsInstructions || process.env.OPENAI_TTS_INSTRUCTIONS || "Speak like a real Indian male presenter from North India. Use warm Indian English pronunciation with natural pauses, gentle confidence, and a ministry-demo tone. Do not sound robotic or synthetic.";

  console.log(`Invoking OpenAI speech. Model=${model}, Voice=${voice}, Instructions=${instructions.slice(0, 90)}`);
  const response = await fetchOpenAiWithRetry(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      instructions,
      response_format: "mp3",
    }),
  }, "OpenAI speech");

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(output, buffer);
  return true;
}

const ANIMATION_STYLES = new Set(["push_in", "pan_left", "pan_right", "focus_top", "focus_center", "gentle_float"]);

function normalizeAnimationStyle(value) {
  const style = String(value || "gentle_float").trim().toLowerCase();
  return ANIMATION_STYLES.has(style) ? style : "gentle_float";
}

function liveAnimationFilter(style, duration) {
  const d = Math.max(1, Number(duration) || 6).toFixed(3);
  const motion = {
    pan_left: `scale=2048:1152,crop=1920:1080:x='128-(128*t/${d})':y=36`,
    pan_right: `scale=2048:1152,crop=1920:1080:x='128*t/${d}':y=36`,
    focus_top: "scale=2016:1134,crop=1920:1080:x=48:y=0",
    focus_center: "scale=2016:1134,crop=1920:1080:x=48:y=27",
    push_in: `scale=w='trunc(1920*(1+0.035*t/${d})/2)*2':h='trunc(1080*(1+0.035*t/${d})/2)*2':eval=frame,crop=1920:1080:x='(iw-ow)/2':y='(ih-oh)/2'`,
    gentle_float: "scale=2048:1152,crop=1920:1080:x='64+22*sin(t*0.45)':y='36+14*cos(t*0.38)'",
  }[normalizeAnimationStyle(style)];
  return `${motion},eq=contrast=1.025:saturation=1.04,fade=t=in:st=0:d=0.16,fade=t=out:st=${Math.max(0, Number(duration) - 0.16).toFixed(3)}:d=0.16,format=yuv420p`;
}

function stillAnimationFilter(style, duration) {
  const frames = Math.max(2, Math.ceil((Number(duration) || 6) * 30));
  const normalized = normalizeAnimationStyle(style);
  // Absolute frame-based easing avoids the old zoom reset/jump and early saturation.
  const ease = `(0.5-0.5*cos(PI*min(on/${frames - 1},1)))`;
  const zoom = normalized === "push_in" ? `1+0.045*${ease}` : "1.045";
  const x = normalized === "pan_left" ? `(iw-iw/zoom)*(1-${ease})` : normalized === "pan_right" ? `(iw-iw/zoom)*${ease}` : "iw/2-iw/zoom/2";
  const y = normalized === "focus_top" ? "0" : "ih/2-ih/zoom/2";
  const fade = Math.min(0.16, duration / 8);
  return `scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=1920x1080:fps=30,eq=contrast=1.025:saturation=1.04,fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade},format=yuv420p`;
}

async function createOpenAiScreenDirection(route, screenshotPath, lang) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI screen narration requires OPENAI_API_KEY.");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
  const extension = path.extname(screenshotPath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  const dataUrl = `data:${mime};base64,${(await fs.readFile(screenshotPath)).toString("base64")}`;
  const language = lang === "hi" ? "simple spoken Hindi" : lang === "pa" ? "simple spoken Punjabi" : "natural spoken English";
  const requiredContext = String(route.narration || route.title || "Mahima application module").trim();
  const response = await fetchOpenAiWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You direct a professional Mahima church-management product video. Preserve the supplied module context, connect it to the visible screen, and describe functional value accurately. Select one tasteful motion style that suits the visible layout. Never invent controls. Return JSON only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Screen title: '${route.title || "Mahima module"}'. Required functional context: '${requiredContext}'. Return {"narration":"1 or 2 connected sentences in ${language}, maximum 55 words","animation":"one of push_in, pan_left, pan_right, focus_top, focus_center, gentle_float"}. Keep the context and align narration and motion with visible content.` },
            // Low-detail vision is sufficient for UI narration and substantially reduces TPM usage.
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    }),
  }, "OpenAI screen narration");
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`OpenAI returned no direction for ${route.title || route.path}.`);
  let direction;
  try {
    direction = JSON.parse(content.replace(/^```json\s*|\s*```$/gi, ""));
  } catch {
    direction = { narration: content, animation: "gentle_float" };
  }
  const narration = String(direction?.narration || requiredContext).trim();
  return { narration, animation: normalizeAnimationStyle(direction?.animation) };
}

async function createNarrationAudio(text, lang, output, ffmpeg, voiceConfig = {}) {
  const template = process.env.DEMO_TTS_COMMAND;
  const voice = voiceConfig.ttsVoice || langVoice(lang);
  const requireOpenAiSpeech = Boolean(voiceConfig.requireOpenAiSpeech) || process.env.REQUIRE_OPENAI_SPEECH === "1";

  try {
    if (await createOpenAiSpeech(text, output, voiceConfig)) return;
  } catch (error) {
    if (requireOpenAiSpeech) throw error;
    console.warn(error.message || error);
  }

  if (requireOpenAiSpeech) {
    throw new Error("OpenAI speech is required for this render, but OPENAI_API_KEY is not configured or the speech request failed.");
  }
  if (template) {
    const command = template
      .replaceAll("{text}", shellQuote(text))
      .replaceAll("{output}", shellQuote(output))
      .replaceAll("{lang}", shellQuote(lang))
      .replaceAll("{voice}", shellQuote(voice))
      .replaceAll("{voiceKey}", shellQuote(voiceConfig.voiceKey || "default"));
    await runShell(command);
    if (await fileExists(output)) return;
  }

  if (await commandExists("espeak-ng")) {
    try {
      await run("espeak-ng", ["-v", voice, "-s", "145", "-w", output, text]);
      return;
    } catch {
      await run("espeak-ng", ["-v", "en", "-s", "145", "-w", output, text]);
      return;
    }
  }

  if (await commandExists("espeak")) {
    try {
      await run("espeak", ["-v", voice, "-s", "145", "-w", output, text]);
      return;
    } catch {
      await run("espeak", ["-v", "en", "-s", "145", "-w", output, text]);
      return;
    }
  }

  console.warn("No TTS command found; using silent audio. Install espeak-ng or set ProjectDemo:TtsCommand.");
  await createSilentAudio(ffmpeg, output, 6);
}

async function audioDuration(ffprobe, file, minimumSeconds = 6) {
  try {
    const result = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    const seconds = Number.parseFloat(result.stdout.trim());
    const minimum = Number.isFinite(Number(minimumSeconds)) ? Number(minimumSeconds) : 6;
    return Number.isFinite(seconds) && seconds > 1 ? Math.max(seconds + 0.35, minimum) : minimum;
  } catch {
    return Number.isFinite(Number(minimumSeconds)) ? Number(minimumSeconds) : 6;
  }
}

async function captureUploadedScreenshots(routes, screenshotsDir) {
  const captured = [];
  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    const source = route.uploadedImagePath;
    if (!source) return null;
    if (!(await fileExists(source))) throw new Error(`Uploaded screenshot is missing: ${source}`);
    const target = path.join(screenshotsDir, route.screenshotName || `${String(i + 1).padStart(2, "0")}${path.extname(source) || ".png"}`);
    await fs.copyFile(source, target);
    captured.push({ ...route, screenshotPath: target });
  }
  return captured;
}

async function captureScreenshots(payload, screenshotsDir) {
  const routes = payload.job.captureRoutes || [];
  const uploaded = await captureUploadedScreenshots(routes, screenshotsDir);
  if (uploaded) return uploaded;

  let chromium;
  try {
    chromium = require("playwright").chromium;
  } catch (error) {
    throw new Error("Playwright is not installed. Run: cd backend/Mahima.Api.v3.clean/Scripts/DemoRenderer && npm install && npx playwright install chromium");
  }

  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    throw new Error(`${error.message}\n\nFix on server:\n  cd /var/www/mahima-api/Scripts/DemoRenderer\n  HOME=/var/www XDG_CACHE_HOME=/var/www/.cache npx playwright install chromium\n\nAlternative: install system chromium and set ProjectDemo:ChromiumExecutablePath.`);
  }
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript((token) => {
    const cleanToken = String(token || "").replace(/^Bearer\s+/i, "").trim();
    window.localStorage.setItem("mahima_token", cleanToken);
    window.localStorage.setItem("authToken", cleanToken);
    window.localStorage.setItem("auth_token", cleanToken);
    window.localStorage.setItem("token", cleanToken);
    const demoUser = JSON.stringify({
      token: cleanToken,
      accessToken: cleanToken,
      username: "Demo Renderer",
      displayName: "Demo Renderer",
      role: "admin",
      pages: ["APP_DOWNLOADS", "PASTOR", "SERMONS", "PRAYER_REQUESTS", "TASKS", "PROJECT_MANAGEMENT", "USERS", "TEAMS", "ROLES", "POSITIONS", "ATTENDANCE", "PAYROLL", "COSTS", "MARRIAGE", "BAPTISM", "COUNSELLING", "PAGES", "REPORTS"]
    });
    ["mahima_user", "me", "currentUser", "mahima_currentUser", "user", "mahima:user"].forEach((key) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, demoUser);
    });
  }, payload.authToken);

  const page = await context.newPage();
  const captured = [];

  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    const url = buildAppUrl(route.path || "/home", payload.appBaseUrl);
    const file = path.join(screenshotsDir, route.screenshotName || `${String(i + 1).padStart(2, "0")}.png`);
    console.log(`Capturing ${url}`);
    // Mahima App keeps a persistent SignalR connection open, so "networkidle" never
    // resolves early here — it used to burn its full 60s timeout on every route before
    // falling back. domcontentloaded + the explicit #root/waitMs checks below are
    // sufficient signals that the page has actually rendered.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#root", { timeout: 15000 }).catch(() => {});
    const waitMs = Number(route.waitMs || 2400);
    await page.waitForTimeout(Number.isFinite(waitMs) ? waitMs : 2400);
    if (!sameHashRoute(page.url(), url)) {
      console.warn(`Route ${route.title || route.path} captured at ${page.url()} instead of ${url}`);
    }
    await page.screenshot({ path: file, fullPage: false });
    captured.push({ ...route, screenshotPath: file, captureVerified: sameHashRoute(page.url(), url) });
  }

  payload.captureStorageState = await context.storageState();
  await browser.close();
  return captured;
}

async function mediaDuration(ffprobe, file) {
  const result = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not verify media duration for ${file}.`);
  return seconds;
}

async function createLiveRouteSegments(payload, timeline, videoDir, segmentsDir, ffmpeg) {
  let chromium;
  try {
    chromium = require("playwright").chromium;
  } catch {
    throw new Error("Playwright is required for live route recording.");
  }
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOptions);
  const segments = [];
  try {
  for (let i = 0; i < timeline.length; i += 1) {
    const item = timeline[i];
    const url = buildAppUrl(item.route.path || "/home", payload.appBaseUrl);
    const routeVideoDir = path.join(videoDir, String(i + 1).padStart(2, "0"));
    await fs.mkdir(routeVideoDir, { recursive: true });
    const context = await browser.newContext({
      ...(payload.captureStorageState ? { storageState: payload.captureStorageState } : {}),
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      recordVideo: { dir: routeVideoDir, size: { width: 1920, height: 1080 } },
    });
    await context.addInitScript((token) => {
      const cleanToken = String(token || "").replace(/^Bearer\s+/i, "").trim();
      ["mahima_token", "authToken", "auth_token", "token"].forEach((key) => {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, cleanToken);
      });
    }, payload.authToken);
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const marker = document.createElement('div');
        marker.id = 'studio-recording-marker';
        marker.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;background:#ff00ff;z-index:2147483647;pointer-events:none';
        document.documentElement.appendChild(marker);
      }, { once: true });
    });
    const recordingStartedAt = Date.now();
    const page = await context.newPage();
    const video = page.video();
    console.log(`Synchronized recording ${i + 1}/${timeline.length}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#root", { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => Boolean(document.querySelector('#root')?.textContent?.trim()), null, { timeout:15000 });
    await page.waitForTimeout(Number(item.route.waitMs) || 2400);
    await page.evaluate(() => document.fonts.ready);
    if (!sameHashRoute(page.url(), url)) {
      const destination = new URL(page.url()).hash.split('?')[0] || new URL(page.url()).pathname;
      await context.close();
      if (item.route.captureVerified === true && item.route.screenshotPath && await fileExists(item.route.screenshotPath)) {
        console.warn(`Live route ${item.route.title} redirected to ${destination}; using its verified earlier capture with synchronized narration.`);
        segments.push(await createSegment(ffmpeg, null, { ...item.route, audioPath: item.audioPath, durationSeconds: item.durationSeconds }, i, payload.job?.language || 'en', videoDir, segmentsDir));
        continue;
      }
      throw new Error(`Live recording redirected away from ${item.route.title} to ${destination}, and no verified module capture is available. Check the signed-in account's access or provide a screenshot of this module.`);
    }
    await page.evaluate(() => { document.getElementById('studio-recording-marker').style.background='#00ff00'; });
    const preparationSeconds = (Date.now() - recordingStartedAt) / 1000;
    await page.mouse.move(1480, 180, { steps: 14 }).catch(() => {});
    const bodyHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)).catch(() => 1080);
    const totalMs = Math.min(6500, Math.max(2000, item.durationSeconds * 1000));
    if (bodyHeight > 1200) {
      await page.waitForTimeout(Math.max(500, totalMs * 0.28));
      await page.evaluate(() => window.scrollTo({ top: Math.min(document.body.scrollHeight * 0.24, 720), behavior: "smooth" })).catch(() => {});
      await page.waitForTimeout(Math.max(600, totalMs * 0.36));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })).catch(() => {});
      await page.waitForTimeout(Math.max(500, totalMs * 0.36));
    } else {
      await page.waitForTimeout(totalMs);
    }
    await page.close();
    await context.close();
    const recordedPath = await video.path();
    const segment = path.join(segmentsDir, `${String(i + 1).padStart(2, "0")}.mp4`);
    const marker = await run(ffmpeg, ['-hide_banner','-loglevel','error','-i',recordedPath,'-t',String(preparationSeconds+3),'-vf','crop=8:8:0:0,signalstats,metadata=mode=select:key=lavfi.signalstats.UAVG:value=90:function=less,metadata=mode=select:key=lavfi.signalstats.VAVG:value=90:function=less,metadata=mode=print:file=-','-an','-f','null','-']);
    const trimSeconds = markerTime(marker.stdout);
    const liveFilter = `drawbox=x=0:y=0:w=8:h=8:color=white:t=fill,tpad=stop_mode=clone:stop_duration=${item.durationSeconds},trim=duration=${item.durationSeconds},setpts=PTS-STARTPTS,${framedScreenFilter(item.durationSeconds)}`;
    const overlayInput = item.route.presentationOverlay ? ['-loop','1','-i',item.route.presentationOverlay] : [];
    const videoFilter = item.route.presentationOverlay ? ['-filter_complex',`[0:v]${liveFilter}[screen];[screen][2:v]overlay=0:0:format=auto,format=yuv420p[vout]`,'-map','[vout]','-map','1:a:0'] : ['-vf',liveFilter];
    await run(ffmpeg, [
      "-y", "-ss", trimSeconds.toFixed(3), "-i", recordedPath, "-i", item.audioPath, ...overlayInput,
      "-t", item.durationSeconds.toFixed(3),
      ...videoFilter,
      "-c:v", "libx264", "-preset", "veryfast", "-r", "30", "-pix_fmt", "yuv420p",
      "-af", "apad", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", segment,
    ]);
    segments.push(segment);
  }
  return segments;
  } finally { await browser.close(); }
}

async function createSegment(ffmpeg, ffprobe, route, index, lang, audioDir, segmentsDir, voiceConfig = {}) {
  const text = route.narration || route.title || "Mahima Application Demo";
  const audioExtension = process.env.OPENAI_API_KEY ? "mp3" : "wav";
  const audio = route.audioPath || path.join(audioDir, `${String(index + 1).padStart(2, "0")}.${audioExtension}`);
  const segment = path.join(segmentsDir, `${String(index + 1).padStart(2, "0")}.mp4`);
  if (!(await fileExists(audio))) await createNarrationAudio(text, lang, audio, ffmpeg, voiceConfig);
  const duration = Number(route.durationSeconds) || await audioDuration(ffprobe, audio, 6);

  const overlayInput = route.presentationOverlay ? ['-loop','1','-i',route.presentationOverlay] : [];
  const motion = stillAnimationFilter(route.animation, duration);
  const videoFilter = route.presentationOverlay ? ['-filter_complex',`[0:v]${motion},${framedScreenFilter(duration)}[screen];[screen][2:v]overlay=0:0:format=auto,format=yuv420p[vout]`,'-map','[vout]','-map','1:a:0'] : ['-vf',motion];
  await run(ffmpeg, [
    "-y",
    "-loop", "1",
    "-t", String(duration),
    "-i", route.screenshotPath,
    "-i", audio, ...overlayInput,
    "-t", String(duration),
    ...videoFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-r", String(30),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-af", "apad", "-ar", "48000", "-ac", "2",
    segment,
  ]);

  return segment;
}

async function createNarrationTimeline(captured, lang, audioDir, ffmpeg, ffprobe, voiceConfig, requestedDuration) {
  const timeline = [];
  for (let i = 0; i < captured.length; i += 1) {
    const route = captured[i];
    let narration = route.narration || route.title || "Mahima Application Demo";
    let animation = normalizeAnimationStyle(route.animation);
    // Prepared jobs already contain reviewed narration. Re-running vision for every
    // captured route doubles AI traffic and can leave short videos rate-limit bound.
    if (process.env.OPENAI_API_KEY && !String(route.narration || "").trim()) {
      const direction = await createOpenAiScreenDirection(route, route.screenshotPath, lang);
      narration = direction.narration;
      animation = direction.animation;
      console.log(`AI direction for ${route.title || route.path}: animation=${animation}`);
    }
    const extension = process.env.OPENAI_API_KEY ? "mp3" : "wav";
    const audioPath = path.join(audioDir, `${String(i + 1).padStart(2, "0")}.${extension}`);
    const cachePath = audioPath + '.json';
    const identity = JSON.stringify({ narration, lang, voiceConfig, model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', provider: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' });
    let speechSeconds = 0;
    if (await fileExists(cachePath) && await fileExists(audioPath)) {
      try {
        if (await fs.readFile(cachePath, 'utf8') === identity) speechSeconds = await mediaDuration(ffprobe, audioPath);
      } catch { /* Regenerate incomplete or invalid audio. */ }
    }
    if (!(speechSeconds > 0)) {
      await createNarrationAudio(narration, lang, audioPath, ffmpeg, voiceConfig);
      speechSeconds = await mediaDuration(ffprobe, audioPath);
      await fs.writeFile(cachePath, identity, 'utf8');
    } else console.log('Reusing verified narration audio for scene ' + (i + 1));
    const durationSeconds = speechSeconds + 0.35;
    timeline.push({ route: { ...route, narration, animation }, audioPath, speechSeconds, durationSeconds });
    // Smooth sequential requests across the provider's rolling token window.
    await delay(350);
  }
  return timeline;
}

function fitTimelineToDuration(timeline, requestedDuration) {
  const target = Math.min(Math.max(Number(requestedDuration) || 90, 30), 1800);
  if (!timeline.length) return timeline;
  const weights = timeline.map((item) => Math.max(1, Number(item.durationSeconds) || 1));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return timeline.map((item, index) => {
    const durationSeconds = index === timeline.length - 1
      ? Math.max(0.5, target - assigned)
      : Math.max(1 / 30, Math.round((assigned + target * weights[index] / weightTotal) * 30) / 30 - assigned);
    assigned += durationSeconds;
    return { ...item, route: { ...item.route, durationSeconds }, durationSeconds };
  });
}

// Stretch each complete utterance to its scene; never cut speech at guessed text offsets.
async function fitNarrationAudio(timeline, ffmpeg, audioDir) {
  for (let i = 0; i < timeline.length; i += 1) {
    const item = timeline[i];
    const speechBudget = Math.max(0.1, item.durationSeconds - 0.2);
    let tempo = Math.max(1, item.speechSeconds / speechBudget);
    const filters = [];
    while (tempo > 2) { filters.push("atempo=2"); tempo /= 2; }
    filters.push(`atempo=${tempo.toFixed(8)}`, "apad", `atrim=duration=${item.durationSeconds.toFixed(6)}`, "asetpts=PTS-STARTPTS");
    const fitted = path.join(audioDir, `${String(i + 1).padStart(2, "0")}-fitted.wav`);
    await run(ffmpeg, ["-y", "-i", item.audioPath, "-af", filters.join(","), "-ar", "48000", "-ac", "2", fitted]);
    item.audioPath = fitted;
    item.route.audioPath = fitted;
  }
}

function selectHighlightRoutes(routes, requestedDuration) {
  const items = Array.isArray(routes) ? routes : [];
  return items;
}

async function concatenateAudio(ffmpeg, timeline, outputRoot) {
  const listPath = path.join(outputRoot, "audio.txt");
  await fs.writeFile(listPath, timeline.map((item) => `file '${item.audioPath.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const output = path.join(outputRoot, "narration.m4a");
  await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "aac", "-b:a", "192k", output]);
  return output;
}

function backgroundMusicSource(style) {
  const beat = style === "peaceful" ? 0.75 : style === "corporate" ? 0.5 : 0.6;
  // Original repeating C-Am-F-G accompaniment, with a soft plucked arpeggio.
  const bar = beat * 8;
  const chord = `mod(floor(t/${bar}),4)`;
  const root = `if(eq(${chord},0),130.81,if(eq(${chord},1),110,if(eq(${chord},2),174.61,196)))`;
  const third = `if(eq(${chord},1),1.189207,1.259921)`;
  const note = `if(eq(mod(floor(t/${beat}),3),0),1,if(eq(mod(floor(t/${beat}),3),1),${third},1.498307))`;
  const rhythm = style === "peaceful" ? "0" : `0.10*sin(2*PI*65*t)*exp(-18*mod(t,${beat})/${beat})+0.025*sin(2*PI*6200*t)*exp(-35*mod(t,${beat / 2})/${beat / 2})`;
  const signal = `${rhythm}+0.08*sin(2*PI*(${root})*0.5*t)+0.12*(sin(2*PI*(${root})*t)+0.5*sin(2*PI*(${root})*(${third})*t)+0.4*sin(2*PI*(${root})*1.498307*t))+0.16*sin(2*PI*2*(${root})*(${note})*t)*exp(-4*mod(t,${beat})/${beat})`;
  return `aevalsrc=exprs='${signal}|${signal}':s=48000`;
}

async function composeFinalVideoWithMusic(ffmpeg, segments, outputRoot, outputPath, musicStyle, musicVolumeValue, targetDuration, continuousAudioPath) {
  const listPath = path.join(outputRoot, "segments.txt");
  const voiceOnlyPath = path.join(outputRoot, "voice-synchronized.mp4");
  await fs.writeFile(listPath, segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const narrationInput = continuousAudioPath ? ["-i", continuousAudioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac"] : ["-c", "copy"];
  await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...narrationInput, "-movflags", "+faststart", voiceOnlyPath]);

  const requestedStyle = String(musicStyle || "uplifting").toLowerCase();
  const style = ["none", "peaceful", "corporate", "uplifting"].includes(requestedStyle) ? requestedStyle : "uplifting";
  const jobVolume = Number(musicVolumeValue);
  if (style === "none" || jobVolume <= 0) {
    const duration = Number(targetDuration).toFixed(3);
    await run(ffmpeg, [
      "-y", "-reinit_filter", "0", "-i", voiceOnlyPath,
      "-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[vout];[0:a]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[aout]`,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-r", "30", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-t", duration, "-movflags", "+faststart", outputPath,
    ]);
    return;
  }
  const configuredMusic = process.env[`DEMO_BACKGROUND_MUSIC_${style.toUpperCase()}_PATH`] || process.env.DEMO_BACKGROUND_MUSIC_PATH;
  const hasConfiguredMusic = configuredMusic && await fileExists(configuredMusic);
  const generatedMusic = backgroundMusicSource(style);
  const musicInputArgs = hasConfiguredMusic
    ? ["-stream_loop", "-1", "-i", configuredMusic]
    : ["-f", "lavfi", "-i", generatedMusic];
  const requestedVolume = Number.isFinite(jobVolume) ? jobVolume : Number.parseFloat(process.env.DEMO_BACKGROUND_MUSIC_VOLUME || "0.35");
  const musicVolume = Number.isFinite(requestedVolume) ? Math.min(Math.max(requestedVolume, 0.01), 0.6) : 0.35;
  const duration = Number(targetDuration).toFixed(3);
  // Concat stream-copy can leave the video or narration slightly short because each
  // H.264/AAC segment ends on a codec time base. Normalize both streams here so
  // `-shortest` cannot truncate an otherwise valid 60/90-second render.
  const mediaFilter = `[0:v]tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[vout];[0:a]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,asplit=2[voice_sidechain][voice_mix];[1:a]highpass=f=75,lowpass=f=10000,loudnorm=I=-14:TP=-2:LRA=7,volume=${musicVolume},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, Number(targetDuration) - 2)}:d=2,apad,atrim=duration=${duration}[music];[music][voice_sidechain]sidechaincompress=threshold=0.06:ratio=3:attack=15:release=280[ducked];[voice_mix][ducked]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95:level=0:latency=1,apad,atrim=duration=${duration}[aout]`;
  await run(ffmpeg, [
    "-y", "-reinit_filter", "0", "-i", voiceOnlyPath, ...musicInputArgs,
    "-filter_complex", mediaFilter,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-r", "30", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-t", duration,
    "-metadata", `comment=Mahima Demo Studio; music=${style}; voice=OpenAI`, "-movflags", "+faststart", outputPath,
  ]);
}

async function createBookend(ffmpeg, assets, outputRoot, kind, seconds) {
  const output = path.join(outputRoot, `${kind}.mp4`);
  const footage = process.env.DEMO_CHURCH_VIDEO_PATH;
  if (footage && !(await fileExists(footage))) throw new Error('Configured church background video does not exist.');
  const background = footage ? ['-stream_loop','-1','-i',footage] : ['-loop','1','-framerate','30','-i',assets.church];
  const motion = footage
    ? 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30'
    : `scale=3840:2160,zoompan=z='1+0.045*(0.5-0.5*cos(PI*on/${Math.ceil(seconds*30)-1}))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30`;
  const filter = `[0:v]${motion},setsar=1,eq=brightness=-0.04:saturation=1.08[bg];[1:v]format=rgba,fade=t=in:st=0:d=0.7:alpha=1[logo];[bg][logo]overlay=x=0:y='24*(1-min(t/1,1))':format=auto,fade=t=in:st=0:d=0.35,fade=t=out:st=${seconds-0.35}:d=0.35,format=yuv420p[vout]`;
  await run(ffmpeg,['-y',...background,'-loop','1','-i',assets[kind],'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-filter_complex',filter,'-map','[vout]','-map','2:a:0','-t',String(seconds),'-r','30','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac',output]);
  return output;
}

function continuousVisualTimeline(story, target, speechSeconds, tempo, silentAudio) {
  // Screen boundaries are estimated by text length. The voice is never split or
  // trimmed at these boundaries; the closing screen holds through the tail.
  const totalFrames = Math.round(target * 30);
  const spokenFrames = Math.min(totalFrames, Math.ceil(speechSeconds / tempo * 30));
  const weights = story.map(route => Math.max(1, [...route.narration].filter(c => /\p{L}/u.test(c)).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cumulative = 0, assigned = 0;
  return story.map((route, index) => {
    cumulative += weights[index];
    const boundary = index === story.length - 1 ? totalFrames
      : Math.max(assigned + 1, Math.min(totalFrames - (story.length - index - 1), Math.round(cumulative / totalWeight * spokenFrames)));
    const durationSeconds = (boundary - assigned) / 30;
    assigned = boundary;
    return { route: { ...route, durationSeconds, audioPath: silentAudio }, durationSeconds, audioPath: silentAudio };
  });
}

async function createContinuousShortNarration(captured, lang, audioDir, ffmpeg, ffprobe, voiceConfig, target, storyRequest) {
  let lastDuration = 0;
  for (const scale of [1, 0.8]) {
    const story = await createStory(captured, lang, target, storyRequest, scale);
    const text = story.map(route => route.narration).join(" ");
    if (text.length > 4000) throw new Error("Continuous narration exceeds the speech input limit.");
    const source = path.join(audioDir, `continuous-${scale}.mp3`);
    console.log(`Continuous narration: one speech request, ${story.length} modules, ${text.split(/\s+/u).length} words.`);
    await createNarrationAudio(text, lang, source, ffmpeg, {
      ...voiceConfig,
      ttsInstructions: `${voiceConfig.ttsInstructions} Deliver this as one flowing ${target}-second tour with short connecting pauses. Do not restart your delivery for each clause or add headings.`,
    });
    const trimmed = path.join(audioDir, `continuous-${scale}-trimmed.wav`);
    // Remove only near-silent leading/trailing edges, preserving internal breaths.
    await run(ffmpeg, ["-y", "-i", source, "-af", "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse", "-ar", "48000", "-ac", "2", trimmed]);
    const seconds = await mediaDuration(ffprobe, trimmed);
    if (!(seconds > 0)) throw new Error("The speech provider returned empty narration audio.");
    lastDuration = seconds;
    const tempo = Math.max(1, seconds / (target - 0.2));
    console.log(`Continuous speech ${seconds.toFixed(2)}s; requested ${target}s; required tempo ${tempo.toFixed(3)}x.`);
    if (tempo > 1.2) continue;
    const fitted = [{ audioPath: trimmed, speechSeconds: seconds, durationSeconds: target, route: {} }];
    await fitNarrationAudio(fitted, ffmpeg, audioDir);
    const silentAudio = path.join(audioDir, "visual-silence.wav");
    await createSilentAudio(ffmpeg, silentAudio, 1);
    return { timeline: continuousVisualTimeline(story, target, seconds, tempo, silentAudio), audioPath: fitted[0].audioPath };
  }
  throw new Error(`Even the shorter continuous narration lasts ${lastDuration.toFixed(1)}s and cannot fit ${target}s within the 1.2x speech-speed limit. Select 90 seconds or try another voice.`);
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) throw new Error("Usage: node render-demo.js <payload.json>");

  const payloadText = (await fs.readFile(payloadPath, "utf8")).replace(/^\uFEFF/, "");
  const payload = JSON.parse(payloadText);
  if (payload.rendererBuild !== DEMO_RENDERER_BUILD) throw new Error("Demo API and renderer builds do not match. Deploy both together.");
  const outputRoot = payload.outputRoot || process.env.DEMO_RENDER_OUTPUT_ROOT || process.cwd();
  const screenshotsDir = path.join(outputRoot, "screenshots");
  const audioDir = path.join(outputRoot, "audio");
  const segmentsDir = path.join(outputRoot, "segments");
  const videoDir = path.join(outputRoot, "live-video");
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(segmentsDir, { recursive: true });
  await fs.mkdir(videoDir, { recursive: true });

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  if (!(await commandExists(ffmpeg, ["-version"]))) throw new Error("ffmpeg was not found. Install ffmpeg or set ProjectDemo:FfmpegPath.");

  const selectedRoutes = selectHighlightRoutes(payload.job.captureRoutes, payload.job.durationSeconds);
  const renderPayload = { ...payload, job: { ...payload.job, captureRoutes: selectedRoutes } };
  console.log(`Selected ${selectedRoutes.length}/${payload.job.captureRoutes?.length || 0} routes for the ${payload.job.durationSeconds || 90}-second render.`);
  const captured = await captureScreenshots(renderPayload, screenshotsDir);
  if (captured.length === 0) throw new Error("No capture routes were provided.");
  const targetDuration = Math.min(Math.max(Number(payload.job.durationSeconds) || 90, 30), 1800);
  const presentation = process.env.DEMO_PRESENTATION === '0' ? null : presentationTiming(targetDuration);
  const contentDuration = presentation ? presentation.content : targetDuration;
  let presentationAssets;
  if (presentation) {
    console.log(`Presentation ${PRESENTATION_BUILD}: ${presentation.intro}s opening, ${contentDuration}s modules, ${presentation.outro}s closing.`);
    presentationAssets = await createPresentationAssets(path.join(outputRoot,'presentation'),captured);
    captured.forEach((route,index) => { route.presentationOverlay = presentationAssets.chapters[index]; });
  }

  const voiceConfig = {
    voiceKey: payload.job.voiceKey,
    voiceLabel: payload.job.voiceLabel,
    ttsVoice: payload.job.ttsVoice,
    ttsInstructions: payload.job.ttsInstructions,
    requireOpenAiSpeech: Boolean(payload.job.requireOpenAiSpeech),
  };

  const outputName = payload.job.output || `mahima-app-demo-${payload.job.language || "en"}.mp4`;
  const outputPath = path.join(outputRoot, outputName);
  const lang = payload.job.language || "en";
  voiceConfig.ttsInstructions = voiceDirection(lang, voiceConfig);
  const storyRequest = async (body) => {
    if (!process.env.OPENAI_API_KEY) throw new Error("Story narration requires configured OpenAI speech and story services.");
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetchOpenAiWithRetry(baseUrl + "/chat/completions", {
      method: "POST", headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, "Story preparation");
    const result = await response.json();
    return JSON.parse(result.choices?.[0]?.message?.content || "{}");
  };
  let timeline;
  let continuousAudioPath;
  const continuousMode = Number(payload.job.durationSeconds) <= 90 && Boolean(shortNativeStory(captured, lang));
  if (continuousMode) {
    const narration = await createContinuousShortNarration(captured, lang, audioDir, ffmpeg, ffprobe, voiceConfig, contentDuration, storyRequest);
    timeline = narration.timeline;
    continuousAudioPath = narration.audioPath;
  } else {
  for (let attempt = 0; attempt < 3; attempt++) {
    const story = await createStory(captured, lang, contentDuration, storyRequest, 0.8 ** attempt);
    const narrationTimeline = await createNarrationTimeline(story, lang, audioDir, ffmpeg, ffprobe, voiceConfig, contentDuration);
    timeline = fitTimelineToDuration(narrationTimeline, contentDuration);
    if (timeline.every(item => item.speechSeconds / Math.max(0.1, item.durationSeconds - 0.2) <= 1.2)) break;
    if (attempt === 2) throw new Error("Narration cannot fit naturally. Please try generating again or select a longer runtime.");
    console.log("Shortening the complete story to preserve natural speech timing.");
  }
  }
  await fs.writeFile(path.join(outputRoot, "storyboard.json"), JSON.stringify(timeline.map(item => ({ title: item.route.title, narration: item.route.narration, durationSeconds: item.durationSeconds })), null, 2));
  if (!continuousMode) await fitNarrationAudio(timeline, ffmpeg, audioDir);
  const uploadedMode = captured.every((route) => route.uploadedImagePath || route.source === "uploaded");
  const shortVideoMode = Number(payload.job.durationSeconds || 90) <= 90;
  let segments;
  if (!uploadedMode && !shortVideoMode) {
    segments = await createLiveRouteSegments(renderPayload, timeline, videoDir, segmentsDir, ffmpeg);
  } else {
    segments = [];
    for (let i = 0; i < timeline.length; i += 1) {
      segments.push(await createSegment(ffmpeg, ffprobe, timeline[i].route, i, lang, audioDir, segmentsDir, voiceConfig));
    }
  }
  if (presentation) {
    const intro = await createBookend(ffmpeg,presentationAssets,segmentsDir,'intro',presentation.intro);
    const outro = await createBookend(ffmpeg,presentationAssets,segmentsDir,'outro',presentation.outro);
    segments = [intro,...segments,outro];
    if (continuousAudioPath) {
      const delayed = path.join(audioDir,'narration-with-bookends.wav');
      await run(ffmpeg,['-y','-i',continuousAudioPath,'-af',`adelay=${presentation.intro*1000}:all=1,apad,atrim=duration=${targetDuration}`,'-ar','48000','-ac','2',delayed]);
      continuousAudioPath = delayed;
    }
  }
  await composeFinalVideoWithMusic(ffmpeg, segments, outputRoot, outputPath, payload.job.musicStyle, payload.job.musicVolume, targetDuration, continuousAudioPath);
  if (!fss.existsSync(outputPath)) throw new Error(`MP4 was not created: ${outputPath}`);
  const renderedDuration = await mediaDuration(ffprobe, outputPath);
  if (Math.abs(renderedDuration - targetDuration) > 1.5) throw new Error(`MP4 duration validation failed: requested ${targetDuration}s, created ${renderedDuration.toFixed(2)}s.`);
  const audioProbe = await run(ffprobe, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", outputPath]);
  if (!String(audioProbe.stdout || "").trim()) throw new Error("MP4 validation failed: narration/music audio stream is missing.");
  console.log(`Created ${outputPath}`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = { createBookend, createLiveRouteSegments, createSegment, continuousVisualTimeline, createContinuousShortNarration, fetchOpenAiWithRetry, selectHighlightRoutes, stillAnimationFilter, liveAnimationFilter, fitTimelineToDuration, fitNarrationAudio, createNarrationTimeline, composeFinalVideoWithMusic, mediaDuration };
