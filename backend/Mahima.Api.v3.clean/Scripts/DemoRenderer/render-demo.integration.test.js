const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync, spawn } = require("node:child_process");
const { mediaDuration } = require("./render-demo");

test("full 60/90-second render preserves scene/audio boundaries and selected voice", { skip: !process.env.FFMPEG_PATH, timeout: 300000 }, async () => {
  const ffmpeg = process.env.FFMPEG_PATH;
  const ffprobe = process.env.FFPROBE_PATH;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "demo-full-render-"));
  const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { maxBuffer: 8000000 });
  const tones = [];
  for (const [index, color, frequency] of [[0, "red", 440], [1, "blue", 880]]) {
    run(["-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", path.join(dir, `${index}.png`)]);
    run(["-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=35`, path.join(dir, `${index}.wav`)]);
    tones.push(await fs.readFile(path.join(dir, `${index}.wav`)));
  }
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (req.url === "/chat/completions") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scenes: [{ id: 0, narration: "Red scene narration" }, { id: 1, narration: "Blue scene narration" }] }) } }] }));
      return;
    }
    requests.push(request);
    res.setHeader("Content-Type", "audio/wav");
    res.end(tones[request.input === "Red scene narration" ? 0 : 1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const duration of [60, 90]) {
      const outputRoot = path.join(dir, String(duration));
      const payloadPath = path.join(dir, `${duration}.json`);
      const output = `mahima-app-demo-en-${duration}s.mp4`;
      await fs.writeFile(payloadPath, JSON.stringify({
        rendererBuild: "2026.09.18-cinematic-story-v7", outputRoot,
        job: { language: "en", durationSeconds: duration, output, musicStyle: "uplifting", musicVolume: 0.12, ttsVoice: "nova", ttsInstructions: "Female presenter", requireOpenAiSpeech: true,
          captureRoutes: [0, 1].map((i) => ({ title: i ? "Blue" : "Red", narration: i ? "Blue scene narration" : "Red scene narration", uploadedImagePath: path.join(dir, `${i}.png`) })) },
      }));
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "render-demo.js"), payloadPath], { env: { ...process.env, OPENAI_API_KEY: "synthetic", OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
        let log = "";
        child.stdout.on("data", (chunk) => { log += chunk; });
        child.stderr.on("data", (chunk) => { log += chunk; });
        child.on("error", reject);
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(log)));
      });
      const video = path.join(outputRoot, output);
      assert.ok(Math.abs(await mediaDuration(ffprobe, video) - duration) < 0.1);
      // In the 90s case, the first 35s utterance ends before its 45s scene.
      // Sample inside the utterance rather than in the intentional padded pause.
      for (const [time, expectedFrequency, channel] of [[Math.min(duration / 2 - 2, 30), 440, 0], [duration / 2 + 2, 880, 2]]) {
        const pixel = run(["-ss", String(time), "-i", video, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        assert.ok(pixel[channel] > 150, `Wrong scene at ${time}s`);
        const audio = run(["-ss", String(time), "-i", video, "-t", "0.25", "-vn", "-ar", "8000", "-ac", "1", "-f", "f32le", "-"]);
        const power = (frequency) => {
          let real = 0, imaginary = 0;
          for (let i = 0; i < audio.length / 4; i++) {
            const value = audio.readFloatLE(i * 4), angle = 2 * Math.PI * frequency * i / 8000;
            real += value * Math.cos(angle); imaginary += value * Math.sin(angle);
          }
          return real ** 2 + imaginary ** 2;
        };
        assert.ok(power(expectedFrequency) > power(expectedFrequency === 440 ? 880 : 440) * 5, `Wrong narration at ${time}s`);
      }
      console.log(`Verified full ${duration}s MP4 with matching color/tone scene boundaries.`);
    }
    assert.equal(requests.length, 4);
    assert.ok(requests.every((request) => request.voice === "nova"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
