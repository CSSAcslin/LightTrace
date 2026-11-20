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

test('Mie polarization resolves the Bohren sphere at 90 degrees and distinguishes the two input axes', () => {
  const law = phase.distribution(sphere);
  const node = Math.round(90 / law.step);
  const quantile = .5 + .5 * law.integral[node] / law.integral.at(-1);
  const [sample90] = phase.scatterPolarized(sphere,[0,1,0],quantile);
  assert.ok(Math.abs(sample90.offset-90)<1e-8);
  // Q/I = S12/S11. U/I and |V|/I test both parts of the complex product.
  // The sign of V here uses exp(-iωt), p,s,k right-handed.
  for (const [i,expected] of [-.23055333,.93743853,-.26087192].entries())
    assert.ok(Math.abs(sample90.stokes[i]-expected)<1e-7);
  const p = phase.scatterPolarized(sphere,[1,0,0]);
  const s = phase.scatterPolarized(sphere,[-1,0,0]);
  assert.ok(Math.abs(p[4].fraction-s[4].fraction)>.001);
  for (const [bins,sign] of [[p,1],[s,-1]]) {
    assert.ok(Math.abs(bins.reduce((sum,bin)=>sum+bin.fraction,0)-1)<1e-12);
    assert.ok(bins.every(bin=>Math.abs(bin.stokes[0]-sign)<1e-10));
  }
  const legacy=phase.sample(sphere);
  for(const [i,bin] of phase.scatterPolarized(sphere,[0,0,0]).entries())
    assert.ok(Math.abs(bin.fraction-legacy[i].fraction)<1e-12);
});
