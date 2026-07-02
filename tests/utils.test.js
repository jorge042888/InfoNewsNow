const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, interleave, formatDate, debounce } = require('../utils');

test('escapeHtml escapes HTML-significant characters', () => {
  assert.equal(
    escapeHtml(`" onerror="alert(1)"`),
    '&quot; onerror=&quot;alert(1)&quot;'
  );
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`it's & "quoted"`), 'it&#39;s &amp; &quot;quoted&quot;');
});

test('escapeHtml handles falsy input', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('interleave alternates two arrays', () => {
  assert.deepEqual(interleave([1, 2], ['a', 'b']), [1, 'a', 2, 'b']);
});

test('interleave handles arrays of different lengths', () => {
  assert.deepEqual(interleave([1, 2, 3], ['a']), [1, 'a', 2, 3]);
  assert.deepEqual(interleave([], ['a', 'b']), ['a', 'b']);
});

test('formatDate returns empty string for falsy input', () => {
  assert.equal(formatDate(''), '');
  assert.equal(formatDate(null), '');
});

test('formatDate formats recent timestamps in minutes', () => {
  const iso = new Date(Date.now() - 5 * 60000).toISOString();
  assert.equal(formatDate(iso), '5m');
});

test('formatDate formats timestamps within a day in hours', () => {
  const iso = new Date(Date.now() - 3 * 3600000).toISOString();
  assert.equal(formatDate(iso), '3h');
});

test('formatDate formats timestamps within a week in days', () => {
  const iso = new Date(Date.now() - 2 * 86400000).toISOString();
  assert.equal(formatDate(iso), '2d');
});

test('debounce delays and coalesces rapid calls', (t, done) => {
  let calls = 0;
  const fn = debounce(() => calls++, 20);
  fn();
  fn();
  fn();
  setTimeout(() => {
    assert.equal(calls, 1);
    done();
  }, 40);
});
