import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SingleFlight, single } from '../dist/esm/index.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('concurrent calls share one execution', async () => {
  const f = new SingleFlight();
  let calls = 0;
  const task = async () => { calls++; await tick(); return calls; };
  const [a, b, c] = await Promise.all([f.run('k', task), f.run('k', task), f.run('k', task)]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test('different keys execute independently', async () => {
  const f = new SingleFlight();
  let calls = 0;
  const task = async () => { const n = ++calls; await tick(); return n; };
  const [a, b] = await Promise.all([f.run('x', task), f.run('y', task)]);
  assert.equal(calls, 2);
  assert.notEqual(a, b);
});

test('sequential calls re-execute after settle', async () => {
  const f = new SingleFlight();
  let calls = 0;
  const task = async () => ++calls;
  assert.equal(await f.run('k', task), 1);
  assert.equal(await f.run('k', task), 2);
});

test('rejection propagates to all waiters and is not cached', async () => {
  const f = new SingleFlight();
  let calls = 0;
  const bad = async () => { calls++; await tick(); throw new Error('boom'); };
  const results = await Promise.allSettled([f.run('k', bad), f.run('k', bad)]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal((results[0] as PromiseRejectedResult).reason.message, 'boom');
  // next call retries fresh
  await assert.rejects(f.run('k', bad), /boom/);
  assert.equal(calls, 2);
});

test('ttlMs replays fulfilled result without re-running', async () => {
  let now = 1000;
  const f = new SingleFlight({ ttlMs: 100, now: () => now });
  let calls = 0;
  const task = async () => { calls++; return `v${calls}`; };
  assert.equal(await f.run('k', task), 'v1');
  now += 50;
  assert.equal(await f.run('k', task), 'v1'); // replay
  assert.equal(calls, 1);
  now += 60; // past ttl
  assert.equal(await f.run('k', task), 'v2');
  assert.equal(calls, 2);
});

test('ttlMs does not replay rejections', async () => {
  const f = new SingleFlight({ ttlMs: 1000 });
  let calls = 0;
  const task = async () => { calls++; if (calls === 1) throw new Error('x'); return 'ok'; };
  await assert.rejects(f.run('k', task));
  assert.equal(await f.run('k', task), 'ok');
  assert.equal(calls, 2);
});

test('eviction respects maxEntries', async () => {
  let now = 0;
  const f = new SingleFlight({ ttlMs: 10_000, maxEntries: 2, now: () => now });
  for (const k of ['a', 'b', 'c']) { now++; await f.run(k, async () => k); }
  assert.ok(f.size <= 2);
});

test('in-flight entries are never evicted', async () => {
  const f = new SingleFlight({ ttlMs: 10_000, maxEntries: 1 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const p1 = f.run('a', async () => { await gate; return 'a'; });
  await f.run('b', async () => 'b'); // settled, evicts... must not evict 'a'
  release();
  assert.equal(await p1, 'a');
  assert.ok(f.size >= 1);
});

test('single() helper dedupes on shared instance', async () => {
  let calls = 0;
  const task = async () => { calls++; await tick(); return 42; };
  const [a, b] = await Promise.all([single('shared-key', task), single('shared-key', task)]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b], [42, 42]);
});
