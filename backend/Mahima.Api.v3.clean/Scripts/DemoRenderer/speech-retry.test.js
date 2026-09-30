const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchOpenAiWithRetry } = require('./render-demo');

test('speech timeout and interrupted body retry before returning complete audio', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    if (calls === 2) return { ok: true, arrayBuffer: async () => { throw new TypeError('connection reset'); } };
    return new Response('complete audio');
  };
  try {
    const response = await fetchOpenAiWithRetry('https://example.invalid', {}, 'Speech', 3, async () => {});
    assert.equal(await response.text(), 'complete audio'); assert.equal(calls, 3);
  } finally { global.fetch = original; }
});

test('authentication errors do not retry; repeated timeouts stop after three attempts', async () => {
  const original = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => { calls++; return new Response('Unauthorized', { status: 401 }); };
    await assert.rejects(fetchOpenAiWithRetry('https://example.invalid', {}, 'Speech', 3, async () => {}), /401/);
    assert.equal(calls, 1); calls = 0;
    global.fetch = async () => { calls++; throw Object.assign(new Error(), { name: 'AbortError' }); };
    await assert.rejects(fetchOpenAiWithRetry('https://example.invalid', {}, 'Speech', 3, async () => {}), /3 attempts/);
    assert.equal(calls, 3);
  } finally { global.fetch = original; }
});
