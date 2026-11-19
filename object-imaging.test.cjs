// Exercise the same instrument, pattern samples, and ray geometry as the UI presets.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {presets}=require('./advanced-editor.js');
const optics=require('./advanced-optics.js');
const sceneFor=k=>structuredClone(presets[k]);
function run(s){
  const r=optics.simulate(s);
  assert.deepEqual(r.warnings,[]);
  const hits=r.detectors[0].hits;
  return {r,hits,power:hits.reduce((s,h)=>s+h.weight,0)};
}
function conditionalVariance(hits){
  const groups=new Map();for(const h of hits){const id=h.objectHits[0].patternIndex;
    if(!groups.has(id))groups.set(id,[]);groups.get(id).push(h);}
  let power=0,weightedVar=0;
  for(const group of groups.values()){const sum=group.reduce((s,h)=>s+h.weight,0);
    const center=group.reduce((s,h)=>s+h.y*h.weight,0)/sum;
    weightedVar+=group.reduce((s,h)=>s+h.weight*(h.y-center)**2,0);power+=sum;}
  return weightedVar/power;
}
test('three ready-to-use object experiments illuminate their painted bins and scale detector power linearly with grey',()=>{
  for (const name of ['objectScatter','objectReflect','objectRefract']){
    const s=sceneFor(name),obj=s.elements.find(e=>e.type==='object'),base=run(s);
    assert.ok(base.power>1,name+' has no object image');
    const detected=new Set(base.hits.map(h=>h.objectHits[0].patternIndex));
    for(const [i,t] of obj.pattern.entries())assert.equal(detected.has(i),t>0,name+' bin '+i);
    obj.pattern=obj.pattern.map(v=>v*.5);
    assert.ok(Math.abs(run(s).power/base.power-.5)<1e-8,name+' grey response');
    obj.pattern.fill(0);assert.equal(run(s).power,0,name+' black target');
  }
});
test('a real lens images the scattering target inverted; shifting the screen degrades the image of each object point',()=>{
  const s=sceneFor('objectScatter'),focused=run(s);
  const bands=new Map();for(const h of focused.hits){let k=h.objectHits[0].patternIndex;if(!bands.has(k))bands.set(k,[]);bands.get(k).push(h.y);}
  const indices=[...bands.keys()].sort((a,b)=>a-b);
  assert.ok(Math.min(...bands.get(indices[0]))>Math.max(...bands.get(indices.at(-1))));
  const screen=s.elements.find(e=>e.type==='screen');screen.x+=45;screen.aperture*=3;
  assert.ok(conditionalVariance(run(s).hits)>conditionalVariance(focused.hits)*3);
});
test('changing the wedge angle moves the measured patterned image even though the texture does not change',()=>{
  const s=sceneFor('objectRefract'),obj=s.elements.find(e=>e.type==='object');
  const tilted=run(s);obj.wedge=0;const parallel=run(s);
  assert.ok(Math.abs(tilted.r.detectors[0].centroid-parallel.r.detectors[0].centroid)>1);
});
