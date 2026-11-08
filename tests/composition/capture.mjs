import { expect } from '@playwright/test';

export async function renderedBounds(page) {
  const width = page.viewportSize().width;
  // innerWidth can expand with overflow on a mobile layout viewport; use the configured width.
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(width + 1);
}
async function settledScroll(page, bottom = false) {
  await page.evaluate(bottom => window.scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0, behavior: 'instant' }), bottom);
  await expect.poll(() => page.evaluate(bottom => Math.abs(window.scrollY - (bottom ? Math.max(0, document.documentElement.scrollHeight - innerHeight) : 0)), bottom)).toBeLessThanOrEqual(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
export async function capture(page, info, name) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.page-enter')).toHaveCSS('opacity', '1');
  // An aria-hidden paused portrait video is not the displayed layer. Check its image instead.
  for (const media of await page.locator('main img, main video:not([aria-hidden="true"])').all()) {
    if (!(await media.isVisible())) continue;
    await media.scrollIntoViewIfNeeded();
    await expect.poll(() => media.evaluate(el => el.tagName === 'IMG'
      ? el.complete && el.naturalWidth > 0
      : el.readyState >= 1 && !el.error)).toBe(true);
  }
  await renderedBounds(page);
  const sessions = page.locator('.session-media');
  if (await sessions.count()) {
    await page.locator('.feature').evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - document.querySelector('.site-header').getBoundingClientRect().height - 20, behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const media of await sessions.all()) {
      const poster = media.locator('.session-poster');
      await expect(poster).toHaveCSS('opacity', '1');
      expect(await poster.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      expect((await media.boundingBox()).height).toBeLessThanOrEqual(521);
      // The overlay only appears after a decoded frame; refusal to autoplay still has a real poster.
      expect(await media.locator('video').evaluate(el => getComputedStyle(el).opacity === '0' || (el.readyState >= 2 && !el.error))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`${name}-session-viewport.png`) });
    await renderedBounds(page);
  }
  await settledScroll(page);
  await page.screenshot({ path: info.outputPath(`${name}-top.png`) });
  const full = await page.screenshot({ path: info.outputPath(`${name}-full.png`), fullPage: true });
  const scale = await page.evaluate(() => devicePixelRatio);
  expect(full.readUInt32BE(16), 'PNG width must match the configured viewport, not an expanded mobile layout').toBe(Math.round(page.viewportSize().width * scale));
  await renderedBounds(page);
  await settledScroll(page, true);
  await page.screenshot({ path: info.outputPath(`${name}-bottom.png`) });
  await renderedBounds(page);
}
