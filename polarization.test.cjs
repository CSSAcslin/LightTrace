const {test} = require('node:test');
const assert = require('node:assert/strict');
const {simulate} = require('./advanced-optics.js');

const source = {type:'collimated', x:-10, y:0, angle:0, rays:3, width:0, wavelength:550};
const plane = (type, id, x, properties={}) => ({type,id,x,y:0,angle:0,aperture:80,...properties});
const screen = (x=25) => plane('screen','screen',x);
function run(elements, changes={}) {
  const result = simulate({source:{...source,...changes}, elements});
  assert.deepEqual(result.warnings, []);
  return result;
}
function near(actual, expected, epsilon=1e-10) {
  assert.ok(Math.abs(actual-expected)<=epsilon, `Expected ${expected}, got ${actual}`);
}
function state(actual, expected) {
  assert.equal(actual.length,3);
  expected.forEach((value,index)=>near(actual[index],value));
}
function closes(result) {
  for (const row of [result.energy,...result.energyByWavelength])
    near(row.emitted,row.absorbed+row.polarizerLoss+row.detected+row.escaped+row.blocked+row.unresolved);
}

test('an old scene supplies unpolarized light; a pair of analyzers follows Malus at 0, 30, 60 and 90 degrees',()=>{
  const untouched = run([screen()]);
  state(untouched.detectors[0].stokes,[0,0,0]);
  near(untouched.detectors[0].weight,3);
  for (const [axisAngle,expectedFraction] of [[0,.5],[30,.375],[60,.125],[90,0]]) {
    const result = run([plane('polarizer','P',0),plane('polarizer','A',10,{axisAngle}),screen()]);
    near(result.detectors[0].weight,3*expectedFraction);
    near(result.energy.polarizerLoss,3*(1-expectedFraction));
    closes(result);
    const events = result.rays[0].events;
    state(events[0].stokesIn,[0,0,0]);
    state(events[1].stokesIn,[1,0,0]);
    if (expectedFraction===0) {
      assert.equal(result.detectors[0].stokes,null);
      assert.equal(events[1].stokesOut,null);
      assert.equal(result.detectors[0].hits.length,0);
    }
  }
});

test('quarter-wave and half-wave plates convert diagonal light at the design wavelength and conserve power',()=>{
  for (const [retardance,expected] of [[90,[0,0,1]],[180,[0,-1,0]]]) {
    const result = run([plane('retarder','W',5,{retardance}),screen()],{polarization:'linear',polAngle:45});
    const ray = result.rays[0];
    state(ray.sourceStokes,[0,1,0]);
    state(ray.events[0].stokesOut,expected);
    state(ray.events[1].stokesIn,expected);
    state(ray.stokes,expected);
    state(result.detectors[0].stokes,expected);
    near(result.detectors[0].weight,3);
    closes(result);
  }
  const otherWavelength = run([plane('retarder','W',5,{referenceWavelength:480}),screen()],
    {wavelength:720,polarization:'linear',polAngle:45});
  state(otherWavelength.detectors[0].stokes,[0,.5,Math.sqrt(3)/2]);
});

test('a reciprocal quarter-wave plate followed by a mirror rotates the returning linear polarization by 90 degrees',()=>{
  const result = run([plane('retarder','W',0,{axisAngle:45}),plane('mirror','M',10),screen(-15)],
    {polarization:'linear',polAngle:0});
  const events = result.rays[0].events;
  assert.deepEqual(events.map(e=>e.kind),['retard','reflect','retard','detect']);
  near(events[0].axisAngle,45);
  near(events[2].axisAngle,-45);
  state(events[0].stokesOut,[0,0,-1]);
  state(events[1].stokesOut,[0,0,1]);
  state(result.detectors[0].stokes,[-1,0,0]);
  near(result.detectors[0].weight,3);
});

const transparentPlate = plane('object','plate',0,{
  interaction:'mixed', fractions:{scatter:0,reflection:0,transmission:1,absorption:0},
  thickness:8, wedge:0, n:1.5, scatterAngle:10, scatterSamples:3, pattern:Array(33).fill(1)
});
test('a bare air/glass interface suppresses p reflection at Brewster incidence but reflects s',()=>{
  const brewster = Math.atan(1.5)*180/Math.PI;
  for (const [polAngle,fraction] of [[0,0],[90,(5/13)**2]]) {
    const result = run([transparentPlate,screen(1)],
      {x:-1,angle:brewster,polarization:'linear',polAngle});
    near(result.detectors[0].weight,3*(1-fraction));
    near(result.rays[0].events[0].fresnel,fraction);
    closes(result);
  }
});

test('45 degree TIR in index 1.5 glass retards diagonal polarization with relative phase atan(3/4)',()=>{
  const result = run([transparentPlate],{x:4,angle:45,polarization:'linear',polAngle:45});
  const bounce = result.rays[0].events[0];
  assert.equal(bounce.kind,'tir');
  near(bounce.weightIn,bounce.weightOut);
  state(bounce.stokesOut,[0,.8,.6]);
  closes(result);
});

test('opposite incidence direction flips the screen transverse reference; partial degree is retained',()=>{
  const result = run([screen(-15)],{angle:180,polarization:'left',polDegree:.4});
  const detector = result.detectors[0];
  state(detector.hits[0].stokes,[0,0,.4]);
  state(detector.hits[0].screenStokes,[0,0,-.4]);
  state(detector.stokes,[0,0,-.4]);
  near(detector.weight,3);
});

test('detector sums differently polarized rays incoherently with their actual weights',()=>{
  // Of three equal input rays, the central and upper ray retain I=1,
  // while the lower ray alone meets the horizontal analyzer with I=1/2.
  const analyzer = plane('polarizer','P',0,{y:-10,aperture:2});
  const result = run([analyzer,screen()],{width:20});
  near(result.detectors[0].weight,2.5);
  state(result.detectors[0].stokes,[.2,0,0]);
  const balanced = run([analyzer,plane('polarizer','S',0,{y:10,aperture:2,axisAngle:90}),screen()],{width:20});
  near(balanced.detectors[0].weight,2);
  state(balanced.detectors[0].stokes,[0,0,0]);
});

test('loss from a plate before a branching interface is counted once, including slab round trips',()=>{
  const result = run([plane('polarizer','P',-5),transparentPlate,
    plane('polarizer','A',15,{axisAngle:45}),plane('screen','back',-20),screen()]);
  // Incoherent lossless parallel slab at normal incidence: R=1/25 on each
  // interface, total reflected fraction 2R/(1+R)=1/13, transmitted 12/13.
  const afterFirstAnalyzer = 3/2;
  near(result.detectors[0].weight,afterFirstAnalyzer/13,5e-8);
  near(result.detectors[1].weight,afterFirstAnalyzer*6/13,5e-8);
  near(result.energy.polarizerLoss,1.5+afterFirstAnalyzer*6/13,5e-8);
  assert.ok(result.rays.some(ray=>ray.events.filter(e=>e.elementId==='plate').length>2));
  closes(result);
});
