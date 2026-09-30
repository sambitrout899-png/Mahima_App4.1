import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesDemoSettings, newDemoRenderAttempt } from "./demoRenderState.js";

const settings = { language: "en", durationSeconds: 60, voiceKey: "indian_female_presenter", musicStyle: "uplifting", musicVolume: 0.12 };
const voice = { label: "Indian woman", ttsVoice: { en: "nova" }, ttsInstructions: "Female presenter" };
const oldJob = { ...settings, id: "old-90", durationSeconds: 90, status: "completed", downloadUrl: "/old-90/download", output: "old-90.mp4", outputFileName: "old-90.mp4", completedAtUtc: "yesterday", captureRoutes: [{ title: "Home" }] };

test("60 seconds cannot display the old 90-second download", () => {
  assert.equal(matchesDemoSettings(oldJob, settings), false);
  assert.equal(matchesDemoSettings({ ...oldJob, durationSeconds: 60 }, settings), true);
  for (const change of [{ voiceKey: "male" }, { musicStyle: "none" }, { musicVolume: 0 }, { language: "hi" }]) {
    assert.equal(matchesDemoSettings({ ...settings, ...change }, settings), false);
  }
});

test("regenerating a completed demo creates an independent queued attempt", () => {
  const attempt = newDemoRenderAttempt(oldJob, settings, voice, "new-60");
  assert.equal(attempt.id, "new-60");
  assert.equal(attempt.status, "queued");
  assert.equal(attempt.durationSeconds, 60);
  assert.equal(attempt.output, "mahima-app-demo-en-60s.mp4");
  assert.equal(attempt.downloadUrl, null);
  assert.equal(attempt.outputFileName, null);
  assert.equal(attempt.completedAtUtc, null);
  assert.equal(attempt.ttsVoice, "nova");
  assert.equal(attempt.musicVolume, 0.12);
  assert.deepEqual(attempt.captureRoutes, oldJob.captureRoutes);
  assert.equal(oldJob.status, "completed");
  assert.equal(oldJob.durationSeconds, 90);
});
