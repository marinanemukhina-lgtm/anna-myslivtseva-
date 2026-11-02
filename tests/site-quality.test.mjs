import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReadingScale, readingProgress, publicArticleUrl, sourceUrls } from '../src/reading-tools.mjs';
test('only supported reading sizes are accepted', () => {
  assert.equal(normalizeReadingScale('1.15'), 1.15);
  assert.equal(normalizeReadingScale(1.3), 1.3);
  for (const bad of [0, -1, 200, 'invalid', null, NaN, Infinity]) assert.equal(normalizeReadingScale(bad), 1);
});
test('reading progress measures viewport position and is bounded', () => {
  assert.equal(readingProgress(300, 2000, 800), 0);
  assert.equal(readingProgress(-600, 2000, 800), 50);
  assert.equal(readingProgress(-2000, 2000, 800), 100);
  assert.equal(readingProgress(0, 500, 800), 100);
  assert.equal(readingProgress(NaN, 2000, 800), 0);
});
test('sharing strips query/hash and allows public article routes only', () => {
  assert.equal(publicArticleUrl('https://example.test/news/test-article?name=private#token'), 'https://example.test/news/test-article');
  for (const bad of ['javascript:alert(1)', 'https://example.test/admin', 'https://user:pass@example.test/news/a', 'http://example.test/news/a', 'https://example.test/news/', 'https://example.test/demo/booking']) assert.equal(publicArticleUrl(bad), null);
});
test('source links are deduplicated HTTPS URLs without credentials', () => {
  assert.deepEqual(sourceUrls(['https://www.who.int/a', 'https://www.who.int/a', 'javascript:a', 'https://x:y@a.test/', '/contact', 'https://example.test/news/next'], 'https://example.test'), ['https://www.who.int/a']);
});
