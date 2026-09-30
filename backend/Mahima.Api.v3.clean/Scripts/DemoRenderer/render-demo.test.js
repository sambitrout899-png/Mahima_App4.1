const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fitTimelineToDuration, fitNarrationAudio, createNarrationTimeline, composeFinalVideoWithMusic, mediaDuration } = require("./render-demo");

for (const target of [60, 90, 300, 600]) {
  test(`${target}s timeline keeps scene boundaries on video frames`, () => {
    const timeline = fitTimelineToDuration([3, 11, 29, 7, 17, 4].map((durationSeconds) => ({ durationSeconds, route: {} })), target);
    assert.ok(Math.abs(timeline.reduce((sum, item) => sum + item.durationSeconds, 0) - target) < 0.00001);
    for (const item of timeline) assert.ok(Math.abs(item.durationSeconds * 30 - Math.round(item.durationSeconds * 30)) < 0.00001);
  });
}

test("FFmpeg fits complete speech and renders audible music at the requested runtime", { skip: !process.env.FFMPEG_PATH }, async () => {
  const ffmpeg = process.env.FFMPEG_PATH;
  const ffprobe = process.env.FFPROBE_PATH;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mahima-demo-test-"));
  const run = (args) => execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  const audio = path.join(dir, "speech.wav");
  run(["-f", "lavfi", "-i", "sine=frequency=440:duration=30", audio]);
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const requests = [];
  try {
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(await fs.readFile(audio));
    };
    const generated = await createNarrationTimeline([
      { narration: "First screen's complete narration." },
      { narration: "Second screen's distinct narration." },
    ], "en", dir, ffmpeg, ffprobe, { ttsVoice: "shimmer", ttsInstructions: "Gentle female presenter", requireOpenAiSpeech: true }, 60);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].input, "First screen's complete narration.");
    assert.equal(requests[1].input, "Second screen's distinct narration.");
    assert.ok(requests.every((request) => request.voice === "shimmer" && request.instructions === "Gentle female presenter"));
    assert.ok(generated.every((item) => item.speechSeconds >= 30), "Speech duration must not be capped at 24 seconds");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
  for (const durationSeconds of [5, 40]) {
    const timeline = [{ audioPath: audio, speechSeconds: 30, durationSeconds, route: {} }];
    await fitNarrationAudio(timeline, ffmpeg, dir);
    assert.ok(Math.abs(await mediaDuration(ffprobe, timeline[0].audioPath) - durationSeconds) < 0.01);
    // A tone near the end verifies that compression retained the whole utterance.
    if (durationSeconds === 5) {
      const tail = execFileSync(ffmpeg, ["-v", "error", "-ss", "4.5", "-i", timeline[0].audioPath, "-t", "0.1", "-f", "s16le", "-"]);
      assert.ok(tail.some((byte) => byte !== 0));
    }
  }
  const segment = path.join(dir, "silent.mp4");
  run(["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-c:a", "aac", segment]);
  for (const [style, volume, duration] of [["uplifting", 0.12, 60], ["peaceful", 0.12, 90], ["corporate", 0.12, 3], ["none", 0.12, 3], ["uplifting", 0, 3]]) {
    const output = path.join(dir, `${style}-${volume}.mp4`);
    await composeFinalVideoWithMusic(ffmpeg, [segment], dir, output, style, volume, duration);
    assert.ok(Math.abs(await mediaDuration(ffprobe, output) - duration) < 0.1);
    const samples = execFileSync(ffmpeg, ["-v", "error", "-i", output, "-vn", "-f", "f32le", "-ac", "1", "-ar", "8000", "-"], { maxBuffer: 8000000 });
    let sum = 0;
    for (let i = 0; i < samples.length; i += 4) sum += samples.readFloatLE(i) ** 2;
    const rms = Math.sqrt(sum / (samples.length / 4));
    if (style === "none" || volume === 0) assert.ok(rms < 0.00001);
    else assert.ok(rms > 0.003, `${style} music is too quiet: ${rms}`);
  }
});
