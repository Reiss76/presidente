const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHealthMeta } = require('@presidente/shared');

test('buildHealthMeta should return a healthy payload', () => {
  const result = buildHealthMeta('codes-backend');

  assert.equal(result.ok, true);
  assert.equal(result.service, 'codes-backend');
  assert.equal(typeof result.timestamp, 'string');
  assert.ok(result.timestamp.length > 10);
});
