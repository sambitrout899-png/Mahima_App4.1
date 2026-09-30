const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { NATIVE_MODULES, createStory } = require('./story');
const { createContinuousShortNarration, continuousVisualTimeline, createSegment, composeFinalVideoWithMusic, mediaDuration } = require('./render-demo');
const routes = NATIVE_MODULES.map(([key, path]) => ({ key, path }));

for (const lang of ['hi', 'pa', 'en']) test(`${lang} timing retry changes and shortens all-module script`, async () => {
  const request = async () => { throw new Error('Compact native script should not call AI'); };
  const normal = await createStory(routes, lang, 60, request, 1);
  const brief = await createStory(routes, lang, 60, request, 0.8);
  assert.equal(brief.length, 37);
  assert.deepEqual(brief.map(r => r.key), normal.map(r => r.key));
  const words = story => story.reduce((sum, r) => sum + r.narration.split(/\s+/u).length, 0);
  assert.ok(words(brief) < words(normal));
  assert.notEqual(brief.map(r => r.narration).join(' '), normal.map(r => r.narration).join(' '));
});

for (const target of [60, 90]) test(`${target}s continuous visual timeline preserves frames and every module`, () => {
  const story = routes.map(r => ({ ...r, narration: 'सेवा जारी है।' }));
  const timeline = continuousVisualTimeline(story, target, 55, 1, 'silent.wav');
  assert.equal(timeline.length, 37);
  assert.ok(Math.abs(timeline.reduce((n,r)=>n+r.durationSeconds,0)-target)<0.0001);
  assert.ok(timeline.every(r=>r.durationSeconds>0 && Math.abs(r.durationSeconds*30-Math.round(r.durationSeconds*30))<0.0001));
  assert.ok(timeline.at(-1).durationSeconds > target-55);
});

test('English 37-scene 54s content retries with shorter text and preserves continuous audio', { skip: !process.env.FFMPEG_PATH, timeout: 300000 }, async () => {
  const ffmpeg = process.env.FFMPEG_PATH, ffprobe = process.env.FFPROBE_PATH;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-continuous-'));
  const run = args => execFileSync(ffmpeg, ['-v','error','-y',...args], { maxBuffer: 8000000 });
  const source = path.join(dir,'screen.png');
  run(['-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1',source]);
  const audio = [];
  for (const seconds of [90,55]) {
    const file = path.join(dir,`tone-${seconds}.wav`);
    run(['-f','lavfi','-i',`sine=frequency=440:duration=${seconds}`,file]);
    audio.push(await fs.readFile(file));
  }
  const originalFetch = global.fetch, key = process.env.OPENAI_API_KEY;
  const requests = [];
  try {
    process.env.OPENAI_API_KEY = 'synthetic-test-key';
    global.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return new Response(audio[Math.min(requests.length-1,1)]); };
    const result = await createContinuousShortNarration(routes.map(r=>({...r,screenshotPath:source})), 'en', dir, ffmpeg, ffprobe,
      { ttsVoice:'nova',ttsInstructions:'English woman',requireOpenAiSpeech:true },54,async()=>{throw Error('Unexpected story API call');});
    assert.equal(requests.length,2,'one long take followed by one shorter take, not 37 calls per retry');
    assert.ok(requests[1].input.split(/\s+/u).length < requests[0].input.split(/\s+/u).length);
    assert.ok(requests.every(r=>r.voice==='nova'));
    assert.ok(Math.abs(await mediaDuration(ffprobe,result.audioPath)-54)<0.02);
    const segments=[];
    for (const [i,item] of result.timeline.entries()) segments.push(await createSegment(ffmpeg,ffprobe,item.route,i,'en',dir,dir,{}));
    const output = path.join(dir,'all-37-modules.mp4');
    await composeFinalVideoWithMusic(ffmpeg,segments,dir,output,'none',0,54,result.audioPath);
    assert.ok(Math.abs(await mediaDuration(ffprobe,output)-54)<0.1);
    // Verify sound spans both early and late scenes without per-scene clipping.
    for (const at of [1,29.9,50]) {
      const samples=run(['-ss',String(at),'-i',output,'-t','0.1','-vn','-ar','8000','-ac','1','-f','f32le','-']);
      let sum=0;for(let i=0;i<samples.length;i+=4)sum+=samples.readFloatLE(i)**2;
      assert.ok(Math.sqrt(sum/(samples.length/4))>0.01);
    }
    console.log(`Verified 37-scene MP4 with shorter retry and continuous voice: ${output}`);
  } finally {
    global.fetch=originalFetch;
    if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;
  }
});

