const {test} = require('node:test');
const assert = require('node:assert/strict');
const wave = require('./wave-scene.js');
const optics = require('./advanced-optics.js');
const {presets} = require('./advanced-editor.js');

function advanced(key) {
  return {format:'guangji.surface-workbench', version:1, scene:{...structuredClone(presets[key]),preset:key}};
}

test('a tracking focal plane follows the thick lens and distinguishes separated focal planes',()=>{
  const scene=wave.fromPackage(advanced('relay')),l1=scene.elements[0],l2=scene.elements[1];
  const p=wave.createElement('probe',0);p.focusOf=l1.id;scene.elements.push(p);
  wave.updateFocalProbes(scene);assert.equal(p.name,'公共焦面');
  const expected=l1.x+optics.lensParaxial(l1,scene.source.wavelength).backFocalX;
  assert.ok(Math.abs(p.x-expected)<1e-9);
  l2.x-=4;wave.updateFocalProbes(scene);assert.match(p.name,/后焦面/);
  assert.equal(p.x,expected);
});

test('all existing presets open without geometry changes or invented optical elements', () => {
  for (const key of Object.keys(presets)) {
    const original = advanced(key);
    const edited = wave.fromPackage(original);
    assert.deepEqual(edited.elements.map(e=>e.id), original.scene.elements.map(e=>e.id));
    assert.deepEqual(edited.elements.map(e=>e.x), original.scene.elements.map(e=>e.x));
    assert.equal(edited.source.type, original.scene.source.type);
    edited.source.x += 3;
    assert.equal(edited.origin.scene.source.x, original.scene.source.x);
    assert.deepEqual(wave.fromPackage(wave.exportPackage(edited)), edited);
  }
});

test('each imported material column has the exact fractions of its old bin', () => {
  for (const key of ['objectMie','objectMixed','objectScatter','objectReflect','objectRefract']) {
    const original = advanced(key);
    const old = original.scene.elements.find(e=>e.type==='object');
    const {map} = wave.fromPackage(original).elements.find(e=>e.id===old.id);
    assert.equal(map.size,33);
    for (let column=0;column<33;column++) {
      const f = optics.cellFractions(old,column);
      for (const row of [0,10,32]) {
        const i=row*33+column;
        assert.deepEqual([map.t[i],map.r[i],map.s[i],map.opd[i]], [f.transmission,f.reflection,f.scatter,0]);
      }
    }
  }
});

test('folded optics and tilted substrates remain inspectable with a blocking status', () => {
  for(const e of wave.fromPackage(advanced('folded')).elements) assert.equal(wave.elementStatus(e).state,'blocked');
  const e=wave.fromPackage(advanced('objectRefract')).elements[0];
  assert.equal(wave.elementStatus(e).state,'blocked');
  assert.equal(wave.elementStatus(wave.fromPackage(advanced('relay')).elements[0]).state,'approx');
});

test('legacy mixed material without channel arrays preserves the grey mask and relative material shares', () => {
  const original=advanced('objectMixed');
  const old=original.scene.elements[0];
  delete old.channels;
  old.pattern[8]=.4;
  const projected=wave.fromPackage(original).elements[0].map;
  const fraction=optics.cellFractions(old,8);
  assert.deepEqual([projected.r[8],projected.s[8],projected.t[8]],
    [fraction.reflection,fraction.scatter,fraction.transmission]);
  assert.equal(projected.t[33+8],projected.t[8]);
});

test('a zero-height field preserves one axial emitter and legacy illumination defaults', () => {
  const old=advanced('relay');
  old.scene.source={x:0,y:0,type:'field',height:0,spectrum:'band'};
  const newScene=wave.fromPackage(old);
  assert.equal(newScene.source.height,0);
  assert.equal(newScene.source.spread,5);
  assert.equal(newScene.source.width,20);
  assert.equal(newScene.source.polarization,'unpolarized');
  assert.deepEqual(wave.wavelengths(newScene.source),[{wavelength:550,weight:1}]);
  assert.deepEqual(newScene.elements.map(e=>e.group),old.scene.elements.map(e=>e.group));
});

test('old stop and retarder geometry defaults follow the ray model and leave the snapshot intact', () => {
  const old=advanced('stop');
  old.scene.elements=[{id:'stop',x:5,type:'stop',aperture:70},{id:'wp',x:10,type:'retarder',aperture:130}];
  const next=wave.fromPackage(old);
  assert.equal(next.elements[0].outerDiameter,110);
  assert.deepEqual([next.elements[1].axisAngle,next.elements[1].retardance,next.elements[1].referenceWavelength],[0,90,550]);
  assert.deepEqual(next.origin,JSON.parse(JSON.stringify(old)));
});

test('reference-wavelength phase step and blank material are independent power and OPD maps', () => {
  const step=wave.makeMap('step',16,4,2,532);
  assert.ok(step.t.every(t=>t===1));
  assert.equal(step.opd[0],0);
  assert.equal(step.opd[15],133);
  const blank=wave.makeMap('blank',16,4,2,532);
  assert.ok(blank.t.concat(blank.r,blank.s,blank.opd).every(v=>v===0));
  assert.notEqual(blank.t,blank.s);
});

test('spectrum respects wavelengths and integrates normalized power once', () => {
  const src={wavelength:400,bandwidth:120,spectrum:'band'};
  const lines=wave.wavelengths(src);
  assert.equal(lines[0].wavelength,380);
  assert.equal(lines.at(-1).wavelength,460);
  assert.equal(lines[0].weight,lines[1].weight/2);
  assert.equal(lines.reduce((s,l)=>s+l.weight,0),1);
  assert.deepEqual(wave.wavelengths({...src,spectrum:'rgb'}).map(l=>l.wavelength),[486.1327,546.074,656.2725]);
});

test('editable 4f configuration round trips and validates corrupted maps, IDs and sampling', () => {
  const src=wave.createDefault(), pkg=wave.exportPackage(src), obj=src.elements.find(e=>e.map);
  assert.equal(pkg.version,1);
  assert.deepEqual(wave.fromPackage(pkg),src);
  assert.deepEqual(src.elements.filter(e=>e.type==='thinLens').map(e=>[e.x,e.focalLength]),[[80,80],[240,80]]);
  assert.equal(src.elements.find(e=>e.type==='probe').x,160);
  obj.map.t[0]=0.9; obj.map.s[0]=0.2;
  assert.throws(()=>wave.exportPackage(src));
  obj.map.s[0]=0; obj.map.opd.pop();
  assert.throws(()=>wave.exportPackage(src));
  const damaged=structuredClone(pkg);
  damaged.scene.elements[1].id=damaged.scene.elements[0].id;
  assert.throws(()=>wave.fromPackage(damaged));
  pkg.scene.settings.n=1000000;
  assert.throws(()=>wave.fromPackage(pkg));
  assert.throws(()=>wave.makeMap('blank',65536,4,4));
});

test('observer crop and reference OPD survive export, including snapshots before these controls existed', () => {
  const scene=wave.createDefault();
  scene.settings.outputWidth=.2; scene.settings.referenceOPD=-137.5;
  assert.deepEqual(wave.fromPackage(wave.exportPackage(scene)).settings,scene.settings);
  delete scene.settings.outputWidth;delete scene.settings.referenceOPD;
  assert.doesNotThrow(()=>wave.exportPackage(scene));
  scene.settings.referenceOPD=Infinity;
  assert.throws(()=>wave.exportPackage(scene));
});
