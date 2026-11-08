import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePageScroll } from '../src/scroll-restoration.mjs';

function environment(limit = 2512) {
  const input = new Map(), media = new Map(), frames = new Map(), timers = new Map();
  let resize, observed = false, nextFrame = 0, finishes = 0, focuses = 0;
  const view = {
    scrollY: 0, limit,
    scrollTo({top}) { this.scrollY = Math.min(top, this.limit); },
    addEventListener(event, fn) { input.set(event, fn); },
    removeEventListener(event, fn) { if (input.get(event) === fn) input.delete(event); },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { timers.set(++nextFrame, fn); return nextFrame; },
    clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class {
      constructor(fn) { resize = fn; }
      observe() { observed = true; }
      disconnect() { observed = false; }
    },
  };
  const root = {
    ownerDocument: {defaultView: view},
    addEventListener(event, fn) { media.set(event, fn); },
    removeEventListener(event, fn) { if (media.get(event) === fn) media.delete(event); },
  };
  const calls = [];
  let lenis = {resize() { calls.push('resize'); }, scrollTo(top, options) { calls.push({top, options}); }};
  return {
    view, input, media, calls,
    run(top = 2590, focus = false) { return restorePageScroll({root, top: () => top, getLenis: () => lenis, focusTarget: focus ? {focus(options) { assert.deepEqual(options, {preventScroll: true}); focuses++; }} : null, onFinish() { finishes++; }}); },
    setLenis(value) { lenis = value; },
    resize() { resize?.(); },
    frame() { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } },
    timeout() { for (const fn of [...timers.values()]) fn(); },
    state() { return {finishes, focuses, observed, frameCount: frames.size, timerCount: timers.size, inputCount: input.size, mediaCount: media.size}; },
  };
}

test('restoration retains a clamped target and completes when remounted layout grows', () => {
  const e = environment();
  e.run();
  assert.equal(e.view.scrollY, 2512);
  assert.equal(e.state().finishes, 0);
  e.frame();
  assert.equal(e.state().finishes, 0);
  e.view.limit = 2590;
  e.resize();
  assert.equal(e.view.scrollY, 2590);
  assert.deepEqual(e.state(), {finishes: 1, focuses: 0, observed: false, frameCount: 0, timerCount: 0, inputCount: 0, mediaCount: 0});
});

test('an immediately reachable target finishes without leaving observers or input handlers', () => {
  const e = environment(3000);
  e.run(807, true);
  assert.equal(e.view.scrollY, 807);
  assert.deepEqual(e.state(), {finishes: 1, focuses: 1, observed: false, frameCount: 0, timerCount: 0, inputCount: 0, mediaCount: 0});
});

test('a new route cleanup cancels stale restoration without clearing the next target', () => {
  const e = environment();
  const cleanup = e.run();
  cleanup();
  e.view.limit = 3000;
  e.resize(); e.frame();
  assert.equal(e.view.scrollY, 2512);
  assert.equal(e.state().finishes, 0);
  assert.equal(e.state().inputCount, 0);
});

test('user scrolling or keyboard/pointer interaction cancels deferred restoration', () => {
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const e = environment();
    e.run();
    e.input.get(event)();
    e.view.scrollY = 400; e.view.limit = 3000;
    e.resize(); e.frame();
    assert.equal(e.view.scrollY, 400);
    assert.equal(e.state().finishes, 1);
    assert.equal(e.state().inputCount, 0);
  }
});

test('deferred restoration uses the current Lenis instance and focuses main only once', () => {
  const e = environment();
  e.run(2590, true);
  e.setLenis(null); // The old route's instance is destroyed before the next layout.
  e.view.limit = 2590;
  e.media.get('loadedmetadata')();
  assert.equal(e.view.scrollY, 2590);
  assert.equal(e.state().focuses, 1);
  assert.deepEqual(e.calls, ['resize', {top: 2590, options: {immediate: true, force: true}}]);
});


test('an unreachable target stops after the bounded restoration window', () => {
  const e = environment();
  e.run();
  e.timeout();
  e.view.limit = 3000;
  e.resize(); e.frame();
  assert.equal(e.view.scrollY, 2512);
  assert.deepEqual(e.state(), {finishes: 1, focuses: 0, observed: false, frameCount: 0, timerCount: 0, inputCount: 0, mediaCount: 0});
});
