const {test} = require('node:test');
const assert = require('node:assert/strict');
const {simulate, validateObject, cellFractions} = require('./advanced-optics.js');

const source = {type:'collimated', x:-10, y:0, angle:0, rays:3, width:0, wavelength:550};
const plate = {type:'object', id:'sample', x:0, y:0, angle:0, aperture:80, thickness:10,
  interaction:'mixed', fractions:{scatter:.2, reflection:.3, transmission:.4, absorption:.1},
  n:1.5, wedge:0, pattern:Array(33).fill(1), scatterAngle:18, scatterSamples:5};
const bare = {scatter:0, reflection:0, transmission:1, absorption:0};
const detector = (id,x) => ({type:'screen',id,x,y:0,angle:0,aperture:300});

function near(a,b,tolerance=1e-10) {
  assert.ok(Number.isFinite(a) && Math.abs(a-b)<=tolerance, `${a} versus ${b}`);
}
function balanced(result) {
  for (const row of [result.energy,...result.energyByWavelength])
    near(row.emitted,row.absorbed+row.blocked+row.detected+row.escaped+row.unresolved);
  for (const obj of result.objects) {
    for (const row of [obj.energy,...obj.byWavelength.map(w=>w.energy)])
      near(row.incident,row.absorbed+row.scattered+row.reflected+row.transmitted);
  }
}
test('one gray bin produces simultaneous backward scattering, specular reflection, refraction and absorption',()=>{
  const result=simulate({source:{...source,spectrum:'rgb'}, elements:[
    {...plate,pattern:Array(33).fill(.5)},detector('back',-25),detector('inside',5)]});
  assert.deepEqual(result.warnings,[]);
  const hit=result.rays[0].events[0];
  near(hit.fresnel,.04);
  near(hit.energy.absorbed,.55);
  near(hit.energy.reflected,.158);
  near(hit.energy.scattered,.1);
  near(hit.energy.transmitted,.192);
  near(result.detectors[0].weight,9*.258);
  near(result.detectors[1].weight,9*.192);
  assert.equal(result.rays.filter(r=>r.events[0].kind==='scatter').length,9*5);
  for(const r of result.rays) {
    const event=r.events[0];
    if(event.kind==='scatter') assert.ok(event.outDirection.x<0);
  }
  balanced(result);
});
test('two uncoated parallel surfaces recover analytical incoherent slab R and T including internal reflections',()=>{
  const result=simulate({source,elements:[{...plate,fractions:bare},detector('back',-25),detector('front',30)]});
  const singleR=.04;
  near(result.detectors[0].weight,3*2*singleR/(1+singleR),3e-8);
  near(result.detectors[1].weight,3*(1-singleR)/(1+singleR),3e-8);
  assert.ok(result.rays.some(r=>r.events.filter(e=>e.surface==='S1').length>1));
  assert.ok(result.energy.unresolved>0 && result.energy.unresolved<6e-8);
  assert.equal(result.energy.absorbed,0);
  balanced(result);
});
test('Snell and oblique unpolarized Fresnel agree at Brewster incidence, including the matched-index limit',()=>{
  const theta=Math.atan(plate.n), input={...source,x:-2,angle:theta*180/Math.PI};
  const result=simulate({source:input,elements:[{...plate,fractions:bare},detector('inner',2)]});
  const event=result.rays.find(r=>r.events[0].kind==='refract').events[0];
  near(event.outAngle,90-input.angle);
  near(event.fresnel,.5*((1-plate.n**2)/(1+plate.n**2))**2);
  balanced(result);
  const matched=simulate({source:input,elements:[{...plate,fractions:bare,n:1}]});
  assert.equal(matched.rays.length,3);
  near(matched.rays[0].events[0].fresnel,0);
  near(matched.rays[0].events[0].outAngle,input.angle);
  balanced(matched);
});
test('mixed plate from inside handles total internal reflection and finite opaque rims without creating absorption',()=>{
  const result=simulate({source:{...source,x:5,angle:60},elements:[{...plate,fractions:bare}]});
  const hits=result.rays[0].events;
  assert.equal(hits[0].surface,'S2');
  assert.equal(hits[0].kind,'tir');
  near(hits[0].fresnel,1);
  near(hits[0].weightIn,hits[0].weightOut);
  assert.equal(hits.at(-1).surface,'rim');
  near(result.energy.blocked,3);
  near(result.energy.absorbed,0);
  balanced(result);
});
test('a black object absorbs only its aperture; rays outside escape with full energy',()=>{
  const result=simulate({source:{...source,width:100},elements:[{...plate,pattern:Array(33).fill(0)}]});
  near(result.energy.absorbed,1);
  near(result.energy.escaped,2);
  near(result.energy.blocked,0);
  const center=result.rays.find(r=>r.pupil===0);
  assert.equal(center.events[0].kind,'absorb');
  assert.equal(center.weight,0);
  balanced(result);
});
test('a mirror cavity leaves power in unresolved paths and repeated visits close both ledgers',()=>{
  const mirror={type:'mirror',id:'left',x:-20,y:0,angle:0,aperture:500};
  const result=simulate({source,elements:[mirror,{...plate,fractions:{scatter:0,reflection:.99,transmission:.01,absorption:0}}]});
  assert.ok(result.energy.unresolved>1);
  assert.ok(result.objects[0].energy.incident>3);
  near(result.energy.absorbed,0);
  balanced(result);
});
test('malformed fractions cannot inject power through a scene import',()=>{
  for(const fractions of [{...bare,other:1,absorption:.01},{...bare,transmission:2,scatter:-1},
      null,{}, {...bare,transmission:NaN}])
    assert.match(validateObject({...plate,fractions}),/100%/);
});

function blankChannels() {
  return {scatter:Array(33).fill(0), reflection:Array(33).fill(0), transmission:Array(33).fill(0)};
}
test('painted channels use their local absolute shares and unpainted light is absorbed',()=>{
  const channels=blankChannels();
  channels.scatter[0]=.2;
  channels.reflection[0]=.3;
  channels.transmission[0]=.1;
  channels.transmission[32]=1;
  const sample={...plate,channels,n:1,scatterModel:'hg',scatterG:.8};
  const result=simulate({source:{...source,width:79},elements:[sample,detector('rear',-20),detector('inside',2)]});
  assert.deepEqual(result.warnings,[]);
  const e=result.objects[0].energy;
  near(e.incident,3);
  near(e.scattered,.2); near(e.reflected,.3); near(e.transmitted,1.1); near(e.absorbed,1.4);
  const central=result.rays.find(r=>r.pupil===0);
  near(central.events[0].patternValue,0); // old all-white gray mask must not override the blank cell
  near(central.events[0].cellFractions.absorption,1);
  assert.equal(central.events[0].kind,'absorb');
  balanced(result);
  channels.scatter[0]=.7;
  assert.match(validateObject(sample),/100%/);
  channels.scatter.pop();
  assert.match(validateObject(sample),/33/);
});
test('legacy masks convert to absolute cell paints without changing energy at the patterned face',()=>{
  const original={...plate,pattern:Array.from({length:33},(_,i)=>i/32)};
  const channels=blankChannels();
  for(let i=0;i<33;i++){
    const cell=cellFractions(original,i);
    for(const key of Object.keys(channels))channels[key][i]=cell[key];
  }
  const scene={source:{...source,width:70,rays:33},elements:[original]};
  const before=simulate(scene), after=simulate({...scene,elements:[{...original,channels}]});
  for(const key of Object.keys(before.energy))near(before.energy[key],after.energy[key]);
  balanced(after);
});
test('particle phase functions use the incident direction at oblique incidence and select the outgoing medium by hemisphere',()=>{
  const scat={scatter:1,reflection:0,transmission:0,absorption:0};
  for(const model of ['mie','hg']){
    const sample={...plate,scatterModel:model, fractions:scat, scatterG:.7, mieIndex:1.46,
      mieDiameter:1, scatterAngle:180, scatterSamples:17};
    const result=simulate({source:{...source,angle:30},elements:[sample,detector('back',-20),detector('inside',2)]});
    assert.deepEqual(result.warnings,[]);
    const rays=result.rays.filter(ray=>ray.sourceId===0);
    const center=rays.find(ray=>Math.abs(ray.events[0].scatterOffset)<1e-8);
    assert.ok(center);
    near(center.events[0].outAngle,30);
    near(center.events[1].n1,sample.n);
    assert.equal(center.events[0].kind,'scatter');
    assert.equal(center.events[0].scatterSide,'opposite');
    const back=rays.find(ray=>ray.events[0].outDirection.x<-.2);
    assert.ok(back);
    assert.equal(back.events[0].scatterSide,'incident');
    near(back.events[1].n1,1);
    assert.ok(center.events[0].weightOut>back.events[0].weightOut);
    balanced(result);
  }
});
test('index-matched Mie particles transfer their scatter share to the dielectric channel',()=>{
  const channels=blankChannels(); channels.scatter.fill(.8);
  const object={...plate,channels,scatterModel:'mie',mieIndex:1,mieDiameter:1};
  const result=simulate({source,elements:[object,detector('back',-20),detector('inside',2)]});
  assert.deepEqual(result.warnings,[]);
  assert.ok(result.rays.every(ray=>ray.events[0].mieMatched));
  const e=result.objects[0].energy;
  near(e.absorbed,.6); near(e.scattered,0); near(e.reflected,2.4*.04); near(e.transmitted,2.4*.96);
  balanced(result);
});
