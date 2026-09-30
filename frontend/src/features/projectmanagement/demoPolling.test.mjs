import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDemoPolling } from './demoPolling.js';

test('polling continues beyond eight minutes, missing rows and connection failures, then accepts completion', async () => {
  const queue = [];
  const seen = [];
  let calls = 0, elapsed = 0, missing = 0, failures = 0;
  startDemoPolling({
    schedule: (fn, ms) => { queue.push({ fn, ms }); return fn; }, unschedule: () => {},
    fetchJob: async () => { calls++; if (calls === 2) return null; if (calls === 3) throw Error('Network'); return { status: calls > 130 ? 'completed' : 'rendering' }; },
    onJob: job => { seen.push(job.status); }, onWaiting: () => missing++, onError: () => failures++,
  });
  while (queue.length) { const next = queue.shift(); elapsed += next.ms; await next.fn(); }
  assert.ok(elapsed > 8 * 60000);
  assert.equal(missing, 1); assert.equal(failures, 1);
  assert.equal(seen.at(-1), 'completed');
  assert.ok(!seen.includes('failed'));
});

test('cleanup ignores a late response from the old job', async () => {
  let callback, resolve;
  const stop = startDemoPolling({ schedule: fn => { callback = fn; }, unschedule: () => {},
    fetchJob: () => new Promise(r => { resolve = r; }), onJob: () => assert.fail('Cancelled update'),
    onWaiting: () => {}, onError: () => {} });
  const pending = callback(); stop(); resolve({ status: 'completed' }); await pending;
});
