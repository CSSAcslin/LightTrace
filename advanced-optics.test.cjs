const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('./advanced-optics.js');

const source = {type:'collimated', x:-100, y:0, width:30, angle:0, wavelength:550, rays:7};
const lens = {id:'L1',type:'lens',x:0,y:0,angle:0,aperture:42,thickness:12,
  material:'BK7',r1:65,r2:-65,k1:0,k2:0,a41:0,a42:0};
const screen = {id:'D',type:'screen',x:95,y:0,angle:0,aperture:200};
const run = (elements, options={}) => O.simulate({source:{...source,...options},elements});
function near(actual, expected, tolerance=1e-7){
  assert.ok(Math.abs(actual-expected)<tolerance,`expected ${actual} within ${tolerance} of ${expected}`);
}
function axisCross(ray){
  const last=ray.events.findLast(e=>e.kind==='refract');
  return last.x-last.y*last.outDirection.x/last.outDirection.y;
}

test('glass dispersion reproduces catalogue d-line index and F/C separation',()=>{
  near(O.indexAt('BK7',587.5618),1.51680,.00001);
  near(O.indexAt('F2',587.5618),1.62004,.00001);
  near(O.indexAt('SILICA',587.5618),1.45846,.00001);
  near(O.indexAt('F2',486.1327)-O.indexAt('F2',656.2725),.017050,.000003);
});
test('signed image-space focal lengths round-trip for both lens surfaces and dispersive glass',()=>{
  for(const [radius,n1,n2,focus] of [[60,1,1.5,180],[-60,1.5,1,120],[-60,1,1.5,-180],[60,1.5,1,-120]]){
    near(O.surfaceFocalLength(radius,n1,n2),focus);
    near(O.radiusFromSurfaceFocus(focus,n1,n2),radius);
  }
  const blue=O.indexAt('F2',486.1327), red=O.indexAt('F2',656.2725);
  const radius=O.radiusFromSurfaceFocus(150,1,blue);
  near(O.surfaceFocalLength(radius,1,blue),150);
  assert.ok(O.surfaceFocalLength(radius,1,red)>150);
});
test('plane or index-matched surfaces have zero power and invalid focal requests are rejected',()=>{
  assert.equal(O.surfaceFocalLength(0,1,1.5),Infinity);
  assert.equal(O.surfaceFocalLength(-120,1,1),Infinity);
  assert.equal(O.radiusFromSurfaceFocus(Infinity,1,1.5),0);
  assert.equal(O.radiusFromSurfaceFocus(-Infinity,1.5,1),0);
  assert.ok(Number.isNaN(O.radiusFromSurfaceFocus(100,1,1)));
  assert.ok(Number.isNaN(O.radiusFromSurfaceFocus(0,1,1.5)));
  for(const [invalid,target] of [[NaN,120],[0,Infinity],[-1,120],[Infinity,120]]){
    assert.ok(Number.isNaN(O.radiusFromSurfaceFocus(target,invalid,1)));
    assert.ok(Number.isNaN(O.surfaceFocalLength(30,1,invalid)));
  }
});
test('surface designs keep distinct vertex and principal-plane focal lengths on the local lens axis',()=>{
  const designed={...lens,material:'CUSTOM',n:1.5,x:20,y:10,angle:30,thickness:12,
    r1:O.radiusFromSurfaceFocus(180,1,1.5),r2:O.radiusFromSurfaceFocus(120,1.5,1)};
  const local=O.lensParaxial(designed);
  const power=2/120-(12/1.5)/120**2;
  near(local.efl,1/power);
  near(local.bfl,(1-(12/1.5)/120)/power);
  assert.deepEqual(local,run([designed]).lensMetrics[0]);
  assert.ok(O.lensParaxial(lens,486.1327).efl<O.lensParaxial(lens,656.2725).efl);
});
test('plane parallel plate obeys Snell and accumulates OPL in each medium',()=>{
  const plate={...lens,aperture:120,thickness:10,material:'CUSTOM',n:1.5,r1:0,r2:0};
  const ray=run([plate,screen],{x:-10,angle:10,width:0}).rays[0];
  const [entry,exit,detector]=ray.events;
  const inside=Math.asin(Math.sin(10*Math.PI/180)/1.5);
  near(entry.outAngle,inside*180/Math.PI);
  near(exit.outAngle,10);
  near(exit.y-entry.y,10*Math.tan(inside));
  near(exit.opl-entry.opl,1.5*10/Math.cos(inside));
  assert.equal(detector.kind,'detect');
  assert.deepEqual([entry.n1,entry.n2,exit.n1,exit.n2],[1,1.5,1.5,1]);
});
test('paraxial powers, principal planes and ray focus agree for a thick lens',()=>{
  const result=run([lens],{width:.05,rays:3});
  const n=O.indexAt('BK7',550),phi=(n-1)/65;
  const expected=1/(2*phi-lens.thickness/n*phi**2);
  const p=result.paraxial;
  near(p.efl,expected);near(p.bfl,expected*(1-lens.thickness*phi/n));
  near(p.matrix.A*p.matrix.D-p.matrix.B*p.matrix.C,1);
  near(p.h1X-p.frontFocalX,p.efl);near(p.backFocalX-p.h2X,p.efl);
  near(axisCross(result.rays[0]),p.backFocalX,.00005);
});
test('spherical and longitudinal chromatic aberrations resolve in traced finite rays',()=>{
  const result=run([lens],{spectrum:'rgb',width:36,rays:9});
  const marginal=result.rays.find(r=>r.pupil===1), inner=result.rays.find(r=>r.pupil===.25);
  assert.ok(axisCross(marginal)<axisCross(inner)-1);
  const red=result.rays.findLast(r=>r.pupil===.25);
  assert.ok(axisCross(red)>axisCross(inner)+.5);
});
test('aspheric intersections lie on both declared surfaces, preserve tangential momentum',()=>{
  const e={...lens,k1:-1.3,k2:-.7,a41:1.8e-6,a42:-1.1e-6};
  const result=run([e,screen],{x:-15,width:22,angle:5});
  for(const ray of result.rays){
    assert.equal(ray.status,'detected');
    const [a,b]=ray.events;assert.equal(a.surface,'S1');assert.equal(b.surface,'S2');
    near(a.x,O.sag(a.y,e.r1,e.k1,e.a41),1e-7);
    near(b.x,e.thickness+O.sag(b.y,e.r2,e.k2,e.a42),1e-7);
    for(const hit of [a,b]){
      const t={x:-hit.normal.y,y:hit.normal.x};
      near(hit.n1*(hit.inDirection.x*t.x+hit.inDirection.y*t.y),
        hit.n2*(hit.outDirection.x*t.x+hit.outDirection.y*t.y));
    }
  }
});
test('source and lens rotate together without changing the local refraction',()=>{
  const base=run([lens],{width:16});
  const tilt=37, rad=tilt*Math.PI/180;
  const rotated=run([{...lens,x:20,y:-13,angle:tilt}],{x:20-100*Math.cos(rad),y:-13-100*Math.sin(rad),angle:tilt,width:16});
  assert.equal(rotated.paraxial.valid,false);
  near(rotated.lensMetrics[0].bfl,base.paraxial.bfl);
  for(let j=0;j<base.rays.length;j++){
    const a=base.rays[j].events[1], b=rotated.rays[j].events[1];
    near(a.localY,b.localY);near(b.outAngle-a.outAngle,tilt);
  }
});
test('finite stop clears central rays, blocks its blades, allows external rays to bypass',()=>{
  const stop={type:'stop',id:'A',x:0,y:0,aperture:10,outerDiameter:25};
  const result=run([stop,screen],{width:40,rays:9});
  assert.equal(result.rays.find(r=>r.pupil===0).events[0].kind,'pass');
  assert.equal(result.rays.find(r=>r.pupil===.5).status,'blocked');
  assert.equal(result.rays.find(r=>r.pupil===1).events[0].kind,'detect');
  assert.equal(result.detectors[0].hits.length,7);
});
test('mirror directs light into an off-axis detector at its physical position',()=>{
  const mirror={id:'M',type:'mirror',x:0,y:0,angle:45,aperture:100};
  const detector={...screen,x:0,y:-80,angle:90};
  const result=run([detector,mirror],{width:12});
  assert.equal(result.detectors[0].hits.length,7);
  for(const ray of result.rays){
    const [bounce,hit]=ray.events;
    near(bounce.outAngle,-90);near(hit.y,-80);near(hit.localY,-hit.x);
  }
});
test('double pass traverses second surface first on return and restores air index',()=>{
  const plate={...lens,r1:0,r2:0};
  const result=run([plate,{...screen,x:-120},{id:'M',type:'mirror',x:35,y:0,angle:0,aperture:100}]);
  const ray=result.rays[3];
  assert.deepEqual(ray.events.map(e=>e.surface),['S1','S2','plane','S2','S1','plane']);
  near(ray.events[3].n1,1);near(ray.events[4].n2,1);
  assert.equal(ray.status,'detected');
});
test('total internal reflection retains material until absorbed by lens rim',()=>{
  const plate={...lens,material:'CUSTOM',n:1.5,r1:0,r2:0,thickness:10,aperture:120};
  const ray=run([plate],{x:5,width:0,angle:60}).rays[0];
  assert.equal(ray.events[0].kind,'tir');near(ray.events[0].incidence,60);
  near(ray.events[0].outAngle,120);near(ray.events[1].n1,1.5);
  assert.equal(ray.events.at(-1).surface,'rim');assert.equal(ray.status,'blocked');
});
test('transmission grating satisfies signed sine law, evanescent orders terminate',()=>{
  const grating={id:'G',type:'grating',x:0,y:0,angle:0,aperture:120,order:-1,lines:600};
  const ray=run([grating],{x:-5,angle:8,width:0,wavelength:500}).rays[0];
  near(Math.sin(ray.events[0].outAngle*Math.PI/180),Math.sin(8*Math.PI/180)-.3);
  const cut=run([{...grating,order:4}],{wavelength:550}).rays[0];
  assert.equal(cut.status,'evanescent');assert.equal(cut.events[0].outAngle,null);
});
test('stop/screen and crossed lenses report unambiguous empty-state results',()=>{
  const overlap=run([lens,{...lens,id:'L2',x:6}]);assert.equal(overlap.rays.length,0);
  assert.match(overlap.warnings.join(''),/重叠/);
  const impossible=run([{...lens,r1:10}]);assert.match(impossible.warnings.join(''),/定义域|相交/);
  const miss=run([{...screen,y:300}]);assert.equal(miss.detectors[0].rms,null);assert.equal(miss.detectors[0].hits.length,0);
});
test('multiple equally sampled object fields and band wavelengths have distinct ray identities',()=>{
  const result=run([screen],{type:'field',height:12,spread:0,rays:3,spectrum:'band',wavelength:390,bandwidth:80});
  assert.deepEqual(result.wavelengths,[380,392.5,405,417.5,430]);
  assert.equal(result.rays.length,45);assert.equal(new Set(result.rays.map(r=>r.id)).size,45);
  assert.deepEqual([...new Set(result.detectors[0].hits.map(h=>h.y))],[-6,0,6]);
});
test('2-lens 4f principal-plane spacing relays the object 1:1 with zero net optical power',()=>{
  const p=run([lens]).paraxial;
  const lens2={...lens,id:'L2',x:p.h2X+2*p.efl-p.h1X};
  const relay=run([lens,lens2],{type:'point',x:p.frontFocalX,spread:2}).paraxial;
  assert.equal(relay.efl,null);near(relay.magnification,-1);
  near(relay.imageX,lens2.x+p.backFocalX);
});

const object = {id:'O', type:'object', x:0, y:0, angle:0, aperture:33,
  interaction:'scatter', scatterAngle:20, scatterSamples:5,
  n:1.5, wedge:0, thickness:6, pattern:Array(33).fill(1)};
const total = values => values.reduce((sum,value)=>sum+value,0);

test('33-bin scatter mask conserves incident and emitted power across paths and wavelengths',()=>{
  const pattern=Array.from({length:33},(_,i)=>i/32);
  const result=run([{...object, pattern},screen],{width:32,rays:33,spectrum:'rgb'});
  assert.equal(result.emittedCount,99);
  assert.equal(result.rays.length,3*(1+32*5));
  const profile=result.objects[0], detector=result.detectors[0];
  near(detector.weight,3*total(pattern));
  for(const line of profile.byWavelength){
    assert.deepEqual(line.incident,Array(33).fill(1));
    assert.deepEqual(line.outgoing,pattern);
  }
  for(let id=0;id<result.emittedCount;id++){
    const paths=result.rays.filter(r=>r.sourceId===id);
    near(total(paths.map(r=>r.weight)),pattern[id%33]);
    if(id%33===0){assert.equal(paths[0].events[0].kind,'blocked');continue;}
    const angles=paths.map(r=>r.events[0].scatterOffset);
    assert.deepEqual(angles.map(a=>Math.round(a)),[-16,-8,0,8,16]);
    assert.ok(paths[2].weight>paths[0].weight);
    assert.ok(paths.every(r=>r.objectHits[0].patternIndex===id%33));
  }
  near(detector.centroid,total(detector.hits.map(h=>h.y*h.weight))/detector.weight);
  // Each sampled object point emits a symmetric angular lobe.
  near(detector.centroid,total(pattern.map((v,i)=>(i-16)*v))/total(pattern));
  near(detector.rms,Math.sqrt(total(detector.hits.map(h=>h.weight*(h.y-detector.centroid)**2))/detector.weight));
});

test('pattern reflectivity scales a folded ray, and a miss stays unmodulated',()=>{
  const mirror={...object,interaction:'reflect',angle:45,pattern:Array(33).fill(.4)};
  const result=run([mirror,{...screen,x:0,y:-80,angle:90},{...screen,id:'straight'}],{width:60,rays:5});
  const center=result.rays.find(r=>r.pupil===0);
  assert.equal(center.events[0].kind,'reflect');near(center.events[0].outAngle,-90);
  near(center.weight,.4);assert.equal(center.objectHits[0].patternIndex,16);
  const bypass=result.detectors.find(d=>d.id==='straight');
  assert.ok(bypass.hits.length>0);
  assert.ok(bypass.hits.every(h=>h.weight===1&&h.objectHits.length===0));
});

test('flat refractive object has parallel emergent rays; wedge deflection follows two-interface Snell law',()=>{
  const plate={...object,interaction:'refract',pattern:Array(33).fill(.25)};
  const r=run([plate,screen],{width:0,x:-6,angle:18}).rays[0];
  near(r.events[1].outAngle,18);
  assert.deepEqual(r.events.slice(0,2).map(e=>e.surface),['S1','S2']);
  near(r.weight,.25);assert.equal(r.objectHits.length,1);
  const wedge={...plate,wedge:10};
  const ray=run([wedge,screen],{width:0}).rays[0];
  const theta=10*Math.PI/180;
  near(ray.events[1].outAngle,Math.asin(1.5*Math.sin(theta))*180/Math.PI-10);
  near(ray.events[1].x,wedge.thickness+ray.events[1].localY*Math.tan(theta));
  near(ray.events[1].n1,1.5);near(ray.events[1].n2,1);
  assert.ok(O.validateObject({...wedge,thickness:1}));
  assert.ok(run([wedge,{...lens,x:2}]).warnings.some(m=>m.includes('重叠')));
});

test('a second diffuse object respects the branch budget and relayed flux',()=>{
  const second={...object,id:'O2',x:5,aperture:100,pattern:Array(33).fill(.5)};
  const result=run([object,second,{...screen,aperture:500}],{width:0,rays:3});
  assert.equal(result.rays.length,3*object.scatterSamples);
  near(result.detectors[0].weight,1.5);
  near(total(result.objects[1].incident),3);
  near(total(result.objects[1].outgoing),1.5);
  assert.ok(result.rays.every(r=>r.events[1].secondaryScatter===true));
});

test('paraxial image for a patterned scatter object is conjugate to the illuminated plane',()=>{
  const mask={...object,x:-140};
  const scene=run([mask,lens,screen],{x:-200});
  const point=run([lens,screen],{type:'point',x:mask.x});
  near(scene.paraxial.imageX,point.paraxial.imageX);
  near(scene.paraxial.magnification,point.paraxial.magnification);
  assert.equal(run([{...mask,angle:20},lens,screen],{x:-200}).paraxial.valid,false);
});
