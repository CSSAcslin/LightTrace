'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Optics = require('./optics.js');

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `Expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `Expected ${actual} ≈ ${expected}`);
}
const lens = (id, x, f, aperture = 50) => ({ id, x, f, aperture });

test('single convex lens: 2f object produces inverted 1:1 real image', () => {
  const result = Optics.analyzeSystem({ object: { x: 0, height: 10 }, lenses: [lens('a', 200, 100)], screenX: 400 });
  assert.equal(result.imageType, 'real');
  near(result.imageX, 400);
  near(result.imageDistance, 200);
  near(result.imageHeight, -10);
  near(result.magnification, -1);
  near(result.effectiveFocalLength, 100);
  near(result.backFocalX, 300);
  near(result.screenBlurRadius, 0);
  near(result.screenCenter, -10);
});

test('object inside focal length gives an upright enlarged virtual image', () => {
  const result = Optics.analyzeSystem({ object: { x: 0, height: 10 }, lenses: [lens('a', 50, 100)] });
  assert.equal(result.imageType, 'virtual');
  near(result.imageDistance, -100);
  near(result.imageX, -50);
  near(result.magnification, 2);
  near(result.imageHeight, 20);
});

test('negative lens gives an upright reduced virtual image', () => {
  const result = Optics.analyzeSystem({ object: { x: 0, height: 20 }, lenses: [lens('a', 200, -100)] });
  assert.equal(result.imageType, 'virtual');
  near(result.imageDistance, -200 / 3);
  near(result.magnification, 1 / 3);
  near(result.effectiveFocalLength, -100);
});

test('focal-plane object yields parallel emergent rays and image at infinity', () => {
  const object = { x: 0, height: 10 };
  const lenses = [lens('a', 100, 100)];
  const result = Optics.analyzeSystem({ object, lenses });
  assert.equal(result.imageType, 'infinity');
  assert.equal(result.imageX, null);
  assert.equal(result.magnification, null);
  const rays = Optics.sampleRays({ object, lenses, count: 9, endX: 400 });
  for (const ray of rays) near(ray.outgoingSlope, -0.1);
});

test('two lenses separated by sum of focal lengths form an afocal system', () => {
  const result = Optics.analyzeSystem({ object: { x: 0, height: 5 }, lenses: [lens('a', 200, 100), lens('b', 350, 50)] });
  assert.equal(result.effectiveFocalLength, null);
  assert.equal(result.backFocalX, null);
  near(result.matrix.C, 0);
  near(result.matrix.A, -0.5);
  near(result.matrix.D, -2);
  // An afocal lens group still gives a finite conjugate for a finite object.
  assert.equal(result.imageType, 'real');
  near(result.imageDistance, 25);
  near(result.magnification, -0.5);
});

test('two-lens relay has the expected image and positive total magnification', () => {
  const result = Optics.analyzeSystem({
    object: { x: 0, height: 10 },
    lenses: [lens('a', 200, 100), lens('b', 600, 100)], screenX: 800
  });
  near(result.stages[0].imageX, 400);
  near(result.stages[0].magnification, -1);
  near(result.stages[1].imageX, 800);
  near(result.magnification, 1);
  near(result.imageHeight, 10);
  near(result.screenBlurRadius, 0);
});

test('all unblocked rays intersect at the ABCD image across compound systems', () => {
  const systems = [
    [lens('a', 180, 90), lens('b', 390, 70)],
    [lens('a', 170, -100), lens('b', 290, 80), lens('c', 460, 160)],
    [lens('a', 240, 130), lens('b', 310, -180)]
  ];
  for (const lenses of systems) {
    const object = { x: -30, height: 7 };
    const result = Optics.analyzeSystem({ object, lenses });
    const { A, B, C, D } = result.matrix;
    near(A * D - B * C, 1);
    for (const ray of Optics.sampleRays({ object, lenses, count: 19, endX: 900 })) {
      if (!ray.blocked) {
        const atImage = ray.lastPoint.y + ray.outgoingSlope * (result.imageX - ray.lastPoint.x);
        near(atImage, result.imageHeight);
      }
    }
  }
});

test('lens order is sorted without changing caller data', () => {
  const lenses = [lens('b', 600, 100), lens('a', 200, 100)];
  const result = Optics.analyzeSystem({ object: { x: 0, height: 10 }, lenses });
  assert.deepEqual(result.stages.map(stage => stage.lensId), ['a', 'b']);
  assert.equal(lenses[0].id, 'b');
  near(result.imageX, 800);
});

test('aperture blocks rays outside radius and includes its edge', () => {
  const object = { x: 0, height: 0 };
  const lenses = [lens('a', 100, 100, 20)];
  const blocked = Optics.traceRay({ object, lenses, slope: 0.2, endX: 300 });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.blockedBy, 'a');
  assert.equal(blocked.points.length, 2);
  near(blocked.lastPoint.x, 100);
  near(blocked.lastPoint.y, 20);
  assert.equal(Optics.traceRay({ object, lenses, slope: 0.1, endX: 300 }).blocked, false);
});

test('screen blur matches aperture interval and vanishes only at focus', () => {
  const config = { object: { x: 0, height: 0 }, lenses: [lens('a', 200, 100, 40)] };
  near(Optics.analyzeSystem({ ...config, screenX: 300 }).screenBlurRadius, 10);
  near(Optics.analyzeSystem({ ...config, screenX: 400 }).screenBlurRadius, 0);
  near(Optics.analyzeSystem({ ...config, screenX: 500 }).screenBlurRadius, 10);
  assert.equal(Optics.analyzeSystem({ ...config, screenX: 150 }).screenBlurRadius, null);
});

test('a later aperture narrows the accepted interval exactly', () => {
  const object = { x: 0, height: 0 };
  const lenses = [lens('a', 100, Infinity, 40), lens('b', 200, Infinity, 10)];
  const result = Optics.analyzeSystem({ object, lenses, screenX: 300 });
  near(result.acceptedSlopeRange.min, -0.025);
  near(result.acceptedSlopeRange.max, 0.025);
  near(result.screenBlurRadius, 7.5);
});

test('complete vignetting returns no screen bundle while preserving conjugate', () => {
  const object = { x: 0, height: 30 };
  const lenses = [lens('a', 100, 50, 40), lens('b', 200, 70, 10)];
  const result = Optics.analyzeSystem({ object, lenses, screenX: 400 });
  assert.equal(result.acceptedSlopeRange, null);
  assert.equal(result.screenBlurRadius, null);
  assert.equal(result.screenCenter, null);
  assert.ok(Optics.sampleRays({ object, lenses, count: 21, endX: 400 }).every(ray => ray.blocked));
});

test('lensmaker follows signed radii and supports plane surfaces', () => {
  near(Optics.lensmaker({ n: 1.5, r1: 100, r2: -100 }), 100);
  near(Optics.lensmaker({ n: 1.5, r1: -100, r2: 100 }), -100);
  near(Optics.lensmaker({ n: 1.5, r1: 100, r2: Infinity }), 200);
  assert.equal(Optics.lensmaker({ n: 1.5, r1: 100, r2: 100 }), Infinity);
  assert.throws(() => Optics.lensmaker({ n: 1.5, r1: 0, r2: 100 }), RangeError);
});

test('empty system and invalid inputs are handled explicitly', () => {
  const empty = Optics.analyzeSystem({ object: { x: 0, height: 10 }, lenses: [] });
  assert.equal(empty.imageType, 'none');
  assert.equal(empty.imageX, null);
  assert.deepEqual(Optics.sampleRays({ object: { x: 0, height: 1 }, lenses: [], endX: 300 }), []);
  assert.throws(() => Optics.analyzeSystem({ object: { x: 0, height: 1 }, lenses: [lens('a', 20, 0)] }), RangeError);
  assert.throws(() => Optics.analyzeSystem({ object: { x: 0, height: 1 }, lenses: [lens('a', -20, 50)] }), RangeError);
});
