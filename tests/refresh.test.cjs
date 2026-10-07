const {test} = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('widget refresh coalesces bursts, drops stale results and recovers after errors', async () => {
  const {createRefresh} = await import('../src/refresh.mjs');
  const pending = [], accepted = [], errors = [];
  const refresh = createRefresh(value => new Promise((resolve, reject) => pending.push({value, resolve, reject})),
    value => accepted.push(value), error => errors.push(error.message));
  const first = refresh.request('current');
  for (let i = 0; i < 20; i++) refresh.request('current');
  assert.equal(pending.length, 1);
  pending[0].resolve('first'); await tick();
  assert.deepEqual(accepted, ['first']);
  assert.equal(pending.length, 2);
  refresh.request('old'); refresh.request('latest');
  pending[1].resolve('stale'); await tick();
  assert.deepEqual(accepted, ['first']);
  assert.equal(pending[2].value, 'latest');
  pending[2].reject(Error('offline')); await first;
  assert.deepEqual(errors, ['offline']);
  const next = refresh.request('latest'); pending[3].resolve('recovered'); await next;
  assert.deepEqual(accepted, ['first', 'recovered']);
});
