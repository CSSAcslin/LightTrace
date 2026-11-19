const {test} = require('node:test');
const assert = require('node:assert/strict');
const phase = require('./mie-phase');

// Bohren's transparent sphere example, as tabulated at
// https://miepython.readthedocs.io/en/latest/07_algorithm.html
const sphere = {diameter:5.213*.55/Math.PI, medium:1, index:1.55,
  wavelength:550, halfAngle:180, samples:9};
test('meridional angular intensity reproduces the forward peak, side minima and backscatter of the reference sphere', () => {
  const {values, step} = phase.distribution(sphere);
  for (const [deg, ref] of [[9,.78538504],[36,.03553383],[45,.07019023],[90,.01246407],[180,.03831054]]) {
    assert.ok(Math.abs(values[Math.round(deg/step)] / values[0] - ref) < 1e-7);
  }
});
test('discrete rays integrate powers over the chosen slice and changes in wavelength alter that distribution', () => {
  for (const halfAngle of [1.5,45,180]) {
    const bins = phase.sample({...sphere, halfAngle});
    assert.equal(bins[4].offset, 0);
    assert.ok(Math.abs(bins.reduce((sum,b) => sum+b.fraction,0)-1) < 1e-12);
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(bins[i].offset+bins[8-i].offset) < 1e-10);
      assert.ok(Math.abs(bins[i].fraction-bins[8-i].fraction) < 1e-12);
    }
  }
  const blue = phase.sample({...sphere, wavelength:450});
  const red = phase.sample({...sphere, wavelength:650});
  assert.ok(Math.abs(blue[4].fraction-red[4].fraction) > .01);
  assert.equal(phase.sample({...sphere,index:1}).length,0);
});
