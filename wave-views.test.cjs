const {test} = require('node:test');
const assert = require('node:assert/strict');
const views = require('./wave-views.js');

function measurement() {
  return {
    n: 2, width: 4,
    lines: [
      {wavelength: 500, weight: .25, i: [8, 0, 0, 0], q: [8, 0, 0, 0], u: [0,0,0,0], v: [0,0,0,0]},
      {wavelength: 600, weight: .75, i: [4, 0, 0, 0], q: [-4, 0, 0, 0], u: [0,0,0,0], v: [0,0,0,0]}
    ], phase: [Math.PI / 2, NaN, NaN, NaN]
  };
}

test('spectrum integration precedes Stokes normalization and preserves dark masks', () => {
  const m = measurement();
  assert.equal(views.derive(m, {layer:'intensity',line:'all'}).values[0], 5);
  const q = views.derive(m, {layer:'q',line:'all'});
  assert.ok(Math.abs(q.values[0] + .2) < 1e-6);
  assert.ok(Number.isNaN(q.values[1]));
  assert.deepEqual([q.min, q.max], [-1,1]);
  assert.equal(views.derive(m, {layer:'dop',line:1}).values[0], 1);
  assert.ok(views.derive(m, {layer:'phase',line:'all'}).values.every(Number.isNaN));
});

test('pixel inspection, integrated ROI and profile carry physical lengths and power', () => {
  const m = measurement(), opts = {layer:'intensity',line:'all'};
  const a = {col:0,row:0}, b = {col:1,row:1};
  const p = views.inspect(m, opts, 'point', a, a);
  assert.deepEqual([p.y,p.z,p.value,p.power], [-1,1,5,20]);
  const roi = views.inspect(m, opts, 'roi', a,b);
  assert.equal(roi.power, 20);
  assert.deepEqual(roi.spectrum.map(line => line.power), [8,12]);
  const profile = views.inspect(m,opts,'line',a,b).profile;
  assert.equal(profile[0].value,5);
  assert.ok(Math.abs(profile.at(-1).distance - Math.sqrt(8)) < 1e-8);
  assert.match(views.toCSV(m, opts), /-1,1,5/);
});

test('editing one share preserves other energy shares, clearing a footprint restores full absorption', () => {
  const n = 5, map = {size:n,width:5,height:5};
  for (const key of ['t','r','s','opd']) map[key] = new Array(n*n).fill(0);
  map.r[12] = .6;
  const p = {row:2,col:2};
  views.stroke(map, {tool:'brush',channel:'t',value:.9,radius:0},p,p);
  assert.ok(Math.abs(map.t[12] - .4)<1e-9);
  views.stroke(map,{tool:'line',channel:'opd',value:-100,radius:0},p,{col:4,row:2});
  assert.equal(map.opd[13],-100);
  views.stroke(map,{tool:'erase',channel:'opd',value:0,radius:0},p,p);
  for (const key of ['t','r','s','opd']) assert.equal(map[key][12],0);
  assert.equal(map.opd[13],-100);
});

test('exports retain phase selection, reference and plane metadata, including comma-containing names', () => {
  const csv = views.toCSV(measurement(), {layer:'phase',line:0,phaseAxis:'z'}, {
    name:'相位片,试片',plane:'物体后表面',reference:'光源平面',mode:'中心点'
  });
  for (const label of ['相位片,试片','物体后表面','光源平面','中心点','E𝓏','500 nm','相对相位']) assert.ok(csv.includes(label));
  assert.ok(!csv.includes('NaN'));
});

test('decentered cameras report world coordinates and stale wavelength projections stay masked', () => {
  const m = {...measurement(),centerY:3,centerZ:-2,phaseLine:1,phaseAxis:'z'};
  const opts = {layer:'phase',line:0,phaseAxis:'z'};
  assert.ok(views.derive(m,opts).values.every(Number.isNaN));
  assert.ok(views.derive(m,{...opts,line:1,phaseAxis:'y'}).values.every(Number.isNaN));
  const a = views.inspect(m, {...opts,line:1},'point',{col:0,row:0});
  assert.deepEqual([a.y,a.z],[2,-1]);
  assert.ok(Math.abs(a.value-Math.PI/2)<1e-6);
});

test('band powers add to the broadband detector and phase masks describe only valid samples', () => {
  const m = measurement();
  for (const [line,value] of [[0,2],[1,3],['all',5]]) {
    const opts = {layer:'intensity',line};
    const p = views.inspect(m,opts,'point',{col:0,row:0});
    assert.equal(p.value,value);
    assert.equal(p.power,value*4);
  }
  const phase = views.derive(m,{layer:'phase',line:0});
  assert.equal(phase.hasFinite,true);
  assert.equal(phase.finiteCount,1);
  assert.ok(Math.abs(phase.actualMin-Math.PI/2)<1e-6);
  assert.equal(phase.actualMin,phase.actualMax);
  const masked=views.derive(m,{layer:'phase',line:'all'});
  assert.equal(masked.hasFinite,false);
  assert.equal(masked.actualMax,null);
});

test('phase-shift views report camera-frame powers, wrapped estimates and visibility masks', () => {
  const m=measurement();
  m.lines=[{...m.lines[0],weight:1}];
  m.measurement={frames:[[2,0,0,0],[3,0,0,0],[2,0,0,0],[1,0,0,0]],
    phase:[Math.PI/2,NaN,NaN,NaN],visibility:[.5,NaN,NaN,NaN]};
  const opts={line:0,layer:'frame1'};
  assert.equal(views.derive(m,opts).values[0],3);
  const p=views.inspect(m,opts,'point',{col:0,row:0});
  assert.equal(p.power,12);
  assert.equal(p.spectrum[0].power,12);
  const recovered=views.derive(m,{...opts,layer:'recovered'});
  assert.ok(Math.abs(recovered.values[0]-Math.PI/2)<1e-6);
  assert.equal(recovered.finiteCount,1);
  assert.deepEqual([recovered.min,recovered.max],[-Math.PI,Math.PI]);
  assert.equal(views.derive(m,{...opts,layer:'visibility'}).values[0],.5);
  m.phase[0]=Math.PI-.02;
  m.measurement.phase[0]=-Math.PI+.03;
  m.measurement.referencePhaseRad=.01;
  const error=views.derive(m,{...opts,layer:'phaseError'});
  assert.ok(Math.abs(error.values[0]-.06)<1e-6);
  assert.equal(error.finiteCount,1);
  const roi=views.inspect(m,{...opts,layer:'recovered'},'roi',{col:0,row:0},{col:1,row:1});
  assert.equal(roi.power,8);
  delete m.measurement;
  assert.equal(views.derive(m,opts).hasFinite,false);
});
