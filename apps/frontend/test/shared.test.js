const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHealthMeta } = require('@presidente/shared');

test('shared package should be available from frontend workspace', () => {
  const result = buildHealthMeta('codes-frontend');

  assert.equal(result.ok, true);
  assert.equal(result.service, 'codes-frontend');
});
