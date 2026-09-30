const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStory, validateStory, voiceDirection, normalizeNarration } = require('./story');
const { selectHighlightRoutes, fitTimelineToDuration } = require('./render-demo');

for (const duration of [60, 90]) {
  test(`${duration}s film preserves all 37 modules and exact runtime`, async () => {
    const routes = Array.from({ length: 37 }, (_, i) => ({ title: `Module ${i}` }));
    assert.deepEqual(selectHighlightRoutes(routes, duration), routes);
    const story = await createStory(routes, 'hi', duration, async body => {
      const prompt = JSON.parse(body.messages[1].content);
      assert.equal(prompt.modules.length, 37);
      return { scenes: routes.map((_, id) => ({ id, narration: 'सेवा जारी है।' })) };
    });
    const timeline = fitTimelineToDuration(story.map(route => ({ route, durationSeconds: 3 })), duration);
    assert.equal(timeline.length, 37);
    assert.ok(Math.abs(timeline.reduce((n, r) => n + r.durationSeconds, 0) - duration) < 0.001);
  });
}

test('native script validation rejects English mixtures, wrong languages and omitted modules', () => {
  const routes = [{ title: 'Prayer' }];
  const scenes = narration => ({ scenes: [{ id: 0, narration }] });
  assert.throws(() => validateStory(scenes('Prayer requests ਸੇਵਾ'), routes, 'pa', 20));
  assert.throws(() => validateStory(scenes('प्रार्थना करें।'), routes, 'pa', 20));
  assert.throws(() => validateStory({ scenes: [] }, routes, 'hi', 20));
  assert.throws(() => validateStory(scenes('ਸੇਵਾ ਕਰਦੇ ਹਾਂ।'), routes, 'pa', 2));
  assert.equal(validateStory(scenes('ਰਲ ਮਿਲ ਕੇ ਸੇਵਾ ਕਰੀਏ।'), routes, 'pa', 20).length, 1);
});

test('story validation requests a correction before accepting a native script story', async () => {
  let calls = 0;
  const result = await createStory([{ title: 'Prayer' }], 'pa', 60, async body => {
    calls++;
    if (calls === 2) assert.match(JSON.parse(body.messages[1].content).correction, /native script/);
    return { scenes: [{ id: 0, narration: calls === 1 ? 'Pray together' : 'ਰਲ ਮਿਲ ਕੇ ਪ੍ਰਾਰਥਨਾ ਕਰੀਏ।' }] };
  });
  assert.equal(calls, 2);
  assert.match(result[0].narration, /ਪ੍ਰਾਰਥਨਾ/);
});

test('voice direction respects language and gender without inherited English pronunciation', () => {
  for (const lang of ['hi', 'pa']) {
    for (const gender of ['female', 'male']) {
      const direction = voiceDirection(lang, { voiceKey: `indian_${gender}_presenter`, ttsInstructions: 'Use Indian English rhythm' });
      assert.match(direction, new RegExp(gender === 'female' ? 'woman' : 'man'));
      assert.ok(!direction.includes('Use Indian English rhythm'));
      assert.ok(direction.includes(lang === 'hi' ? 'Devanagari' : 'Gurmukhi'));
    }
  }
});

test('product names and acronyms become native-script speech without accepting English prose', () => {
  for (const lang of ['hi', 'pa']) {
    const text = normalizeNarration('Mahima Google Drive ReadMe AI PDF UPI SaaS PMO QA MP4 WhatsApp', lang);
    assert.doesNotMatch(text, /[a-z]/i);
    const story = validateStory({ scenes: [{ id: 0, narration: text }] }, [{ title: 'Files' }], lang, 40);
    assert.equal(story[0].narration, text);
    assert.throws(() => validateStory({ scenes: [{ id: 0, narration: 'Mahima helps church teams manage tasks' }] }, [{}], lang, 40));
  }
});

test('repair receives the actual draft and every faulty scene, retaining all 37 modules', async () => {
  const routes = Array.from({ length: 37 }, (_, i) => ({ title: `Module ${i}` }));
  let calls = 0;
  const draft = { scenes: routes.map((_, id) => ({ id, narration: [4, 19, 36].includes(id) ? 'Manage tasks' : 'ਸੇਵਾ ਜਾਰੀ ਹੈ।' })) };
  const story = await createStory(routes, 'pa', 60, async body => {
    calls++;
    if (calls === 1) return draft;
    const prompt = JSON.parse(body.messages[1].content);
    assert.deepEqual(prompt.previousDraft, draft);
    for (const id of [4, 19, 36]) assert.ok(prompt.correction.includes(`scene id ${id}:`));
    assert.match(prompt.repairInstructions, /Keep valid scenes unchanged/);
    return { scenes: draft.scenes.map(scene => ({ ...scene, narration: 'ਸੇਵਾ ਜਾਰੀ ਹੈ।' })) };
  });
  assert.equal(calls, 2);
  assert.equal(story.length, 37);
  assert.equal(story[36].narration, 'ਸੇਵਾ ਜਾਰੀ ਹੈ।');
});

test('persistent English output still fails after bounded repair attempts', async () => {
  let calls = 0;
  await assert.rejects(createStory([{}], 'hi', 60, async () => {
    calls++;
    return { scenes: [{ id: 0, narration: 'English narration' }] };
  }), /scene id 0/);
  assert.equal(calls, 3);
});

for (const lang of ['en', 'hi', 'pa']) {
  test(`${lang}: omitted scenes are filled in batches without losing the original 37-module plan`, async () => {
    const routes = Array.from({ length: 37 }, (_, id) => ({ title: `Module ${id}`, path: `/module/${id}` }));
    const native = lang === 'hi' ? 'सेवा जारी है।' : lang === 'pa' ? 'ਸੇਵਾ ਜਾਰੀ ਹੈ।' : 'Service continues here.';
    let calls = 0;
    const result = await createStory(routes, lang, 60, async body => {
      const prompt = JSON.parse(body.messages[1].content);
      calls++;
      if (calls === 1) return { scenes: [{ id: 0, narration: native }, { id: 36, narration: native }] };
      assert.ok(prompt.requestedSceneIds.length <= 6);
      assert.ok(!prompt.requestedSceneIds.includes(0));
      assert.ok(!prompt.requestedSceneIds.includes(36));
      return { scenes: [...prompt.requestedSceneIds].reverse().map(id => ({ id: String(id), narration: native })) };
    });
    assert.equal(calls, 7);
    assert.equal(result.length, 37);
    assert.deepEqual(result.map(r => r.path), routes.map(r => r.path));
    assert.ok(result.every(r => r.narration === native));
  });
}

test('duplicate ids are repaired explicitly; unknown ids cannot replace missing modules', async () => {
  let calls = 0;
  const result = await createStory([{ title: 'A' }, { title: 'B' }, { title: 'C' }], 'en', 60, async body => {
    calls++;
    if (calls === 1) return { scenes: [{ id: 0, narration: 'Welcome.' }, { id: 1, narration: 'First.' }, { id: 1, narration: 'Conflicting.' }, { id: 999, narration: 'Unknown.' }] };
    const prompt = JSON.parse(body.messages[1].content);
    assert.deepEqual(prompt.requestedSceneIds, [1, 2]);
    return { scenes: [{ id: 2, narration: 'Together we thrive.' }, { id: 1, narration: 'We serve.' }] };
  });
  assert.deepEqual(result.map(r => r.narration), ['Welcome.', 'We serve.', 'Together we thrive.']);
});

test('a partial repair survives another omitted response', async () => {
  let calls = 0;
  const result = await createStory([{}, {}, {}], 'en', 60, async body => {
    calls++;
    const prompt = JSON.parse(body.messages[1].content);
    if (calls === 1) return { scenes: [{ id: 0, narration: 'Welcome.' }] };
    if (calls === 2) return { scenes: [{ id: 1, narration: 'We serve.' }] };
    assert.deepEqual(prompt.requestedSceneIds, [2]);
    return { scenes: [{ id: 2, narration: 'Together we thrive.' }] };
  });
  assert.equal(result.length, 3);
});

test('overlong narration is shortened without dropping modules', async () => {
  let calls = 0;
  const result = await createStory([{}, {}], 'en', 60, async body => {
    calls++;
    const prompt = JSON.parse(body.messages[1].content);
    return { scenes: prompt.requestedSceneIds.map(id => ({ id, narration: calls === 1 ? 'word '.repeat(100) : 'We serve together.' })) };
  });
  assert.equal(calls, 2);
  assert.equal(result.length, 2);
});

test('persistent omissions identify missing ids after bounded retries', async () => {
  let calls = 0;
  await assert.rejects(createStory([{}, {}], 'en', 60, async () => {
    calls++;
    return { scenes: [{ id: 0, narration: 'Welcome.' }] };
  }), /Missing scene id 1/);
  assert.equal(calls, 3);
});

for (const [lang, narration] of [['hi', 'हम सेवा करते हैं।'], ['pa', 'ਅਸੀਂ ਸੇਵਾ ਕਰਦੇ ਹਾਂ।']]) {
  test(`${lang}: complete 37-scene story above 115 words proceeds to measured audio timing`, async () => {
    const routes = Array.from({ length: 37 }, (_, id) => ({ title: `Module ${id}` }));
    let calls = 0;
    const result = await createStory(routes, lang, 60, async body => {
      calls++;
      const prompt = JSON.parse(body.messages[1].content);
      assert.equal(prompt.maximumTotalWords, 115);
      return { scenes: prompt.requestedSceneIds.map(id => ({ id, narration })) };
    });
    assert.ok(calls >= 2 && calls <= 8, 'bounded shortening batches');
    assert.equal(result.length, 37);
    assert.ok(result.every(scene => scene.narration === narration), 'complete sentences remain intact');
    assert.ok(result.reduce((n, scene) => n + scene.narration.split(/\s+/u).length, 0) > 115);
  });
}

test('soft runtime budget never accepts mixed English or missing modules', async () => {
  let calls = 0;
  await assert.rejects(createStory([{}, {}], 'hi', 60, async body => {
    calls++;
    const prompt = JSON.parse(body.messages[1].content);
    return { scenes: prompt.requestedSceneIds.filter(id => id === 0).map(id => ({ id, narration: 'English '.repeat(150) })) };
  }), /native script/);
  assert.equal(calls, 3);
});

for (const lang of ['hi', 'pa']) {
  test(lang + ': all known modules survive persistent malformed AI narration', async () => {
    const { NATIVE_MODULES } = require('./story');
    const routes = NATIVE_MODULES.map(([key, path]) => ({ key, path: '#' + path }));
    const result = await createStory(routes, lang, 300, async body => {
      const prompt = JSON.parse(body.messages[1].content);
      return { scenes: prompt.requestedSceneIds.map(id => ({ id, narration: 'English marketing text' })) };
    });
    assert.equal(result.length, 37);
    assert.deepEqual(result.map(r => r.key), routes.map(r => r.key));
    assert.ok(result.every(r => !/[a-z]/i.test(r.narration)));
    assert.equal(validateStory({ scenes: result.map((r, id) => ({ id, narration: r.narration })) }, routes, lang, Infinity).length, 37);
  });
}

test('reported Digital Marketing scene failure uses Hindi fallback and preserves valid scenes', async () => {
  const { NATIVE_MODULES } = require('./story');
  const routes = NATIVE_MODULES.map(([key, path]) => ({ key, path }));
  const result = await createStory(routes, 'hi', 300, async body => {
    const prompt = JSON.parse(body.messages[1].content);
    return { scenes: prompt.requestedSceneIds.map(id => ({ id, narration: id === 28 ? 'Digital Marketing प्रचार' : 'सेवा जारी है।' })) };
  });
  assert.equal(result[28].narration, 'प्रचार से लोगों तक पहुँचते हैं।');
  assert.equal(result[0].narration, 'सेवा जारी है।');
  assert.equal(result[36].narration, 'सेवा जारी है।');
});

test('known-module fallback cannot be applied to arbitrary uploaded screenshots', async () => {
  await assert.rejects(createStory([{ key: 'DIGITAL_MARKETING', uploadedImagePath: '/tmp/custom.png' }], 'hi', 60, async () => ({ scenes: [] })), /no valid hi narration or known-module fallback/);
});

for (const lang of ['hi', 'pa']) {
 test(lang + ': short known-module tour never requests an oversized AI script', async () => {
   const { NATIVE_MODULES } = require('./story');
   const routes = NATIVE_MODULES.map(([key,path])=>({key,path}));
   const result = await createStory(routes,lang,60,async()=>{throw Error('Story provider must not be called');});
   assert.equal(result.length,37);
   const words=result.reduce((n,r)=>n+r.narration.split(/\s+/u).length,0);
   assert.ok(words<=150, 'Compact script: '+words);
 });
}
test('oversized unrecognized story is rejected before expensive speech synthesis', async () => {
 const routes=Array.from({length:37},()=>({}));
 await assert.rejects(createStory(routes,'en',60,async body=>({scenes:JSON.parse(body.messages[1].content).requestedSceneIds.map(id=>({id,narration:'word '.repeat(17)}))})), /too long for speech generation/);
});

test('English cinematic short story covers all modules within the 54s word budget', async () => {
 const {NATIVE_MODULES,shortNativeStory}=require('./story');
 const routes=NATIVE_MODULES.map(([key,path])=>({key,path,narration:'Long reference description '.repeat(25)}));
 for(const duration of [54,84]) {
  const result=await createStory(routes,'en',duration,async()=>{throw Error('Must not request an oversized English story');});
  assert.deepEqual(result.map(r=>r.path),routes.map(r=>r.path));
  assert.ok(result.reduce((n,r)=>n+r.narration.split(/\s+/u).length,0)<=102);
 }
 assert.equal(shortNativeStory(routes.map(r=>({...r,uploadedImagePath:'/custom.png'})),'en'),null);
 assert.equal(shortNativeStory(routes.map((r,i)=>i===0?{...r,path:'/unknown'}:r),'en'),null);
});
